import express from 'express';
import { registerFarmer, loginFarmer } from '../../controllers/farmer/auth';
import { requireAuth, authorizeRoles } from '../../middleware/auth';

const router = express.Router();

router.post('/register', registerFarmer);
router.post('/login', loginFarmer);
router.get('/verify', requireAuth, authorizeRoles('farmer'), (req: any, res: any) => {
    res.status(200).json({ success: true, user: req.user });
});

export default router;
