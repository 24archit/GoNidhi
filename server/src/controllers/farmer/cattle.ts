import { Request, Response } from 'express';
import { Cattle } from '../../models/Cattel';
import { User } from '../../models/User';
import { Dispute } from '../../models/Dispute';
import axios from 'axios';
import { uploadBufferToCloudinary, deleteFromCloudinary } from '../../services/cloudinaryService';
import { asyncHandler } from '../../middleware/asyncHandler';
import { processTelemetry } from '../../services/telemetryService';
import { createCattleRegistration, cleanupCowCloudResources } from '../../services/cattleService';
import { getDlApiUrl } from '../../utils/dlApi';

interface AuthRequest extends Request {
    user?: { id: string; role: string; name: string };
    body: any;
    params: any;
}

export const recentRejections = new Map<string, any>();
const REJECTION_TTL_MS = 10 * 60 * 1000;

export const registerCow = asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const farmerId = authReq.user.id;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    const savedCow = await createCattleRegistration(farmerId, authReq.body, files);

    res.status(202).json({
        success: true,
        message: 'Cow registration accepted. It is currently being processed by our AI servers.',
        data: savedCow
    });
});

export const getMyCattle = asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const search = req.query.search ? String(req.query.search) : '';
    const skip = (page - 1) * limit;

    const baseQuery: any = {
        farmerId: authReq.user.id,
        'aiMetadata.status': { $ne: 'PENDING' }
    };

    const [totalNonDisputed, totalPregnant, totalDisputed] = await Promise.all([
        Cattle.countDocuments({ ...baseQuery, isDispute: { $ne: true } }),
        Cattle.countDocuments({ ...baseQuery, isDispute: { $ne: true }, currentStatus: 'Pregnant' }),
        Cattle.countDocuments({ ...baseQuery, isDispute: true })
    ]);

    const searchQuery = { ...baseQuery };
    if (search) {
        searchQuery.$text = { $search: search };
    }

    const sortOptions: any = search 
        ? { score: { $meta: "textScore" } } 
        : { createdAt: -1 };

    const cattle = await Cattle.find(searchQuery, search ? { score: { $meta: "textScore" } } : {})
        .sort(sortOptions)
        .skip(skip)
        .limit(limit);

    const totalFiltered = await Cattle.countDocuments(searchQuery);

    res.status(200).json({
        success: true,
        count: cattle.length,
        totalFiltered,
        totalPages: Math.ceil(totalFiltered / limit),
        currentPage: page,
        hasMore: skip + cattle.length < totalFiltered,
        stats: {
            totalNonDisputed,
            totalPregnant,
            totalDisputed
        },
        data: cattle
    });
});

export const deleteCow = asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const cowToDelete = await Cattle.findOne({ _id: authReq.params.id, farmerId: authReq.user.id });
    if (!cowToDelete) return res.status(404).json({ success: false, message: 'Cow not found or unauthorized' });

    await Cattle.findByIdAndDelete(authReq.params.id);
    await User.findByIdAndUpdate(authReq.user.id, { $pull: { cows: authReq.params.id } }).catch(() => {});

    // Run cleanup asynchronously in background to not block the response
    cleanupCowCloudResources(cowToDelete);

    res.status(200).json({ success: true, message: 'Cow deleted successfully' });
});

