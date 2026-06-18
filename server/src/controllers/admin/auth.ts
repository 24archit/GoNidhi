import { Request, Response } from 'express';
import { User } from '../../models/User';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import logger from '../../utils/logger';
import { adminRegisterBackendSchema, loginSchema } from '../../schemas/auth';

const JWT_SECRET = process.env.JWT_SECRET;

export const loginAdmin = async (req: Request, res: Response) => {
    try {
        const parseResult = loginSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ success: false, message: parseResult.error.issues[0].message });
        }
        const { phone, password } = parseResult.data;

        const user = await User.findOne({ 'contact.phone': phone, role: 'admin' }).select('+auth.password');

        if (!user || !user.auth?.password) {
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

        const passwordMatches = await bcrypt.compare(password || '', user.auth.password);
        if (!passwordMatches) {
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

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
        logger.error(error, 'Admin Login Error:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const registerAdmin = async (req: Request, res: Response) => {
    try {
        const parseResult = adminRegisterBackendSchema.safeParse(req.body);
        if (!parseResult.success) {
            return res.status(400).json({ success: false, message: parseResult.error.issues[0].message });
        }
        const { name, phone, password, district } = parseResult.data;

        const existingUser = await User.findOne({ 'contact.phone': phone });
        if (existingUser) {
            return res.status(409).json({ success: false, message: 'User already exists with this phone number.' });
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        const user = new User({
            name,
            role: 'admin',
            contact: { phone },
            location: { state: 'Odisha', district, village: 'Admin Center' }, // Defaults for admin
            auth: { password: hashedPassword } // Store hashed password
        });

        await user.save();

        const token = jwt.sign(
            { id: user._id, role: user.role, name: user.name },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.status(201).json({
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
        logger.error(error, 'Admin Register Error:');
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

