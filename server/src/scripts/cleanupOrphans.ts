import mongoose from 'mongoose';
import { v2 as cloudinary } from 'cloudinary';
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../../dl-api/.env') }); // load Qdrant keys if present

// Setup Cloudinary
if (!process.env.CLOUDINARY_URL) {
    console.error('Missing CLOUDINARY_URL. Make sure .env is correct.');
    process.exit(1);
}
cloudinary.config(true); // Automatically parses CLOUDINARY_URL

// Setup Qdrant URL
const QDRANT_URL = process.env.QDRANT_URL || '';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || '';

// Minimal schema for Cattle to avoid importing full app deps
const CattleSchema = new mongoose.Schema({}, { strict: false });
const Cattle = mongoose.model('Cattle', CattleSchema, 'cattles');

const isDryRun = !process.argv.includes('--execute');

async function getAllQdrantCowIds(): Promise<Set<string>> {
    console.log('[Qdrant] Fetching all vectors from cattle_vectors_spatial...');
    const qdrantCowIds = new Set<string>();
    const headers = QDRANT_API_KEY ? { 'api-key': QDRANT_API_KEY } : {};

    let offset: string | null = null;
    let totalVectors = 0;

    try {
        while (true) {
            const body: any = {
                limit: 1000,
                with_payload: true,
                with_vector: false
            };
            if (offset) body.offset = offset;

            const res = await axios.post(`${QDRANT_URL}/collections/cattle_vectors_spatial/points/scroll`, body, { headers });
            
            const points = res.data.result.points;
            for (const point of points) {
                if (point.payload && point.payload.cow_id) {
                    qdrantCowIds.add(point.payload.cow_id);
                }
            }
            
            totalVectors += points.length;
            offset = res.data.result.next_page_offset;
            
            if (!offset) break;
        }
    } catch (err: any) {
        if (err.response?.status === 404) {
            console.log('[Qdrant] Collection cattle_vectors_spatial not found. Assuming empty.');
            return qdrantCowIds;
        }
        console.error('[Qdrant] Error fetching vectors:', err.response?.data || err.message);
        throw err;
    }

    console.log(`[Qdrant] Found ${totalVectors} vectors representing ${qdrantCowIds.size} unique cows.`);
    return qdrantCowIds;
}

async function getAllCloudinaryImages(): Promise<Set<string>> {
    console.log('[Cloudinary] Fetching all images...');
    const cloudinaryIds = new Set<string>();
    
    let next_cursor: string | undefined = undefined;
    let totalImages = 0;

    do {
        const res: any = await cloudinary.api.resources({
            type: 'upload',
            max_results: 500,
            next_cursor: next_cursor
        });

        for (const resource of res.resources) {
            // Ignore telemetry
            if (!resource.public_id.startsWith('ama-gau-dhana-telemetry/')) {
                cloudinaryIds.add(resource.public_id);
            }
        }
        totalImages += res.resources.length;
        next_cursor = res.next_cursor;
    } while (next_cursor);

    console.log(`[Cloudinary] Checked ${totalImages} total images. Retained non-telemetry images for cleanup check.`);
    return cloudinaryIds;
}

async function deleteFromQdrant(cowId: string) {
    if (isDryRun) return;
    const headers = QDRANT_API_KEY ? { 'api-key': QDRANT_API_KEY } : {};
    await axios.post(`${QDRANT_URL}/collections/cattle_vectors_spatial/points/delete`, {
        filter: {
            must: [{ key: 'cow_id', match: { value: cowId } }]
        }
    }, { headers });
}

