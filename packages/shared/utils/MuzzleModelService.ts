import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';

const MODEL_URL = '/model/muzzle/model.json';
const MODEL_INPUT_SIZE: [number, number] = [640, 640];

let cachedModel: tf.GraphModel | null = null;
let loadPromise: Promise<tf.GraphModel> | null = null;

let cachedNimaModel: tf.GraphModel | null = null;
let nimaLoadPromise: Promise<tf.GraphModel> | null = null;

export const isModelsCached = (requiresMuzzle: boolean): boolean => {
    if (requiresMuzzle) return cachedModel !== null && cachedNimaModel !== null;
    return cachedNimaModel !== null;
};

export const preloadMuzzleModel = (): Promise<tf.GraphModel> => {
    // If already loading or loaded, return the existing promise
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
        try {
            await tf.ready();
            const loadedModel = await tf.loadGraphModel(MODEL_URL);

            // WebGL Shader Warm-up (Crucial for instant first-inference)
            const dummy = tf.zeros([1, MODEL_INPUT_SIZE[0], MODEL_INPUT_SIZE[1], 3]);
            const warmupResult = await loadedModel.executeAsync(dummy);

            // Clean up memory safely (handles array of tensors or single tensor)
            tf.dispose(warmupResult);
            dummy.dispose();

            cachedModel = loadedModel;
            console.log('✅ Global AI Model Preloaded & Warmed Up');
            return loadedModel;
        } catch (error) {
            console.error('❌ Failed to preload AI model:', error);
            loadPromise = null; // Reset so we can try again if it fails
            throw error;
        }
    })();

    return loadPromise;
};

// Components call this to get the model. 
// If it's already preloaded, it resolves instantly.
export const getMuzzleModel = async (): Promise<tf.GraphModel> => {
    if (cachedModel) return cachedModel;
    return preloadMuzzleModel();
};

export const preloadNimaModel = (): Promise<tf.GraphModel> => {
    if (nimaLoadPromise) return nimaLoadPromise;

    nimaLoadPromise = (async () => {
        try {
            await tf.ready();
            const nima = await tf.loadGraphModel('/model/nima/model.json');

            // Warm-up NIMA to compile its WebGL shaders
            const dummy = tf.zeros([1, 224, 224, 3]);
            const warmup = nima.predict(dummy) as tf.Tensor;
            tf.dispose([warmup, dummy]);

            cachedNimaModel = nima;
            console.log('✅ Global NIMA Model Preloaded & Warmed Up');
            return nima;
        } catch (error) {
            console.error('❌ Failed to preload NIMA model:', error);
            nimaLoadPromise = null;
            throw error;
        }
    })();

    return nimaLoadPromise;
};

export const getNimaModel = async (): Promise<tf.GraphModel> => {
    if (cachedNimaModel) return cachedNimaModel;
    return preloadNimaModel();
};

/**
 * Explicitly disposes of loaded models to free up GPU and RAM memory.
 * This should be called when exiting the camera or registration flows.
 */
export const disposeModels = () => {
    try {
        if (cachedModel) {
            cachedModel.dispose();
            cachedModel = null;
        }
        if (cachedNimaModel) {
            cachedNimaModel.dispose();
            cachedNimaModel = null;
        }
        loadPromise = null;
        nimaLoadPromise = null;
        console.log('🧹 AI Models disposed and RAM/VRAM freed.');
    } catch (e) {
        console.error('❌ Error while disposing AI models:', e);
    }
};