import { startPingJob } from './pingJob';
import { startCleanupJob } from './cleanupJob';

export const initJobs = () => {
    startPingJob();
    startCleanupJob();
};
