import { Request, Response } from 'express';
import { User } from '../../models/User';
import { Cattle } from '../../models/Cattel';
import { cleanupCowCloudResources } from '../../services/cattleService';
import mongoose from 'mongoose';
import logger from '../../utils/logger';

export const getFarmers = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const search = req.query.search as string;

        let query: any = { role: 'farmer' };
        if (search) {
            query = {
                ...query,
                $or: [
                    { name: { $regex: search, $options: 'i' } },
                    { 'contact.phone': { $regex: search, $options: 'i' } }
                ]
            };
        }

        const skip = (page - 1) * limit;

        const farmers = await User.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await User.countDocuments(query);

        res.status(200).json({
            success: true,
            data: farmers,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page
        });
    } catch (error: any) {
        logger.error(error, 'Error fetching farmers:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const getFarmerDetails = async (req: Request, res: Response) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id as string)) {
            return res.status(404).json({ success: false, message: 'Farmer not found' });
        }
        const farmer = await User.findOne({ _id: req.params.id, role: 'farmer' }).lean();
        if (!farmer) {
            return res.status(404).json({ success: false, message: 'Farmer not found' });
        }

        const stats = await Cattle.aggregate([
            { $match: { farmerId: farmer._id } },
            { $group: {
                _id: null,
                totalCattle: { $sum: 1 },
                successAI: { $sum: { $cond: [{ $eq: ['$aiMetadata.status', 'SUCCESS'] }, 1, 0] } },
                disputes: { $sum: { $cond: ['$isDispute', 1, 0] } }
            }}
        ]);
        
        const statData = stats[0] || { totalCattle: 0, successAI: 0, disputes: 0 };
        const data = { ...farmer, stats: statData };

        res.status(200).json({ success: true, data });
    } catch (error: any) {
        logger.error(error, 'Error fetching farmer details:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const getFarmerCattle = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 10;
        const skip = (page - 1) * limit;

        if (!mongoose.Types.ObjectId.isValid(req.params.id as string)) {
            return res.status(404).json({ success: false, message: 'Farmer not found' });
        }
        const cattle = await Cattle.find({ farmerId: req.params.id })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const total = await Cattle.countDocuments({ farmerId: req.params.id });

        res.status(200).json({
            success: true,
            data: cattle,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page
        });
    } catch (error: any) {
        logger.error(error, 'Error fetching farmer cattle:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const deleteFarmer = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(404).json({ success: false, message: 'Farmer not found' });
        }
        const session = await mongoose.startSession();
        let deletedFarmer: any = null;
        let farmersCattle: any[] = [];
        
        await session.withTransaction(async () => {
            deletedFarmer = await User.findOneAndDelete({ _id: id, role: 'farmer' }, { session });
            if (deletedFarmer) {
                farmersCattle = await Cattle.find({ farmerId: id }).session(session);
                await Cattle.deleteMany({ farmerId: id }, { session });
            }
        });
        session.endSession();

        if (!deletedFarmer) {
            return res.status(404).json({ success: false, message: 'Farmer not found' });
        }

        // Background cleanup of cloud resources for all deleted cows
        try {
            for (const cow of farmersCattle) {
                await cleanupCowCloudResources(cow);
            }
        } catch (cleanupErr) {
            logger.error(cleanupErr, 'Error during cloud cleanup in deleteFarmer:');
        }

        res.status(200).json({ success: true, message: 'Farmer deleted successfully' });
    } catch (error: any) {
        logger.error(error, 'Error deleting farmer:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const updateFarmer = async (req: Request, res: Response) => {
    try {
        const id = req.params.id as string;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(404).json({ success: false, message: 'Farmer not found' });
        }
        const updateData = req.body;
        
        // Ensure role cannot be changed
        delete updateData.role;
        delete updateData.auth;
        delete updateData.cows;
        
        const updatedFarmer = await User.findOneAndUpdate(
            { _id: id, role: 'farmer' },
            { $set: updateData },
            { new: true, runValidators: true }
        ).lean();

        if (!updatedFarmer) {
            return res.status(404).json({ success: false, message: 'Farmer not found' });
        }

        // We need to fetch stats again to return the full profile data shape
        const stats = await Cattle.aggregate([
            { $match: { farmerId: updatedFarmer._id } },
            { $group: {
                _id: null,
                totalCattle: { $sum: 1 },
                successAI: { $sum: { $cond: [{ $eq: ['$aiMetadata.status', 'SUCCESS'] }, 1, 0] } },
                disputes: { $sum: { $cond: ['$isDispute', 1, 0] } }
            }}
        ]);
        
        const statData = stats[0] || { totalCattle: 0, successAI: 0, disputes: 0 };
        const data = { ...updatedFarmer, stats: statData };

        res.status(200).json({ success: true, data, message: 'Farmer updated successfully' });
    } catch (error: any) {
        logger.error(error, 'Error updating farmer:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
