import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    Container, Paper, Typography, Box, Stepper, Step, StepButton,
    Button, TextField, MenuItem, Stack, IconButton, Divider, InputAdornment,
    SwipeableDrawer, List, ListItem, ListItemButton,
    ListItemIcon, ListItemText, Alert, AlertTitle, Dialog, DialogTitle, DialogContent, DialogActions
} from '@mui/material';
import {
    CameraAlt, ArrowForward, CheckCircle,
    QrCodeScanner, Edit, ErrorOutline,
    PhotoLibrary
} from '@mui/icons-material';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import { useNavigate, useLocation } from 'react-router-dom';
import { syncManager } from '../utils/syncManager';
import { registerCowAPI, getCowProfileAPI, deleteCowAPI } from '../apis/apis';
import { useQueryClient } from '@tanstack/react-query';
import { App as CapacitorApp } from '@capacitor/app';
import { Geolocation } from '@capacitor/geolocation';
import { HTML5CameraDialog } from '../components/HTML5CameraDialog';
import type { CameraGuidanceType } from '../components/HTML5CameraDialog';
import { base64ToFile, compressImage } from '../utils/imageUtils';
import { ALLOW_GALLERY_UPLOAD } from '../config';
import { useProcessing } from '../contexts/ProcessingContext';
// STEPS MAPPED TO YOUR WORKFLOW
const steps = ['Basic Info', 'Lineage & Origin', 'Visual ID', 'Farmer KYC', 'Health & Stats', 'Review'];

interface CowFormData {
    tagNo: string;
    name: string;
    species: string;
    breed: string;
    sex: string;
    dob: string;
    ageMonths: string;
    source: string;
    purchaseDate: string;
    purchasePrice: string;
    sireTag: string;
    damTag: string;
    birthWeight: string;
    motherWeightAtCalving: string;
    bodyConditionScore: string;
    currentWeight: string;
    growthStatus: string;
    healthStatus: string;
    productionStatus: string;
    // Photos
    faceImage: string;
    muzzleImage: string;
    leftImage: string;
    rightImage: string;
    backImage: string;
    tailImage: string;
    selfieImage: string;
    retryCount?: number;
    id?: string;
}

