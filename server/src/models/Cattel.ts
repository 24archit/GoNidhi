import mongoose, { Schema, Document } from 'mongoose';

export interface ICattle extends Document {
    farmerId: mongoose.Types.ObjectId; // Owner

    // Identity
    tagNumber: string;
    name: string;
    species: 'Cow' | 'Buffalo';
    breed: string;
    sex: 'Male' | 'Female' | 'Freemartin';
    dob: Date;
    ageMonths?: number;

    // Lineage & Source
    sireTag?: string;
    damTag?: string;
    source: 'Home Born' | 'Purchase';
    purchaseDetails?: {
        date?: Date;
        price?: number;
    };

    // Media & AI
    location?: {
        lat: number;
        lng: number;
    };
    photos: {
        faceProfile: string;
        muzzle: string;
        leftProfile: string;
        rightProfile: string;
        backView: string;
        tailView: string;
        selfie?: string;
    };
    aiMetadata: {
        isRegistered: boolean;
        status?: string;
        confidenceScore?: number;
        lastScannedAt?: Date;
    };
    superpointCache?: any;

    // Health Status
    currentStatus: 'Milking' | 'Dry' | 'Pregnant' | 'Heifer' | 'Calf';
    lastWeight?: number;
    isSick: boolean;
    isDispute: boolean;
    healthStats?: {
        birthWeight?: number;
        motherWeightAtCalving?: number;
        growthStatus?: string;
        healthStatus?: string;
        bodyConditionScore?: number;
    };
}

const CattleSchema = new Schema<ICattle>({
    farmerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    tagNumber: { type: String, unique: true, sparse: true },
    name: { type: String },
    species: { type: String, enum: ['Cow', 'Buffalo'] },
    breed: { type: String },
    sex: { type: String, enum: ['Male', 'Female', 'Freemartin'] },
    dob: { type: Date },
    ageMonths: { type: Number },

    sireTag: { type: String, default: null },
    damTag: { type: String, default: null },
    source: { type: String, enum: ['Home Born', 'Purchase'] },
    purchaseDetails: {
        date: { type: Date },
        price: { type: Number }
    },
    location: {
        lat: { type: Number },
        lng: { type: Number }
    },

    photos: {
        faceProfile: { type: String, required: true },
        muzzle: { type: String, required: true },
        leftProfile: { type: String },
        rightProfile: { type: String },
        backView: { type: String },
        tailView: { type: String },
        selfie: { type: String }
    },

    aiMetadata: {
        isRegistered: { type: Boolean, default: false },
        status: String,
        confidenceScore: Number,
        lastScannedAt: Date
    },
    superpointCache: { type: Schema.Types.Mixed },

    currentStatus: {
        type: String,
        enum: ['Milking', 'Dry', 'Pregnant', 'Heifer', 'Calf'],
        default: 'Calf'
    },
    lastWeight: Number,
    isSick: { type: Boolean, default: false },
    isDispute: { type: Boolean, default: false },
    healthStats: {
        birthWeight: Number,
        motherWeightAtCalving: Number,
        growthStatus: String,
        healthStatus: String,
        bodyConditionScore: Number
    }
}, { timestamps: true });

// Explicit unique index on tagNumber is defined in the schema field

// Compound index for quick farmer searches
CattleSchema.index({ farmerId: 1, tagNumber: 1 });

// Text index for optimized searching (replaces slow $regex)
CattleSchema.index({ name: 'text', tagNumber: 'text' });

export const Cattle = mongoose.model<ICattle>('Cattle', CattleSchema);