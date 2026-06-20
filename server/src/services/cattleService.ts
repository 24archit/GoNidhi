import { Cattle } from '../models/Cattel';
import { User } from '../models/User';
import { uploadBufferToCloudinary, deleteFromCloudinary } from './cloudinaryService';
import { dlApiClient } from '../utils/dlApiClient';
import mongoose from 'mongoose';
import crypto from 'crypto';
import logger from '../utils/logger';
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
        dlApiClient.post(`/register`, {
            cow_id: savedCow._id.toString(),
            farmer_id: farmerId,
            cow_name: name,
            face_image_url: faceTelemetryCloudinary,
            muzzle_image_url: muzzleTelemetryCloudinary
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
                        await Cattle.findByIdAndDelete(savedCow._id, { session });
                        await User.findByIdAndUpdate(farmerId, { $pull: { cows: savedCow._id } }, { session });
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
        if (cow.photos) {
            const deletePromises = [];
            if (cow.photos.faceProfile) deletePromises.push(deleteFromCloudinary(cow.photos.faceProfile).catch(() => { }));
            if (cow.photos.muzzle) deletePromises.push(deleteFromCloudinary(cow.photos.muzzle).catch(() => { }));
            if (cow.photos.leftProfile) deletePromises.push(deleteFromCloudinary(cow.photos.leftProfile).catch(() => { }));
            if (cow.photos.rightProfile) deletePromises.push(deleteFromCloudinary(cow.photos.rightProfile).catch(() => { }));
            if (cow.photos.backView) deletePromises.push(deleteFromCloudinary(cow.photos.backView).catch(() => { }));
            if (cow.photos.tailView) deletePromises.push(deleteFromCloudinary(cow.photos.tailView).catch(() => { }));
            if (cow.photos.selfie) deletePromises.push(deleteFromCloudinary(cow.photos.selfie).catch(() => { }));
            
            if (deletePromises.length > 0) {
                await Promise.all(deletePromises);
            }
        }

        // Instruct Qdrant to directly delete vectors
        try {
            await deleteCowVectors(cow._id.toString());
        } catch (dlErr) {
            // Error already logged in qdrantClient
        }

    } catch (err) {
        logger.error(err, 'Error in cleanupCowCloudResources:');
    }
};
