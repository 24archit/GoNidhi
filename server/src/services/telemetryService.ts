import { AiLog } from '../models/AiLog';
import logger from '../utils/logger';

const snakeToCamel = (str: string) => str.replace(/_([a-z])/g, (g) => g[1].toUpperCase());

export const processTelemetry = async (telemetry: any, endpoint: string, success: boolean) => {
    try {
        if (!telemetry) return;

        const formattedTelemetry: any = {};
        for (const key of Object.keys(telemetry)) {
            formattedTelemetry[snakeToCamel(key)] = telemetry[key];
        }

        try {
            await AiLog.create({
                ...formattedTelemetry,
                timestamp: new Date(),
                success,
                endpoint
            });
        } catch (dbError) {
            logger.error(dbError, 'Failed to save AiLog to database.');
        }
    } catch (err) {
        logger.error(err, `Failed to process telemetry from ${endpoint}:`);
    }
};
