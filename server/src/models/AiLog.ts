import mongoose, { Schema, Document } from 'mongoose';

export interface IAiLog extends Document {
    timestamp: Date;
    endpoint?: string;
    success: boolean;
    matchStatus?: string;
    cowId?: string;
    farmerId?: string;
    matchedCowId?: string;
    inferenceTimeMs: number;
    muzzleConfM?: number;
    muzzleConfF?: number;
    spoofProbM?: number;
    spoofProbF?: number;
    cowName?: string;
    faceSimilarityScore?: number;
    muzzleSimilarityScore?: number;
    spatialMuzzleSim?: number;
    spatialFaceSim?: number;
    muzzlePostLgScore?: number;
    lgMatches?: number;
    ensembleScore?: number;
    pignisticMatch?: number;
    dsBeliefMatch?: number;
    dsBeliefMismatch?: number;
    dsUncertainty?: number;
    reason?: string;
    bestWrongAnswerImageUrl?: string;
    muzzleImgUrl?: string;
    faceImgUrl?: string;
    muzzleCropUrl?: string;
    faceCropUrl?: string;
    matchedCowName?: string;
    tradMorphology?: {
        beadCount?: number;
        avgArea?: number;
        avgEccentricity?: number;
    };
    tradLbpDist?: number;
    tradHogDist?: number;
    tradInlierRatio?: number;
    tradAlignedSsim?: number;
    xgbScore?: number;
    fusionConfidence?: number;
    xgbMappedScore?: number;
    isAiOutcomeCorrect?: boolean;
    createdAt: Date;
}

const AiLogSchema = new Schema<IAiLog>({
    timestamp: { type: Date, required: true },
    endpoint: { type: String },
    success: { type: Boolean, required: true },
    matchStatus: { type: String },
    cowId: { type: String },
    farmerId: { type: String },
    matchedCowId: { type: String },
    inferenceTimeMs: { type: Number, required: true },
    muzzleConfM: { type: Number },
    muzzleConfF: { type: Number },
    spoofProbM: { type: Number },
    spoofProbF: { type: Number },
    cowName: { type: String },
    faceSimilarityScore: { type: Number },
    muzzleSimilarityScore: { type: Number },
    spatialMuzzleSim: { type: Number },
    spatialFaceSim: { type: Number },
    muzzlePostLgScore: { type: Number },
    lgMatches: { type: Number },
    ensembleScore: { type: Number },
    dsBeliefMatch: { type: Number },
    dsBeliefMismatch: { type: Number },
    dsUncertainty: { type: Number },
    reason: { type: String },
    bestWrongAnswerImageUrl: { type: String },
    muzzleImgUrl: { type: String },
    faceImgUrl: { type: String },
    muzzleCropUrl: { type: String },
    faceCropUrl: { type: String },
    matchedCowName: { type: String },
    tradMorphology: {
        beadCount: { type: Number },
        avgArea: { type: Number },
        avgEccentricity: { type: Number }
    },
    tradLbpDist: { type: Number },
    tradHogDist: { type: Number },
    tradInlierRatio: { type: Number },
    tradAlignedSsim: { type: Number },
    xgbScore: { type: Number },
    fusionConfidence: { type: Number },
    xgbMappedScore: { type: Number },
    isAiOutcomeCorrect: { type: Boolean }
}, { timestamps: true });

AiLogSchema.index({ timestamp: -1 });
AiLogSchema.index({ matchStatus: 1, endpoint: 1, timestamp: -1 }); // Compound index for analytics

export const AiLog = mongoose.model<IAiLog>('AiLog', AiLogSchema, 'mllogs');
