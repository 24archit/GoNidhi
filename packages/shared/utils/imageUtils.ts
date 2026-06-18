/**
 * Resizes a base64 image (data URL) to a target maximum dimension while maintaining aspect ratio.
 * @param base64Str - The original base64 image string.
 * @param maxWidth - The maximum width (or height if landscape).
 * @param quality - The output quality (0 to 1).
 * @returns A promise that resolves to the resized base64 image string.
 */
import { API_BASE } from '@gonidhi/shared';

export const resizeImage = (base64Str: string, maxWidth: number = 1080, quality: number = 0.85): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.src = base64Str;
        img.onload = () => {
            let width = img.width;
            let height = img.height;

            // Calculate new dimensions
            if (width > height) {
                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }
            } else {
                if (height > maxWidth) {
                    width = Math.round((width * maxWidth) / height);
                    height = maxWidth;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Could not get canvas context'));
                return;
            }

            // High quality scaling
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);

            resolve(canvas.toDataURL('image/webp', quality));
        };
        img.onerror = (err) => reject(err);
    });
};
// Helper function to convert a Base64 string into a physical File object
export const base64ToFile = (base64String: string | File | unknown, filename: string): File | string | unknown => {
    // If it's not a string (e.g., already a File object), or empty, return it as is
    if (!base64String || typeof base64String !== 'string' || !base64String.startsWith('data:image')) return base64String;

    const arr = base64String.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);

    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }

    return new File([u8arr], filename, { type: mime });
};
export const compressImage = (dataUrl: string, maxWidth = 1080, maxHeight = 1080, quality = 0.85): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;

            if (width > height) {
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
            } else {
                if (height > maxHeight) {
                    width *= maxHeight / height;
                    height = maxHeight;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return resolve(dataUrl);

            // OPTIONAL BUT RECOMMENDED: Add image smoothing for better downscaling
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            ctx.drawImage(img, 0, 0, width, height);

            // Use the dynamic quality parameter here, exporting as highly-efficient WebP
            resolve(canvas.toDataURL('image/webp', quality));
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
};

export const getImageUrl = (filename?: string | null): string => {
    if (!filename) return '';
    if (filename.startsWith('http') || filename.startsWith('data:image')) {
        return filename;
    }

    return `${API_BASE}/uploads/${filename}`;
};