import { Request, Response } from 'express';
import { Cattle } from '../../models/Cattel';
import { User } from '../../models/User';
import crypto from 'crypto';
import { createCattleRegistration, executeCowSearch, cleanupCowCloudResources, recentRejections, getRejectionMessage, processDlApiResult } from '../../services/cattleService';
import logger from '../../utils/logger';
import mongoose from 'mongoose';
import { asyncHandler } from '../../middleware/asyncHandler';

interface AuthRequest extends Request {
    user?: { id: string; role: string; name: string };
    body: any;
    params: any;
}


export const registerCow = asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const farmerId = authReq.user.id;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };

    if (String(authReq.body.isInformationCorrectAgreement) !== 'true') {
        return res.status(400).json({ success: false, message: 'You must agree that the information is true and correct.' });
    }

    const savedCow = await createCattleRegistration(req, farmerId, authReq.body, files);

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
        'aiMetadata.status': { $nin: ['PENDING', 'PROCESSING_RESULT'] }
    };

    const searchQuery = { ...baseQuery };
    if (search) {
        searchQuery.$text = { $search: search };
    }

    const sortOptions: any = search
        ? { score: { $meta: "textScore" } }
        : { createdAt: -1 };

    const [totalNonDisputed, totalPregnant, totalDisputed, cattle, totalFiltered] = await Promise.all([
        Cattle.countDocuments({ ...baseQuery, isDispute: { $ne: true } }),
        Cattle.countDocuments({ ...baseQuery, isDispute: { $ne: true }, currentStatus: 'Pregnant' }),
        Cattle.countDocuments({ ...baseQuery, isDispute: true }),
        Cattle.find(searchQuery, search ? { score: { $meta: "textScore" } } : {})
            .sort(sortOptions)
            .skip(skip)
            .limit(limit)
            .lean(),
        Cattle.countDocuments(searchQuery)
    ]);

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





export const getCowProfile = asyncHandler(async (req: Request, res: Response) => {
    const authReq = req as AuthRequest;
    if (!authReq.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    if (!mongoose.Types.ObjectId.isValid(authReq.params.id)) {
        return res.status(404).json({ success: false, message: 'Cow not found or unauthorized' });
    }

    let cow = await Cattle.findOne({ _id: authReq.params.id, farmerId: authReq.user.id });

    if (!cow) {
        if (recentRejections.has(authReq.params.id)) {
            const rejectionData = recentRejections.get(authReq.params.id);
            const failureStatus = typeof rejectionData === 'string' ? rejectionData : rejectionData?.status;
            const messageStr = typeof rejectionData === 'object' ? rejectionData?.message : undefined;
            const userMessage = getRejectionMessage(failureStatus, messageStr);

            return res.status(400).json({
                success: false,
                isRejected: true,
                status: failureStatus,
                message: userMessage
            });
        }
        return res.status(404).json({ success: false, message: 'Cow not found or unauthorized' });
    }


    // Mask internal PROCESSING_RESULT status from client so it continues polling instead of crashing
    if (cow.aiMetadata && cow.aiMetadata.status === 'PROCESSING_RESULT') {
        const cowObj = cow.toObject ? cow.toObject() : cow;
        cowObj.aiMetadata.status = 'PENDING';
        return res.status(200).json({ success: true, data: cowObj });
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

    try {
        const result = await executeCowSearch(req.files, authReq.user.id, authReq.user.role || 'farmer', '/search', abortController);

        if (result.match === false || !result.cow_id) {
            return res.status(200).json({
                success: true,
                data: { cowId: null, cow: null, confidence: 0, match: false },
                message: result.reason || 'Cow not found. No suspects passed the AI evaluation.'
            });
        }

        const cow = await Cattle.findOne({ _id: result.cow_id, farmerId: authReq.user.id });
        if (!cow) {
            return res.status(404).json({ success: false, message: 'Cow identified but does not belong to you or does not exist.' });
        }

        res.status(200).json({
            success: true,
            data: {
                cowId: result.cow_id,
                cow: cow,
                confidence: 1 - result.distance,
                match: true
            }
        });

    } catch (error: any) {
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({ success: false, message: error.message || 'Server Error' });
    }
});



export const handleDlApiWebhook = asyncHandler(async (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const expectedToken = process.env.DL_API_KEY;

    if (!expectedToken) {
        return res.status(500).json({ success: false, message: 'Server misconfiguration: DL_API_KEY is required for webhook authentication' });
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Unauthorized webhook call' });
    }

    const token = authHeader.split(' ')[1];

    // Use timingSafeEqual to prevent timing attacks
    if (token.length !== expectedToken.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken))) {
        return res.status(401).json({ success: false, message: 'Unauthorized webhook call' });
    }

    await processDlApiResult(req.body);
    // Acknowledge receipt even if already processed by polling
    res.status(200).json({ success: true });
});
