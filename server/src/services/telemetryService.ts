import { AiLog } from '../models/AiLog';
import { uploadBase64ToCloudinary, deleteFromCloudinary } from './cloudinaryService';
import logger from '../utils/logger';

const snakeToCamel = (str: string) => str.replace(/_([a-z])/g, (g) => g[1].toUpperCase());

export const processTelemetry = async (telemetry: any, endpoint: string, success: boolean) => {
    try {
        if (!telemetry) return;

        const formattedTelemetry: any = {};
        for (const key of Object.keys(telemetry)) {
            formattedTelemetry[snakeToCamel(key)] = telemetry[key];
        }

        let uploadedMuzzleCrop = '';
        let uploadedFaceCrop = '';

        try {
            if (formattedTelemetry.muzzleCropUrl && formattedTelemetry.muzzleCropUrl.startsWith('data:image')) {
                uploadedMuzzleCrop = await uploadBase64ToCloudinary(formattedTelemetry.muzzleCropUrl, 'gonidhi-telemetry');
                formattedTelemetry.muzzleCropUrl = uploadedMuzzleCrop;
            }
            if (formattedTelemetry.faceCropUrl && formattedTelemetry.faceCropUrl.startsWith('data:image')) {
                uploadedFaceCrop = await uploadBase64ToCloudinary(formattedTelemetry.faceCropUrl, 'gonidhi-telemetry');
                formattedTelemetry.faceCropUrl = uploadedFaceCrop;
            }

            await AiLog.create({
                ...formattedTelemetry,
                timestamp: new Date(),
                success,
                endpoint
            });
        } catch (dbError) {
            logger.error(dbError, 'Failed to save AiLog to database. Rolling back telemetry images.');
            if (uploadedMuzzleCrop) deleteFromCloudinary(uploadedMuzzleCrop).catch(() => { });
            if (uploadedFaceCrop) deleteFromCloudinary(uploadedFaceCrop).catch(() => { });
        }
    } catch (err) {
        logger.error(err, `Failed to process telemetry from ${endpoint}:`);
    }
};