interface StepProps {
    formData: CowFormData;
    handleChange: (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => void;
    handlePhotoCapture?: (field: keyof CowFormData, img: string) => void;
}

interface StepReviewProps {
    formData: CowFormData;
    setActiveStep: (step: number) => void;
}

// --- STEP 1: BASIC INFORMATION ---
const StepBasic: React.FC<StepProps> = ({ formData, handleChange }) => (
    <Stack spacing={3}>
        <Typography variant="subtitle2" color="primary" fontWeight="bold">IDENTIFICATION</Typography>

        <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
                fullWidth label="Tag No (Animal No)"
                placeholder="Scan Ear Tag"
                value={formData.tagNo} onChange={handleChange('tagNo')}
                InputProps={{
                    endAdornment: (
                        <InputAdornment position="end">
                            <IconButton color="primary"><QrCodeScanner /></IconButton>
                        </InputAdornment>
                    )
                }}
            />
        </Box>

        <TextField fullWidth label="Given Name" value={formData.name} onChange={handleChange('name')} />

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField select fullWidth label="Species" value={formData.species} onChange={handleChange('species')}>
                <MenuItem value="Cow">Cow</MenuItem>
                <MenuItem value="Buffalo">Buffalo</MenuItem>
            </TextField>
            <TextField select fullWidth label="Sex" value={formData.sex} onChange={handleChange('sex')}>
                <MenuItem value="Female">Female</MenuItem>
                <MenuItem value="Male">Male</MenuItem>
                <MenuItem value="Freemartin">Freemartin</MenuItem>
            </TextField>
        </Box>

        <TextField select fullWidth label="Breed" value={formData.breed} onChange={handleChange('breed')}>
            <MenuItem value="Gir">Gir</MenuItem>
            <MenuItem value="Sahiwal">Sahiwal</MenuItem>
            <MenuItem value="Jersey">Jersey</MenuItem>
            <MenuItem value="HF">Holstein Friesian</MenuItem>
            <MenuItem value="Desi">Non-Descript (Desi)</MenuItem>
        </TextField>

        <Typography variant="subtitle2" color="primary" fontWeight="bold" sx={{ mt: 1 }}>AGE DETAILS</Typography>

        <TextField
            fullWidth type="date" label="Date of Birth"
            InputLabelProps={{ shrink: true }}
            value={formData.dob} onChange={handleChange('dob')}
        />

        <TextField
            fullWidth disabled label="Approx Age (Months)"
            value={formData.ageMonths}
            helperText="Auto-calculated from DOB"
        />
    </Stack>
);

// --- STEP 2: LINEAGE & ORIGIN ---
const StepOrigin: React.FC<StepProps> = ({ formData, handleChange }) => (
    <Stack spacing={3}>
        <Typography variant="subtitle2" color="primary" fontWeight="bold">ORIGIN SOURCE</Typography>

        <TextField select fullWidth label="Purchase / Home Born" value={formData.source} onChange={handleChange('source')}>
            <MenuItem value="Home Born">Home Born</MenuItem>
            <MenuItem value="Purchase">Purchased</MenuItem>
        </TextField>

        {formData.source === 'Purchase' && (
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <TextField type="date" label="Purchase Date" InputLabelProps={{ shrink: true }} />
                <TextField type="number" label="Price (₹)" />
            </Box>
        )}

        <Divider sx={{ my: 1 }} />
        <Typography variant="subtitle2" color="primary" fontWeight="bold">PARENTAGE (LIFETIME DETAILS)</Typography>

        <TextField fullWidth label="Sire No (Father Pasu Aadhar)" value={formData.sireTag} onChange={handleChange('sireTag')} />
        <TextField fullWidth label="Dam No (Mother Pasu Aadhar)" value={formData.damTag} onChange={handleChange('damTag')} />

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField type="number" label="Birth Weight (kg)" value={formData.birthWeight} onChange={handleChange('birthWeight')} />
            <TextField type="number" label="Mother Wt after Calving" value={formData.motherWeightAtCalving} onChange={handleChange('motherWeightAtCalving')} />
        </Box>
    </Stack>
);

// --- STEP 3: VISUAL ID (CAMERA) ---

interface SmartPhotoBoxProps {
    label: string;
    currentImage?: string;
    required?: boolean;
    guidanceType: CameraGuidanceType;
    onCapture: (img: string) => void;
}

const SmartPhotoBox: React.FC<SmartPhotoBoxProps> = ({ label, currentImage, required = false, guidanceType, onCapture }) => {
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [cameraOpen, setCameraOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleBoxClick = () => {
        if (!ALLOW_GALLERY_UPLOAD) {
            handleTakePicture();
            return;
        }
        setDrawerOpen(true);
    };

    const handleTakePicture = () => {
        setDrawerOpen(false);
        // Small delay so the drawer closes smoothly before opening fullscreen camera
        setTimeout(() => setCameraOpen(true), 200);
    };

    const handleGallery = () => {
        setDrawerOpen(false);
        setTimeout(() => fileInputRef.current?.click(), 200);
    };
    const processAndCapture = async (dataUrl: string) => {
        try {
            // Treat Face and Muzzle as high-priority biometrics
            const isBiometric = guidanceType === 'muzzle' || guidanceType === 'face';

            // Biometrics: 1280px max, 95% quality (high fidelity)
            // General Photos (Tail, Side, Farmer Selfie): 800px max, 80% quality (high compression)
            const targetSize = isBiometric ? 1280 : 800;
            const targetQuality = isBiometric ? 0.95 : 0.80;

            const compressedImage = await compressImage(dataUrl, targetSize, targetSize, targetQuality);
            onCapture(compressedImage);
            if (compressedImage !== dataUrl && dataUrl.startsWith('blob:')) {
                URL.revokeObjectURL(dataUrl);
            }
        } catch (err) {
            console.error('Image compression failed', err);
            // Fallback to original image if compression fails for some reason
            onCapture(dataUrl);
        }
    };
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async (event) => {
                const result = event.target?.result;
                if (typeof result === 'string') {
                    processAndCapture(result);
                }
            };
            reader.readAsDataURL(file);
        }
        // Reset input so the same file can be re-selected
        e.target.value = '';
    };

    return (
        <>
            {/* Hidden file input for gallery */}
            <input
                type="file"
                accept="image/*"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileChange}
            />

            {/* HTML5 Camera Dialog */}
            <HTML5CameraDialog
                open={cameraOpen}
                onClose={() => setCameraOpen(false)}
                onCapture={(img) => {
                    processAndCapture(img);
                    setCameraOpen(false);
                }}
                guidanceType={guidanceType}
            />

