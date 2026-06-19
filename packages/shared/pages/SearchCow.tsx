import React, { useState, useCallback, useEffect, useRef } from 'react';
import axios from 'axios';
import {
    Container, Box, TextField, IconButton, Typography,
    Paper, Avatar, Chip, Button, Stack,
    Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Skeleton,
    Divider, Fade
} from '@mui/material';
import {
    Search, ArrowForwardIos, Close,
    CameraAlt, CheckCircle, History,
    PhotoLibrary, Fingerprint, Tag, QrCodeScanner,
    Visibility, ArrowBack
} from '@mui/icons-material';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HTML5CameraDialog } from '../components/HTML5CameraDialog';
import { base64ToFile, compressImage, getImageUrl } from '../utils/imageUtils';
import { ALLOW_GALLERY_UPLOAD } from '../config';
import { useProcessing } from '../contexts/ProcessingContext';
import { Preferences } from '@capacitor/preferences';
import { preloadMuzzleModel, preloadNimaModel, disposeModels } from '../utils/MuzzleModelService';

import { API_BASE } from '@gonidhi/shared';

// ── Types ───────────────────────────────────────────────────────────────────
interface CowListSummary {
    _id: string;
    name: string;
    tagNumber: string;
    breed: string;
    currentStatus: string;
    ageMonths?: number;
    photos?: { faceProfile?: string; muzzle?: string };
}

const SEARCH_HISTORY_KEY = 'gonidhi_search_history';
const MAX_HISTORY = 3;

function useSearchHistory() {
    const [history, setHistory] = useState<string[]>(() => {
        try { return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]'); }
        catch { return []; }
    });
    const addHistory = useCallback((term: string) => {
        const t = term.trim();
        if (!t) return;
        setHistory(prev => {
            const h = [t, ...prev.filter(i => i !== t)].slice(0, MAX_HISTORY);
            localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(h));
            return h;
        });
    }, []);
    return { history, addHistory };
}



const getStatusColor = (status: string): 'error' | 'warning' | 'info' | 'default' | 'success' => {
    switch (status) {
        case 'Sick': return 'error';
        case 'Pregnant': return 'warning';
        case 'Heifer': return 'info';
        case 'Dry': return 'default';
        default: return 'success';
    }
};

