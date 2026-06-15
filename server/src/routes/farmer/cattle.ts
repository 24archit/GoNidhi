import express from 'express';
import multer from 'multer';
import { registerCow, getMyCattle, getCowProfile, searchCow, handleDlApiWebhook, deleteCow } from '../../controllers/farmer/cattle';
import { requireAuth } from '../../middleware/auth';

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

// Webhook for DL-API (should use an API key in production, skipped for brevity but easily added)
router.post('/webhook/dl-api-complete', handleDlApiWebhook);

// Apply auth middleware to all routes in this file
router.use(requireAuth);

router.post('/search', upload.fields([
    { name: 'faceImage', maxCount: 1 },
    { name: 'muzzleImage', maxCount: 1 }
]), searchCow);

router.post('/', upload.fields([
    { name: 'faceImage', maxCount: 1 },
    { name: 'muzzleImage', maxCount: 1 },
    { name: 'leftImage', maxCount: 1 },
    { name: 'rightImage', maxCount: 1 },
    { name: 'backImage', maxCount: 1 },
    { name: 'tailImage', maxCount: 1 },
    { name: 'selfieImage', maxCount: 1 }
]), registerCow);

router.get('/', getMyCattle);
router.get('/:id', getCowProfile);
router.delete('/:id', deleteCow);

export default router;