            {/* Source Picker Drawer */}
            <SwipeableDrawer
                anchor="bottom"
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                onOpen={() => setDrawerOpen(true)}
                PaperProps={{
                    sx: {
                        borderTopLeftRadius: 20,
                        borderTopRightRadius: 20,
                        pb: 3
                    }
                }}
            >
                {/* Drawer handle bar */}
                <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1.5, pb: 1 }}>
                    <Box sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'grey.300' }} />
                </Box>
                <Typography variant="subtitle1" fontWeight={700} sx={{ px: 3, pb: 1 }}>
                    {label}
                </Typography>
                <List disablePadding>
                    <ListItem disablePadding>
                        <ListItemButton onClick={handleTakePicture} sx={{ py: 1.5, px: 3 }}>
                            <ListItemIcon sx={{ minWidth: 44 }}>
                                <CameraAlt color="primary" />
                            </ListItemIcon>
                            <ListItemText
                                primary="Take Picture"
                                secondary="Use the camera to capture a live photo"
                                primaryTypographyProps={{ fontWeight: 600 }}
                            />
                        </ListItemButton>
                    </ListItem>
                    {ALLOW_GALLERY_UPLOAD && (
                        <>
                            <Divider variant="inset" component="li" />
                            <ListItem disablePadding>
                                <ListItemButton onClick={handleGallery} sx={{ py: 1.5, px: 3 }}>
                                    <ListItemIcon sx={{ minWidth: 44 }}>
                                        <PhotoLibrary color="action" />
                                    </ListItemIcon>
                                    <ListItemText
                                        primary="From Gallery"
                                        secondary="Choose an existing photo from your device"
                                        primaryTypographyProps={{ fontWeight: 600 }}
                                    />
                                </ListItemButton>
                            </ListItem>
                        </>
                    )}
                </List>
            </SwipeableDrawer>

            {/* Photo Placeholder Card */}
            <Paper
                elevation={0}
                onClick={handleBoxClick}
                sx={{
                    bgcolor: '#F3F4F6', border: '2px dashed #CBD5E1', borderRadius: 1,
                    p: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    height: required ? 160 : 110, cursor: 'pointer', position: 'relative', overflow: 'hidden',
                    transition: '0.2s', '&:active': { transform: 'scale(0.98)' }
                }}
            >
                {currentImage ? (
                    <>
                        <img src={currentImage} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <Box sx={{
                            position: 'absolute', top: 0, left: 0, right: 0,
                            bgcolor: 'rgba(0,0,0,0.5)', color: 'white',
                            py: 0.5, px: 1, display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}>
                            <Typography variant="caption" fontWeight="bold" noWrap>{label}</Typography>
                        </Box>
                        <Box sx={{
                            position: 'absolute', bottom: 0, left: 0, right: 0,
                            bgcolor: 'rgba(0,0,0,0.6)', color: 'white',
                            py: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5
                        }}>
                            <CameraAlt sx={{ fontSize: 14 }} />
                            <Typography variant="caption" fontWeight="bold">Retake</Typography>
                        </Box>
                    </>
                ) : (
                    <>
                        <CameraAlt color={required ? 'primary' : 'action'} sx={{ fontSize: 32, mb: 1 }} />
                        <Typography variant="caption" fontWeight={600} align="center">{label}</Typography>
                    </>
                )}

                {required && !currentImage && (
                    <Box sx={{ position: 'absolute', top: 0, right: 0, bgcolor: 'secondary.main', color: 'white', fontSize: 10, px: 1, borderBottomLeftRadius: 8 }}>
                        REQUIRED
                    </Box>
                )}
            </Paper>
        </>
    );
};

const StepVisual: React.FC<StepProps> = ({ formData, handlePhotoCapture }) => (
    <Stack spacing={3}>
        <Typography variant="body2" color="text.secondary">
            Capture both the muzzle print and the face profile for strict AI verification. You may reuse the muzzle photo if a separate face photo is not possible.
        </Typography>

        <Typography variant="subtitle2" fontWeight="bold">1. PRIMARY IDENTIFIER</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <SmartPhotoBox
                label="Muzzle (Required)"
                required={true}
                guidanceType="muzzle"
                currentImage={formData.muzzleImage}
                onCapture={(img) => handlePhotoCapture?.('muzzleImage', img)}
            />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <SmartPhotoBox
                    label="Face Profile (Required)"
                    required={true}
                    guidanceType="face"
                    currentImage={formData.faceImage}
                    onCapture={(img) => handlePhotoCapture?.('faceImage', img)}
                />
                <Button
                    size="small"
                    variant="outlined"
                    color="secondary"
                    disabled={!formData.muzzleImage}
                    onClick={() => handlePhotoCapture?.('faceImage', formData.muzzleImage)}
                    sx={{ textTransform: 'none', fontSize: '0.75rem', py: 0.25 }}
                >
                    Copy Muzzle
                </Button>
            </Box>
        </Box>

        <Typography variant="subtitle2" fontWeight="bold">2. BODY ANGLES</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <SmartPhotoBox
                label="Left Profile"
                required={false}
                guidanceType="left"
                currentImage={formData.leftImage}
                onCapture={(img) => handlePhotoCapture?.('leftImage', img)}
            />
            <SmartPhotoBox
                label="Right Profile"
                required={false}
                guidanceType="right"
                currentImage={formData.rightImage}
                onCapture={(img) => handlePhotoCapture?.('rightImage', img)}
            />
            <SmartPhotoBox
                label="Back View"
                required={false}
                guidanceType="back"
                currentImage={formData.backImage}
                onCapture={(img) => handlePhotoCapture?.('backImage', img)}
            />
            <SmartPhotoBox
                label="Tail / Udders"
                required={false}
                guidanceType="tail"
                currentImage={formData.tailImage}
                onCapture={(img) => handlePhotoCapture?.('tailImage', img)}
            />
        </Box>
    </Stack>
);

const StepKYC: React.FC<StepProps> = ({ formData, handlePhotoCapture }) => (
    <Stack spacing={3}>
        <Typography variant="body2" color="text.secondary">
            Take a selfie with the cow to verify farmer identity.
        </Typography>

        <Typography variant="subtitle2" fontWeight="bold">FARMER KYC</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr', gap: 2 }}>
            <SmartPhotoBox
                label="Farmer Selfie with Cow"
                required={false}
                guidanceType="selfie"
                currentImage={formData.selfieImage}
                onCapture={(img) => handlePhotoCapture?.('selfieImage', img)}
            />
        </Box>
    </Stack>
);

