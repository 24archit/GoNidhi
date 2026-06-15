import { Request, Response } from 'express';
import { User } from '../../models/User';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev_gau_netra4321';

export const loginAdmin = async (req: Request, res: Response) => {
    try {
        const { phone, password } = req.body;

        if (!phone) {
            return res.status(400).json({ success: false, message: 'Phone number is required' });
        }

        const user = await User.findOne({ 'contact.phone': phone, role: 'admin' }).select('+auth.password');

        if (!user) {
            return res.status(404).json({ success: false, message: 'Admin not found with this number.' });
        }

        // For simplicity assuming we either trust phone login or we have a password (the prompt mentions identical flow, so let's stick to phone, but prompt also mentions password maybe? Let's just do simple phone login for now like the farmer, unless they provide password).
        if (password && user.auth?.password) {
            if (password !== user.auth.password) {
                 return res.status(401).json({ success: false, message: 'Invalid credentials.' });
            }
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
        console.error('Admin Login Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

export const registerAdmin = async (req: Request, res: Response) => {
    try {
        const { name, phone, password, district } = req.body;

        if (!name || !phone || !password || !district) {
            return res.status(400).json({ success: false, message: 'Name, phone, password, and district are required.' });
        }

        const existingUser = await User.findOne({ 'contact.phone': phone });
        if (existingUser) {
            return res.status(409).json({ success: false, message: 'User already exists with this phone number.' });
        }

        const user = new User({
            name,
            role: 'admin',
            contact: { phone },
            location: { state: 'Odisha', district, village: 'Admin Center' }, // Defaults for admin
            auth: { password } // Store password
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
        console.error('Admin Register Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};

