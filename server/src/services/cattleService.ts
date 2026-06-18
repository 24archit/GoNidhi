import { Cattle } from '../models/Cattel';
import { User } from '../models/User';
import { uploadBufferToCloudinary, deleteFromCloudinary } from './cloudinaryService';
import { dlApiClient } from '../utils/dlApiClient';
import mongoose from 'mongoose';
import logger from '../utils/logger';

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

        const faceProfileFile = files.faceImage[0];
        const muzzleFile = files.muzzleImage[0];

        let faceProfileCloudinary, muzzleCloudinary, leftProfileCloudinary, rightProfileCloudinary, backViewCloudinary, tailViewCloudinary, selfieCloudinary;
        let faceTelemetryCloudinary, muzzleTelemetryCloudinary;

        try {
            faceProfileCloudinary = await safeUpload(faceProfileFile.buffer);
            muzzleCloudinary = await safeUpload(muzzleFile.buffer);
            leftProfileCloudinary = await safeUploadIfPresent(files.leftImage);
            rightProfileCloudinary = await safeUploadIfPresent(files.rightImage);
            backViewCloudinary = await safeUploadIfPresent(files.backImage);
            tailViewCloudinary = await safeUploadIfPresent(files.tailImage);
            selfieCloudinary = await safeUploadIfPresent(files.selfieImage);

            // Telemetry uploads
            faceTelemetryCloudinary = await safeUpload(faceProfileFile.buffer, 'gonidhi-telemetry');
            muzzleTelemetryCloudinary = await safeUpload(muzzleFile.buffer, 'gonidhi-telemetry');
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
                date: purchaseDate,
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
                selfie: selfieCloudinary
            },
            aiMetadata: {
                isRegistered: false,
                status: 'PENDING'
            },
            currentStatus: productionStatus,
            healthStats: {
                birthWeight: birthWeight ? Number(birthWeight) : undefined,
                motherWeightAtCalving: motherWeightAtCalving ? Number(motherWeightAtCalving) : undefined,
                healthStatus,
                calvingCounter: calvingCounter ? Number(calvingCounter) : undefined
            }
        });

        try {
            if (req.isAborted) throw new Error('Client Closed Request');
            const session = await mongoose.startSession();
            await session.withTransaction(async () => {
                const [savedItems] = await Cattle.create([newCow], { session });
                savedCow = savedItems;
                await User.findByIdAndUpdate(farmerId, {
                    $push: { cows: savedCow._id }
                }, { session });
            });
            session.endSession();
        } catch (dbError: any) {
            logger.error(dbError, 'Error saving to MongoDB, rolling back:');
            if (dbError.code === 11000) {
                if (dbError.keyPattern && dbError.keyPattern.tagNumber) {
                    const err = new Error('Cow with this tag number already exists');
                    (err as any).statusCode = 400;
                    throw err;
                }
                if (dbError.keyPattern && dbError.keyPattern['aiMetadata.status']) {
                    const err = new Error('You already have a cow registration in progress. Please wait for it to complete.');
                    (err as any).statusCode = 400;
                    throw err;
                }
            }
            const err = new Error('Database error during registration. Please try again.');
            (err as any).statusCode = 500;
            throw err;
        }

        // Send Job to DL-API REST Endpoint
        try {
            // We do not await this heavily, we just trigger it and let it run in the background thread of the DL-API.
            // The DL-API will immediately return 202 Accepted.
            await dlApiClient.post(`/register`, {
                cow_id: savedCow._id.toString(),
                farmer_id: farmerId,
                cow_name: name,
                face_image_url: faceTelemetryCloudinary,
                muzzle_image_url: muzzleTelemetryCloudinary
            });
        } catch (apiError: any) {
            logger.error(apiError.message, 'Error triggering DL-API:');
            const err = new Error('Could not trigger AI registration process. Please try again.');
            (err as any).statusCode = 500;
            throw err;
        }

        return savedCow;

    } catch (error: any) {
        try {
            if (savedCow) {
                const session = await mongoose.startSession();
                await session.withTransaction(async () => {
                    await Cattle.findByIdAndDelete(savedCow._id, { session });
                    await User.findByIdAndUpdate(farmerId, { $pull: { cows: savedCow._id } }, { session });
                });
                session.endSession();
            }
        } catch (rollbackErr) {
            logger.error(rollbackErr, 'Error executing DB rollback:');
        } finally {
            for (const fileUrl of uploadedFiles) {
                await deleteFromCloudinary(fileUrl).catch(() => { });
            }
        }
        throw error;
    }
};

export const cleanupCowCloudResources = async (cow: any) => {
    try {
        if (cow.photos) {
            if (cow.photos.faceProfile) await deleteFromCloudinary(cow.photos.faceProfile).catch(() => { });
            if (cow.photos.muzzle) await deleteFromCloudinary(cow.photos.muzzle).catch(() => { });
            if (cow.photos.leftProfile) await deleteFromCloudinary(cow.photos.leftProfile).catch(() => { });
            if (cow.photos.rightProfile) await deleteFromCloudinary(cow.photos.rightProfile).catch(() => { });
            if (cow.photos.backView) await deleteFromCloudinary(cow.photos.backView).catch(() => { });
            if (cow.photos.tailView) await deleteFromCloudinary(cow.photos.tailView).catch(() => { });
            if (cow.photos.selfie) await deleteFromCloudinary(cow.photos.selfie).catch(() => { });
        }

        // Instruct DL-API to delete vectors
        try {
            await dlApiClient.delete(`/cow/${cow._id}`);
        } catch (dlErr) {
            logger.error(dlErr, `Failed to delete vectors for cow ${cow._id} in DL-API:`);
        }

    } catch (err) {
        logger.error(err, 'Error in cleanupCowCloudResources:');
    }
};
