import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
const JWT_SECRET = process.env.JWT_SECRET;

export const requireAuth = async (req: any, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        
        // Verify user still exists in the database
        const userExists = await User.findById(decoded.id).select('_id lastLogoutAt').lean();
        if (!userExists) {
            return res.status(401).json({ success: false, message: 'User account no longer exists. Please log in again.' });
        }

        // Enforce token invalidation on logout
        if (userExists.lastLogoutAt && decoded.iat) {
            // decoded.iat is in seconds, lastLogoutAt is in milliseconds
            const logoutTime = Math.floor(userExists.lastLogoutAt.getTime() / 1000);
            if (decoded.iat < logoutTime) {
                return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
            }
        }

        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
};

export const authorizeRoles = (...allowedRoles: string[]) => {
    return (req: any, res: Response, next: NextFunction) => {
        if (!req.user || !req.user.role) {
            return res.status(403).json({ success: false, message: 'Role not defined or user not authenticated' });
        }
        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied: insufficient permissions' });
        }
        next();
    };
};
