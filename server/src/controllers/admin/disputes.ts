import { Request, Response } from 'express';
import { Dispute } from '../../models/Dispute';
import { Cattle } from '../../models/Cattel';
import { User } from '../../models/User';
import mongoose from 'mongoose';
import logger from '../../utils/logger';

export const getDisputes = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const status = req.query.status as string;
        
        const query: any = {};
        if (status) {
            query.status = status;
        }

        const skip = (page - 1) * limit;

        const disputes = await Dispute.find(query)
            .populate('cattleId', 'tagNumber name species breed photos aiMetadata')
            .populate('originalFarmerId', 'name contact.phone location')
            .populate('attemptingFarmerId', 'name contact.phone location')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const total = await Dispute.countDocuments(query);

        res.status(200).json({
            success: true,
            data: disputes,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page
        });
    } catch (error: any) {
        logger.error(error, 'Error fetching disputes:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const resolveDispute = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(404).json({ success: false, message: 'Dispute not found' });
        }
        const { resolutionStatus, assignedFarmerId } = req.body; // resolutionStatus: 'resolved' | 'rejected'

        if (!['resolved', 'rejected'].includes(resolutionStatus)) {
            return res.status(400).json({ success: false, message: 'Invalid resolution status' });
        }

        const session = await mongoose.startSession();
        let updatedDispute: any = null;
        try {
            await session.withTransaction(async () => {
                // Atomically check and lock the dispute to prevent concurrent resolution races
                updatedDispute = await Dispute.findOneAndUpdate(
                    { _id: id, status: 'pending' },
                    { $set: { status: resolutionStatus } },
                    { new: true, session }
                );

                if (!updatedDispute) {
                    return; // Dispute was already resolved or doesn't exist
                }

                if (resolutionStatus === 'resolved' && assignedFarmerId && updatedDispute.cattleId) {
                    const cow = await Cattle.findById(updatedDispute.cattleId).session(session);
                    if (cow && cow.farmerId && cow.farmerId.toString() !== assignedFarmerId.toString()) {
                        await User.findByIdAndUpdate(cow.farmerId, { $pull: { cows: updatedDispute.cattleId } }, { session });
                        await User.findByIdAndUpdate(assignedFarmerId, { $push: { cows: updatedDispute.cattleId } }, { session });
                    } else if (cow && !cow.farmerId) {
                        await User.findByIdAndUpdate(assignedFarmerId, { $push: { cows: updatedDispute.cattleId } }, { session });
                    }
                    
                    await Cattle.findByIdAndUpdate(updatedDispute.cattleId, {
                        farmerId: assignedFarmerId,
                        isDispute: false
                    }, { session });
                }
            });
        } finally {
            await session.endSession();
        }

        if (!updatedDispute) {
            return res.status(400).json({ success: false, message: 'Dispute is already resolved or does not exist.' });
        }

        res.status(200).json({ success: true, data: updatedDispute, message: 'Dispute resolved' });
    } catch (error: any) {
        logger.error(error, 'Error resolving dispute:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