// ── Photo Capture Box ─────────────────────────────────────────────────────────
const PhotoCaptureBox = ({
    label, guidanceType, currentImage, onCapture, icon, onPreview
}: {
    label: string;
    guidanceType: 'face' | 'muzzle';
    currentImage?: string;
    onCapture: (img: string) => void;
    icon?: React.ReactNode;
    onPreview?: (img: string) => void;
}) => {
    const [cameraOpen, setCameraOpen] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = async (event) => {
                const result = event.target?.result;
                if (typeof result === 'string') {
                    const isMuzzle = guidanceType === 'muzzle';
                    const compressed = await compressImage(result, isMuzzle ? 1280 : 800, isMuzzle ? 1280 : 800, isMuzzle ? 0.95 : 0.80);
                    onCapture(compressed);
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const handleCameraCapture = async (capturedSrc: string) => {
        const isMuzzle = guidanceType === 'muzzle';
        const compressed = await compressImage(capturedSrc, isMuzzle ? 1280 : 800, isMuzzle ? 1280 : 800, isMuzzle ? 0.95 : 0.80);
        onCapture(compressed);
        setCameraOpen(false);
        if (compressed !== capturedSrc && capturedSrc.startsWith('blob:')) URL.revokeObjectURL(capturedSrc);
    };

    return (
        <>
            {/* Empty / placeholder state */}
            {!currentImage && (
                <Paper
                    elevation={0}
                    onClick={() => setConfirmOpen(true)}
                    sx={{
                        border: '2px dashed #A5D6A7',
                        borderRadius: 2,
                        bgcolor: '#F6FBF6',
                        cursor: 'pointer',
                        p: 2,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 1,
                        transition: 'all 0.2s',
                        '&:active': { bgcolor: '#EAF5EA', transform: 'scale(0.99)' },
                    }}
                >
                    <Box sx={{
                        width: 44, height: 44, borderRadius: '50%',
                        bgcolor: '#C8E6C9',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                        {icon || <CameraAlt sx={{ color: '#2E7D32', fontSize: 22 }} />}
                    </Box>
                    <Box sx={{ textAlign: 'center' }}>
                        <Typography variant="body2" fontWeight={700} color="text.primary" sx={{ mb: 0.2 }}>
                            {label}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            Tap to open camera
                        </Typography>
                    </Box>
                    {ALLOW_GALLERY_UPLOAD && (
                        <Button
                            size="small"
                            variant="outlined"
                            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                            startIcon={<PhotoLibrary sx={{ fontSize: 15 }} />}
                            sx={{ textTransform: 'none', fontSize: '0.75rem', borderRadius: 2, py: 0.4, px: 2, borderColor: '#A5D6A7', color: 'primary.dark' }}
                        >
                            Gallery
                        </Button>
                    )}
                </Paper>
            )}

            {/* Captured state */}
            {currentImage && (
                <Box sx={{ borderRadius: 2, overflow: 'hidden', position: 'relative', height: 140 }}>
                    <img
                        src={currentImage}
                        alt={label}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', cursor: onPreview ? 'pointer' : 'default' }}
                        onClick={() => onPreview?.(currentImage)}
                    />
                    {/* Top badge */}
                    <Box sx={{
                        position: 'absolute', top: 0, left: 0, right: 0,
                        px: 2, py: 1,
                        background: 'linear-gradient(to bottom, rgba(0,0,0,0.6) 0%, transparent 100%)',
                        display: 'flex', alignItems: 'center', gap: 0.8
                    }}>
                        <CheckCircle sx={{ fontSize: 16, color: '#69F0AE' }} />
                        <Typography sx={{ color: 'white', fontWeight: 700, fontSize: '0.78rem', flex: 1 }}>{label}</Typography>
                        {onPreview && (
                            <IconButton size="small" onClick={() => onPreview(currentImage)} sx={{ color: 'white', p: 0 }}>
                                <Visibility sx={{ fontSize: 18 }} />
                            </IconButton>
                        )}
                    </Box>
                    {/* Bottom action row */}
                    <Box sx={{
                        position: 'absolute', bottom: 0, left: 0, right: 0,
                        display: 'flex',
                        background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)',
                        pt: 3,
                    }}>
                        <Button
                            size="small"
                            onClick={() => setConfirmOpen(true)}
                            startIcon={<CameraAlt sx={{ fontSize: 15 }} />}
                            sx={{ flex: 1, color: 'white', textTransform: 'none', fontWeight: 600, fontSize: '0.8rem', py: 1 }}
                        >
                            Retake
                        </Button>
                        {ALLOW_GALLERY_UPLOAD && (
                            <>
                                <Divider orientation="vertical" flexItem sx={{ bgcolor: 'rgba(255,255,255,0.3)', my: 0.5 }} />
                                <Button
                                    size="small"
                                    onClick={() => fileInputRef.current?.click()}
                                    startIcon={<PhotoLibrary sx={{ fontSize: 15 }} />}
                                    sx={{ flex: 1, color: 'white', textTransform: 'none', fontWeight: 600, fontSize: '0.8rem', py: 1 }}
                                >
                                    Gallery
                                </Button>
                            </>
                        )}
                    </Box>
                </Box>
            )}

            <input type="file" accept="image/*" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileUpload} />
            <HTML5CameraDialog open={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={handleCameraCapture} guidanceType={guidanceType} />

            {/* Confirmation Dialog */}
            <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
                <DialogTitle>Open Camera?</DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        Do you want to turn on the camera to capture the {label}?
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
                    <Button onClick={() => { setConfirmOpen(false); setCameraOpen(true); }} variant="contained" autoFocus>
                        Yes
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

// ── AI Scan Tab ───────────────────────────────────────────────────────────────
const ScanTab = ({ isAdmin }: { isAdmin?: boolean }) => {
    const navigate = useNavigate();
    const { startProcessing, updateProgress, stopProcessing } = useProcessing();
    const [faceImage, setFaceImage] = useState<string | null>(null);
    const [muzzleImage, setMuzzleImage] = useState<string | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [notFoundOpen, setNotFoundOpen] = useState(false);
    const [notFoundReason, setNotFoundReason] = useState('');
    const [notFoundTitle, setNotFoundTitle] = useState('');
    const [matchedCow, setMatchedCow] = useState<{
        cowId: string;
        cow: { name?: string; tagNumber?: string; photos?: { faceProfile?: string; muzzle?: string }; isDispute?: boolean };
        confidence: number;
    } | null>(null);

    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxImage, setLightboxImage] = useState<string | null>(null);

    const openLightbox = (url: string) => {
        setLightboxImage(url);
        setLightboxOpen(true);
        window.history.pushState({ lightboxOpen: true }, '');
    };

    const closeLightbox = () => {
        setLightboxOpen(false);
        setLightboxImage(null);
        if (window.history.state?.lightboxOpen) {
            window.history.back();
        }
    };

    useEffect(() => {
        const handlePopState = () => {
            if (lightboxOpen) {
                setLightboxOpen(false);
                setLightboxImage(null);
            }
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [lightboxOpen]);

    useEffect(() => {
        return () => { setFaceImage(null); setMuzzleImage(null); };
    }, []);

    const handleSearch = async () => {
        if (!muzzleImage || !faceImage) return;
        const signal = startProcessing(
            'Finding Cattle',
            'Uploading biometrics…',
            false,
            'Please be patient and do not close the app. This secure API search process may take about 10-12 minutes to analyze and match across the national database.'
        );
        updateProgress(15);

        try {
            const payload = {
                faceImage: base64ToFile(faceImage, 'search_face.webp'),
                muzzleImage: base64ToFile(muzzleImage, 'search_muzzle.webp')
            };

            await new Promise(r => window.setTimeout(r, 600)); // UX delay for realism
            updateProgress(45, 'Matching against database…');

            const tokenResponse = isAdmin
                ? await Preferences.get({ key: 'adminToken' })
                : await Preferences.get({ key: 'jwt_token' });
            const token = tokenResponse.value;
            if (!token) throw new Error('Not authenticated');

            const formData = new FormData();
            formData.append('faceImage', payload.faceImage as Blob);
            formData.append('muzzleImage', payload.muzzleImage as Blob);

            const endpoint = isAdmin ? '/api/admin/cattle/proxy-search' : '/api/farmer/cattle/search';
            const res = await axios.post(`${API_BASE}${endpoint}`, formData, {
                headers: { Authorization: `Bearer ${token}` },
                signal
            });
            const responseData = res.data;

            updateProgress(85, 'Finalizing…');
            await new Promise(r => window.setTimeout(r, 500));
            updateProgress(100, 'Complete');
            await new Promise(r => window.setTimeout(r, 300));

            if (responseData.success && responseData.data.cowId) {
                setMatchedCow(responseData.data);
                setDialogOpen(true);
            } else {
                setNotFoundTitle('No Match Found');
                setNotFoundReason('No matching cow found in the database.');
                setNotFoundOpen(true);
            }
        } catch (err: unknown) {
            if (axios.isCancel(err) || (err instanceof Error && err.name === 'CanceledError')) {
                return; // User canceled the request
            }
            updateProgress(100);
            await new Promise(r => window.setTimeout(r, 250));
            const msg = err instanceof Error ? err.message : '';
            let title = 'Search Failed'; let reason = msg;
            if (msg.toLowerCase().includes('detect a muzzle')) { title = 'Detection Failed'; reason = 'Could not detect a clear muzzle or face. Please ensure both are well-lit and clearly visible.'; }
            else if (msg.toLowerCase().includes('cow not found') || msg.toLowerCase().includes('similarity too low')) { title = 'No Match Found'; reason = 'No matching cow found in the database. Ensure the cow is registered.'; }
            else if (msg.toLowerCase().includes('spoof')) { title = 'Invalid Image'; reason = 'The image appears to be a spoof. Please take a live photo.'; }
            else if (msg.toLowerCase().includes('unavailable')) { title = 'Service Unavailable'; reason = 'The AI service is temporarily unavailable. Try again later.'; }
            setNotFoundTitle(title); setNotFoundReason(reason); setNotFoundOpen(true);
        } finally {
            stopProcessing();
        }
    };

    const bothCaptured = !!muzzleImage && !!faceImage;

    return (
        <Box>
            {/* Capture boxes stacked */}
            <Stack spacing={1.5} sx={{ mb: 1.5 }}>
                <PhotoCaptureBox
                    label="Muzzle Photo"
                    guidanceType="muzzle"
                    currentImage={muzzleImage || undefined}
                    onCapture={setMuzzleImage}
                    icon={<Fingerprint sx={{ color: '#2E7D32', fontSize: 22 }} />}
                    onPreview={openLightbox}
                />
                <PhotoCaptureBox
                    label="Face Profile Photo"
                    guidanceType="face"
                    currentImage={faceImage || undefined}
                    onCapture={setFaceImage}
                    icon={<CameraAlt sx={{ color: '#2E7D32', fontSize: 22 }} />}
                    onPreview={openLightbox}
                />
            </Stack>

            {/* Copy muzzle helper */}
            {muzzleImage && !faceImage && (
                <Fade in>
                    <Button
                        size="small"
                        variant="outlined"
                        color="primary"
                        onClick={() => setFaceImage(muzzleImage)}
                        sx={{ textTransform: 'none', borderRadius: 2, width: '100%', mb: 1.5, fontSize: '0.78rem' }}
                    >
                        Use muzzle photo as face profile
                    </Button>
                </Fade>
            )}

            {/* CTA button */}
            <Button
                variant="contained"
                color="primary"
                fullWidth
                disabled={!bothCaptured}
                onClick={handleSearch}
                endIcon={<QrCodeScanner />}
                sx={{
                    py: 1.6, borderRadius: 3, fontWeight: 'bold', fontSize: '1rem', mt: 1,
                    boxShadow: bothCaptured ? '0 6px 20px rgba(46, 125, 50, 0.35)' : 'none',
                    transition: 'box-shadow 0.3s',
                    textTransform: 'none'
                }}
            >
                {bothCaptured ? 'Verify & Find Cow' : 'Capture Both Photos to Search'}
            </Button>

            {/* Not-found dialog */}
            <Dialog open={notFoundOpen} onClose={() => setNotFoundOpen(false)} fullWidth maxWidth="xs">
                <DialogContent sx={{ textAlign: 'center', pt: 4, pb: 2 }}>
                    <Box sx={{ width: 68, height: 68, borderRadius: '50%', bgcolor: '#FEE2E2', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
                        <Typography fontSize={32}>🔍</Typography>
                    </Box>
                    <Typography variant="h6" fontWeight={800} gutterBottom>{notFoundTitle}</Typography>
                    <Typography variant="body2" color="text.secondary">{notFoundReason}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                        Tip: Ensure the muzzle is clear, well-lit, and closely framed.
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ justifyContent: 'center', pb: 3, px: 3, flexDirection: 'column', gap: 1 }}>
                    <Button variant="contained" color="error" fullWidth onClick={() => { setNotFoundOpen(false); setFaceImage(null); setMuzzleImage(null); }} sx={{ borderRadius: 3, fontWeight: 'bold', py: 1.2 }}>
                        🔄 Retry with New Photos
                    </Button>
                    <Button fullWidth onClick={() => setNotFoundOpen(false)} sx={{ borderRadius: 3 }}>Close</Button>
                </DialogActions>
            </Dialog>

            {/* Match-found dialog */}
            <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} fullWidth maxWidth="xs">
                <DialogContent>
                    {matchedCow?.cow && (
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 2, gap: 1.5 }}>
                            <Box sx={{ width: 68, height: 68, borderRadius: '50%', bgcolor: '#E8F5E9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <CheckCircle sx={{ color: '#2E7D32', fontSize: 36 }} />
                            </Box>
                            <Typography variant="body2" fontWeight={700} color="primary.main">Match Found</Typography>
                            <Avatar
                                src={getImageUrl(matchedCow.cow.photos?.faceProfile) || getImageUrl(matchedCow.cow.photos?.muzzle) || ''}
                                sx={{ width: 88, height: 88, border: '3px solid #E8F5E9' }}
                            />
                            <Typography variant="h6" fontWeight={800}>{matchedCow.cow.name || 'Unnamed Cow'}</Typography>
                            <Chip label={`Tag #${matchedCow.cow.tagNumber}`} size="small" color="primary" variant="outlined" />
                            {matchedCow.cow.isDispute && <Chip label="⚠️ Disputed Record" color="error" size="small" sx={{ fontWeight: 'bold' }} />}
                        </Box>
                    )}
                </DialogContent>
                <DialogActions sx={{ justifyContent: 'center', pb: 3, px: 3, gap: 1 }}>
                    <Button onClick={() => setDialogOpen(false)} color="inherit" sx={{ flex: 1, borderRadius: 3 }}>Cancel</Button>
                    <Button
                        variant="contained" color="primary" sx={{ flex: 2, borderRadius: 3, fontWeight: 'bold', py: 1.2 }}
                        onClick={() => { setDialogOpen(false); navigate(isAdmin ? `/cattle/${matchedCow?.cowId}` : `/profile/${matchedCow?.cowId}`); }}
                    >
                        View Full Profile →
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Lightbox Dialog */}
            <Dialog
                open={lightboxOpen}
                onClose={closeLightbox}
                fullScreen
                PaperProps={{
                    sx: {
                        bgcolor: 'rgba(0,0,0,0.9)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }
                }}
            >
                <IconButton
                    onClick={closeLightbox}
                    sx={{ position: 'absolute', top: 'calc(max(16px, env(safe-area-inset-top)) + 16px)', left: 16, color: 'white', zIndex: 100, bgcolor: 'rgba(0,0,0,0.5)' }}
                >
                    <ArrowBack />
                </IconButton>
                {lightboxImage && (
                    <TransformWrapper centerOnInit={true} centerZoomedOut={true}>
                        <TransformComponent
                            wrapperStyle={{ width: '100vw', height: '100vh' }}
                            contentStyle={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                            <img
                                src={lightboxImage}
                                alt="Zoomed"
                                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                            />
                        </TransformComponent>
                    </TransformWrapper>
                )}
            </Dialog>
        </Box>
    );
};

// ── Search-by-ID Tab ──────────────────────────────────────────────────────────
const SearchTab = ({ isAdmin }: { isAdmin?: boolean }) => {
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const { history, addHistory } = useSearchHistory();

    // Debounce search input
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearch(searchTerm);
            if (searchTerm.trim()) {
                addHistory(searchTerm);
            }
        }, 500);
        return () => clearTimeout(handler);
    }, [searchTerm, addHistory]);

    const fetchCattle = async (search: string) => {
        const token = isAdmin
            ? localStorage.getItem('adminToken')
            : (await Preferences.get({ key: 'jwt_token' })).value;
        const endpoint = isAdmin ? '/api/admin/cattle' : '/api/farmer/cattle';
        const res = await axios.get(`${API_BASE}${endpoint}`, {
            params: { search },
            headers: { Authorization: `Bearer ${token}` }
        });
        return res.data;
    };

    const { data: cowsResponse, isLoading } = useQuery({
        queryKey: ['cows', debouncedSearch, isAdmin],
        queryFn: () => fetchCattle(debouncedSearch)
    });

    const filteredCows = cowsResponse?.data || [];

    const commit = useCallback((term: string) => {
        if (!term.trim()) return;
        setSearchTerm(term.trim());
        addHistory(term);
    }, [addHistory]);

    const clearSearch = () => { setSearchTerm(''); setDebouncedSearch(''); };
    const hasSearched = debouncedSearch.trim().length > 0;

    return (
        <Box>
            {/* Search bar */}
            <Paper elevation={0} sx={{
                display: 'flex', alignItems: 'center', px: 1.5, py: 0.5,
                border: '1.5px solid #E2E8F0', borderRadius: 3, mb: 2,
                transition: 'all 0.2s',
                '&:focus-within': { borderColor: 'primary.main', boxShadow: '0 0 0 3px rgba(46,125,50,0.12)' }
            }}>
                <Search sx={{ color: 'text.disabled', mr: 1 }} />
                <TextField
                    fullWidth variant="standard"
                    placeholder="Tag No, Name or Breed…"
                    InputProps={{ disableUnderline: true }}
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') commit(searchTerm); }}
                    sx={{ py: 0.5 }}
                />
                {searchTerm
                    ? <IconButton size="small" onClick={clearSearch}><Close fontSize="small" /></IconButton>
                    : null
                }
            </Paper>

            {/* Recent history chips */}
            {!hasSearched && history.length > 0 && (
                <Box sx={{ mb: 2 }}>
                    <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
                        <History sx={{ fontSize: 13, color: 'text.disabled' }} />
                        <Typography variant="caption" color="text.disabled" fontWeight={700} letterSpacing={0.5}>RECENT</Typography>
                    </Stack>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {history.map(h => (
                            <Chip key={h} label={h} size="small" variant="outlined" onClick={() => commit(h)}
                                sx={{ cursor: 'pointer', fontWeight: 600, borderRadius: 2 }} />
                        ))}
                    </Stack>
                </Box>
            )}

            {/* Results */}
            {hasSearched && (
                isLoading ? (
                    <Stack spacing={1.5}>
                        {[1, 2].map(i => (
                            <Paper key={i} elevation={0} sx={{ p: 2, borderRadius: 3, border: '1px solid #eee', display: 'flex', gap: 2 }}>
                                <Skeleton variant="rounded" width={56} height={56} sx={{ borderRadius: 2 }} />
                                <Box sx={{ flex: 1 }}>
                                    <Skeleton variant="text" width="50%" />
                                    <Skeleton variant="text" width="70%" />
                                </Box>
                            </Paper>
                        ))}
                    </Stack>
                ) : (
                    <Stack spacing={1.5}>
                        <Typography variant="caption" color="text.disabled" fontWeight={700} letterSpacing={0.5}>
                            {filteredCows.length} RESULT{filteredCows.length !== 1 ? 'S' : ''}
                        </Typography>
                        {filteredCows.length === 0 ? (
                            <Box sx={{ textAlign: 'center', py: 6 }}>
                                <Box sx={{ width: 64, height: 64, borderRadius: '50%', bgcolor: '#F5F5F5', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
                                    <Search sx={{ fontSize: 32, color: '#BDBDBD' }} />
                                </Box>
                                <Typography variant="body1" fontWeight={700} color="text.secondary">No cattle matched</Typography>
                                <Typography variant="caption" color="text.disabled">Try the Tag Number, Name, or use AI Scan</Typography>
                            </Box>
                        ) : (
                            filteredCows.map((cow: CowListSummary) => (
                                <Paper
                                    key={cow._id} elevation={0}
                                    onClick={() => navigate(isAdmin ? `/cattle/${cow._id}` : `/profile/${cow._id}`)}
                                    sx={{
                                        p: 1.5, borderRadius: 3, border: '1px solid #F0F0F0',
                                        display: 'flex', alignItems: 'center', gap: 1.5,
                                        cursor: 'pointer', transition: 'all 0.18s',
                                        '&:active': { bgcolor: '#F5F5F5', transform: 'scale(0.98)' }
                                    }}
                                >
                                    <Avatar
                                        src={getImageUrl(cow.photos?.faceProfile) || getImageUrl(cow.photos?.muzzle) || ''}
                                        variant="rounded"
                                        sx={{ width: 56, height: 56, borderRadius: 2, bgcolor: '#E8F5E9' }}
                                    />
                                    <Box sx={{ flex: 1, minWidth: 0 }}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.4, gap: 1 }}>
                                            <Typography variant="subtitle2" fontWeight={800} noWrap sx={{ minWidth: 0, flex: 1 }}>
                                                {cow.name ? cow.name : <Typography component="span" sx={{ fontStyle: 'italic', color: 'text.disabled', fontSize: 'inherit', fontWeight: 'inherit' }}>Unnamed</Typography>}
                                            </Typography>
                                            <Chip label={cow.currentStatus} size="small" color={getStatusColor(cow.currentStatus)}
                                                sx={{ minHeight: 18, height: 'auto', fontSize: '0.65rem', fontWeight: 700, flexShrink: 0 }} />
                                        </Box>
                                        <Stack direction="row" spacing={0.8} alignItems="center">
                                            <Tag sx={{ fontSize: 12, color: 'text.disabled' }} />
                                            <Typography variant="caption" color={cow.tagNumber ? 'text.secondary' : 'text.disabled'} fontWeight={cow.tagNumber ? 600 : 400} fontStyle={cow.tagNumber ? 'normal' : 'italic'}>
                                                {cow.tagNumber || 'N/A'}
                                            </Typography>
                                            <Typography variant="caption" color="text.disabled">·</Typography>
                                            <Typography variant="caption" color={cow.breed ? "text.secondary" : "text.disabled"} fontStyle={cow.breed ? 'normal' : 'italic'}>
                                                {cow.breed || 'Breed N/A'}
                                            </Typography>
                                        </Stack>
                                    </Box>
                                    <ArrowForwardIos sx={{ fontSize: 12, color: '#BDBDBD', flexShrink: 0 }} />
                                </Paper>
                            ))
                        )}
                    </Stack>
                )
            )}

            {/* Empty state */}
            {!hasSearched && history.length === 0 && (
                <Box sx={{ textAlign: 'center', py: 5 }}>
                    <Box sx={{ width: 64, height: 64, borderRadius: '50%', bgcolor: '#E8F5E9', display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 2 }}>
                        <Tag sx={{ fontSize: 30, color: '#2E7D32' }} />
                    </Box>
                    <Typography variant="body1" fontWeight={700} color="text.secondary">Search by ID</Typography>
                    <Typography variant="caption" color="text.disabled">Enter a tag number, name, or breed above</Typography>
                </Box>
            )}
        </Box>
    );
};

// ── Main ──────────────────────────────────────────────────────────────────────
const SearchCow: React.FC<{ isAdmin?: boolean }> = ({ isAdmin }) => {
    const [tab, setTab] = useState<'scan' | 'id'>('scan');

    const { startProcessing, stopProcessing } = useProcessing();

    // Explicitly show blocking overlay while models load
    useEffect(() => {
        let isMounted = true;

        const loadModels = async () => {
            startProcessing(
                'Initializing AI...',
                'Warming up Neural Engines...',
                true,
                'Please be patient. This one-time process may take about 2-3 minutes to securely compile the advanced AI models onto your device.'
            );
            try {
                await Promise.all([
                    preloadMuzzleModel(),
                    preloadNimaModel()
                ]);
            } catch (e) {
                console.error("Failed to preload models", e);
            } finally {
                if (isMounted) stopProcessing();
            }
        };

        // Wait 100ms for UI to render first
        const timer = setTimeout(loadModels, 100);

        return () => {
            isMounted = false;
            clearTimeout(timer);
            disposeModels();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <Container maxWidth="sm" sx={{ pt: 2, pb: 12 }}>

            {/* Page header */}
            <Typography variant="h5" fontWeight={800} color="text.primary" sx={{ mb: 2 }}>
                Find Any Cattle
            </Typography>

            {/* Pill switcher */}
            <Paper elevation={0} sx={{ display: 'flex', p: 0.5, bgcolor: '#F3F4F6', borderRadius: 3, mb: 2, gap: 0.5 }}>
                {([
                    { key: 'scan', label: 'AI Scan', icon: <Fingerprint sx={{ fontSize: 18 }} /> },
                    { key: 'id', label: 'Search ID', icon: <Search sx={{ fontSize: 18 }} /> }
                ] as { key: 'scan' | 'id'; label: string; icon: React.ReactNode }[]).map(({ key, label, icon }) => (
                    <Button
                        key={key}
                        onClick={() => setTab(key)}
                        startIcon={icon}
                        sx={{
                            flex: 1, borderRadius: 2.5, textTransform: 'none', fontWeight: 700,
                            py: 1, fontSize: '0.875rem', minHeight: 42,
                            bgcolor: tab === key ? 'white' : 'transparent',
                            color: tab === key ? 'primary.main' : 'text.secondary',
                            boxShadow: tab === key ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
                            transition: 'all 0.25s ease',
                            '&:hover': { bgcolor: tab === key ? 'white' : 'rgba(0,0,0,0.04)' }
                        }}
                    >
                        {label}
                    </Button>
                ))}
            </Paper>

            {tab === 'scan' ? <ScanTab isAdmin={isAdmin} /> : <SearchTab isAdmin={isAdmin} />}
        </Container>
    );
};

export default SearchCow;
