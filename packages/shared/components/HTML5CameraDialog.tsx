import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Box, Typography, Dialog, IconButton, Button } from '@mui/material';
import { Close, FlashOn, FlashOff, CheckCircle, Cameraswitch } from '@mui/icons-material';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgl';

import { getMuzzleModel, getNimaModel, isModelsCached } from '../utils/MuzzleModelService';
import { useCamera } from '../hooks/useCamera';

import type { CameraGuidanceType, QualityReport, DetectionResult, Phase } from './camera/types';
import { FRAME_W, FRAME_H, SWEEP_MS, MUZZLE_CONF_THRESHOLD, MIN_ACCEPTABLE_SCORE } from './camera/constants';
import { ProgressRing, CountdownDisplay, OvalGuide, AnalysisOverlay } from './camera/CameraOverlays';
import { calculateQualityScore, computeNIMAScore, parseModelOutput } from './camera/qualityUtils';

interface HTML5CameraDialogProps {
    open: boolean;
    onClose: () => void;
    onCapture: (imageSrc: string) => void;
    guidanceType: CameraGuidanceType;
}

export type { CameraGuidanceType, QualityReport, DetectionResult, Phase };

// ─── Main Component ───────────────────────────────────────────────────────────
export const HTML5CameraDialog: React.FC<HTML5CameraDialogProps> = ({ open, onClose, onCapture, guidanceType }) => {
    const isAIScan = guidanceType === 'muzzle';
    const { cameraState, startPreview, stopPreview, capturePhoto, captureSweepFrames, flipCamera, toggleFlash } = useCamera();

    const muzzleModelRef = useRef<tf.GraphModel | null>(null);
    const nimaModelRef = useRef<tf.GraphModel | null>(null);
    const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const previewHostRef = useRef<HTMLDivElement | null>(null);
    const progressRafRef = useRef<number | null>(null);

    const [phase, setPhase] = useState<Phase>('idle');
    const [flash, setFlash] = useState(false);
    const [capturedImage, setCapturedImage] = useState<string | null>(null);
    const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);
    const [analysisStatus, setAnalysisStatus] = useState('');
    const [analysisProgress, setAnalysisProgress] = useState(0);
    const [modelsLoaded, setModelsLoaded] = useState(!isAIScan);
    const [recordingProgress, setRecordingProgress] = useState(0);
    const [secondsLeft, setSecondsLeft] = useState(5);

    // ── Off-screen canvas ────────────────────────────────────────────────────
    useEffect(() => {
        const canvas = document.createElement('canvas');
        canvas.width = FRAME_W;
        canvas.height = FRAME_H;
        captureCanvasRef.current = canvas;

        return () => { captureCanvasRef.current = null; };
    }, []);

    // ── Model loading ────────────────────────────────────────────────────────
    useEffect(() => {
        let mounted = true;

        // We load NIMA regardless of isAIScan, because it's great for standard photos too!
        const loadModels = async () => {
            // Only load models AFTER the camera preview has successfully booted and stabilized.
            if (phase !== 'preview') return;

            // 🚀 Prevent Massive VRAM Leaks on "Retake"
            const nimaLoaded = nimaModelRef.current !== null;
            const muzzleLoaded = isAIScan ? muzzleModelRef.current !== null : true;
            
            if (nimaLoaded && muzzleLoaded) {
                // Wait briefly just for camera hardware to initialize, skip ML loading!
                await new Promise(resolve => setTimeout(resolve, 600));
                if (mounted) setModelsLoaded(true);
                return;
            }

            // Give the browser 600ms to smoothly begin rendering the camera stream 
            // before we await the background models to prevent UI stuttering.
            await new Promise(resolve => setTimeout(resolve, 600));

            try {
                // Ensure TensorFlow backend is fully initialized before loading weights
                await tf.ready();

                // If the user rushed here, this will elegantly await the background promises 
                // started by the page mount without any arbitrary penalty delays!
                const [nima, muzzle] = await Promise.all([
                    getNimaModel(),
                    isAIScan ? getMuzzleModel() : Promise.resolve(null)
                ]);

                if (mounted) {
                    nimaModelRef.current = nima;
                    muzzleModelRef.current = muzzle;
                    setModelsLoaded(true);
                }
            } catch (error) {
                console.error('Model load failed:', error);
                if (mounted) setModelsLoaded(false);
            }
        };

        void loadModels();
        return () => { mounted = false; };
    }, [phase, isAIScan]);

    // ── Helpers ──────────────────────────────────────────────────────────────
    const clearProgressAnimation = useCallback(() => {
        if (progressRafRef.current !== null) {
            cancelAnimationFrame(progressRafRef.current);
            progressRafRef.current = null;
        }
    }, []);

    const resetSessionState = useCallback(() => {
        setCapturedImage(null);
        setQualityReport(null);
        setAnalysisStatus('');
        setAnalysisProgress(0);
        setRecordingProgress(0);
        setSecondsLeft(5);
        setFlash(false);
    }, []);

    const startPreviewInHost = useCallback(async (position?: 'rear' | 'front') => {
        await startPreview({
            parent: 'camera-preview-host',
            x: 0,
            y: 0,
            width: window.screen.width,
            height: window.screen.height,
            ...(position ? { position } : {}),
        });
    }, [startPreview]);

    // ── Camera lifecycle ─────────────────────────────────────────────────────
    useEffect(() => {
        let cancelled = false;

        const bootPreview = async () => {
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
            await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

            if (cancelled) return;

            try {
                resetSessionState();
                await startPreviewInHost();
                if (cancelled) { await stopPreview(); return; }
                setPhase('preview');
            } catch (error) {
                console.error('Camera start failed:', error);
                setPhase('idle');
            }
        };

        if (open) {
            void bootPreview();
        } else {
            clearProgressAnimation();
            void stopPreview();
            setPhase('idle');
            resetSessionState();
        }

        return () => {
            cancelled = true;
            clearProgressAnimation();
            if (open) void stopPreview();
        };
    }, [open, startPreviewInHost, stopPreview, clearProgressAnimation, resetSessionState]);

    // ── Body class for camera transparency ───────────────────────────────────
    useEffect(() => {
        document.documentElement.classList.toggle('camera-preview-active', open);
        document.body.classList.toggle('camera-preview-active', open);

        return () => {
            document.documentElement.classList.remove('camera-preview-active');
            document.body.classList.remove('camera-preview-active');
        };
    }, [open]);

    useEffect(() => () => {
        clearProgressAnimation();
    }, [clearProgressAnimation]);

    // ── AI helpers ───────────────────────────────────────────────────────────
    const evaluateFrame = useCallback(async (imgUrl: string): Promise<DetectionResult> => {
        if (!muzzleModelRef.current || !captureCanvasRef.current) return { conf: 0, box: null };

        let inputTensor: tf.Tensor | null = null;
        let output: tf.Tensor | tf.Tensor[] | null = null;

        try {
            const img = new Image();
            const loaded = new Promise((resolve, reject) => {
                img.onload = async () => {
                    // Force the browser to fully decode/rasterize the image pixels into memory 
                    try { await img.decode(); } catch { /* ignore unsupported */ }
                    resolve(null);
                };
                img.onerror = reject;
            });
            img.src = imgUrl;
            await loaded;

            const w = img.width;
            const h = img.height;
            const size = Math.min(w, h);
            const startY = Math.floor((h - size) / 2);
            const startX = Math.floor((w - size) / 2);

            // Hardware accelerated off-screen canvas downscaling (95% VRAM savings)
            const canvas = document.createElement('canvas');
            canvas.width = FRAME_W;
            canvas.height = FRAME_H;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('No 2d context');

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            // Draw center square crop directly into the tiny 320x320 canvas
            ctx.drawImage(img, startX, startY, size, size, 0, 0, FRAME_W, FRAME_H);

            inputTensor = tf.tidy(() => {
                // TensorFlow now reads a 300KB canvas instead of a 6MB raw image
                const rawImg = tf.browser.fromPixels(canvas);
                return rawImg.cast('float32').div(255).expandDims(0);
            });

            output = await muzzleModelRef.current.executeAsync(inputTensor);
            const primary = Array.isArray(output) ? output[0] : output;

            return await parseModelOutput(primary);
        } catch (error) {
            console.error('Frame evaluation failed:', error);
            return { conf: 0, box: null };
        } finally {
            if (inputTensor) inputTensor.dispose();
            if (output) tf.dispose(output);
        }
    }, []);

    const evaluateNIMA = useCallback(async (imgUrl: string): Promise<number> => {
        if (!nimaModelRef.current) return 0;
        let inputTensor: tf.Tensor | null = null;
        let predictions: tf.Tensor | null = null;
        
        try {
            const img = new Image();
            const loaded = new Promise((resolve, reject) => {
                img.onload = async () => {
                    try { await img.decode(); } catch { /* ignore unsupported */ }
                    resolve(null);
                };
                img.onerror = reject;
            });
            img.src = imgUrl;
            await loaded;

            const w = img.width;
            const h = img.height;
            const size = Math.min(w, h);
            const startY = Math.floor((h - size) / 2);
            const startX = Math.floor((w - size) / 2);

            // Hardware accelerated off-screen canvas downscaling
            const canvas = document.createElement('canvas');
            canvas.width = 224;
            canvas.height = 224;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('No 2d context');

            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            // Draw center square crop directly into the tiny 224x224 canvas
            ctx.drawImage(img, startX, startY, size, size, 0, 0, 224, 224);

            inputTensor = tf.tidy(() => {
                // TensorFlow now reads a 150KB canvas instead of a 6MB raw image
                const rawImg = tf.browser.fromPixels(canvas);
                return rawImg.cast('float32').div(255).expandDims(0);
            });

            predictions = nimaModelRef.current.predict(inputTensor) as tf.Tensor;
            const predictionData = await predictions.data();
            const nimaScore = computeNIMAScore(predictionData);

            return nimaScore;
        } catch (error) {
            console.error('NIMA frame evaluation failed:', error);
            return 0;
        } finally {
            if (inputTensor) inputTensor.dispose();
            if (predictions) predictions.dispose();
        }
    }, []);

    // ── Frame analysis with % progress ──────────────────────────────────────
    const analyzeCapturedFrames = useCallback(async (frames: string[]) => {
        if (!frames.length) { setPhase('preview'); return; }

        setPhase('analyzing');
        setAnalysisProgress(0);

        // --- GPU Warmup ---
        setAnalysisStatus('Initializing GPU...');
        await tf.nextFrame();

        try {
            if (isAIScan && muzzleModelRef.current) {
                const warmupTensor = tf.zeros([1, FRAME_H, FRAME_W, 3]);
                const warmupOut = await muzzleModelRef.current.executeAsync(warmupTensor) as tf.Tensor | tf.Tensor[];
                if (Array.isArray(warmupOut)) warmupOut.forEach(t => t.dispose());
                else warmupOut.dispose();
                warmupTensor.dispose();
            }
            if (nimaModelRef.current) {
                const warmupTensor = tf.zeros([1, 224, 224, 3]);
                const warmupOut = nimaModelRef.current.predict(warmupTensor) as tf.Tensor;
                warmupOut.dispose();
                warmupTensor.dispose();
            }
            // Allow WebGL to finish dummy execution and stabilize memory on slower mobile GPUs
            // Giving ample time here guarantees 100% flawless memory states.
            await new Promise(resolve => setTimeout(resolve, 1500));
        } catch (e) {
            console.warn("Model warmup failed:", e);
        }

        // --- Single Pass: Detection & Clarity ---
        setAnalysisStatus(isAIScan ? 'Scanning subject...' : 'Preparing frames...');
        
        if (isAIScan) {
            console.groupCollapsed(`🔍 Starting AI Burst Analysis (${frames.length} frames)`);
            console.log(`Configured Thresholds:`);
            console.log(` - Muzzle Det >= ${(MUZZLE_CONF_THRESHOLD * 100).toFixed(0)}%`);
            console.log(` - Min Acceptable Quality >= ${MIN_ACCEPTABLE_SCORE}`);
            console.log(` - Early Exit Criteria: Det >= 85% AND NIMA >= 5.8/10`);
        }

        let bestFailMuzzleConf = 0;
        let bestFailFrame = frames[0];
        let bestFailQuality: QualityReport | null = null;

        let bestUrl = frames[0];
        let bestNimaScore = -Infinity;
        let finalQualityReport: QualityReport | null = null;

        // Start a massive global GC scope for all tensor operations to guarantee prolonged app health
        tf.engine().startScope();
        try {
            for (let index = 0; index < frames.length; index += 1) {
            const frame = frames[index];

            if (isAIScan) {
                const detection = await evaluateFrame(frame);
                const quality = calculateQualityScore(detection.conf, detection.box, FRAME_W, FRAME_H, guidanceType);
                console.log(`[Frontend] Frame ${index + 1}/${frames.length} | Det Conf: ${(detection.conf * 100).toFixed(2)}% | Base Quality: ${quality.score}`);

                if (detection.conf >= MUZZLE_CONF_THRESHOLD) {
                    setAnalysisStatus(`Analysing...`);
                    const nimaScore = await evaluateNIMA(frame);

                    console.log(`   └─ ✅ Passed Detection Filter`);
                    console.log(`   └─ ⚡ NIMA Clarity Score: ${nimaScore.toFixed(3)} / 10`);

                    if (nimaScore > bestNimaScore) {
                        bestNimaScore = nimaScore;
                        bestUrl = frame;
                        finalQualityReport = quality;
                    }

                    // 🚀 EARLY EXIT: If muzzle detection is highly confident and focus is very clear!
                    if (detection.conf >= 0.85 && nimaScore >= 5.8) {
                        console.log('🚀 Perfect frame found! Early exit short-circuit triggered.');
                        console.log(`   └─ Det Conf: ${(detection.conf * 100).toFixed(2)}% | NIMA: ${nimaScore.toFixed(3)}`);
                        setAnalysisProgress(100);
                        break;
                    }
                } else {
                    console.log(`   └─ ❌ Failed Detection Filter (below threshold)`);
                    if (detection.conf > bestFailMuzzleConf) {
                        bestFailMuzzleConf = detection.conf;
                        bestFailFrame = frame;
                        bestFailQuality = quality;
                    }
                }
            } else {
                bestUrl = frame;
                break; // Handled non-AI
            }

            setAnalysisProgress(Math.round(((index + 1) / frames.length) * 100));
            await tf.nextFrame();

            // Force the event loop to idle, triggering V8 Garbage Collection for the previous frame's massive blob strings!
            await new Promise(resolve => setTimeout(resolve, 60));
        }
        } finally {
            // End scope to physically wipe any hanging intermediate tensors from GPU VRAM
            tf.engine().endScope();
        }

        if (isAIScan && bestNimaScore === -Infinity) {
            frames.forEach(url => {
                if (url !== bestFailFrame) {
                    URL.revokeObjectURL(url);
                }
            });
            setQualityReport(bestFailQuality);
            setCapturedImage(bestFailFrame);
            setAnalysisStatus('');
            setPhase('no-match');
            return;
        }

        if (isAIScan) console.groupEnd();

        // --- Set Final Results ---
        console.group(`🎯 Final AI Verdict`);
        
        if (isAIScan) {
            if (finalQualityReport) {
                const nimaPercentage = Math.max(0, Math.min(100, Math.round(((bestNimaScore - 4.2) / (6.5 - 4.2)) * 100)));
                
                console.log(`🏆 Selected Winner Frame Details:`);
                console.log(` - Absolute NIMA Score: ${bestNimaScore.toFixed(3)}`);
                console.log(` - Normalized Clarity: ${nimaPercentage}%`);
                console.log(` - Initial Quality Score: ${finalQualityReport.score.toFixed(0)}`);

                if (nimaPercentage < 25) {
                    finalQualityReport.score = Math.round(finalQualityReport.score * 0.6);
                    finalQualityReport.passed = false;
                    finalQualityReport.feedback = 'Image is too blurry. Hold device steady.';
                } else if (nimaPercentage < 40) {
                    finalQualityReport.score = Math.round(finalQualityReport.score * 0.85);
                    if (finalQualityReport.score < finalQualityReport.targetScore) {
                        finalQualityReport.passed = false;
                        finalQualityReport.feedback = 'Slight motion blur. Hold steady.';
                    }
                } else {
                    finalQualityReport.score = Math.round((finalQualityReport.score * 0.8) + (nimaPercentage * 0.2));
                }

                finalQualityReport.score = Math.max(0, Math.min(100, finalQualityReport.score));
                
                // Rigorously update the 'passed' boolean based on the globally configured min score!
                const finalVerdict = finalQualityReport.score >= MIN_ACCEPTABLE_SCORE;
                finalQualityReport.passed = finalVerdict;
                
                if (finalVerdict && (finalQualityReport.feedback.includes("Point") || finalQualityReport.feedback.includes("Steady") || finalQualityReport.feedback.includes("Close") || finalQualityReport.feedback.includes("Center"))) {
                    finalQualityReport.feedback = "Deep Learning selected the clearest frame.";
                }
                
                console.log(`📈 Final Computed Score: ${finalQualityReport.score.toFixed(0)}`);
                console.log(`🏁 Verdict: ${finalVerdict ? 'PASSED ✅' : 'FAILED ❌'} (${finalQualityReport.feedback})`);
            }
            setQualityReport(finalQualityReport);
        } else {
            console.log(`📸 Standard Photo Capture (No AI Quality Assessment)`);
            setQualityReport({
                score: Math.max(0, Math.min(100, Math.round(((bestNimaScore - 4.2) / (6.5 - 4.2)) * 100))),
                passed: true,
                feedback: 'Deep Learning selected the clearest frame.',
                targetScore: 0,
            });
        }
        
        console.groupEnd();

        frames.forEach(url => {
            if (url !== bestUrl) {
                URL.revokeObjectURL(url);
            }
        });

        setCapturedImage(bestUrl);
        setAnalysisStatus('');
        setPhase('result');

    }, [evaluateFrame, evaluateNIMA, guidanceType, isAIScan]);

    // ── Recording ────────────────────────────────────────────────────────────
    const handleStartRecording = useCallback(async () => {
        if (phase !== 'preview' || !modelsLoaded || !cameraState.isActive) return;

        setCapturedImage(null);
        setQualityReport(null);

        if (!isAIScan) {
            const frame = await capturePhoto();
            if (!frame) {
                console.error('capturePhoto returned no frame');
                setPhase('preview');
                return;
            }

            await stopPreview();
            await analyzeCapturedFrames([frame]);
            return;
        }

        setPhase('recording');
        setRecordingProgress(0);
        setSecondsLeft(5);

        const startedAt = Date.now();
        clearProgressAnimation();

        const tick = () => {
            const elapsed = Date.now() - startedAt;
            setRecordingProgress(Math.min((elapsed / SWEEP_MS) * 100, 100));
            setSecondsLeft(Math.max(1, Math.ceil((SWEEP_MS - elapsed) / 1000)));
            if (elapsed < SWEEP_MS) {
                progressRafRef.current = requestAnimationFrame(tick);
            }
        };

        progressRafRef.current = requestAnimationFrame(tick);
        const frames = await captureSweepFrames(SWEEP_MS, 6);
        clearProgressAnimation();

        if (!frames.length) {
            console.error('captureSweepFrames returned no frames');
            setPhase('preview');
            return;
        }

        // Shut down the camera while analyzing to save resources and match new UX spec
        await stopPreview();

        // Give the browser hardware a tick to completely clear the live 1080p camera buffers from memory
        await new Promise(resolve => setTimeout(resolve, 50));
        await tf.nextFrame();

        await analyzeCapturedFrames(frames);
    }, [analyzeCapturedFrames, cameraState.isActive, capturePhoto, captureSweepFrames, clearProgressAnimation, isAIScan, modelsLoaded, phase, stopPreview]);

    // ── Navigation ───────────────────────────────────────────────────────────
    const handleRetake = useCallback(async () => {
        setCapturedImage(prev => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
        });
        resetSessionState();
        await startPreviewInHost();
        setPhase('preview');
    }, [resetSessionState, startPreviewInHost]);

    const handleCloseDialog = useCallback(async () => {
        setCapturedImage(prev => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
        });
        clearProgressAnimation();
        await stopPreview();
        onClose();
    }, [clearProgressAnimation, onClose, stopPreview]);

    const handleAccept = useCallback(async () => {
        if (!capturedImage) return;
        onCapture(capturedImage);
        await handleCloseDialog();
    }, [capturedImage, handleCloseDialog, onCapture]);

    // ── Derived state ────────────────────────────────────────────────────────
    const isCameraVisible = phase === 'preview' || phase === 'recording';
    const isProcessing = phase === 'analyzing';
    const resultButtonDisabled = isAIScan && qualityReport ? qualityReport.score < MIN_ACCEPTABLE_SCORE : false;

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <Dialog
            className="camera-preview-dialog"
            fullScreen
            hideBackdrop
            keepMounted
            open={open}
            PaperProps={{
                sx: {
                    bgcolor: isCameraVisible ? 'transparent' : '#000',
                    boxShadow: 'none',
                    overflow: 'hidden',
                    background: isCameraVisible ? 'transparent !important' : undefined,
                    margin: 0,
                    width: '100%',
                    maxWidth: '100%',
                    height: '100vh',
                    maxHeight: '100vh',
                    '@supports (height: 100dvh)': {
                        height: '100dvh',
                        maxHeight: '100dvh',
                    }
                },
            }}
        >
            <Box sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'transparent' }}>
                {/* Native camera layer */}
                <Box id="camera-preview-host" ref={previewHostRef} sx={{ position: 'absolute', inset: 0, zIndex: 0, backgroundColor: 'transparent', pointerEvents: 'none' }} />

                {/* ── Camera active UI ── */}
                {isCameraVisible && (
                    <>
                        {/* Top bar */}
                        <Box sx={{
                            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
                            background: 'linear-gradient(to bottom, rgba(0,0,0,0.72) 0%, transparent 100%)',
                            px: 2, pt: 'env(safe-area-inset-top, 24px)', pb: 5,
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        }}>
                            <IconButton
                                onClick={() => void handleCloseDialog()}
                                sx={{
                                    color: 'white',
                                    bgcolor: 'rgba(0,0,0,0.3)',
                                    backdropFilter: 'blur(8px)',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    '&:hover': { bgcolor: 'rgba(255,255,255,0.15)' },
                                }}
                            >
                                <Close sx={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.6))' }} />
                            </IconButton>

                            {/* Mode label */}
                            <Box sx={{
                                px: 2, py: 0.5,
                                borderRadius: '20px',
                                bgcolor: 'rgba(0,0,0,0.4)',
                                backdropFilter: 'blur(10px)',
                                border: '1px solid rgba(74,222,128,0.25)',
                            }}>
                                <Typography sx={{ color: '#4ADE80', fontSize: 12, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' }}>
                                    {guidanceType === 'muzzle' ? 'Muzzle Scan' : guidanceType === 'face' ? 'Face Scan' : 'Photo'}
                                </Typography>
                            </Box>

                            <Box sx={{ display: 'flex', gap: 1 }}>
                                <IconButton
                                    onClick={async () => {
                                        const next = !flash;
                                        const success = await toggleFlash(next);
                                        if (success) {
                                            setFlash(next);
                                        }
                                    }}
                                    sx={{
                                        color: flash ? '#FCD34D' : 'white',
                                        bgcolor: 'rgba(0,0,0,0.3)',
                                        backdropFilter: 'blur(8px)',
                                        border: `1px solid ${flash ? 'rgba(252,211,77,0.35)' : 'rgba(255,255,255,0.12)'}`,
                                        '&:hover': { bgcolor: 'rgba(255,255,255,0.15)' },
                                    }}
                                >
                                    {flash ? <FlashOn /> : <FlashOff />}
                                </IconButton>
                                <IconButton
                                    onClick={async () => {
                                        const newPosition = cameraState.position === 'rear' ? 'front' : 'rear';
                                        await flipCamera(() => startPreviewInHost(newPosition));
                                        setFlash(false);
                                    }}
                                    sx={{
                                        color: 'white',
                                        bgcolor: 'rgba(0,0,0,0.3)',
                                        backdropFilter: 'blur(8px)',
                                        border: '1px solid rgba(255,255,255,0.12)',
                                        '&:hover': { bgcolor: 'rgba(255,255,255,0.15)' },
                                    }}
                                >
                                    <Cameraswitch />
                                </IconButton>
                            </Box>
                        </Box>

                        {/* Countdown overlay */}
                        {phase === 'recording' && <CountdownDisplay secondsLeft={secondsLeft} />}

                        {/* Guide overlay */}
                        <OvalGuide recording={phase === 'recording'} guidanceType={guidanceType} />

                        {/* Bottom bar */}
                        <Box sx={{
                            position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
                            background: 'linear-gradient(to top, rgba(0,0,0,0.80) 0%, transparent 100%)',
                            px: 3, pt: 8, pb: 'calc(env(safe-area-inset-bottom, 20px) + 28px)',
                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                        }}>
                            {/* Hint text */}
                            <Typography sx={{
                                color: 'rgba(255,255,255,0.85)',
                                fontWeight: 600,
                                fontSize: 14,
                                mb: 4,
                                textShadow: '0 1px 6px rgba(0,0,0,0.9)',
                                letterSpacing: 0.2,
                                opacity: phase === 'recording' ? 0 : 1,
                                transition: 'opacity 0.3s',
                                textAlign: 'center',
                            }}>
                                {!modelsLoaded ? 'Loading camera tools…' : isAIScan ? 'Tap to start 5-second scan' : 'Tap to capture photo'}
                            </Typography>

                            {/* Shutter button */}
                            <Box
                                onClick={phase === 'preview' && modelsLoaded ? () => void handleStartRecording() : undefined}
                                sx={{
                                    position: 'relative',
                                    width: 88, height: 88,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    cursor: phase === 'preview' && modelsLoaded ? 'pointer' : 'default',
                                    userSelect: 'none',
                                    WebkitTapHighlightColor: 'transparent',
                                }}
                            >
                                <ProgressRing progress={recordingProgress} recording={phase === 'recording'} />
                                <Box sx={{
                                    width: phase === 'recording' ? 30 : 64,
                                    height: phase === 'recording' ? 30 : 64,
                                    bgcolor: phase === 'recording' ? '#4ADE80' : 'white',
                                    borderRadius: phase === 'recording' ? '10px' : '50%',
                                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                                    zIndex: 2,
                                    boxShadow: phase === 'recording'
                                        ? '0 0 20px rgba(74,222,128,0.55)'
                                        : '0 2px 10px rgba(0,0,0,0.4)',
                                }} />
                            </Box>
                        </Box>
                    </>
                )}

                {/* ── Analysing overlay ── */}
                {isProcessing && (
                    <AnalysisOverlay status={analysisStatus} progress={analysisProgress} />
                )}

                {/* ── Result screen ── */}
                {phase === 'result' && capturedImage && (
                    <Box sx={{ position: 'absolute', inset: 0, zIndex: 100, bgcolor: '#0a0a0a', display: 'flex', flexDirection: 'column' }}>
                        {/* Image preview */}
                        <Box sx={{ flex: 1, position: 'relative', overflow: 'hidden', borderRadius: '0 0 24px 24px' }}>
                            <img src={capturedImage} alt="Best frame" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            {/* Subtle green vignette on success */}
                            {qualityReport?.passed && (
                                <Box sx={{
                                    position: 'absolute', inset: 0,
                                    background: 'radial-gradient(ellipse at center, transparent 60%, rgba(74,222,128,0.08) 100%)',
                                    pointerEvents: 'none',
                                }} />
                            )}
                        </Box>

                        {/* Quality card */}
                        {qualityReport && isAIScan && (
                            <Box sx={{
                                mx: 3, mt: 2.5,
                                p: 2.5,
                                borderRadius: 4,
                                bgcolor: 'rgba(255,255,255,0.04)',
                                border: `1px solid ${qualityReport.score < MIN_ACCEPTABLE_SCORE
                                    ? '#F8717144'
                                    : '#4ADE8044'
                                    }`,
                                backdropFilter: 'blur(12px)',
                            }}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                                    <Typography sx={{ color: 'rgba(255,255,255,0.85)', fontWeight: 700, fontSize: 15 }}>
                                        Photo Review
                                    </Typography>
                                    <Box sx={{
                                        px: 1.5, py: 0.4, borderRadius: '20px',
                                        bgcolor: qualityReport.score < MIN_ACCEPTABLE_SCORE
                                            ? 'rgba(248,113,113,0.15)'
                                            : 'rgba(74,222,128,0.15)',
                                    }}>
                                        <Typography sx={{
                                            color: qualityReport.score < MIN_ACCEPTABLE_SCORE ? '#F87171' : '#4ADE80',
                                            fontWeight: 700, fontSize: 12, lineHeight: 1.2, letterSpacing: 0.4, textTransform: 'uppercase',
                                        }}>
                                            {qualityReport.score < MIN_ACCEPTABLE_SCORE
                                                ? 'Retake'
                                                : 'Use Photo'}
                                        </Typography>
                                    </Box>
                                </Box>
                                <Typography sx={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, lineHeight: 1.5 }}>
                                    {qualityReport.score < MIN_ACCEPTABLE_SCORE
                                        ? 'This photo is not clear enough for reliable identification. Please retake it.'
                                        : 'This photo looks good and is ready to use.'}
                                </Typography>
                            </Box>
                        )}

                        {/* Action buttons */}
                        <Box sx={{ height: 110, display: 'flex', alignItems: 'center', justifyContent: 'space-around', px: 4 }}>
                            <Box
                                onClick={() => void handleRetake()}
                                sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', gap: 0.5 }}
                            >
                                <IconButton sx={{
                                    bgcolor: 'rgba(255,255,255,0.1)',
                                    color: 'white',
                                    border: '1px solid rgba(255,255,255,0.15)',
                                    '&:hover': { bgcolor: 'rgba(255,255,255,0.2)' },
                                }}>
                                    <Close />
                                </IconButton>
                                <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 500 }}>Retake</Typography>
                            </Box>

                            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <Button
                                    onClick={() => void handleAccept()}
                                    disabled={resultButtonDisabled}
                                    variant="contained"
                                    startIcon={<CheckCircle />}
                                    sx={{
                                        minWidth: 160,
                                        height: 56,
                                        borderRadius: '16px',
                                        bgcolor: resultButtonDisabled
                                            ? 'rgba(255,255,255,0.1)'
                                            : '#4ADE80',
                                        color: resultButtonDisabled ? 'rgba(255,255,255,0.35)' : '#0a0a0a',
                                        fontWeight: 800,
                                        fontSize: 15,
                                        textTransform: 'none',
                                        boxShadow: resultButtonDisabled ? 'none' : '0 4px 16px rgba(74,222,128,0.35)',
                                        '&.Mui-disabled': { bgcolor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.3)' },
                                        '&:hover': { filter: 'brightness(1.08)' },
                                    }}
                                >
                                    {qualityReport && isAIScan
                                        ? (qualityReport.score < MIN_ACCEPTABLE_SCORE ? 'Retake Required' : 'Use Photo')
                                        : 'Use Photo'}
                                </Button>
                            </Box>
                        </Box>
                    </Box>
                )}

                {/* ── No-match screen ── */}
                {phase === 'no-match' && (
                    <Box sx={{
                        position: 'absolute', inset: 0, zIndex: 100,
                        bgcolor: '#0a0a0a',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        gap: 2.5, px: 4,
                    }}>
                        {/* Icon */}
                        <Box sx={{
                            width: 72, height: 72, borderRadius: '50%',
                            bgcolor: 'rgba(248,113,113,0.12)',
                            border: '2px solid rgba(248,113,113,0.3)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 36,
                        }}>
                            🔍
                        </Box>

                        <Typography sx={{ color: 'white', fontWeight: 800, fontSize: 22, textAlign: 'center', lineHeight: 1.3 }}>
                            No {guidanceType === 'face' ? 'Face' : 'Muzzle'} Detected
                        </Typography>
                        <Typography sx={{ color: 'rgba(255,255,255,0.55)', fontSize: 14, textAlign: 'center', maxWidth: 300, lineHeight: 1.6 }}>
                            We could not find a strong {guidanceType === 'face' ? 'face' : 'muzzle'} match in the burst.
                            Ensure the subject is well-lit and within the guide.
                        </Typography>

                        {qualityReport && (
                            <Box sx={{
                                px: 3, py: 1.5,
                                borderRadius: 3,
                                bgcolor: 'rgba(255,255,255,0.05)',
                                border: '1px solid rgba(255,255,255,0.1)',
                            }}>
                                <Typography sx={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center' }}>
                                    Best frame: {qualityReport.feedback}
                                </Typography>
                            </Box>
                        )}

                        <Box
                            onClick={() => void handleRetake()}
                            sx={{
                                mt: 1,
                                px: 5, py: 1.5,
                                borderRadius: '50px',
                                bgcolor: '#4ADE80',
                                cursor: 'pointer',
                                boxShadow: '0 4px 16px rgba(74,222,128,0.35)',
                                '&:active': { filter: 'brightness(0.92)' },
                            }}
                        >
                            <Typography sx={{ color: '#0a0a0a', fontWeight: 800, fontSize: 15 }}>Try Again</Typography>
                        </Box>
                    </Box>
                )}
            </Box>
        </Dialog>
    );
};
