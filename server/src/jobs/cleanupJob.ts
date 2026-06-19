import { Cattle } from '../models/Cattel';
import { User } from '../models/User';
import { cleanupCowCloudResources } from '../services/cattleService';
import { dlApiClient } from '../utils/dlApiClient';
import { getAllQdrantCowIds, deleteCowVectors } from '../utils/qdrantClient';
import mongoose from 'mongoose';
import logger from '../utils/logger';

import cron from 'node-cron';

let cleanupRunning = false;

export const startCleanupJob = () => {
    logger.info('[Jobs] Initializing Database & Vector Store Reconciliation Cron Job (Runs every hour)');

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
                const qdrantCowIds: string[] = await getAllQdrantCowIds();

                if (qdrantCowIds && qdrantCowIds.length > 0) {
                    const validMongoCowIds = new Set<string>();
                    
                    // Batch query MongoDB in chunks of 5000 to prevent database memory overload
                    const BATCH_SIZE = 5000;
                    for (let i = 0; i < qdrantCowIds.length; i += BATCH_SIZE) {
                        const batch = qdrantCowIds.slice(i, i + BATCH_SIZE);
                        const validMongoCowsBatch = await Cattle.find({
                            _id: { $in: batch }
                        }, '_id').lean();
                        
                        validMongoCowsBatch.forEach(cow => validMongoCowIds.add(cow._id.toString()));
                    }

                    const orphanCowIds = qdrantCowIds.filter(id => !validMongoCowIds.has(id));

                    if (orphanCowIds.length > 0) {
                        logger.warn(`[CleanupJob] Found ${orphanCowIds.length} orphan vector(s) in Qdrant without MongoDB record. Purging...`);
                        let deletedCount = 0;
                        for (const orphanId of orphanCowIds) {
                            try {
                                await deleteCowVectors(orphanId);
                                deletedCount++;
                            } catch (err: any) {
                                // Error already logged in qdrantClient
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

    // Run the cleanup cron job at minute 0 past every hour
    cron.schedule('0 * * * *', runCleanup);
};
