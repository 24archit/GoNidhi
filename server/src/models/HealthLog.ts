import mongoose, { Schema, Document } from 'mongoose';

export interface IHealthLog extends Document {
    cattleId: mongoose.Types.ObjectId;
    farmerId: mongoose.Types.ObjectId;
    type: 'Weight' | 'Vaccination' | 'Insemination' | 'Treatment';
    date: Date;
    data: {
        weight?: number;
        vaccineName?: string;
        batchNumber?: string;
        notes?: string;
        doctorName?: string;
    };
    nextDueDate?: Date;
}

const HealthLogSchema = new Schema<IHealthLog>({
    cattleId: { type: Schema.Types.ObjectId, ref: 'Cattle', required: true },
    farmerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
        type: String,
        enum: ['Weight', 'Vaccination', 'Insemination', 'Treatment'],
        required: true
    },
    date: { type: Date, default: Date.now },

    data: {
        weight: Number,
        vaccineName: String,
        batchNumber: String,
        notes: String,
        doctorName: String
    },

    nextDueDate: Date
}, { timestamps: true });

// Compound index to quickly fetch a cow's health history sorted chronologically
HealthLogSchema.index({ cattleId: 1, date: -1 });
// Foreign key index for the farmer
HealthLogSchema.index({ farmerId: 1 });

export const HealthLog = mongoose.model<IHealthLog>('HealthLog', HealthLogSchema);