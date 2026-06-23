package com.gonidhi.admin;

import android.content.res.AssetFileDescriptor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.tensorflow.lite.Interpreter;
import org.tensorflow.lite.Tensor;
import org.tensorflow.lite.nnapi.NnApiDelegate;

import java.io.FileInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.MappedByteBuffer;
import java.nio.channels.FileChannel;
import java.util.Arrays;

/**
 * TFLiteDetectorPlugin — Native YOLO muzzle detector for Capacitor.
 *
 * Supports both float32 and INT8 quantized TFLite models.
 * Output tensor shape is detected dynamically at load time.
 *
 * INT8 quantization note:
 * - Confidence scores may be ~3-5% lower than float32 models
 * - We use a low pre-filter threshold (0.20) here and let the
 *   JavaScript analysis loop apply the real threshold (0.45)
 */
@CapacitorPlugin(name = "TFLiteDetector")
public class TFLiteDetectorPlugin extends Plugin {

    private static final String TAG = "TFLiteDetector";
    private static final String MODEL_FILENAME = "muzzle_detector.tflite";
    private static final int INPUT_SIZE = 640;

    // Low pre-filter: lets the JS side (MUZZLE_CONF_THRESHOLD = 0.45) do the real filtering.
    // INT8 quantization can drop confidence by ~3-5%, so we keep the native filter generous.
    private static final float CONFIDENCE_THRESHOLD = 0.20f;

    private Interpreter interpreter;
    private boolean isLoaded = false;

    // Output shape detected at load time — handles both [1,5,8400] and [1,8400,5]
    private int numAnchors = 8400;
    private int numOutputChannels = 5; // 4 box coords + 1 class
    private boolean isChannelsLast = false; // true if [1, 8400, 5], false if [1, 5, 8400]

    @PluginMethod()
    public void loadModel(PluginCall call) {
        if (isLoaded) {
            JSObject ret = new JSObject();
            ret.put("loaded", true);
            ret.put("message", "Model already loaded");
            call.resolve(ret);
            return;
        }

        try {
            MappedByteBuffer modelBuffer = loadModelFile(MODEL_FILENAME);
            Interpreter.Options options = new Interpreter.Options();
            options.setNumThreads(2); // Limit CPU threads to prevent thermal throttling

            // Try NNAPI first (best for INT8 on NPU/DSP — lowest power)
            boolean nnApiAvailable = false;
            try {
                NnApiDelegate nnApiDelegate = new NnApiDelegate();
                options.addDelegate(nnApiDelegate);
                nnApiAvailable = true;
                Log.i(TAG, "NNAPI delegate enabled — using NPU/DSP for cool inference");
            } catch (Exception e) {
                Log.w(TAG, "NNAPI not available, trying GPU delegate: " + e.getMessage());
            }

            // Fallback to native CPU if NNAPI fails
            if (!nnApiAvailable) {
                Log.i(TAG, "NNAPI not available, falling back to highly-optimized native CPU");
            }

            interpreter = new Interpreter(modelBuffer, options);

            // ── Detect output tensor shape dynamically ──
            // YOLOv8 can output [1, 5, 8400] (channels-first) or [1, 8400, 5] (channels-last)
            // INT8 quantized models may have slightly different layouts
            Tensor outputTensor = interpreter.getOutputTensor(0);
            int[] outputShape = outputTensor.shape();
            Log.i(TAG, "Output tensor shape: " + Arrays.toString(outputShape));
            Log.i(TAG, "Output tensor type: " + outputTensor.dataType());

            if (outputShape.length == 3) {
                if (outputShape[1] == 8400) {
                    // [1, 8400, 5] — channels last
                    isChannelsLast = true;
                    numAnchors = outputShape[1];
                    numOutputChannels = outputShape[2];
                } else if (outputShape[2] == 8400) {
                    // [1, 5, 8400] — channels first
                    isChannelsLast = false;
                    numOutputChannels = outputShape[1];
                    numAnchors = outputShape[2];
                } else {
                    // Unknown layout — try best guess
                    numAnchors = Math.max(outputShape[1], outputShape[2]);
                    numOutputChannels = Math.min(outputShape[1], outputShape[2]);
                    isChannelsLast = outputShape[1] > outputShape[2];
                }
            }
            Log.i(TAG, "Detected layout: anchors=" + numAnchors +
                    " channels=" + numOutputChannels +
                    " channelsLast=" + isChannelsLast);

            isLoaded = true;

            // Warmup pass — pre-allocate internal buffers
            ByteBuffer warmupInput = ByteBuffer.allocateDirect(1 * INPUT_SIZE * INPUT_SIZE * 3 * 4);
            warmupInput.order(ByteOrder.nativeOrder());
            float[] warmupOutput = new float[numAnchors * numOutputChannels];
            // Use the flat array approach for warmup to handle both layouts
            float[][][] warmupOut3d;
            if (isChannelsLast) {
                warmupOut3d = new float[1][numAnchors][numOutputChannels];
            } else {
                warmupOut3d = new float[1][numOutputChannels][numAnchors];
            }
            try {
                interpreter.run(warmupInput, warmupOut3d);
            } catch (Exception e) {
                Log.w(TAG, "Warmup failed (non-critical): " + e.getMessage());
            }
            warmupInput.clear();

            JSObject ret = new JSObject();
            ret.put("loaded", true);
            ret.put("nnapi", nnApiAvailable);
            ret.put("channelsLast", isChannelsLast);
            ret.put("anchors", numAnchors);
            call.resolve(ret);

        } catch (Exception e) {
            Log.e(TAG, "Failed to load TFLite model: " + e.getMessage(), e);
            call.reject("Failed to load model: " + e.getMessage());
        }
    }

