import { Request, Response } from 'express';
import { User } from '../../models/User';
import jwt from 'jsonwebtoken';
import logger from '../../utils/logger';

// Fallback secret for local dev environments only
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev_gau_netra4321';

export const registerFarmer = async (req: any, res: any) => {
    try {
        const { name, phone, village, state, district, pincode } = req.body;

        // Basic validation
        if (!name || !phone) {
            return res.status(400).json({ success: false, message: 'Name and phone are required' });
        }

        // Check duplicate users
        const existingUser = await User.findOne({ 'contact.phone': phone });

        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Phone number already registered. Please login instead.' });
        }

        // Register new farmer
        const user = new User({
            name,
            role: 'farmer',
            contact: { phone },
            location: { state, district, village, pincode }
        });
        await user.save();

        // Sign JWT Token
        const token = jwt.sign(
            { id: user._id, role: user.role, name: user.name },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.status(200).json({
            success: true,
            token,
            user: {
                id: user._id,
                name: user.name,
                role: user.role,
                phone: user.contact.phone
            }
        });

    } catch (error: any) {
        logger.error('Registration Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const loginFarmer = async (req: any, res: any) => {
    try {
        const { phone } = req.body;

        if (!phone) {
            return res.status(400).json({ success: false, message: 'Phone number is required' });
        }

        const user = await User.findOne({ 'contact.phone': phone });

        if (!user) {
            return res.status(404).json({ success: false, message: 'No farmer found with this number. Please register.' });
        }

        // Sign JWT Token
        const token = jwt.sign(
            { id: user._id, role: user.role, name: user.name },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.status(200).json({
            success: true,
            token,
            user: {
                id: user._id,
                name: user.name,
                role: user.role,
                phone: user.contact.phone
            }
        });

    } catch (error: any) {
        logger.error('Login Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