// --- STEP 4: HEALTH & STATS ---
const StepStats: React.FC<StepProps> = ({ formData, handleChange }) => (
    <Stack spacing={3}>
        <Typography variant="subtitle2" color="primary" fontWeight="bold">BODY WEIGHT RECORDING</Typography>

        <TextField type="number" fullWidth label="Current Body Weight (kg)" value={formData.currentWeight} onChange={handleChange('currentWeight')} />

        <TextField select fullWidth label="Growth Status" value={formData.growthStatus} onChange={handleChange('growthStatus')}>
            <MenuItem value="Optimum">Optimum Growth (&gt;400g/day)</MenuItem>
            <MenuItem value="Poor">Poor Growth (&lt;400g/day)</MenuItem>
        </TextField>

        <Typography variant="subtitle2" color="primary" fontWeight="bold" sx={{ mt: 1 }}>CURRENT STATUS</Typography>

        <TextField select fullWidth label="Reproduction Status" value={formData.productionStatus} onChange={handleChange('productionStatus')}>
            <MenuItem value="Milking">In Milk</MenuItem>
            <MenuItem value="Dry">Dry</MenuItem>
            <MenuItem value="Pregnant">Pregnant</MenuItem>
            <MenuItem value="Heifer">Heifer (Not yet calved)</MenuItem>
        </TextField>

        <TextField select fullWidth label="Calf Body Condition" value={formData.healthStatus} onChange={handleChange('healthStatus')}>
            <MenuItem value="Healthy">Healthy</MenuItem>
            <MenuItem value="Underweight">Underweight</MenuItem>
        </TextField>

        <TextField type="number" label="Body Condition Score (1-5)" value={formData.bodyConditionScore} onChange={handleChange('bodyConditionScore')} />
    </Stack>
);

