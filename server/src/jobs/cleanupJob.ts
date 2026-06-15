import { Cattle } from '../models/Cattel';
import { User } from '../models/User';
import { cleanupCowCloudResources } from '../services/cattleService';
import mongoose from 'mongoose';
import logger from '../utils/logger';

let cleanupRunning = false;

export const startCleanupJob = () => {
    logger.info('[Jobs] Starting Orphaned Cow Cleanup Job (1h interval)');

    const runCleanup = async () => {
        if (cleanupRunning) {
            logger.info('[CleanupJob] Previous cleanup is still running. Skipping this iteration.');
            return;
        }
        cleanupRunning = true;
        try {
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
            const orphanedCows = await Cattle.find({
                'aiMetadata.status': { $in: ['PENDING', 'PROCESSING_RESULT'] },
                createdAt: { $lt: twoHoursAgo }
            });

            if (orphanedCows.length > 0) {
                logger.info(`[CleanupJob] Found ${orphanedCows.length} orphaned PENDING cows. Cleaning up...`);
            }

            for (const cow of orphanedCows) {
                logger.info(`[CleanupJob] Attempting to delete orphaned PENDING cow: ${cow._id}`);
                
                let deletedCow: any = null;
                const session = await mongoose.startSession();
                await session.withTransaction(async () => {
                    // Atomically check if it's still PENDING before deleting
                    deletedCow = await Cattle.findOneAndDelete({ _id: cow._id, 'aiMetadata.status': { $in: ['PENDING', 'PROCESSING_RESULT'] } }, { session });
                    if (deletedCow) {
                        await User.findByIdAndUpdate(deletedCow.farmerId, { $pull: { cows: deletedCow._id } }, { session });
                    }
                });
                session.endSession();

                if (deletedCow) {
                    // Only cleanup cloud resources if we successfully deleted the PENDING cow
                    await cleanupCowCloudResources(deletedCow);
                    logger.info(`[CleanupJob] Successfully cleaned up cow: ${cow._id}`);
                } else {
                    logger.info(`[CleanupJob] Cow ${cow._id} is no longer PENDING (or already deleted). Skipping cloud cleanup.`);
                }
            }
        } catch (error) {
            logger.error('[CleanupJob] Error during orphaned cow cleanup:', error);
        } finally {
            cleanupRunning = false;
        }
    };

    runCleanup();
    setInterval(runCleanup, 60 * 60 * 1000); // 1 hour
};