async function runCleanup() {
    console.log(`\n===========================================`);
    console.log(` STARTING CLEANUP SCRIPT (Dry Run: ${isDryRun}) `);
    console.log(`===========================================\n`);

    if (!process.env.MONGO_URI) {
        console.error('Missing MONGO_URI. Make sure .env is correct.');
        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);
    console.log('[MongoDB] Connected successfully.');

    try {
        // 1. Fetch Mongo State
        const allCows = await Cattle.find({});
        console.log(`[MongoDB] Found ${allCows.length} total cows in database.`);

        const mongoCowIds = new Set<string>();
        const validMongoCowIds = new Set<string>(); // isRegistered=true or status=SUCCESS
        const mongoCloudinaryIds = new Set<string>();

        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const stalePendingCows: any[] = [];

        for (const cow of allCows) {
            const id = cow._id.toString();
            mongoCowIds.add(id);

            const aiStatus = cow.get('aiMetadata.status');
            const isRegistered = cow.get('aiMetadata.isRegistered');
            
            // Check for stale pending
            if (aiStatus === 'PENDING' && cow.get('createdAt') < oneHourAgo) {
                stalePendingCows.push(cow);
            } else if (aiStatus === 'SUCCESS' || isRegistered) {
                validMongoCowIds.add(id);
            }

            // Extract photos
            const photos = cow.get('photos');
            if (photos) {
                for (const key of Object.keys(photos)) {
                    if (photos[key] && typeof photos[key] === 'string') {
                        const url = photos[key];
                        const regex = /\/v\d+\/(.+)\.\w+$/;
                        const match = url.match(regex);
                        if (match && match[1]) {
                            mongoCloudinaryIds.add(match[1]);
                        }
                    }
                }
            }
        }

        // 2. Fetch Qdrant State
        const qdrantCowIds = await getAllQdrantCowIds();

        // 3. Fetch Cloudinary State
        const cloudinaryIds = await getAllCloudinaryImages();

        console.log(`\n--- CROSS-REFERENCING ---\n`);

        let toDeleteMongoCount = 0;
        let toDeleteQdrantCount = 0;
        let toDeleteCloudinaryCount = 0;

        // RULE 1: Corrupted Cow (Mongo but no Qdrant)
        console.log(`[RULE 1] Checking for Corrupted Cows (Registered in Mongo, missing from Qdrant)...`);
        const corruptedCowIds: string[] = [];
        for (const id of validMongoCowIds) {
            if (!qdrantCowIds.has(id)) {
                corruptedCowIds.push(id);
            }
        }
        if (corruptedCowIds.length > 0) {
            console.log(`⚠️  Found ${corruptedCowIds.length} corrupted cows! IDs: ${corruptedCowIds.join(', ')}`);
            toDeleteMongoCount += corruptedCowIds.length;
            for (const id of corruptedCowIds) {
                if (!isDryRun) await Cattle.findByIdAndDelete(id);
            }
        } else {
            console.log(`✅ No corrupted cows found.`);
        }

        // RULE 2: Orphaned Vector (Qdrant but no Mongo)
        console.log(`\n[RULE 2] Checking for Orphaned Vectors (In Qdrant, missing from Mongo)...`);
        const orphanedVectorIds: string[] = [];
        for (const qId of qdrantCowIds) {
            // If it's not in Mongo at all, or it IS in Mongo but we just deleted it for being corrupted
            if (!mongoCowIds.has(qId) || corruptedCowIds.includes(qId)) {
                orphanedVectorIds.push(qId);
            }
        }
        if (orphanedVectorIds.length > 0) {
            console.log(`⚠️  Found ${orphanedVectorIds.length} orphaned Qdrant sets! Cow IDs: ${orphanedVectorIds.join(', ')}`);
            toDeleteQdrantCount += orphanedVectorIds.length;
            for (const qId of orphanedVectorIds) {
                if (!isDryRun) await deleteFromQdrant(qId);
            }
        } else {
            console.log(`✅ No orphaned vectors found.`);
        }

        // RULE 3: Stale Pending (Failed Registration)
        console.log(`\n[RULE 3] Checking for Stale PENDING Registrations (> 1hr old)...`);
        if (stalePendingCows.length > 0) {
            console.log(`⚠️  Found ${stalePendingCows.length} stale pending cows! IDs: ${stalePendingCows.map(c => c._id.toString()).join(', ')}`);
            toDeleteMongoCount += stalePendingCows.length;
            for (const cow of stalePendingCows) {
                const id = cow._id.toString();
                if (!isDryRun) {
                    await Cattle.findByIdAndDelete(id);
                    await deleteFromQdrant(id);
                }
            }
        } else {
            console.log(`✅ No stale pending cows found.`);
        }

        // Refresh Mongo Cloudinary IDs after removing corrupted/stale cows
        // We only want to KEEP images belonging to cows that survived.
        const survivingCloudinaryIds = new Set<string>();
        for (const cow of allCows) {
            const id = cow._id.toString();
            if (!corruptedCowIds.includes(id) && !stalePendingCows.find(c => c._id.toString() === id)) {
                const photos = cow.get('photos');
                if (photos) {
                    for (const key of Object.keys(photos)) {
                        if (photos[key] && typeof photos[key] === 'string') {
                            const url = photos[key];
                            const regex = /\/v\d+\/(.+)\.\w+$/;
                            const match = url.match(regex);
                            if (match && match[1]) {
                                survivingCloudinaryIds.add(match[1]);
                            }
                        }
                    }
                }
            }
        }

        // RULE 4: Orphaned Image (Cloudinary but no surviving Mongo cow)
        console.log(`\n[RULE 4] Checking for Orphaned Cloudinary Images...`);
        const orphanedImageIds: string[] = [];
        for (const pubId of cloudinaryIds) {
            if (!survivingCloudinaryIds.has(pubId)) {
                orphanedImageIds.push(pubId);
            }
        }
        if (orphanedImageIds.length > 0) {
            console.log(`⚠️  Found ${orphanedImageIds.length} orphaned Cloudinary images!`);
            toDeleteCloudinaryCount += orphanedImageIds.length;
            
            // Delete in batches of 100 for Cloudinary Admin API
            if (!isDryRun) {
                for (let i = 0; i < orphanedImageIds.length; i += 100) {
                    const batch = orphanedImageIds.slice(i, i + 100);
                    await cloudinary.api.delete_resources(batch);
                    console.log(`   Deleted batch of ${batch.length} images...`);
                }
            }
        } else {
            console.log(`✅ No orphaned Cloudinary images found.`);
        }

        console.log(`\n===========================================`);
        if (isDryRun) {
            console.log(` 📋 DRY RUN SUMMARY `);
            console.log(` - Cows to delete from Mongo: ${toDeleteMongoCount}`);
            console.log(` - Vector Sets to delete from Qdrant: ${toDeleteQdrantCount}`);
            console.log(` - Images to delete from Cloudinary: ${toDeleteCloudinaryCount}`);
            console.log(`\n To execute these deletions, run: npx ts-node src/scripts/cleanupOrphans.ts --execute`);
        } else {
            console.log(` 🗑️  EXECUTION SUMMARY `);
            console.log(` - Deleted Cows from Mongo: ${toDeleteMongoCount}`);
            console.log(` - Deleted Vector Sets from Qdrant: ${toDeleteQdrantCount}`);
            console.log(` - Deleted Images from Cloudinary: ${toDeleteCloudinaryCount}`);
            console.log(`\n Cleanup completed successfully.`);
        }
        console.log(`===========================================\n`);

    } catch (error) {
        console.error('Fatal error during cleanup:', error);
    } finally {
        await mongoose.disconnect();
        console.log('[MongoDB] Disconnected.');
    }
}

runCleanup();
