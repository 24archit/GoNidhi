import express from 'express';
import multer from 'multer';
import { getAllCattle, proxyRegisterCow, deleteCattle, getCattleDetails, updateCattle, proxySearchCow, getPendingCattle } from '../../controllers/admin/cattle';
import { requireAuth, authorizeRoles } from '../../middleware/auth';
import { verifyWebhookSignature } from '../../middleware/webhookAuth';
import { handleDlApiWebhook } from '../../controllers/farmer/cattle';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Webhook for DL-API
router.post('/webhook/dl-api-complete', verifyWebhookSignature, handleDlApiWebhook);

router.use(requireAuth, authorizeRoles('admin'));

router.get('/', getAllCattle);
router.get('/pending', getPendingCattle);
router.get('/:id', getCattleDetails);
router.put('/:id', updateCattle);
router.delete('/:id', deleteCattle);

router.post('/proxy-register', upload.fields([
    { name: 'faceImage', maxCount: 1 },
    { name: 'muzzleImage', maxCount: 1 },
    { name: 'leftImage', maxCount: 1 },
    { name: 'rightImage', maxCount: 1 },
    { name: 'backImage', maxCount: 1 },
    { name: 'tailImage', maxCount: 1 },
    { name: 'selfieImage', maxCount: 1 }
]), proxyRegisterCow);

router.post('/proxy-search', upload.fields([
    { name: 'faceImage', maxCount: 1 },
    { name: 'muzzleImage', maxCount: 1 }
]), proxySearchCow);

export default router;
