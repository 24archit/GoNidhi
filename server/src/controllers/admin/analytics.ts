import { Request, Response } from 'express';
import { AiLog } from '../../models/AiLog';
import { Cattle } from '../../models/Cattel';
import { User } from '../../models/User';
import { Dispute } from '../../models/Dispute';
import { deleteFromCloudinary } from '../../services/cloudinaryService';
import mongoose from 'mongoose';
import logger from '../../utils/logger';

export const getSystemStats = async (req: Request, res: Response) => {
    try {
        const totalFarmers = await User.countDocuments({ role: 'farmer' });
        const totalCattle = await Cattle.countDocuments();
        const totalDisputes = await Dispute.countDocuments();
        const activeDisputes = await Dispute.countDocuments({ status: 'pending' });

        res.status(200).json({
            success: true,
            data: {
                totalFarmers,
                totalCattle,
                totalDisputes,
                activeDisputes
            }
        });
    } catch (error: any) {
        logger.error(error, 'Error fetching stats:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const getAiLogs = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 20;
        const skip = (page - 1) * limit;

        const statuses = req.query.statuses ? (req.query.statuses as string).split(',') : [];
        const types = req.query.types ? (req.query.types as string).split(',') : [];
        const year = req.query.year ? parseInt(req.query.year as string) : undefined;
        const cowId = req.query.cowId as string;

        const query: any = {};

        if (cowId) {
            query.cowId = cowId;
        }

        if (statuses.length > 0 && !statuses.includes('All')) {
            // Expand statuses to handle common casing to maintain fast exact-match index queries
            const expandedStatuses = statuses.flatMap(s => [s, s.toLowerCase(), s.toUpperCase(), s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()]);
            query.matchStatus = { $in: expandedStatuses };
        }

        if (types.length > 0) {
            // Expand types to handle variations (register/registration) without using slow Regex
            const expandedTypes = types.flatMap(t => {
                const lower = t.toLowerCase();
                if (lower.includes('regist')) return ['register', 'registration', 'REGISTER', 'REGISTRATION', 'Register', 'Registration'];
                if (lower.includes('search')) return ['search', 'SEARCH', 'Search'];
                return [t, t.toLowerCase(), t.toUpperCase()];
            });
            query.endpoint = { $in: expandedTypes };
        }

        if (year) {
            query.timestamp = { $ne: null }; // Prevents $expr crashes on missing timestamps
            query.$expr = {
                $and: [
                    { $eq: [{ $type: "$timestamp" }, "date"] },
                    { $eq: [{ $year: "$timestamp" }, year] }
                ]
            };
        }

        const logs = await AiLog.find(query)
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(limit)
            .lean();

        const total = await AiLog.countDocuments(query);

        // Calculate deep AI metrics
        const breakdown = await AiLog.aggregate([
            { $match: query },
            {
                $group: {
                    _id: { $ifNull: ['$matchStatus', 'UNKNOWN'] },
                    total: { $sum: 1 },
                    correct: { $sum: { $cond: [{ $eq: ['$isAiOutcomeCorrect', true] }, 1, 0] } },
                    incorrect: { $sum: { $cond: [{ $eq: ['$isAiOutcomeCorrect', false] }, 1, 0] } },
                    avgTime: { $avg: '$inferenceTimeMs' }
                }
            }
        ]);

        let totalInferences = 0;
        let totalCorrect = 0;
        let totalTimeSum = 0;

        const breakdownResult: any[] = [];
        breakdown.forEach(r => {
            totalInferences += r.total;
            totalCorrect += r.correct;
            totalTimeSum += (r.avgTime * r.total);
            
            let statusName = r._id;
            if (statusName === 'DUPLICATE' || statusName === 'DISPUTE') {
                statusName = 'DUPLICATE / DISPUTE';
            }

            const existing = breakdownResult.find(b => b.status === statusName);
            if (existing) {
                existing.total += r.total;
                existing.correct += r.correct;
                existing.incorrect += r.incorrect;
                existing.unmarked += (r.total - r.correct - r.incorrect);
            } else {
                breakdownResult.push({
                    status: statusName,
                    total: r.total,
                    correct: r.correct,
                    incorrect: r.incorrect,
                    unmarked: r.total - r.correct - r.incorrect
                });
            }
        });

        const avgTime = totalInferences > 0 ? totalTimeSum / totalInferences : 0;
        const successRate = totalInferences > 0 ? totalCorrect / totalInferences : 0;

        res.status(200).json({
            success: true,
            data: logs,
            metrics: { avgTime, successRate, totalInferences },
            breakdown: breakdownResult,
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page
        });
    } catch (error: any) {
        logger.error(error, 'Error fetching AI logs:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const getAiLogById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id as string)) {
            return res.status(400).json({ success: false, message: 'Invalid log ID' });
        }
        const log = await AiLog.findById(id);
        if (!log) {
            return res.status(404).json({ success: false, message: 'Log not found' });
        }
        res.status(200).json({ success: true, data: log });
    } catch (error: any) {
        logger.error(error, 'Error fetching AI log by ID:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const updateAiLog = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { isAiOutcomeCorrect } = req.body;

        const updatedLog = await AiLog.findByIdAndUpdate(
            id,
            { $set: { isAiOutcomeCorrect } },
            { new: true }
        );

        if (!updatedLog) {
            return res.status(404).json({ success: false, message: 'Log not found' });
        }

        res.status(200).json({ success: true, message: 'Log updated successfully', data: updatedLog });
    } catch (error: any) {
        logger.error(error, 'Error updating AI log:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const deleteAiLog = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const deletedLog = await AiLog.findByIdAndDelete(id);

        if (!deletedLog) {
            return res.status(404).json({ success: false, message: 'Log not found' });
        }

        if (deletedLog.muzzleCropUrl) {
            deleteFromCloudinary(deletedLog.muzzleCropUrl).catch(err => logger.error(err));
        }
        if (deletedLog.faceCropUrl) {
            deleteFromCloudinary(deletedLog.faceCropUrl).catch(err => logger.error(err));
        }
        if (deletedLog.muzzleImgUrl) {
            deleteFromCloudinary(deletedLog.muzzleImgUrl).catch(err => logger.error(err));
        }
        if (deletedLog.faceImgUrl) {
            deleteFromCloudinary(deletedLog.faceImgUrl).catch(err => logger.error(err));
        }

        res.status(200).json({ success: true, message: 'Log deleted successfully' });
    } catch (error: any) {
        logger.error(error, 'Error deleting AI log:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const exportAiLogs = async (req: Request, res: Response) => {
    try {
        const statuses = req.query.statuses ? (req.query.statuses as string).split(',') : [];
        const types = req.query.types ? (req.query.types as string).split(',') : [];
        const year = req.query.year ? parseInt(req.query.year as string) : undefined;

        const query: any = {};

        if (statuses.length > 0 && !statuses.includes('All')) {
            query.matchStatus = { $in: statuses };
        }

        if (types.length > 0) {
            query.endpoint = { $in: types };
        }

        if (year) {
            query.timestamp = { $ne: null };
            query.$expr = {
                $and: [
                    { $eq: [{ $type: "$timestamp" }, "date"] },
                    { $eq: [{ $year: "$timestamp" }, year] }
                ]
            };
        }

        const logs = await AiLog.find(query).sort({ timestamp: -1 }).setOptions({ allowDiskUse: true }).lean();

        if (logs.length === 0) {
            return res.status(404).send('No logs found for the applied filters.');
        }

        const flattenObject = (obj: any, prefix = ''): Record<string, any> => {
            return Object.keys(obj).reduce((acc: any, k: string) => {
                const pre = prefix.length ? prefix + '_' : '';
                if (typeof obj[k] === 'object' && obj[k] !== null && !(obj[k] instanceof Date) && k !== '_id') {
                    Object.assign(acc, flattenObject(obj[k], pre + k));
                } else {
                    acc[pre + k] = obj[k];
                }
                return acc;
            }, {});
        };

        const flatLogs = logs.map(log => flattenObject(log));
        const headerSet = new Set<string>();
        flatLogs.forEach(log => Object.keys(log).forEach(key => { if (key !== '__v') headerSet.add(key) }));
        const headers = Array.from(headerSet);

        let csv = headers.join(',') + '\n';
        flatLogs.forEach(log => {
            const row = headers.map(header => {
                let val = log[header];
                if (val === undefined || val === null) val = '';
                if (val instanceof Date) val = val.toISOString();
                let strVal = String(val);
                if (strVal.includes(',') || strVal.includes('"') || strVal.includes('\n')) {
                    strVal = `"${strVal.replace(/"/g, '""')}"`;
                }
                return strVal;
            });
            csv += row.join(',') + '\n';
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=ai_insights_export.csv');
        return res.status(200).send(csv);

    } catch (error: any) {
        logger.error(error, 'Error exporting AI logs:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
