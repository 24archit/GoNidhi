import { Cattle } from '../models/Cattel';
import { User } from '../models/User';
import { Dispute } from '../models/Dispute';
import { uploadBufferToCloudinary, deleteFromCloudinary } from './cloudinaryService';
import { dlApiClient } from '../utils/dlApiClient';
import mongoose from 'mongoose';
import crypto from 'crypto';
import logger from '../utils/logger';
import axios from 'axios';
import { processTelemetry } from './telemetryService';
import { deleteCowVectors } from '../utils/qdrantClient';

export const createCattleRegistration = async (req: any, farmerId: string, payload: any, files: any) => {
    // 1. ATOMICITY CHECK: Ensure the farmer does not already have a PENDING cow.
    const existingPending = await Cattle.findOne({
        farmerId,
        'aiMetadata.status': 'PENDING'
    });

    if (existingPending) {
        const err = new Error('You already have a cow registration in progress. Please wait for it to complete.');
        (err as any).statusCode = 400;
        throw err;
    }

    const {
        tagNo, name, species, breed, sex, ageYears, ageMonths,
        source, purchaseDate, purchasePrice, sireTag, damTag,
        birthWeight, motherWeightAtCalving, calvingCounter,
        healthStatus, productionStatus,
        isInformationCorrectAgreement,
        lat, lng
    } = payload;

    if (!species || !sex || !source) {
        const err = new Error('Species, sex, and source are mandatory fields.');
        (err as any).statusCode = 400;
        throw err;
    }

    if (!lat || !lng) {
        const err = new Error('GPS Location is mandatory to register a cow.');
        (err as any).statusCode = 400;
        throw err;
    }

    if (String(isInformationCorrectAgreement) !== 'true') {
        const err = new Error('You must agree that the information provided is correct.');
        (err as any).statusCode = 400;
        throw err;
    }

    if (!files?.muzzleImage?.[0] || !files?.faceImage?.[0]) {
        const err = new Error('Missing required biometrics. Both a Face Profile and a Muzzle capture are strictly required.');
        (err as any).statusCode = 400;
        throw err;
    }

    const faceProfileFile = files.faceImage[0];
    const muzzleFile = files.muzzleImage[0];

    // Compute an image hash for robust idempotency checking, even when tagNo is absent
    const imageHash = crypto.createHash('sha256').update(muzzleFile.buffer).digest('hex');

    // 3. Idempotency Check via Image Hash
    const existingWithHash = await Cattle.findOne({ farmerId, 'photos.imageHash': imageHash });
    if (existingWithHash) {
        if (existingWithHash.aiMetadata?.status === 'SUCCESS' || existingWithHash.aiMetadata?.status === 'PROCESSING_RESULT' || existingWithHash.isDispute) {
            const err = new Error('This exact cow photo has already been registered in your herd. If this is a different cow, please take a new, clear photo.');
            (err as any).statusCode = 400;
            throw err;
        } else if (existingWithHash.aiMetadata?.status === 'PENDING') {
            const err = new Error('This cow is currently being processed. Please wait for the result.');
            (err as any).statusCode = 400;
            throw err;
        }
    }

    let uploadedFiles: string[] = [];
    let savedCow: any = null;

    try {
        const safeUpload = async (buffer: Buffer, folderName: string = 'gonidhi-images') => {
            if (req.isAborted) throw new Error('Client Closed Request');
            const result = await uploadBufferToCloudinary(buffer, folderName);
            if (result) uploadedFiles.push(result);
            return result;
        };

        const safeUploadIfPresent = async (fileArray: Express.Multer.File[] | undefined) => {
            if (!fileArray || fileArray.length === 0) return '';
            const file = fileArray[0];
            return await safeUpload(file.buffer);
        };

        let faceProfileCloudinary, muzzleCloudinary, leftProfileCloudinary, rightProfileCloudinary, backViewCloudinary, tailViewCloudinary, selfieCloudinary;
        let faceTelemetryCloudinary, muzzleTelemetryCloudinary;

        try {
            [
                faceProfileCloudinary,
                muzzleCloudinary,
                leftProfileCloudinary,
                rightProfileCloudinary,
                backViewCloudinary,
                tailViewCloudinary,
                selfieCloudinary,
                faceTelemetryCloudinary,
                muzzleTelemetryCloudinary
            ] = await Promise.all([
                safeUpload(faceProfileFile.buffer),
                safeUpload(muzzleFile.buffer),
                safeUploadIfPresent(files.leftImage),
                safeUploadIfPresent(files.rightImage),
                safeUploadIfPresent(files.backImage),
                safeUploadIfPresent(files.tailImage),
                safeUploadIfPresent(files.selfieImage),
                safeUpload(faceProfileFile.buffer, 'gonidhi-telemetry'),
                safeUpload(muzzleFile.buffer, 'gonidhi-telemetry')
            ]);
        } catch (uploadError) {
            logger.error(uploadError, 'Error during image uploads, rolling back:');
            const err = new Error('Failed to upload images. Please try again.');
            (err as any).statusCode = 500;
            throw err;
        }

        const newCow = new Cattle({
            farmerId,
            tagNumber: (tagNo && tagNo.trim() !== '') ? tagNo : undefined,
            name,
            species: species || undefined,
            breed: breed || undefined,
            sex: sex || undefined,
            ageYears: ageYears ? Number(ageYears) : undefined,
            ageMonths: ageMonths ? Number(ageMonths) : undefined,
            sireTag,
            damTag,
            source,
            purchaseDetails: source === 'Purchase' ? {
                date: purchaseDate || undefined,
                price: purchasePrice ? Number(purchasePrice) : undefined
            } : undefined,
            isInformationCorrectAgreement: String(isInformationCorrectAgreement) === 'true',
            location: {
                lat: Number(lat),
                lng: Number(lng)
            },
            photos: {
                faceProfile: faceProfileCloudinary,
                muzzle: muzzleCloudinary,
                leftProfile: leftProfileCloudinary,
                rightProfile: rightProfileCloudinary,
                backView: backViewCloudinary,
                tailView: tailViewCloudinary,
                selfie: selfieCloudinary,
                imageHash: imageHash
            },
            aiMetadata: {
                isRegistered: false,
                status: 'PENDING'
            },
            currentStatus: productionStatus || undefined,
            healthStats: {
                birthWeight: birthWeight ? Number(birthWeight) : undefined,
                motherWeightAtCalving: motherWeightAtCalving ? Number(motherWeightAtCalving) : undefined,
                healthStatus: healthStatus || undefined,
                calvingCounter: calvingCounter ? Number(calvingCounter) : undefined
            }
        });

        let session;
        try {
            if (req.isAborted) throw new Error('Client Closed Request');
            session = await mongoose.startSession();
            await session.withTransaction(async () => {
                savedCow = await newCow.save({ session });
                await User.findByIdAndUpdate(farmerId, {
                    $push: { cows: savedCow._id }
                }, { session });
            });
        } catch (dbError: any) {
            logger.error(dbError, 'Error saving to MongoDB, rolling back:');
            if (dbError.code === 11000) {
                if (dbError.keyPattern && dbError.keyPattern.tagNumber) {
                    const err = new Error('A cow with this tag number already exists. Please verify the tag number, or check your "My Cows" page.');
                    (err as any).statusCode = 400;
                    throw err;
                }
                if (dbError.keyPattern && dbError.keyPattern['aiMetadata.status']) {
                    const err = new Error('You already have a cow registration in progress. Please wait for it to complete.');
                    (err as any).statusCode = 400;
                    throw err;
                }
            }
            if (dbError.name === 'ValidationError') {
                const err = new Error(`Validation Error: ${dbError.message}`);
                (err as any).statusCode = 400;
                throw err;
            }
            const err = new Error('Database error during registration. Please try again.');
            (err as any).statusCode = 500;
            throw err;
        } finally {
            if (session) {
                await session.endSession();
            }
        }

        // Send Job to DL-API REST Endpoint
        // We trigger it and let it run in the background thread. We do NOT await it 
        // to prevent stream aborted errors from rolling back the DB entry and images.
        const FormData = require('form-data');
        const formData = new FormData();
        formData.append('cow_id', savedCow._id.toString());
        formData.append('farmer_id', farmerId);
        if (name) formData.append('cow_name', name);
        if (faceTelemetryCloudinary) formData.append('face_image_url', faceTelemetryCloudinary);
        if (muzzleTelemetryCloudinary) formData.append('muzzle_image_url', muzzleTelemetryCloudinary);
        formData.append('face_image', faceProfileFile.buffer, { filename: 'face.jpg' });
        formData.append('muzzle_image', muzzleFile.buffer, { filename: 'muzzle.jpg' });

        dlApiClient.post(`/register`, formData, {
            headers: formData.getHeaders()
        }).catch(async (apiError: any) => {
            logger.error(apiError.message || apiError, 'Error triggering DL-API in background. Rolling back ghost cow...');
            
            try {
                let deletedCow: any = null;
                const session = await mongoose.startSession();
                try {
                    await session.withTransaction(async () => {
                        deletedCow = await Cattle.findOneAndDelete({ _id: savedCow._id, 'aiMetadata.status': 'PENDING' }, { session });
                        if (deletedCow) {
                            await User.findByIdAndUpdate(farmerId, { $pull: { cows: deletedCow._id } }, { session });
                        }
                    });
                } finally {
                    await session.endSession();
                }

                if (deletedCow) {
                    await cleanupCowCloudResources(deletedCow);
                    logger.info(`[Sync] Successfully rolled back ghost cow ${savedCow._id}`);
                }
            } catch (rollbackErr) {
                logger.error(rollbackErr, 'Failed to execute instant rollback for ghost cow:');
            }
        });

        return savedCow;

    } catch (error: any) {
        try {
            if (savedCow) {
                const session = await mongoose.startSession();
                try {
                    await session.withTransaction(async () => {
                        await Promise.all([
                            Cattle.findByIdAndDelete(savedCow._id, { session }),
                            User.findByIdAndUpdate(farmerId, { $pull: { cows: savedCow._id } }, { session })
                        ]);
                    });
                } finally {
                    await session.endSession();
                }
            }
        } catch (rollbackErr) {
            logger.error(rollbackErr, 'Error executing DB rollback:');
        } finally {
            if (uploadedFiles.length > 0) {
                await Promise.all(uploadedFiles.map(fileUrl => deleteFromCloudinary(fileUrl).catch(() => { })));
            }
        }
        throw error;
    }
};