    @PluginMethod()
    public void detect(PluginCall call) {
        if (!isLoaded || interpreter == null) {
            call.reject("Model not loaded. Call loadModel() first.");
            return;
        }

        String imageBase64 = call.getString("imageBase64");
        if (imageBase64 == null || imageBase64.isEmpty()) {
            call.reject("imageBase64 is required");
            return;
        }

        Bitmap bitmap = null;
        Bitmap scaledBitmap = null;
        ByteBuffer inputBuffer = null;

        try {
            // Strip data URI prefix if present
            if (imageBase64.contains(",")) {
                imageBase64 = imageBase64.substring(imageBase64.indexOf(",") + 1);
            }

            // Decode base64 to bitmap
            byte[] decodedBytes = Base64.decode(imageBase64, Base64.DEFAULT);
            bitmap = BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.length);
            decodedBytes = null; // Free raw bytes immediately

            if (bitmap == null) {
                call.reject("Failed to decode image");
                return;
            }

            // Center crop to square, then resize to model input size
            int size = Math.min(bitmap.getWidth(), bitmap.getHeight());
            int x = (bitmap.getWidth() - size) / 2;
            int y = (bitmap.getHeight() - size) / 2;
            Bitmap croppedBitmap = Bitmap.createBitmap(bitmap, x, y, size, size);
            bitmap.recycle();
            bitmap = null;

            scaledBitmap = Bitmap.createScaledBitmap(croppedBitmap, INPUT_SIZE, INPUT_SIZE, true);
            croppedBitmap.recycle();

            // Convert bitmap to float32 ByteBuffer (NHWC format, normalized 0-1)
            inputBuffer = ByteBuffer.allocateDirect(1 * INPUT_SIZE * INPUT_SIZE * 3 * 4);
            inputBuffer.order(ByteOrder.nativeOrder());

            int[] pixels = new int[INPUT_SIZE * INPUT_SIZE];
            scaledBitmap.getPixels(pixels, 0, INPUT_SIZE, 0, 0, INPUT_SIZE, INPUT_SIZE);
            scaledBitmap.recycle();
            scaledBitmap = null;

            for (int pixel : pixels) {
                inputBuffer.putFloat(((pixel >> 16) & 0xFF) / 255.0f); // R
                inputBuffer.putFloat(((pixel >> 8) & 0xFF) / 255.0f);  // G
                inputBuffer.putFloat((pixel & 0xFF) / 255.0f);         // B
            }
            pixels = null;

            // ── Run inference with dynamic output shape ──
            float[][][] output;
            if (isChannelsLast) {
                output = new float[1][numAnchors][numOutputChannels];
            } else {
                output = new float[1][numOutputChannels][numAnchors];
            }
            inputBuffer.rewind();
            interpreter.run(inputBuffer, output);

            // ── Parse output: find best detection ──
            float bestConf = CONFIDENCE_THRESHOLD;
            int bestIdx = -1;
            int numClasses = numOutputChannels - 4;

            if (isChannelsLast) {
                // Layout: [1, 8400, 5] → row[i] = [cx, cy, w, h, conf]
                for (int i = 0; i < numAnchors; i++) {
                    for (int c = 0; c < numClasses; c++) {
                        float conf = output[0][i][4 + c];
                        if (conf > bestConf) {
                            bestConf = conf;
                            bestIdx = i;
                        }
                    }
                }
            } else {
                // Layout: [1, 5, 8400] → output[0][4][i] = conf for anchor i
                for (int c = 0; c < numClasses; c++) {
                    for (int i = 0; i < numAnchors; i++) {
                        float conf = output[0][4 + c][i];
                        if (conf > bestConf) {
                            bestConf = conf;
                            bestIdx = i;
                        }
                    }
                }
            }

            JSObject ret = new JSObject();
            if (bestIdx >= 0) {
                ret.put("conf", bestConf);
                if (isChannelsLast) {
                    ret.put("cx", output[0][bestIdx][0]);
                    ret.put("cy", output[0][bestIdx][1]);
                    ret.put("w", output[0][bestIdx][2]);
                    ret.put("h", output[0][bestIdx][3]);
                } else {
                    ret.put("cx", output[0][0][bestIdx]);
                    ret.put("cy", output[0][1][bestIdx]);
                    ret.put("w", output[0][2][bestIdx]);
                    ret.put("h", output[0][3][bestIdx]);
                }
            } else {
                ret.put("conf", 0);
                ret.put("cx", 0);
                ret.put("cy", 0);
                ret.put("w", 0);
                ret.put("h", 0);
            }

            output = null;
            call.resolve(ret);

        } catch (Exception e) {
            Log.e(TAG, "Detection failed: " + e.getMessage(), e);
            call.reject("Detection failed: " + e.getMessage());
        } finally {
            if (bitmap != null && !bitmap.isRecycled()) bitmap.recycle();
            if (scaledBitmap != null && !scaledBitmap.isRecycled()) scaledBitmap.recycle();
            if (inputBuffer != null) inputBuffer.clear();
        }
    }

    @PluginMethod()
    public void dispose(PluginCall call) {
        if (interpreter != null) {
            interpreter.close();
            interpreter = null;
        }
        isLoaded = false;
        Log.i(TAG, "TFLite interpreter disposed — native memory freed");

        JSObject ret = new JSObject();
        ret.put("disposed", true);
        call.resolve(ret);
    }

    private MappedByteBuffer loadModelFile(String filename) throws IOException {
        AssetFileDescriptor afd = getContext().getAssets().openFd(filename);
        FileInputStream fis = new FileInputStream(afd.getFileDescriptor());
        FileChannel fc = fis.getChannel();
        long startOffset = afd.getStartOffset();
        long declaredLength = afd.getDeclaredLength();
        MappedByteBuffer buffer = fc.map(FileChannel.MapMode.READ_ONLY, startOffset, declaredLength);
        fis.close();
        afd.close();
        return buffer;
    }
}
