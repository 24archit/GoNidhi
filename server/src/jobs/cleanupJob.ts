import { Cattle } from '../models/Cattel';
import { User } from '../models/User';
import { cleanupCowCloudResources } from '../services/cattleService';

export const startCleanupJob = () => {
    console.log('[Jobs] Starting Orphaned Cow Cleanup Job (1h interval)');
    setInterval(async () => {
        try {
            const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
            const orphanedCows = await Cattle.find({
                'aiMetadata.status': 'PENDING',
                createdAt: { $lt: twoHoursAgo }
            });

            if (orphanedCows.length > 0) {
                console.log(`[CleanupJob] Found ${orphanedCows.length} orphaned PENDING cows. Cleaning up...`);
            }

            for (const cow of orphanedCows) {
                console.log(`[CleanupJob] Deleting orphaned PENDING cow: ${cow._id}`);
                
                await cleanupCowCloudResources(cow);

                await Cattle.findByIdAndDelete(cow._id);
                await User.findByIdAndUpdate(cow.farmerId, { $pull: { cows: cow._id } }).catch(() => {});
            }
        } catch (error) {
            console.error('[CleanupJob] Error during orphaned cow cleanup:', error);
        }
    }, 60 * 60 * 1000); // 1 hour
};