export const cleanupCowCloudResources = async (cow: any) => {
    try {
        const deletePromises: Promise<any>[] = [];
        
        if (cow.photos) {
            if (cow.photos.faceProfile) deletePromises.push(deleteFromCloudinary(cow.photos.faceProfile).catch(() => { }));
            if (cow.photos.muzzle) deletePromises.push(deleteFromCloudinary(cow.photos.muzzle).catch(() => { }));
            if (cow.photos.leftProfile) deletePromises.push(deleteFromCloudinary(cow.photos.leftProfile).catch(() => { }));
            if (cow.photos.rightProfile) deletePromises.push(deleteFromCloudinary(cow.photos.rightProfile).catch(() => { }));
            if (cow.photos.backView) deletePromises.push(deleteFromCloudinary(cow.photos.backView).catch(() => { }));
            if (cow.photos.tailView) deletePromises.push(deleteFromCloudinary(cow.photos.tailView).catch(() => { }));
            if (cow.photos.selfie) deletePromises.push(deleteFromCloudinary(cow.photos.selfie).catch(() => { }));
        }

        // Instruct Qdrant to directly delete vectors
        if (cow._id) {
            deletePromises.push(deleteCowVectors(cow._id.toString()).catch(() => { }));
        }

        if (deletePromises.length > 0) {
            await Promise.all(deletePromises);
        }
    } catch (err) {
        logger.error(err, 'Error in cleanupCowCloudResources:');
    }
};

