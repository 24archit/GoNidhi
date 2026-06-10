import { Request, Response } from 'express';
import { Cattle } from '../models/Cattel';
import { User } from '../models/User';
import axios from 'axios';
import { uploadImageToOCI, publishDlJob } from '../services/ociService';

// Define the authenticated request type
interface AuthRequest extends Request {
    user?: { id: string; role: string; name: string };
    body: any;
    params: any;
}

// In-memory store for recent rejection reasons to inform the frontend without permanently storing failed cows.
// Entries map cowId -> status ('DUPLICATE', 'SPOOF_DETECTED', etc.)
const recentRejections = new Map<string, any>();
const REJECTION_TTL_MS = 10 * 60 * 1000; // Keep in memory for 10 minutes max

// POST /api/cattle -> Register a new cow for a farmer
export const registerCow = async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    try {
        if (!authReq.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const farmerId = authReq.user.id;
        const {
            tagNo, name, species, breed, sex, dob, ageMonths,
            source, purchaseDate, purchasePrice, sireTag, damTag,
            birthWeight, motherWeightAtCalving, bodyConditionScore,
            currentWeight, growthStatus, healthStatus, productionStatus,
            lat, lng
        } = authReq.body;

        const files = req.files as { [fieldname: string]: Express.Multer.File[] };

        // Basic validation
        if (!lat || !lng) {
            return res.status(400).json({ success: false, message: 'GPS Location is mandatory to register a cow.' });
        }

        if (!files?.muzzleImage?.[0] || !files?.faceImage?.[0]) {
            return res.status(400).json({ success: false, message: 'Missing required biometrics. Both a Face Profile and a Muzzle capture are strictly required.' });
        }
        
        // Check duplicate tags if tag is provided
        if (tagNo && tagNo.trim() !== '') {
            const existingCow = await Cattle.findOne({ tagNumber: tagNo });
            if (existingCow) {
                return res.status(400).json({ success: false, message: 'Cow with this tag number already exists' });
            }
        }

        const uploadFileIfPresent = async (fileArray: Express.Multer.File[] | undefined) => {
            if (!fileArray || fileArray.length === 0) return '';
            const file = fileArray[0];
            return await uploadImageToOCI(file.buffer, file.originalname, file.mimetype);
        };

        const faceProfileFile = files.faceImage[0];
        const muzzleFile = files.muzzleImage[0];
        
        const faceProfileOci = await uploadImageToOCI(faceProfileFile.buffer, faceProfileFile.originalname, faceProfileFile.mimetype);
        const muzzleOci = await uploadImageToOCI(muzzleFile.buffer, muzzleFile.originalname, muzzleFile.mimetype);
        const leftProfileOci = await uploadFileIfPresent(files.leftImage);
        const rightProfileOci = await uploadFileIfPresent(files.rightImage);
        const backViewOci = await uploadFileIfPresent(files.backImage);
        const tailViewOci = await uploadFileIfPresent(files.tailImage);
        const selfieOci = await uploadFileIfPresent(files.selfieImage);

        const newCow = new Cattle({
            farmerId,
            tagNumber: (tagNo && tagNo.trim() !== '') ? tagNo : undefined,
            name,
            species: species || undefined,
            breed: breed || undefined,
            sex: sex || undefined,
            dob: dob || undefined,
            ageMonths: ageMonths ? Number(ageMonths) : undefined,
            sireTag,
            damTag,
            source,
            purchaseDetails: source === 'Purchase' ? {
                date: purchaseDate,
                price: purchasePrice ? Number(purchasePrice) : undefined
            } : undefined,
            location: {
                lat: Number(lat),
                lng: Number(lng)
            },
            photos: {
                faceProfile: faceProfileOci,
                muzzle: muzzleOci,
                leftProfile: leftProfileOci,
                rightProfile: rightProfileOci,
                backView: backViewOci,
                tailView: tailViewOci,
                selfie: selfieOci
            },
            aiMetadata: {
                isRegistered: false, // Will be updated to true by DL-API webhook
                status: 'PENDING'
            },
            currentStatus: productionStatus,
            lastWeight: currentWeight ? Number(currentWeight) : undefined,
            healthStats: {
                birthWeight: birthWeight ? Number(birthWeight) : undefined,
                motherWeightAtCalving: motherWeightAtCalving ? Number(motherWeightAtCalving) : undefined,
                growthStatus,
                healthStatus,
                bodyConditionScore: bodyConditionScore ? Number(bodyConditionScore) : undefined
            }
        });

        const savedCow = await newCow.save();

        // Bind Cow to Farmer Document
        await User.findByIdAndUpdate(farmerId, {
            $push: { cows: savedCow._id }
        });

        // Call DL API asynchronously via OCI Queue
        try {
            await publishDlJob({
                type: 'register',
                cow_id: savedCow._id.toString(),
                farmer_id: farmerId,
                cow_name: name,
                face_image_oci: faceProfileOci,
                muzzle_image_oci: muzzleOci
            });
        } catch (queueError: any) {
            console.error('Error calling putting job into OCI Queue:', queueError.message);

            // Clean up: delete the cow and remove from user if the message queue implies systemic failure
            await Cattle.findByIdAndDelete(savedCow._id);
            await User.findByIdAndUpdate(farmerId, {
                $pull: { cows: savedCow._id }
            });
            return res.status(500).json({ success: false, message: 'Could not enqueue registration process. Please try again.' });
        }

        res.status(202).json({
            success: true,
            message: 'Cow registration accepted. It is currently being processed by our AI servers.',
            data: savedCow
        });

    } catch (error: any) {
        console.error('Error registering cow:', error);
        res.status(500).json({ success: false, message: error.message || 'Server Error' });
    }
};

