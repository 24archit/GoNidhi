import { useState, useRef, useCallback } from 'react';
import { CameraPreview, type CameraPreviewOptions } from '@capacitor-community/camera-preview';
import { Capacitor } from '@capacitor/core';

const base64ToBlob = (base64: string, mimeType = 'image/jpeg'): Blob => {
    const byteString = atob(base64);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeType });
};

export interface CameraState {
    isActive: boolean;
    isRecording: boolean;
    zoomLevel: number;
    maxZoom: number;
    position: 'rear' | 'front';
}

export const useCamera = () => {
    const [media, setMedia] = useState<string | null>(null);
    const [cameraState, setCameraState] = useState<CameraState>({
        isActive: false,
        isRecording: false,
        zoomLevel: 1,
        maxZoom: 5,
        position: 'rear',
    });

    const activeRef = useRef(false);
    const previewOptionsRef = useRef<CameraPreviewOptions | null>(null);
    const isFlippingRef = useRef(false);

    const buildPreviewOptions = useCallback((overrides: Partial<CameraPreviewOptions> = {}): CameraPreviewOptions => {
        const fallbackWidth = Math.round(window.screen.width || window.innerWidth || 1080);
        const fallbackHeight = Math.round(window.screen.height || window.innerHeight || 1920);
        const width = Math.max(1, Math.round(overrides.width ?? fallbackWidth));
        const height = Math.max(1, Math.round(overrides.height ?? fallbackHeight));
        const x = Math.max(0, Math.round(overrides.x ?? 0));
        const y = Math.max(0, Math.round(overrides.y ?? 0));

        const options: CameraPreviewOptions = {
            position: 'rear',
            toBack: true,
            enableZoom: true,
            lockAndroidOrientation: true,
            ...(Capacitor.getPlatform() === 'web' && overrides.parent ? { parent: overrides.parent } : {}),
            ...overrides,
        };

        options.width = width;
        options.height = height;
        options.x = x;
        options.y = y;

        return options;
    }, []);

    const startPreview = useCallback(async (overrides: Partial<CameraPreviewOptions> = {}): Promise<void> => {
        if (activeRef.current) return;

        try {
            const started = await CameraPreview.isCameraStarted().catch(() => ({ value: false }));
            if (started.value) {
                activeRef.current = true;
                setCameraState(prev => ({ ...prev, isActive: true }));
                return;
            }

            const options = buildPreviewOptions(overrides);
            await CameraPreview.start(options);

            previewOptionsRef.current = options;
            activeRef.current = true;
            setCameraState(prev => ({ ...prev, isActive: true, zoomLevel: 1 }));

            try {
                const cp = CameraPreview as unknown as { getMaxZoom: () => Promise<{ maxZoom: number }> };
                const zoomData = await cp.getMaxZoom();
                if (zoomData?.maxZoom) {
                    setCameraState(prev => ({ ...prev, maxZoom: Math.min(zoomData.maxZoom, 8) }));
                }
            } catch {
                console.warn('Device does not support programmatic max zoom detection.');
            }
        } catch (error) {
            console.error('CameraPreview.start failed:', error);
            throw error;
        }
    }, [buildPreviewOptions]);

    const stopPreview = useCallback(async (): Promise<void> => {
        if (!activeRef.current) return;

        try {
            await CameraPreview.stop();
        } catch {
            // Ignore if already stopped.
        }

        previewOptionsRef.current = null;
        activeRef.current = false;
        setCameraState(prev => ({ ...prev, isActive: false, isRecording: false, zoomLevel: 1 }));
    }, []);

    const setZoom = useCallback(async (zoom: number): Promise<void> => {
        const clamped = Math.max(1, Math.min(zoom, cameraState.maxZoom));
        try {
            const cp = CameraPreview as unknown as { setZoom: (options: { zoom: number }) => Promise<void> };
            await cp.setZoom({ zoom: clamped });
            setCameraState(prev => ({ ...prev, zoomLevel: clamped }));
        } catch (error) {
            console.error('Zoom failed:', error);
        }
    }, [cameraState.maxZoom]);

    const capturePhoto = useCallback(async (): Promise<string | null> => {
        if (!activeRef.current) return null;

        try {
            const sample = await CameraPreview.captureSample({ quality: 85 });
            if (!sample?.value) return null;

            const blob = base64ToBlob(sample.value);
            const blobUrl = URL.createObjectURL(blob);
            setMedia(blobUrl);
            return blobUrl;
        } catch (error) {
            console.error('Photo capture failed:', error);
            return null;
        }
    }, []);

    const captureSweepFrames = useCallback(async (durationMs = 3000, samplesPerSecond = 6): Promise<string[]> => {
        if (!activeRef.current) return [];

        try {
            setCameraState(prev => ({ ...prev, isRecording: true }));
            const frameUrls: string[] = [];
            const intervalMs = Math.max(120, Math.round(1000 / samplesPerSecond));
            const startedAt = Date.now();

            while (Date.now() - startedAt < durationMs) {
                const sample = await CameraPreview.captureSample({ quality: 85 });
                if (sample?.value) {
                    const blob = base64ToBlob(sample.value);
                    const blobUrl = URL.createObjectURL(blob);
                    frameUrls.push(blobUrl);
                }
                await new Promise(resolve => setTimeout(resolve, intervalMs));
            }

            setCameraState(prev => ({ ...prev, isRecording: false }));
            setMedia(frameUrls[frameUrls.length - 1] ?? null);
            return frameUrls;
        } catch (error) {
            console.error('Frame capture failed:', error);
            setCameraState(prev => ({ ...prev, isRecording: false }));
            return [];
        }
    }, []);

    const flipCamera = useCallback(async (startCallback: () => Promise<void>): Promise<void> => {
        if (isFlippingRef.current || !activeRef.current) return;

        isFlippingRef.current = true;
        try {
            // Turn off flash to prevent native crash on flip
            try { await CameraPreview.setFlashMode({ flashMode: 'off' }); } catch (e) { }

            const newPosition = cameraState.position === 'rear' ? 'front' : 'rear';

            // Properly stop through the hook so activeRef is set to false
            await stopPreview();

            // Give the Android Camera Service time to fully release its hardware lock
            await new Promise(resolve => setTimeout(resolve, 500));

            // Delegate restart to the caller (e.g. the dialog's startPreviewInHost)
            // so that all native options like 'parent' element are correctly re-applied
            await startCallback();

            // Only after successful start, update the tracked position
            setCameraState(prev => ({ ...prev, position: newPosition }));
        } catch (error) {
            console.error('Flip failed:', error);
        } finally {
            isFlippingRef.current = false;
        }
    }, [cameraState.position, stopPreview]);

    const toggleFlash = useCallback(async (enable: boolean): Promise<boolean> => {
        if (!activeRef.current) return false;
        try {
            if (!enable) {
                await CameraPreview.setFlashMode({ flashMode: 'off' });
                return true;
            }

            // Check if device supports flash/torch before turning it on to prevent native crashes
            const cp = CameraPreview as any;
            if (cp.getSupportedFlashModes) {
                const { result } = await cp.getSupportedFlashModes();
                const modes: string[] = result || [];
                
                if (modes.includes('torch')) {
                    await CameraPreview.setFlashMode({ flashMode: 'torch' });
                    return true;
                } else if (modes.includes('on')) {
                    await CameraPreview.setFlashMode({ flashMode: 'on' });
                    return true;
                } else {
                    console.warn('Flash/Torch is not supported on this camera.');
                    return false;
                }
            } else {
                // Fallback for older plugin versions
                await CameraPreview.setFlashMode({ flashMode: 'torch' });
                return true;
            }
        } catch (error) {
            console.error('Failed to set flash mode:', error);
            return false;
        }
    }, []);

    return {
        media,
        cameraState,
        startPreview,
        stopPreview,
        setZoom,
        capturePhoto,
        captureSweepFrames,
        flipCamera,
        toggleFlash,
    };
};