export const executeCowSearch = async (
    files: any, 
    userId: string, 
    role: string, 
    endpointName: string, 
    abortController: AbortController
) => {
    if (!files?.muzzleImage?.[0] || !files?.faceImage?.[0]) {
        const err = new Error('Both a Face Profile and a Muzzle image are strictly required for AI verification.');
        (err as any).statusCode = 400;
        throw err;
    }

    let faceCloudinary: string | undefined;
    let muzzleCloudinary: string | undefined;
    
    try {
        const faceFile = files.faceImage[0];
        const muzzleFile = files.muzzleImage[0];

        // Fire and forget cloudinary uploads to reduce latency
        uploadBufferToCloudinary(faceFile.buffer, 'gonidhi-telemetry').then((url) => { if (url) faceCloudinary = url; }).catch(() => {});
        uploadBufferToCloudinary(muzzleFile.buffer, 'gonidhi-telemetry').then((url) => { if (url) muzzleCloudinary = url; }).catch(() => {});

        const FormData = require('form-data');
        const formData = new FormData();
        formData.append('user_id', userId);
        formData.append('role', role);
        if (faceCloudinary) formData.append('face_image_url', faceCloudinary);
        if (muzzleCloudinary) formData.append('muzzle_image_url', muzzleCloudinary);
        formData.append('face_image', faceFile.buffer, { filename: 'face.jpg' });
        formData.append('muzzle_image', muzzleFile.buffer, { filename: 'muzzle.jpg' });

        const dlResponse = await dlApiClient.post(`/search`, formData, {
            headers: formData.getHeaders(),
            signal: abortController.signal,
            timeout: 120000
        });

        const { match, cow_id, distance, reason, telemetry } = dlResponse.data;

        if (telemetry) {
            processTelemetry(telemetry, endpointName, match);
        }

        return { match, cow_id, distance, reason, telemetry };

    } catch (dlError: any) {
        if (faceCloudinary) deleteFromCloudinary(faceCloudinary).catch(() => { });
        if (muzzleCloudinary) deleteFromCloudinary(muzzleCloudinary).catch(() => { });

        if (axios.isCancel(dlError) || dlError.name === 'AbortError' || dlError.name === 'CanceledError') {
            logger.info('Client disconnected, canceled DL API search request.');
            const err = new Error('Client Closed Request');
            (err as any).statusCode = 499;
            throw err;
        }
        logger.error(dlError?.response?.data || dlError.message, 'Error calling DL API search:');
        let errorDetail = dlError?.response?.data?.detail;
        if (typeof errorDetail === 'object' && errorDetail?.message) {
            errorDetail = errorDetail.message;
        }
        errorDetail = errorDetail || 'AI Service unavailable or could not process images.';
        
        const err = new Error(errorDetail);
        (err as any).statusCode = 404;
        throw err;
    }
};

