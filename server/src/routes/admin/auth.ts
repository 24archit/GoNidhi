import express from 'express';
import { loginAdmin, registerAdmin } from '../../controllers/admin/auth';
import { requireAuth, authorizeRoles } from '../../middleware/auth';

const router = express.Router();

router.post('/login', loginAdmin);
router.post('/register', registerAdmin);
router.get('/verify', requireAuth, authorizeRoles('admin'), (req: any, res: any) => {
    res.status(200).json({ success: true, user: req.user });
});

export default router;
