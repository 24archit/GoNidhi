import axios from 'axios';
import logger from './logger';
import dotenv from 'dotenv';

dotenv.config();

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const COLLECTION_NAME = "cattle_vectors_spatial";

const qdrantAxios = axios.create({
    baseURL: QDRANT_URL,
    headers: {
        'Content-Type': 'application/json',
        'api-key': QDRANT_API_KEY
    }
});

export const getAllQdrantCowIds = async (): Promise<string[]> => {
    try {
        const cowIds = new Set<string>();
        let offset: string | number | null = null;

        while (true) {
            const payload: any = {
                limit: 1000,
                with_payload: ["cow_id"],
                with_vector: false
            };
            if (offset) {
                payload.offset = offset;
            }

            const response = await qdrantAxios.post(`/collections/${COLLECTION_NAME}/points/scroll`, payload);
            
            const points = response.data?.result?.points || [];
            const nextOffset = response.data?.result?.next_page_offset;

            for (const point of points) {
                if (point.payload && point.payload.cow_id) {
                    cowIds.add(point.payload.cow_id);
                }
            }

            if (!nextOffset) {
                break;
            }
            offset = nextOffset;
        }

        return Array.from(cowIds);
    } catch (error: any) {
        logger.error(error.response?.data || error.message, 'Error fetching cow IDs directly from Qdrant:');
        throw error;
    }
};

export const deleteCowVectors = async (cowId: string): Promise<boolean> => {
    try {
        const payload = {
            filter: {
                must: [
                    {
                        key: "cow_id",
                        match: {
                            value: cowId
                        }
                    }
                ]
            }
        };

        const response = await qdrantAxios.post(`/collections/${COLLECTION_NAME}/points/delete`, payload);
        logger.info(`[Qdrant] Successfully deleted vectors for cow ${cowId}. Response: ${response.data?.status}`);
        return true;
    } catch (error: any) {
        logger.error(error.response?.data || error.message, `[Qdrant] Failed to delete vectors for cow ${cowId}:`);
        throw error;
    }
};
