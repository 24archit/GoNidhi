import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
const JWT_SECRET = process.env.JWT_SECRET;

export const requireAuth = (req: any, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
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