export const recentRejections = new Map<string, any>();
const REJECTION_TTL_MS = 10 * 60 * 1000;

export function getRejectionMessage(status: string, message?: string): string {
    let userMessage = message ? message : `Registration failed due to: ${status}`;
    if (!userMessage || userMessage === 'N/A' || userMessage.includes('Registration failed due to')) {
        if (status === 'SPOOF_DETECTED_MUZZLE') {
            userMessage = 'Registration failed: Spoofing detected in the Muzzle image. Make sure it is a real photo, not a screen or print.';
        } else if (status === 'NO_MUZZLE_DETECTED_MUZZLE_IMAGE' || status === 'NO_MUZZLE_DETECTED') {
            userMessage = 'Registration failed: Could not detect the muzzle clearly in the Muzzle profile image. Retake the Muzzle profile.';
        } else if (status === 'NO_FACE_DETECTED') {
            userMessage = 'Registration failed: Could not detect the face clearly in the Face profile image. Retake the Face profile.';
        } else if (status === 'NO_BIOMETRICS_DETECTED') {
            userMessage = 'Registration failed: Could not detect either a Face or Muzzle. Please retake the photos clearly.';
        } else if (status === 'NOT_A_COW') {
            userMessage = 'Registration failed: Images do not appear to contain a cow.';
        } else if (status === 'DUPLICATE') {
            userMessage = 'Registration failed: This cow is already registered.';
        } else if (status === 'FAILED') {
            userMessage = 'Registration failed: An unexpected error occurred while processing your request. Please try again.';
        } else {
            userMessage = `Registration failed: An unknown error occurred (${status}). Please try again.`;
        }
    }
    return userMessage;
}

