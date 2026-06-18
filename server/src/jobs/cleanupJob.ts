import { Cattle } from '../models/Cattel';
import { User } from '../models/User';
import { cleanupCowCloudResources } from '../services/cattleService';
import { dlApiClient } from '../utils/dlApiClient';
import mongoose from 'mongoose';
import logger from '../utils/logger';

let cleanupRunning = false;

export const startCleanupJob = () => {
    logger.info('[Jobs] Starting Database & Vector Store Reconciliation Job (1h interval)');

    const runCleanup = async () => {
        if (cleanupRunning) {
            logger.info('[CleanupJob] Previous cleanup is still running. Skipping this iteration.');
            return;
        }
        cleanupRunning = true;
        try {
            logger.info('[CleanupJob] Phase 1: Sweeping stale PENDING / PROCESSING_RESULT cows in MongoDB...');
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
                try {
                    await session.withTransaction(async () => {
                        // Atomically check if it's still PENDING before deleting
                        deletedCow = await Cattle.findOneAndDelete({ _id: cow._id, 'aiMetadata.status': { $in: ['PENDING', 'PROCESSING_RESULT'] } }, { session });
                        if (deletedCow && deletedCow.farmerId) {
                            await User.findByIdAndUpdate(deletedCow.farmerId, { $pull: { cows: deletedCow._id } }, { session });
                        }
                    });
                } finally {
                    await session.endSession();
                }

                if (deletedCow) {
                    // Only cleanup cloud resources if we successfully deleted the PENDING cow
                    await cleanupCowCloudResources(deletedCow);
                    logger.info(`[CleanupJob] Successfully cleaned up cow: ${cow._id}`);
                } else {
                    logger.info(`[CleanupJob] Cow ${cow._id} is no longer PENDING (or already deleted). Skipping cloud cleanup.`);
                }
            }

            logger.info('[CleanupJob] Phase 2: Scanning Qdrant for split-brain orphaned vectors...');
            try {
                const qdrantResponse = await dlApiClient.get('/vectors/cow_ids');
                const qdrantCowIds: string[] = qdrantResponse.data.cow_ids;

                if (qdrantCowIds && qdrantCowIds.length > 0) {
                    const validMongoCows = await Cattle.find({
                        _id: { $in: qdrantCowIds }
                    }, '_id').lean();

                    const validMongoCowIds = new Set(validMongoCows.map(cow => cow._id.toString()));
                    const orphanCowIds = qdrantCowIds.filter(id => !validMongoCowIds.has(id));

                    if (orphanCowIds.length > 0) {
                        logger.warn(`[CleanupJob] Found ${orphanCowIds.length} orphan vector(s) in Qdrant without MongoDB record. Purging...`);
                        let deletedCount = 0;
                        for (const orphanId of orphanCowIds) {
                            try {
                                await dlApiClient.delete(`/cow/${orphanId}`);
                                deletedCount++;
                            } catch (err: any) {
                                logger.error(err, `[CleanupJob] Failed to delete orphan vector ${orphanId}:`);
                            }
                        }
                        logger.info(`[CleanupJob] Purged ${deletedCount}/${orphanCowIds.length} orphan vectors from Qdrant.`);
                    } else {
                        logger.info('[CleanupJob] Qdrant and MongoDB are fully synced. No orphans found.');
                    }
                }
            } catch (err: any) {
                logger.error(err.message || err, '[CleanupJob] Phase 2 Qdrant reconciliation failed:');
            }

            logger.info('[CleanupJob] Reconciliation complete.');
        } catch (error) {
            logger.error(error, '[CleanupJob] Error during orphaned cow cleanup:');
        } finally {
            cleanupRunning = false;
        }
    };

    // Delay initial cold start execution by 5 minutes to allow DL-API and DBs to stabilize
    setTimeout(() => {
        runCleanup();
        setInterval(runCleanup, 60 * 60 * 1000); // 1 hour
    }, 5 * 60 * 1000);
};
