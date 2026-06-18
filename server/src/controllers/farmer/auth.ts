import { Request, Response } from 'express';
import { User } from '../../models/User';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import logger from '../../utils/logger';
import { farmerRegisterBackendSchema, loginSchema } from '../../schemas/auth';

// Fallback secret for local dev environments only
const JWT_SECRET = process.env.JWT_SECRET;

export const registerFarmer = async (req: any, res: any) => {
    try {
        const parseResult = farmerRegisterBackendSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ success: false, message: parseResult.error.issues[0].message });
        }
        const { name, phone, village, state, district, block, pincode, password } = parseResult.data;

        // Check duplicate users
        const existingUser = await User.findOne({ 'contact.phone': phone });

        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Phone number already registered. Please login instead.' });
        }

        // Register new farmer
        const hashedPassword = await bcrypt.hash(password, 12);
        const user = new User({
            name,
            role: 'farmer',
            contact: { phone },
            location: { state, district, block, village, pincode },
            auth: { password: hashedPassword }
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
        logger.error(error, 'Registration Error:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const loginFarmer = async (req: any, res: any) => {
    try {
        const parseResult = loginSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ success: false, message: parseResult.error.issues[0].message });
        }
        const { phone, password } = parseResult.data;

        const user = await User.findOne({ 'contact.phone': phone, role: 'farmer' }).select('+auth.password');

        if (!user || !user.auth?.password) {
            return res.status(404).json({ success: false, message: 'Invalid credentials or farmer not found.' });
        }

        const passwordMatches = await bcrypt.compare(password, user.auth.password);
        if (!passwordMatches) {
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
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
        logger.error(error, 'Login Error:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};