// GET /api/cattle -> Get paginated cows for the logged-in farmer
export const getMyCattle = async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    try {
        if (!authReq.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const search = req.query.search ? String(req.query.search) : '';
        const skip = (page - 1) * limit;

        const baseQuery: any = {
            farmerId: authReq.user.id,
            'aiMetadata.status': { $ne: 'PENDING' }
        };

        // Parallel stats computation (only needed, but we can compute it on every fetch or just page 1)
        // To be safe we compute it here. It's fast with indexes.
        const [totalNonDisputed, totalPregnant, totalDisputed] = await Promise.all([
            Cattle.countDocuments({ ...baseQuery, isDispute: { $ne: true } }),
            Cattle.countDocuments({ ...baseQuery, isDispute: { $ne: true }, currentStatus: 'Pregnant' }),
            Cattle.countDocuments({ ...baseQuery, isDispute: true })
        ]);

        // Add text search if provided (much faster than regex)
        const searchQuery = { ...baseQuery };
        if (search) {
            searchQuery.$text = { $search: search };
        }

        // We also need to sort by text score if searching, otherwise sort by newest
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

    } catch (error: any) {
        console.error('Error fetching cattle:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// DELETE /api/cattle/:id -> Delete a cow belonging to the farmer
export const deleteCow = async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    try {
        if (!authReq.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const cowToDelete = await Cattle.findOne({ _id: authReq.params.id, farmerId: authReq.user.id });
        if (!cowToDelete) return res.status(404).json({ success: false, message: 'Cow not found or unauthorized' });

        await Cattle.findByIdAndDelete(authReq.params.id);
        await User.findByIdAndUpdate(authReq.user.id, { $pull: { cows: authReq.params.id } });

        res.status(200).json({ success: true, message: 'Cow deleted successfully' });
    } catch (error: any) {
        console.error('Error deleting cow:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// GET /api/cattle/:id -> Get a single cow by ID
export const getCowProfile = async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    try {
        if (!authReq.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const cow = await Cattle.findOne({ _id: authReq.params.id, farmerId: authReq.user.id });

        if (!cow) {
            if (recentRejections.has(authReq.params.id)) {
                const rejectionData = recentRejections.get(authReq.params.id);
                // rejectionData might be a string (old code) or an object (new code)
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

        res.status(200).json({
            success: true,
            data: cow
        });

    } catch (error: any) {
        console.error('Error fetching cow details:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// POST /api/cattle/search -> Search a cow via DL API
export const searchCow = async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    
    // Create an AbortController to cancel the DL API request if the client disconnects
    const abortController = new AbortController();
    
    res.on('close', () => {
        // If the socket closes before we could send our response, the client disconnected.
        if (!res.writableEnded) {
            abortController.abort();
        }
    });

    try {
        if (!authReq.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const files = req.files as { [fieldname: string]: Express.Multer.File[] };

        if (!files?.muzzleImage?.[0] || !files?.faceImage?.[0]) {
            return res.status(400).json({ success: false, message: 'Both a Face Profile and a Muzzle image are strictly required for AI verification.' });
        }

        try {
            const faceFile = files.faceImage[0];
            const muzzleFile = files.muzzleImage[0];

            const faceOci = await uploadImageToOCI(faceFile.buffer, faceFile.originalname, faceFile.mimetype);
            const muzzleOci = await uploadImageToOCI(muzzleFile.buffer, muzzleFile.originalname, muzzleFile.mimetype);

            const dlApiUrl = process.env.DL_MODEL_SERVER_LINK || 'http://localhost:8000';
            const dlResponse = await axios.post(`${dlApiUrl}/search`, {
                user_id: authReq.user.id,
                role: authReq.user.role || 'farmer',
                face_image_oci: faceOci,
                muzzle_image_oci: muzzleOci
            }, {
                signal: abortController.signal
            });

            // Wait for the unified DL-API response
            const { match, cow_id, distance, reason } = dlResponse.data;

            if (match === false || !cow_id) {
                return res.status(200).json({ 
                    success: true, 
                    data: {
                        cowId: null,
                        cow: null,
                        confidence: 0,
                        match: false
                    },
                    message: reason || 'Cow not found. No suspects passed the AI evaluation.' 
                });
            }

            // Optional: verify the cow exists and belongs to the farmer
            const cow = await Cattle.findOne({ _id: cow_id, farmerId: authReq.user.id });
            if (!cow) {
                return res.status(404).json({ success: false, message: 'Cow identified but does not belong to you or does not exist.' });
            }

            res.status(200).json({
                success: true,
                data: {
                    cowId: cow_id,
                    cow: cow,
                    confidence: 1 - distance, // Rough conversion of distance to confidence for UI
                    match: true
                }
            });

        } catch (dlError: any) {
            if (axios.isCancel(dlError) || dlError.name === 'AbortError' || dlError.name === 'CanceledError') {
                console.log('Client disconnected, canceled DL API search request.');
                // 499 is Client Closed Request. Response might fail to send if socket is closed, but we return anyway.
                return res.status(499).json({ success: false, message: 'Client Closed Request' });
            }
            console.error('Error calling DL API search:', dlError?.response?.data || dlError.message);
            const errorDetail = dlError?.response?.data?.detail || 'AI Service unavailable or could not process images.';
            return res.status(404).json({ success: false, message: errorDetail });
        }

    } catch (error: any) {
        console.error('Error in search proxy:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

// POST /api/cattle/webhook/dl-api-complete -> Webhook for DL-API
export const handleDlApiWebhook = async (req: Request, res: Response) => {
    try {
        const { cow_id, farmer_id, status, matched_cow_id, superpoint_cache, error_message } = req.body;

        if (!cow_id) {
            return res.status(400).json({ success: false, message: 'Missing cow_id' });
        }

        const cow = await Cattle.findById(cow_id);
        if (!cow) {
            return res.status(404).json({ success: false, message: 'Cow not found' });
        }

        if (status === 'DUPLICATE') {
            await Cattle.findByIdAndDelete(cow_id);
            await User.findByIdAndUpdate(farmer_id, { $pull: { cows: cow_id } });
            recentRejections.set(cow_id, { status, message: error_message } as any);
            setTimeout(() => recentRejections.delete(cow_id), REJECTION_TTL_MS);
            console.log(`[Webhook] Duplicate cow deleted for cow_id: ${cow_id}`);
        } else if (status === 'DISPUTE') {
            cow.isDispute = true;
            cow.aiMetadata.isRegistered = true;
            cow.aiMetadata.status = status;
            await cow.save();

            if (matched_cow_id) {
                await Cattle.findByIdAndUpdate(matched_cow_id, { isDispute: true });
            }
            console.log(`[Webhook] Dispute marked for cow_id: ${cow_id} and matched_cow_id: ${matched_cow_id}`);
        } else if (status === 'SUCCESS') {
            cow.aiMetadata.isRegistered = true;
            cow.aiMetadata.status = status;

            await cow.save();
            console.log(`[Webhook] Successfully registered cow_id: ${cow_id}`);
        } else {
            // FAILED, NO_MUZZLE_DETECTED, FAILED_MAX_RETRIES etc
            await Cattle.findByIdAndDelete(cow_id);
            await User.findByIdAndUpdate(farmer_id, { $pull: { cows: cow_id } });
            recentRejections.set(cow_id, { status, message: error_message } as any);
            setTimeout(() => recentRejections.delete(cow_id), REJECTION_TTL_MS);
            console.log(`[Webhook] Failed AI processing, cow deleted for cow_id: ${cow_id}`);
        }

        res.status(200).json({ success: true });
    } catch (error: any) {
        console.error('Error in webhook handling:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
