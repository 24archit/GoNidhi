import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error(`[Error] ${req.method} ${req.url} - ${err.message || err}`);

    // If headers are already sent, delegate to default Express error handler
    if (res.headersSent) {
        return next(err);
    }

    let statusCode = err.statusCode || 500;
    let safeMessage = err.message || 'An unexpected error occurred. Please try again later.';

    // 1. Handle Zod Validation Errors
    if (err.name === 'ZodError') {
        statusCode = 400;
        const missingFields = err.errors?.map((e: any) => e.path.join('.')).join(', ') || 'fields';
        safeMessage = `Some information is missing or incorrect (${missingFields}). Please review the form and try again.`;
    } 
    // 2. Handle Mongoose Validation Errors
    else if (err.name === 'ValidationError') {
        statusCode = 400;
        const fields = Object.keys(err.errors || {}).join(', ');
        safeMessage = `The information provided is invalid. Please check the following fields: ${fields}.`;
    } 
    // 3. Handle Mongoose Cast Errors (Invalid ID or data type)
    else if (err.name === 'CastError') {
        statusCode = 400;
        safeMessage = `Invalid data format provided for ${err.path}. Please correct it.`;
    } 
    // 4. Handle Mongoose Duplicate Key Error (e.g. unique email/phone)
    else if (err.code === 11000) {
        statusCode = 400;
        const field = Object.keys(err.keyValue || {})[0];
        safeMessage = `This ${field} is already registered. Please use a different one or login.`;
    }
    // 5. General fallback for 500
    else if (statusCode === 500) {
        safeMessage = 'Our servers are experiencing technical difficulties. Please try again in a few minutes.';
    }

    res.status(statusCode).json({
        success: false,
        message: safeMessage
    });
};
