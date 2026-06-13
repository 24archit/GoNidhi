import { Request, Response, NextFunction } from 'express';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    console.error(`[Error] ${req.method} ${req.url} - ${err.message || err}`);

    // If headers are already sent, delegate to default Express error handler
    if (res.headersSent) {
        return next(err);
    }

    const statusCode = err.statusCode || 500;
    const message = err.message || 'Server Error';

    res.status(statusCode).json({
        success: false,
        message: message
    });
};