export const getCowProfile = asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    let cow = await Cattle.findOne({ _id: authReq.params.id, farmerId: authReq.user.id });

    if (!cow) {
        if (recentRejections.has(authReq.params.id)) {
            const rejectionData = recentRejections.get(authReq.params.id);
            let failureStatus = typeof rejectionData === 'string' ? rejectionData : rejectionData?.status;
            let userMessage = typeof rejectionData === 'object' && rejectionData?.message 
                ? rejectionData.message 
                : `Registration failed due to: ${failureStatus}`;
            
            if (!userMessage || userMessage.includes('Registration failed due to')) {
                if (failureStatus === 'SPOOF_DETECTED_MUZZLE') {
                    userMessage = 'Registration failed: Spoofing detected in the Muzzle image. Make sure it is a real photo, not a screen or print.';
                } else if (failureStatus === 'NO_MUZZLE_DETECTED_MUZZLE_IMAGE' || failureStatus === 'NO_MUZZLE_DETECTED') {
                    userMessage = 'Registration failed: Could not detect the muzzle clearly in the Muzzle profile image. Retake the Muzzle profile.';
                } else if (failureStatus === 'NO_FACE_DETECTED') {
                    userMessage = 'Registration failed: Could not detect the face clearly in the Face profile image. Retake the Face profile.';
                } else if (failureStatus === 'NO_BIOMETRICS_DETECTED') {
                    userMessage = 'Registration failed: Could not detect either a Face or Muzzle. Please retake the photos clearly.';
                } else if (failureStatus === 'DUPLICATE') {
                    userMessage = 'Registration failed: This cow is already registered.';
                }
            }
            
            return res.status(400).json({ 
                success: false, 
                isRejected: true,
                status: failureStatus,
                message: userMessage
            });
        }
        return res.status(404).json({ success: false, message: 'Cow not found or unauthorized' });
    }
    if (cow.aiMetadata.status === 'PENDING') {
        try {
            const dlApiUrl = getDlApiUrl();
            const statusRes = await axios.get(`${dlApiUrl}/status/${cow._id}`);
            
            if (statusRes.data.status === 'COMPLETED') {
                console.log(`[DL-API Sync] Polled DL-API and found COMPLETED result for cow ${cow._id}. Processing locally.`);
                await processDlApiResult(statusRes.data.result);
                
                // Fetch the updated cow or return 404 if it was a failure/duplicate and got deleted
                const updatedCow = await Cattle.findById(cow._id);
                if (!updatedCow) {
                    const rejectionData = recentRejections.get(cow._id.toString());
                    return res.status(400).json({ 
                        success: false, 
                        isRejected: true,
                        status: rejectionData ? (rejectionData as any).status : 'FAILED',
                        message: rejectionData ? (rejectionData as any).message : 'Registration failed.'
                    });
                }
                cow = updatedCow;
            }
            // If it returns PROCESSING, we just fall through and return PENDING.
        } catch (err: any) {
            // If the DL-API returns a 404, the job is no longer active (crashed or lost).
            if (err.response && err.response.status === 404) {
                console.log(`[DL-API Sync] Cow ${cow._id} is PENDING but DL-API has no record of it. Discarding.`);
                
                // Background cleanup
                cleanupCowCloudResources(cow);
                
                await Cattle.findByIdAndDelete(cow._id);
                await User.findByIdAndUpdate(authReq.user.id, { $pull: { cows: cow._id } });
                
                return res.status(400).json({ 
                    success: false, 
                    isRejected: true,
                    status: 'AI_CRASH',
                    message: 'The AI server dropped the registration request due to an internal error. Please try again.'
                });
            }
        }
    }

    res.status(200).json({
        success: true,
        data: cow
    });
});

export const searchCow = asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    const abortController = new AbortController();
    
    res.on('close', () => {
        if (!res.writableEnded) abortController.abort();
    });

    if (!authReq.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    if (!files?.muzzleImage?.[0] || !files?.faceImage?.[0]) {
        return res.status(400).json({ success: false, message: 'Both a Face Profile and a Muzzle image are strictly required for AI verification.' });
    }

    let faceCloudinary: string | undefined;
    let muzzleCloudinary: string | undefined;
    try {
        const faceFile = files.faceImage[0];
        const muzzleFile = files.muzzleImage[0];

        faceCloudinary = await uploadBufferToCloudinary(faceFile.buffer, 'ama-gau-dhana-telemetry');
        muzzleCloudinary = await uploadBufferToCloudinary(muzzleFile.buffer, 'ama-gau-dhana-telemetry');

        const dlApiUrl = getDlApiUrl();
        const dlResponse = await axios.post(`${dlApiUrl}/search`, {
            user_id: authReq.user.id,
            role: authReq.user.role || 'farmer',
            face_image_url: faceCloudinary,
            muzzle_image_url: muzzleCloudinary
        }, {
            signal: abortController.signal,
            timeout: 120000
        });

        const { match, cow_id, distance, reason, telemetry } = dlResponse.data;

        if (telemetry) {
            processTelemetry(telemetry, '/search', match);
        }

        if (match === false || !cow_id) {
            return res.status(200).json({ 
                success: true, 
                data: { cowId: null, cow: null, confidence: 0, match: false },
                message: reason || 'Cow not found. No suspects passed the AI evaluation.' 
            });
        }

        const cow = await Cattle.findOne({ _id: cow_id, farmerId: authReq.user.id });
        if (!cow) {
            return res.status(404).json({ success: false, message: 'Cow identified but does not belong to you or does not exist.' });
        }

        res.status(200).json({
            success: true,
            data: {
                cowId: cow_id,
                cow: cow,
                confidence: 1 - distance,
                match: true
            }
        });

    } catch (dlError: any) {
        if (faceCloudinary) deleteFromCloudinary(faceCloudinary).catch(() => {});
        if (muzzleCloudinary) deleteFromCloudinary(muzzleCloudinary).catch(() => {});

        if (axios.isCancel(dlError) || dlError.name === 'AbortError' || dlError.name === 'CanceledError') {
            console.log('Client disconnected, canceled DL API search request.');
            return res.status(499).json({ success: false, message: 'Client Closed Request' });
        }
        console.error('Error calling DL API search:', dlError?.response?.data || dlError.message);
        const errorDetail = dlError?.response?.data?.detail || 'AI Service unavailable or could not process images.';
        return res.status(404).json({ success: false, message: errorDetail });
    }
});