// --- STEP 5: REVIEW ---
const StepReview: React.FC<StepReviewProps> = ({ formData, setActiveStep }) => (
    <Stack spacing={2}>
        <Paper elevation={0} sx={{ bgcolor: '#F9FAFB', p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" color="primary" fontWeight="bold">BASIC IDENTIFICATION</Typography>
                <IconButton size="small" onClick={() => setActiveStep(0)}><Edit fontSize="small" /></IconButton>
            </Box>
            <Typography variant="body2"><b>Tag No:</b> {formData.tagNo || 'None'}</Typography>
            <Typography variant="body2"><b>Name:</b> {formData.name || 'None'}</Typography>
            <Typography variant="body2"><b>Species:</b> {formData.species}</Typography>
            <Typography variant="body2"><b>Sex:</b> {formData.sex}</Typography>
            <Typography variant="body2"><b>Breed:</b> {formData.breed || 'None'}</Typography>
            <Typography variant="body2"><b>DOB:</b> {formData.dob || 'None'} ({formData.ageMonths ? `${formData.ageMonths}m` : 'N/A'})</Typography>
        </Paper>

        <Paper elevation={0} sx={{ bgcolor: '#F9FAFB', p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" color="primary" fontWeight="bold">LINEAGE & ORIGIN</Typography>
                <IconButton size="small" onClick={() => setActiveStep(1)}><Edit fontSize="small" /></IconButton>
            </Box>
            <Typography variant="body2"><b>Source:</b> {formData.source}</Typography>
            {formData.source === 'Purchase' && (
                <>
                    <Typography variant="body2"><b>Purchase Date:</b> {formData.purchaseDate || 'None'}</Typography>
                    <Typography variant="body2"><b>Price:</b> ₹{formData.purchasePrice || '0'}</Typography>
                </>
            )}
            <Typography variant="body2"><b>Sire Tag:</b> {formData.sireTag || 'None'}</Typography>
            <Typography variant="body2"><b>Dam Tag:</b> {formData.damTag || 'None'}</Typography>
            <Typography variant="body2"><b>Birth Weight:</b> {formData.birthWeight || 'None'} kg</Typography>
            <Typography variant="body2"><b>Mother WT at Calving:</b> {formData.motherWeightAtCalving || 'None'} kg</Typography>
        </Paper>

        <Paper elevation={0} sx={{ bgcolor: '#F9FAFB', p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" color="primary" fontWeight="bold">PHOTOS / IDENTIFIERS</Typography>
                <IconButton size="small" onClick={() => setActiveStep(2)}><Edit fontSize="small" /></IconButton>
            </Box>
            <Typography variant="body2"><b>Face Profile:</b> {formData.faceImage ? 'Captured ✅' : 'Pending ❌'}</Typography>
            <Typography variant="body2"><b>Muzzle:</b> {formData.muzzleImage ? 'Captured ✅' : 'Pending ❌'}</Typography>
            <Typography variant="body2"><b>Left Profile:</b> {formData.leftImage ? 'Captured ✅' : 'Pending ❌'}</Typography>
            <Typography variant="body2"><b>Right Profile:</b> {formData.rightImage ? 'Captured ✅' : 'Pending ❌'}</Typography>
            <Typography variant="body2"><b>Back View:</b> {formData.backImage ? 'Captured ✅' : 'Pending ❌'}</Typography>
            <Typography variant="body2"><b>Tail / Udders:</b> {formData.tailImage ? 'Captured ✅' : 'Pending ❌'}</Typography>
        </Paper>

        <Paper elevation={0} sx={{ bgcolor: '#F9FAFB', p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" color="primary" fontWeight="bold">FARMER KYC</Typography>
                <IconButton size="small" onClick={() => setActiveStep(3)}><Edit fontSize="small" /></IconButton>
            </Box>
            <Typography variant="body2"><b>Farmer Selfie:</b> {formData.selfieImage ? 'Captured ✅' : 'Pending ❌'}</Typography>
        </Paper>

        <Paper elevation={0} sx={{ bgcolor: '#F9FAFB', p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" color="primary" fontWeight="bold">HEALTH & STATS</Typography>
                <IconButton size="small" onClick={() => setActiveStep(4)}><Edit fontSize="small" /></IconButton>
            </Box>
            <Typography variant="body2"><b>Current Weight:</b> {formData.currentWeight || 'None'} kg</Typography>
            <Typography variant="body2"><b>Growth Status:</b> {formData.growthStatus}</Typography>
            <Typography variant="body2"><b>Reproduction:</b> {formData.productionStatus}</Typography>
            <Typography variant="body2"><b>Condition Status:</b> {formData.healthStatus}</Typography>
            <Typography variant="body2"><b>Body Score (BCS):</b> {formData.bodyConditionScore || 'None'}</Typography>
        </Paper>

        <Box sx={{ textAlign: 'center', mt: 2 }}>
            <Typography variant="caption" color="text.secondary">
                By clicking submit, this data and the metadata will be uploaded to the Ama Gaudhana AI Server.
            </Typography>
        </Box>
    </Stack>
);

const AddCow: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const offlineDraft = location.state?.offlineDraft;

    const [formData, setFormData] = useState<CowFormData>(
        offlineDraft ? offlineDraft : {
            tagNo: '', name: '', species: 'Cow', breed: '', sex: 'Female', dob: '', ageMonths: '',
            source: 'Home Born', purchaseDate: '', purchasePrice: '', sireTag: '', damTag: '',
            birthWeight: '', motherWeightAtCalving: '', bodyConditionScore: '',
            currentWeight: '', growthStatus: 'Optimum', healthStatus: 'Healthy', productionStatus: 'Milking',
            // Photos
            faceImage: '', muzzleImage: '', leftImage: '', rightImage: '', backImage: '', tailImage: '', selfieImage: ''
        }
    );

    const [activeStep, setActiveStep] = useState(0);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [cooldownRemaining, setCooldownRemaining] = useState(0);
    const apiAttemptsRef = useRef(0);

    const { isOpen, startProcessing, updateProgress, stopProcessing } = useProcessing();

    // Feedback State
    const [feedback, setFeedback] = useState<{ type: 'ERROR' | 'OFFLINE_SAVED' | 'SERVER_ERROR_SAVED' | 'FATAL', title: string, message: string } | null>(null);
    const [showDisputeDialog, setShowDisputeDialog] = useState(false);
    const [disputeCowId, setDisputeCowId] = useState<string | null>(null);

    // 1-minute restriction logic
    useEffect(() => {
        const lastRegStr = localStorage.getItem('last_registration_time');
        if (lastRegStr) {
            const lastReg = parseInt(lastRegStr, 10);
            const diffMs = Date.now() - lastReg;
            if (diffMs < 15000) {
                setCooldownRemaining(Math.ceil((15000 - diffMs) / 1000));

                const timer = setInterval(() => {
                    setCooldownRemaining(prev => {
                        if (prev <= 1) {
                            clearInterval(timer);
                            return 0;
                        }
                        return prev - 1;
                    });
                }, 1000);
                return () => clearInterval(timer);
            }
        }
    }, [location.key]);

    useEffect(() => {
        if (scrollRef.current) {
            setTimeout(() => {
                if (scrollRef.current) {
                    scrollRef.current.scrollTo({ top: 0, behavior: 'smooth' });
                    scrollRef.current.scrollTop = 0;
                }
                const mainEl = document.querySelector('main');
                if (mainEl) {
                    mainEl.scrollTo({ top: 0, behavior: 'smooth' });
                    mainEl.scrollTop = 0;
                }
            }, 50);
        }
    }, [activeStep]);

    const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setFormData(prev => {
            const updated = { ...prev, [field]: value };
            if (field === 'dob') {
                if (value) {
                    const birth = new Date(value);
                    const now = new Date();
                    const months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
                    updated.ageMonths = isNaN(months) ? '' : months.toString();
                } else {
                    updated.ageMonths = '';
                }
            }
            return updated;
        });
    };

    const queryClient = useQueryClient();

    const handleSubmit = async () => {
        // Start processing and HIDE the Cancel button
        startProcessing('Registering Cow', 'Confirming your live location for this submission.', true);

        let lat, lng;
        try {
            const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
        } catch (err) {
            console.error('GPS error:', err);
            stopProcessing();
            setFeedback({ type: 'ERROR', title: 'Location Required', message: 'Could not fetch your precise GPS location. Please ensure location services are enabled and permissions are granted.' });
            return;
        }

        updateProgress(30, 'Uploading required cow and KYC photos securely...');

        const apiPayload = {
            ...formData,
            lat,
            lng,
            faceImage: base64ToFile(formData.faceImage || formData.muzzleImage, 'face_image.jpg'),
            muzzleImage: base64ToFile(formData.muzzleImage, 'muzzle_image.jpg'),
            leftImage: base64ToFile(formData.leftImage, 'left_image.jpg'),
            rightImage: base64ToFile(formData.rightImage, 'right_image.jpg'),
            backImage: base64ToFile(formData.backImage, 'back_image.jpg'),
            tailImage: base64ToFile(formData.tailImage, 'tail_image.jpg'),
            selfieImage: base64ToFile(formData.selfieImage, 'selfie_image.jpg'),
        };

        if (!navigator.onLine) {
            try {
                if (offlineDraft && offlineDraft.id) {
                    await syncManager.removePendingCow(offlineDraft.id);
                }
                await syncManager.savePendingCow({ ...formData, lat, lng });
                localStorage.setItem('last_registration_time', Date.now().toString());
                stopProcessing();
                setFeedback({ type: 'OFFLINE_SAVED', title: 'Saved Locally (Offline)', message: 'No internet connection detected. Your data is safely stored on this device and will sync automatically when you are back online.' });
            } catch (err) {
                console.error('Failed to save locally', err);
                stopProcessing();
                alert('Failed to save locally.');
            }
        } else {
            updateProgress(45, 'Your photos are being sent to the AI servers for verification...');
            try {
                // Register Cow (will return 202 Accepted)
                const response = await registerCowAPI(apiPayload);
                const cowId = response.data?._id;

                if (!cowId) throw new Error('Registration failed to return Cow ID');

                updateProgress(60, 'AI Server received images. Running Biometric Extraction...');

                // Start polling mechanism
                let pollAttempts = 0;
                const maxPolls = 60; // 60 polls at 5 seconds = 5 minutes timeout

                const pollInterval = setInterval(async () => {
                    pollAttempts++;
                    try {
                        const cowResponse = await getCowProfileAPI(cowId);
                        const cowStatus = cowResponse?.data?.aiMetadata?.status;

                        if (pollAttempts === 3) updateProgress(70, 'Running duplicate checks against entire database...');
                        if (pollAttempts === 8) updateProgress(85, 'Cross-matching facial features and muzzle patterns...');

                        if (cowStatus === 'SUCCESS') {
                            clearInterval(pollInterval);
                            updateProgress(100, 'Registration complete! Cow verified successfully.');

                            localStorage.setItem('last_registration_time', Date.now().toString());
                            if (offlineDraft && offlineDraft.id) {
                                await syncManager.removePendingCow(offlineDraft.id);
                            }
                            queryClient.invalidateQueries({ queryKey: ['cows'] });

                            setTimeout(() => {
                                stopProcessing();
                                navigate('/home');
                            }, 1500);
                        } else if (cowStatus === 'DISPUTE') {
                            clearInterval(pollInterval);
                            stopProcessing();
                            setDisputeCowId(cowId);
                            setShowDisputeDialog(true);
                        } else if (cowStatus === 'FAILED' || cowStatus === 'DUPLICATE') {
                            // Handled by catch block normally due to 400 error return from getCowProfileAPI
                            clearInterval(pollInterval);
                            stopProcessing();
                            setFeedback({ type: 'ERROR', title: 'AI Verification Failed', message: 'The AI detected an issue with your photos.' });
                        }
                    } catch (pollErr: any) {
                        if (pollErr.isRejected) {
                            clearInterval(pollInterval);
                            stopProcessing();
                            apiAttemptsRef.current += 1;
                            const newCount = apiAttemptsRef.current;

                            if (pollErr.status === 'DISPUTE') {
                                setDisputeCowId(cowId);
                                setShowDisputeDialog(true);
                                return;
                            }

                            if (newCount >= 10) {
                                setFeedback({ type: 'FATAL', title: 'Registration Blocked', message: `You have failed AI validation 10 times. To prevent spam, you cannot submit this registration right now.` });
                            } else {
                                setFeedback({ type: 'ERROR', title: 'AI Verification Failed', message: `${pollErr.message || 'The AI detected an issue with your photos.'} (Attempt ${newCount} of 10)` });
                            }
                        } else if (pollAttempts >= maxPolls) {
                            clearInterval(pollInterval);
                            stopProcessing();
                            setFeedback({ type: 'ERROR', title: 'Timeout', message: 'The AI server is taking too long to respond. Please check your network or try again later.' });
                        }
                        // otherwise keep polling
                    }
                }, 5000);

            } catch (err: any) {
                stopProcessing();
                console.error('Server error during registration request', err);
                try {
                    if (offlineDraft && offlineDraft.id) await syncManager.removePendingCow(offlineDraft.id);
                    await syncManager.savePendingCow({ ...formData, lat, lng });
                    localStorage.setItem('last_registration_time', Date.now().toString());
                    setFeedback({ type: 'SERVER_ERROR_SAVED', title: 'Saved Locally (Server Error)', message: `Server error: ${err.message || 'Please try again'}. Your registration has been saved locally for review and will automatically sync later.` });
                } catch (localErr) {
                    console.error('Failed to save locally as fallback', localErr);
                }
            }
        }
    };

    const handlePhotoCapture = (field: keyof CowFormData, img: string) => {
        setFormData(prev => {
            if (field === 'muzzleImage') {
                return { ...prev, muzzleImage: img, faceImage: img };
            }

            return { ...prev, [field]: img };
        });
    };

    const handleNext = () => setActiveStep((prev) => prev + 1);
    const handleBack = () => setActiveStep((prev) => prev - 1);

    const handleCancelRequest = useCallback(() => {
        const confirmLeave = window.confirm('You are currently registering a new cow. If you leave, your progress will be lost. Are you sure you want to exit?');
        if (confirmLeave) {
            navigate('/home', { replace: true });
        }
    }, [navigate]);

    useEffect(() => {
        const backListener = CapacitorApp.addListener('backButton', () => {
            if (activeStep > 0) {
                handleBack();
            } else {
                handleCancelRequest();
            }
        });

        return () => {
            backListener.then(listener => listener.remove());
        };
    }, [activeStep, handleCancelRequest]);

    if (cooldownRemaining > 0) {
        return (
            <Box sx={{ p: 4, height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                <Typography variant="h5" color="error" fontWeight="bold" gutterBottom>Slow Down</Typography>
                <Typography align="center" variant="body1">
                    Please wait another {cooldownRemaining} seconds before registering another cow.
                </Typography>
                <Button variant="outlined" sx={{ mt: 3 }} onClick={() => navigate('/home')}>Go Back</Button>
            </Box>
        );
    }

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>


            <Dialog
                open={feedback !== null}
                onClose={() => {
                    if (feedback?.type === 'ERROR') {
                        setFeedback(null);
                    }
                }}
                PaperProps={{ sx: { borderRadius: 3, p: 1 } }}
            >
                {feedback && (
                    <>
                        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1, fontWeight: 'bold', color: feedback.type === 'OFFLINE_SAVED' || feedback.type === 'SERVER_ERROR_SAVED' ? 'warning.main' : 'error.main' }}>
                            {feedback.type === 'ERROR' || feedback.type === 'FATAL' ? <ErrorOutline sx={{ fontSize: 28 }} /> : <WifiOffIcon sx={{ fontSize: 28 }} />}
                            {feedback.title}
                        </DialogTitle>
                        <DialogContent>
                            <Typography variant="body1">{feedback.message}</Typography>
                            {(feedback.type === 'OFFLINE_SAVED' || feedback.type === 'SERVER_ERROR_SAVED') && (
                                <Box sx={{ mt: 2, p: 1.5, bgcolor: '#F9FAFB', borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                    <CheckCircle color="success" />
                                    <Typography variant="body2" fontWeight={600}>Don't worry! Your filled data is safely preserved on your device.</Typography>
                                </Box>
                            )}
                            {feedback.type === 'ERROR' && (
                                <Box sx={{ mt: 2, p: 1.5, bgcolor: '#FEF2F2', borderRadius: 2, border: '1px solid #FECACA' }}>
                                    <Typography variant="body2" color="error.dark" fontWeight={600}>Action Required:</Typography>
                                    <Typography variant="body2" color="error.main">Please click 'Fix Errors & Try Again' below, go back to the relevant steps (like Visual ID), capture clearer, live photos, and try submitting again.</Typography>
                                </Box>
                            )}
                        </DialogContent>
                        <DialogActions sx={{ pt: 2, px: 3, pb: 2 }}>
                            {feedback.type === 'ERROR' ? (
                                <Button variant="contained" color="error" fullWidth sx={{ borderRadius: 6, fontWeight: 'bold' }} onClick={() => setFeedback(null)}>
                                    Fix Errors & Try Again
                                </Button>
                            ) : (
                                <Button variant="contained" fullWidth sx={{ borderRadius: 6, fontWeight: 'bold' }} onClick={() => { setFeedback(null); navigate('/home'); }}>
                                    Return to Dashboard
                                </Button>
                            )}
                        </DialogActions>
                    </>
                )}
            </Dialog>

            {/* Dispute Confirmation Dialog */}
            <Dialog open={showDisputeDialog} onClose={() => { }}>
                <DialogTitle color="error" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ErrorOutline /> Dispute Detected
                </DialogTitle>
                <DialogContent>
                    <Typography>
                        The AI has detected that a highly similar cow is already registered in the system. This indicates a potential dispute. Do you still want to continue and submit this registration for review?
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={async () => {
                        if (disputeCowId) {
                            try {
                                await deleteCowAPI(disputeCowId);
                            } catch (e) { console.error(e); }
                        }
                        setShowDisputeDialog(false);
                        alert('Registration cancelled.');
                        navigate('/home');
                    }} color="inherit">
                        No, Cancel
                    </Button>
                    <Button onClick={() => {
                        setShowDisputeDialog(false);
                        alert('Registered with a Dispute flag. An admin will review it.');
                        navigate('/home');
                    }} variant="contained" color="warning">
                        Yes, Continue
                    </Button>
                </DialogActions>
            </Dialog>

            {/* FIXED TOP HEADER */}
            <Box sx={{
                pt: 'env(safe-area-inset-top, 0px)',
                bgcolor: 'white',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                zIndex: 1100
            }}>
                <Container maxWidth="sm" sx={{ pt: 0.5, pb: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', mb: 0.5 }}>
                        <Typography variant="subtitle1" fontWeight={800}>New Registration</Typography>
                    </Box>

                    {/* Offline Awareness Notice */}
                    {!navigator.onLine && (
                        <Alert
                            severity="warning"
                            icon={<WifiOffIcon />}
                            sx={{ mb: 2, borderRadius: '12px' }}
                        >
                            <AlertTitle sx={{ fontWeight: 'bold' }}>Offline Mode</AlertTitle>
                            You are offline. Registration will be saved locally and sync automatically when internet is restored.
                        </Alert>
                    )}

                    {/* FIXED STEPPER */}
                    <Stepper nonLinear activeStep={activeStep} alternativeLabel sx={{ mb: 0.5 }}>
                        {steps.map((label, index) => (
                            <Step key={label} completed={activeStep > index}>
                                <StepButton
                                    onClick={() => setActiveStep(index)}
                                    icon={<Box sx={{
                                        width: 24, height: 24, borderRadius: '50%',
                                        bgcolor: activeStep === index ? 'primary.main' : (activeStep > index ? 'primary.main' : 'grey.400'),
                                        color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: '0.75rem', fontWeight: 'bold'
                                    }}>{index + 1}</Box>}
                                    sx={{ '& .MuiStepLabel-label': { fontSize: '0.65rem' } }}
                                >
                                    {label}
                                </StepButton>
                            </Step>
                        ))}
                    </Stepper>

                    {/* COMPACT TOP NAVIGATION */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1, px: 2 }}>
                        <Button
                            size="small"
                            disabled={activeStep === 0 || isOpen}
                            onClick={handleBack}
                            sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '0.7rem', px: 1.5, py: 0.5, borderRadius: 4, bgcolor: '#F3F4F6', '&:hover': { bgcolor: '#E5E7EB' } }}
                        >
                            Back
                        </Button>
                        <Button
                            size="small"
                            variant="contained"
                            disabled={isOpen}
                            onClick={activeStep === steps.length - 1 ? handleSubmit : handleNext}
                            endIcon={activeStep === steps.length - 1 ? <CheckCircle sx={{ fontSize: '14px !important' }} /> : <ArrowForward sx={{ fontSize: '14px !important' }} />}
                            sx={{ fontWeight: 700, fontSize: '0.7rem', px: 1.5, py: 0.5, borderRadius: 4, boxShadow: 'none' }}
                        >
                            {isOpen ? 'Wait..' : (activeStep === steps.length - 1 ? 'Submit' : 'Next')}
                        </Button>
                    </Box>
                </Container>
            </Box>

            {/* SCROLLABLE FORM BODY */}
            <Box ref={scrollRef} sx={{ flexGrow: 1, overflowY: 'auto', p: 1, pb: 'calc(env(safe-area-inset-bottom) + 32px)' }}>
                <Container maxWidth="sm">
                    <Paper elevation={0} sx={{ p: 2.5, border: '1px solid #E5E7EB', borderRadius: 2, mb: 3, bgcolor: 'white' }}>
                        {activeStep === 0 && <StepBasic formData={formData} handleChange={handleChange} />}
                        {activeStep === 1 && <StepOrigin formData={formData} handleChange={handleChange} />}
                        {activeStep === 2 && <StepVisual formData={formData} handleChange={handleChange} handlePhotoCapture={handlePhotoCapture} />}
                        {activeStep === 3 && <StepKYC formData={formData} handleChange={handleChange} handlePhotoCapture={handlePhotoCapture} />}
                        {activeStep === 4 && <StepStats formData={formData} handleChange={handleChange} />}
                        {activeStep === 5 && <StepReview formData={formData} setActiveStep={setActiveStep} />}
                    </Paper>

                    {/* INLINE BOTTOM NAVIGATION */}
                    <Box sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        mb: 4
                    }}>
                        <Button
                            color="error"
                            onClick={handleCancelRequest}
                            sx={{ fontWeight: 600, minWidth: 'auto', px: 2 }}
                        >
                            Cancel
                        </Button>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button
                                disabled={activeStep === 0 || isOpen}
                                onClick={handleBack}
                                sx={{ color: 'text.secondary', fontWeight: 600, bgcolor: '#F3F4F6', '&:hover': { bgcolor: '#E5E7EB' }, borderRadius: 6, px: 3 }}
                            >
                                Back
                            </Button>
                            <Button
                                variant="contained"
                                disabled={isOpen}
                                onClick={activeStep === steps.length - 1 ? handleSubmit : handleNext}
                                endIcon={activeStep === steps.length - 1 ? <CheckCircle /> : <ArrowForward />}
                                sx={{ borderRadius: 6, px: 4, boxShadow: '0 4px 12px rgba(46, 125, 50, 0.3)', fontWeight: 700, py: 1.5 }}
                            >
                                {isOpen ? 'Wait..' : (activeStep === steps.length - 1 ? 'Submit' : 'Next')}
                            </Button>
                        </Box>
                    </Box>
                </Container>
            </Box>
        </Box>
    );
};

export default AddCow;
