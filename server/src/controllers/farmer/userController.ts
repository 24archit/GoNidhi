import { Response } from 'express';
import { User } from '../../models/User';
import logger from '../../utils/logger';

export const getUserProfile = async (req: any, res: Response) => {
    try {
        const userId = req.user?.id; // Assumes auth middleware populates req.user

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const user = await User.findById(userId).select('-auth.password -auth.otpSession');

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.status(200).json({ success: true, user });
    } catch (error) {
        logger.error(error, 'Fetch Profile Error:');
        res.status(500).json({ success: false, message: 'Server Error fetching profile' });
    }
};

export const updateUserProfile = async (req: any, res: Response) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { name, phone, village, state, district, block, pincode, profilePicture } = req.body;

        const updateData: any = {};
        if (name) updateData.name = name;
        
        if (phone) {
            // Check if another user already has this phone number
            const existingUser = await User.findOne({ 'contact.phone': phone, _id: { $ne: userId } }).select('_id').lean();
            if (existingUser) {
                return res.status(409).json({ success: false, message: 'This phone number is already registered to another account.' });
            }
            updateData['contact.phone'] = phone;
        }

        if (profilePicture !== undefined) updateData.profilePicture = profilePicture;

        // Location updates
        if (state || district || village || pincode || block) {
            updateData.location = {};
            if (state) updateData.location.state = state;
            if (district) updateData.location.district = district;
            if (block) updateData.location.block = block;
            if (village) updateData.location.village = village;
            if (pincode) updateData.location.pincode = pincode;
        }

        // Find and update the user
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: updateData },
            { new: true, runValidators: true }
        ).select('-auth.password -auth.otpSession');

        if (!updatedUser) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.status(200).json({ success: true, user: updatedUser });
    } catch (error) {
        logger.error(error, 'Update Profile Error:');
        res.status(500).json({ success: false, message: 'Server Error updating profile' });
    }
};

export const logoutUser = async (req: any, res: Response) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const user = await User.findByIdAndUpdate(
            userId,
            { lastLogoutAt: new Date() },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.status(200).json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        logger.error(error, 'Logout Error:');
        res.status(500).json({ success: false, message: 'Server Error during logout' });
    }
};
