import { Request, Response } from 'express';
import { Cattle } from '../../models/Cattel';
import { User } from '../../models/User';
import { cleanupCowCloudResources, createCattleRegistration, executeCowSearch, recentRejections, getRejectionMessage } from '../../services/cattleService';
import mongoose from 'mongoose';
import logger from '../../utils/logger';

export const getCattleDetails = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(404).json({ success: false, message: 'Cattle not found' });
        }
        let cattle = await Cattle.findById(id).populate('farmerId', 'name contact.phone location.village location.district');
        if (!cattle) {
            if (recentRejections.has(id)) {
                const rejectionData = recentRejections.get(id);
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
            return res.status(404).json({ success: false, message: 'Cattle not found' });
        }


        // Mask internal PROCESSING_RESULT status from client
        if (cattle.aiMetadata && cattle.aiMetadata.status === 'PROCESSING_RESULT') {
            const cattleObj = cattle.toObject ? cattle.toObject() : cattle;
            cattleObj.aiMetadata.status = 'PENDING';
            return res.status(200).json({ success: true, data: cattleObj });
        }

        res.status(200).json({ success: true, data: cattle });
    } catch (error: any) {
        logger.error(error, 'Error fetching cattle details:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const getAllCattle = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const search = req.query.search as string;

        let query: any = {
            'aiMetadata.status': { $nin: ['PENDING', 'PROCESSING_RESULT'] }
        };
        if (search) {
            query.$text = { $search: search };
        }

        const skip = (page - 1) * limit;
        const sortOptions: any = search ? { score: { $meta: "textScore" } } : { createdAt: -1 };

        const [cattle, total] = await Promise.all([
            Cattle.find(query, search ? { score: { $meta: "textScore" } } : {})
                .populate('farmerId', 'name contact.phone location')
                .sort(sortOptions)
                .skip(skip)
                .limit(limit)
                .lean(),
            Cattle.countDocuments(query)
        ]);

        res.status(200).json({
            success: true,
            data: cattle,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page
        });
    } catch (error: any) {
        logger.error(error, 'Error fetching all cattle:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const getPendingCattle = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;

        let query: any = {
            'aiMetadata.status': { $in: ['PENDING', 'PROCESSING_RESULT'] }
        };

        const skip = (page - 1) * limit;

        const [cattle, total] = await Promise.all([
            Cattle.find(query)
                .populate('farmerId', 'name contact.phone location')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Cattle.countDocuments(query)
        ]);

        res.status(200).json({
            success: true,
            data: cattle,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page
        });
    } catch (error: any) {
        logger.error(error, 'Error fetching pending cattle:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const proxyRegisterCow = async (req: Request, res: Response) => {
    try {
        const farmerPhone = req.body.farmerPhone;
        if (!farmerPhone) {
            return res.status(400).json({ success: false, message: 'Farmer phone number is required for proxy registration' });
        }

        const farmer = await User.findOne({ 'contact.phone': farmerPhone, role: 'farmer' });
        if (!farmer) {
            return res.status(404).json({ success: false, message: 'Farmer not found with this phone number' });
        }

        const files = req.files as { [fieldname: string]: Express.Multer.File[] };
        const savedCow = await createCattleRegistration(req, farmer._id.toString(), req.body, files);

        res.status(202).json({
            success: true,
            message: `Cow proxy registration accepted for farmer ${farmer.name}.`,
            data: savedCow
        });

    } catch (error: any) {
        logger.error(error, 'Error in proxy registering cow:');
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({ success: false, message: error.message || 'Server Error' });
    }
};

export const deleteCattle = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(404).json({ success: false, message: 'Cattle not found' });
        }
        const session = await mongoose.startSession();
        let deletedCattle: any = null;
        try {
            await session.withTransaction(async () => {
                deletedCattle = await Cattle.findByIdAndDelete(id, { session });
                if (deletedCattle && deletedCattle.farmerId) {
                    await User.findByIdAndUpdate(deletedCattle.farmerId, { $pull: { cows: deletedCattle._id } }, { session });
                }
            });
        } finally {
            await session.endSession();
        }

        if (!deletedCattle) {
            // Idempotent delete: if it's already gone, treat as success
            return res.status(200).json({ success: true, message: 'Cattle already deleted' });
        }

        // Background cleanup of cloud resources
        cleanupCowCloudResources(deletedCattle);

        res.status(200).json({ success: true, message: 'Cattle deleted successfully' });
    } catch (error: any) {
        logger.error(error, 'Error deleting cattle:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const updateCattle = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(404).json({ success: false, message: 'Cattle not found' });
        }
        const updateData = req.body;

        // Prevent editing of images, system fields, and farmerId through this basic update route
        delete updateData._id;
        delete updateData.farmerId;
        delete updateData.photos;
        delete updateData.aiMetadata;
        delete updateData.createdAt;
        delete updateData.updatedAt;

        // Clean up nested fields if necessary, or just rely on mongoose $set
        const updatedCattle = await Cattle.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true, runValidators: true }
        ).populate('farmerId', 'name contact.phone location.village location.district');

        if (!updatedCattle) {
            return res.status(404).json({ success: false, message: 'Cattle not found' });
        }

        res.status(200).json({ success: true, message: 'Cattle updated successfully', data: updatedCattle });
    } catch (error: any) {
        logger.error(error, 'Error updating cattle:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const proxySearchCow = async (req: Request, res: Response) => {
    const abortController = new AbortController();

    res.on('close', () => {
        if (!res.writableEnded) {
            abortController.abort();
        }
    });

    try {
        const result = await executeCowSearch(req.files, 'admin_proxy', 'admin', '/admin/proxy-search', abortController);

        if (result.match === false || !result.cow_id) {
            return res.status(200).json({
                success: true,
                data: { cowId: null, cow: null, confidence: 0, match: false },
                message: result.reason || 'Cow not found. No suspects passed the AI evaluation.'
            });
        }

        const cow = await Cattle.findById(result.cow_id).populate('farmerId', 'name contact.phone');
        if (!cow) {
            return res.status(404).json({ success: false, message: 'Cow identified but does not exist in DB.' });
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
        logger.error(error, 'Error in proxy search:');
        const statusCode = error.statusCode || 500;
        res.status(statusCode).json({ success: false, message: error.message || 'Server Error' });
    }
};
