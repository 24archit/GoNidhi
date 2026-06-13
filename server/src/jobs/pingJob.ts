import axios from 'axios';

export const startPingJob = () => {
    const DL_API_URL = process.env.DL_API_URL;
    if (DL_API_URL) {
        console.log('[Jobs] Starting DL-API Ping Job (10m interval)');
        setInterval(async () => {
            try {
                await axios.get(`${DL_API_URL}/docs`, { timeout: 5000 });
            } catch (error: any) {
                console.error("[PingJob] Internal Ping Failed:", error.message);
            }
        }, 10 * 60 * 1000); // 10 minutes
    }
};