export async function processDlApiResult(payload: any) {
    const { cow_id, farmer_id, status, matched_cow_id, superpoint_cache, error_message, telemetry } = payload;

    if (telemetry) {
        processTelemetry(telemetry, '/register', status === 'SUCCESS' || status === 'DUPLICATE' || status === 'DISPUTE');
    }

    if (!cow_id) return false;

    // Atomically find and lock the cow for processing to prevent race conditions
    // between DL-API webhook and farmer's profile query.
    const cow = await Cattle.findOneAndUpdate(
        { _id: cow_id, 'aiMetadata.status': 'PENDING' },
        { $set: { 'aiMetadata.status': 'PROCESSING_RESULT' } },
        { new: true }
    );

    if (!cow) {
        logger.info(`[Sync] Cow ${cow_id} already processed or not pending.`);
        
        // If the webhook is arriving late (after the 6-minute cleanup job or instant rollback),
        // we must ensure the late vector is purged from Qdrant to prevent split-brain.
        try {
            await deleteCowVectors(cow_id);
            logger.info(`[Sync] Purged late-arriving vector for deleted cow: ${cow_id}`);
        } catch (qErr) {
            // Error already logged in qdrantClient
        }
        
        return false;
    }

    try {
        let finalStatus = status;

        if (status === 'DUPLICATE' && matched_cow_id) {
            const matchedCow = await Cattle.findById(matched_cow_id).select('farmerId').lean();
            if (matchedCow && matchedCow.farmerId.toString() !== farmer_id.toString()) {
                finalStatus = 'DISPUTE';
            }
        }

        if (finalStatus === 'DUPLICATE') {
            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    await Promise.all([
                        Cattle.findByIdAndDelete(cow_id, { session }),
                        User.findByIdAndUpdate(farmer_id, { $pull: { cows: cow_id } }, { session })
                    ]);
                });
            } finally {
                await session.endSession();
            }
            recentRejections.set(cow_id, { status, message: error_message } as any);
            setTimeout(() => recentRejections.delete(cow_id), REJECTION_TTL_MS);

            cleanupCowCloudResources(cow);
            logger.info(`[Sync] Duplicate cow deleted for cow_id: ${cow_id}`);
        } else if (finalStatus === 'DISPUTE') {
            let originalFarmerId = null;
            if (matched_cow_id) {
                const matchedCow = await Cattle.findById(matched_cow_id);
                if (matchedCow) {
                    originalFarmerId = matchedCow.farmerId;
                }
            }

            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    const tasks: Promise<any>[] = [
                        Cattle.findByIdAndDelete(cow_id, { session }),
                        User.findByIdAndUpdate(farmer_id, { $pull: { cows: cow_id } }, { session })
                    ];
                    
                    if (matched_cow_id) {
                        tasks.push(Cattle.findByIdAndUpdate(matched_cow_id, { isDispute: true }, { session }));
                    }
                    if (originalFarmerId && matched_cow_id) {
                        tasks.push(Dispute.create([{
                            cattleId: matched_cow_id,
                            originalFarmerId: originalFarmerId,
                            attemptingFarmerId: farmer_id,
                            status: 'pending',
                            reason: error_message || 'Duplicate Registration Attempt Detected via AI Biometrics'
                        }], { session }));
                    }
                    
                    await Promise.all(tasks);
                });
            } finally {
                await session.endSession();
            }

            cleanupCowCloudResources(cow);
            logger.info(`[Sync] Dispute marked for matched_cow_id: ${matched_cow_id}. Ghost cow ${cow_id} deleted.`);
        } else if (finalStatus === 'SUCCESS') {
            cow.aiMetadata.isRegistered = true;
            cow.aiMetadata.status = status;
            await cow.save();
            logger.info(`[Sync] Successfully registered cow_id: ${cow_id}`);
        } else {
            const session = await mongoose.startSession();
            try {
                await session.withTransaction(async () => {
                    await Promise.all([
                        Cattle.findByIdAndDelete(cow_id, { session }),
                        User.findByIdAndUpdate(farmer_id, { $pull: { cows: cow_id } }, { session })
                    ]);
                });
            } finally {
                await session.endSession();
            }
            recentRejections.set(cow_id, { status: finalStatus, message: error_message } as any);
            setTimeout(() => recentRejections.delete(cow_id), REJECTION_TTL_MS);

            cleanupCowCloudResources(cow);
            logger.info(`[Sync] Failed AI processing, cow deleted for cow_id: ${cow_id}`);
        }

        return true;
    } catch (error) {
        logger.error(error, `[Sync] Error processing DL API result for cow ${cow_id}:`);
        await Cattle.findByIdAndUpdate(cow_id, { $set: { 'aiMetadata.status': 'PENDING' } });
        return false;
    }
}