async function processDlApiResult(payload: any) {
    const { cow_id, farmer_id, status, matched_cow_id, superpoint_cache, error_message, telemetry } = payload;

    if (telemetry) {
        processTelemetry(telemetry, '/register', status === 'SUCCESS' || status === 'DUPLICATE' || status === 'DISPUTE');
    }

    if (!cow_id) return false;

    const cow = await Cattle.findById(cow_id);
    if (!cow) return false;

    if (status === 'DUPLICATE') {
        await Cattle.findByIdAndDelete(cow_id);
        await User.findByIdAndUpdate(farmer_id, { $pull: { cows: cow_id } });
        recentRejections.set(cow_id, { status, message: error_message } as any);
        setTimeout(() => recentRejections.delete(cow_id), REJECTION_TTL_MS);
        
        cleanupCowCloudResources(cow);
        console.log(`[Sync] Duplicate cow deleted for cow_id: ${cow_id}`);
    } else if (status === 'DISPUTE') {
        cow.isDispute = true;
        cow.aiMetadata.isRegistered = true;
        cow.aiMetadata.status = status;
        await cow.save();

        let originalFarmerId = null;
        if (matched_cow_id) {
            await Cattle.findByIdAndUpdate(matched_cow_id, { isDispute: true });
            const matchedCow = await Cattle.findById(matched_cow_id);
            if (matchedCow) {
                originalFarmerId = matchedCow.farmerId;
            }
        }

        if (originalFarmerId) {
            const dispute = new Dispute({
                cattleId: cow_id,
                originalFarmerId: originalFarmerId,
                attemptingFarmerId: farmer_id,
                status: 'pending',
                reason: error_message || 'Duplicate Registration Attempt Detected via AI Biometrics'
            });
            await dispute.save();
        }

        console.log(`[Sync] Dispute marked for cow_id: ${cow_id} and matched_cow_id: ${matched_cow_id}`);
    } else if (status === 'SUCCESS') {
        cow.aiMetadata.isRegistered = true;
        cow.aiMetadata.status = status;
        await cow.save();
        console.log(`[Sync] Successfully registered cow_id: ${cow_id}`);
    } else {
        await Cattle.findByIdAndDelete(cow_id);
        await User.findByIdAndUpdate(farmer_id, { $pull: { cows: cow_id } });
        recentRejections.set(cow_id, { status, message: error_message } as any);
        setTimeout(() => recentRejections.delete(cow_id), REJECTION_TTL_MS);
        
        cleanupCowCloudResources(cow);
        console.log(`[Sync] Failed AI processing, cow deleted for cow_id: ${cow_id}`);
    }
    
    return true;
}

export const handleDlApiWebhook = asyncHandler(async (req: Request, res: Response) => {
    const processed = await processDlApiResult(req.body);
    if (!processed) {
        return res.status(404).json({ success: false, message: 'Cow not found or missing ID' });
    }
    res.status(200).json({ success: true });
});
