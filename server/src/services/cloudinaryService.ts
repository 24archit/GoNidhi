import { v2 as cloudinary } from 'cloudinary';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import stream from 'stream';
import logger from '../utils/logger';

dotenv.config();

// Cloudinary automatically picks up CLOUDINARY_URL from the environment variables

export const uploadBase64ToCloudinary = async (base64String: string, folder: string = 'gonidhi-telemetry'): Promise<string> => {
    try {
        if (!base64String) return "";
        if (base64String.startsWith('http')) return base64String;

        // Ensure proper format if it's raw base64 without the data URI scheme
        let uploadStr = base64String;
        if (!base64String.startsWith('data:image')) {
            uploadStr = `data:image/jpeg;base64,${base64String}`;
        }

        const result = await cloudinary.uploader.upload(uploadStr, {
            folder,
            public_id: uuidv4()
        });

        return result.secure_url;
    } catch (error) {
        logger.error(error, 'Cloudinary base64 upload error:');
        return "";
    }
};

export const uploadBufferToCloudinary = async (buffer: Buffer, folder: string = 'gonidhi-images'): Promise<string> => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder,
                public_id: uuidv4()
            },
            (error, result) => {
                if (error) {
                    logger.error(error, 'Cloudinary buffer upload error:');
                    reject(error);
                } else if (result) {
                    resolve(result.secure_url);
                } else {
                    reject(new Error('Unknown Cloudinary upload error'));
                }
            }
        );

        const bufferStream = new stream.PassThrough();
        bufferStream.end(buffer);
        bufferStream.pipe(uploadStream);
    });
};

export const deleteFromCloudinary = async (url: string) => {
    try {
        if (!url || !url.includes('cloudinary.com')) return;

        // Extract public_id from typical cloudinary URL
        // https://res.cloudinary.com/<cloud_name>/image/upload/v123456789/<folder>/<filename>.<ext>
        const regex = /\/v\d+\/(.+)\.\w+$/;
        const match = url.match(regex);
        if (match && match[1]) {
            const publicId = match[1];
            await cloudinary.uploader.destroy(publicId);
            logger.info(`Deleted image from Cloudinary: ${publicId}`);
        }
    } catch (error) {
        logger.error(error, 'Cloudinary delete error:');
    }
};
