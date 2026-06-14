import { Request, Response, NextFunction } from 'express';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'fallback_webhook_secret_for_dev_4321';

export const verifyWebhookSignature = (req: Request, res: Response, next: NextFunction) => {
    const signature = req.headers['x-webhook-secret'];
    
    if (!signature || signature !== WEBHOOK_SECRET) {
        return res.status(401).json({ success: false, message: 'Invalid or missing webhook signature' });
    }
    
    next();
};
