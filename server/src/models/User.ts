import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
    name: string;
    role: 'farmer' | 'collector' | 'admin';
    contact: {
        phone: string;
        email?: string;
    };
    auth: {
        password?: string;
        otpSession?: string;
    };
    location: {
        state: string;
        district: string;
        block: string;
        village: string;
        pincode: string;
    };
    organization?: string;
    aadharHash?: string;
    profilePicture?: string;
    cows: mongoose.Types.ObjectId[];
    lastLogoutAt?: Date;
    createdAt: Date;
}

const UserSchema = new Schema<IUser>({
    name: { type: String, required: true },
    role: {
        type: String,
        enum: ['farmer', 'collector', 'admin'],
        default: 'farmer'
    },
    contact: {
        phone: { type: String, required: true, unique: true, index: true },
        email: { type: String }
    },
    auth: {
        password: {
            type: String,
            select: false,
            required: function(this: any) {
                return this.role === 'farmer' || this.role === 'admin';
            }
        },
        otpSession: { type: String, select: false }
    },
    location: {
        state: { type: String, default: 'Odisha' },
        district: { type: String },
        block: { type: String },
        village: { type: String },
        pincode: { type: String }
    },
    organization: String,
    aadharHash: String,
    profilePicture: String,
    cows: [{ type: Schema.Types.ObjectId, ref: 'Cattle' }],
    lastLogoutAt: { type: Date }
}, { timestamps: true });

export const User = mongoose.model<IUser>('User', UserSchema);