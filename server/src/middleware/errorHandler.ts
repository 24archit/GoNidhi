import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error(`[Error] ${req.method} ${req.url} - ${err.message || err}`);

    // If headers are already sent, delegate to default Express error handler
    if (res.headersSent) {
        return next(err);
    }

    const statusCode = err.statusCode || 500;
    const message = err.message || 'Server Error';

    const safeMessage = statusCode === 500 ? 'Internal Server Error' : message;

    res.status(statusCode).json({
        success: false,
        message: safeMessage
    });
};
