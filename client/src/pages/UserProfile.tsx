import React, { useState, useEffect, useRef } from 'react';
import {
    Container, Box, Typography, Avatar, Paper, List, ListItem, ListItemButton, ListItemIcon, ListItemText,
    Switch, Divider, Button, TextField, CircularProgress, Alert, MenuItem, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions
} from '@mui/material';
import {
    Person, Settings, Language, Help, Logout, ChevronRight, PhotoCamera, ArrowBack
} from '@mui/icons-material';
import { getUserProfileAPI, updateUserProfileAPI, getStatesAPI, getDistrictsAPI, getBlocksAPI, getVillagesAPI, logoutUserAPI } from '../apis/apis';
import { Preferences } from '@capacitor/preferences';
import { useNavigate } from 'react-router-dom';
import PullToRefresh from 'react-simple-pull-to-refresh';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

interface UserLocation {
    state?: string;
    district?: string;
    block?: string;
    village?: string;
    pincode?: string;
}

interface UserProfileData {
    name: string;
    role: string;
    contact?: { phone?: string };
    location?: UserLocation;
    profilePicture?: string;
}

const UserProfile: React.FC = () => {
    const navigate = useNavigate();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [odia, setOdia] = useState(false);

    const [error, setError] = useState<string | null>(null);
    const [editMode, setEditMode] = useState(false);
    const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [lightboxImage, setLightboxImage] = useState<string | null>(null);
    const [formData, setFormData] = useState<Record<string, unknown>>({});

    const [states, setStates] = useState<string[]>([]);
    const [districts, setDistricts] = useState<string[]>([]);
    const [blocks, setBlocks] = useState<string[]>([]);
    const [villages, setVillages] = useState<string[]>([]);

    const queryClient = useQueryClient();
    const { data: profileData, isLoading, refetch, error: fetchError, isError: isFetchError } = useQuery({
        queryKey: ['userProfile'],
        queryFn: getUserProfileAPI
    });

    const mutation = useMutation({
        mutationFn: updateUserProfileAPI,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['userProfile'] });
            setEditMode(false);
        },
        onError: (err: unknown) => {
            const errorMessage = err instanceof Error ? err.message : 'Failed to update profile';
            setError(errorMessage);
        }
    });

    const user = profileData?.user as UserProfileData | undefined;

    useEffect(() => {
        getStatesAPI().then(setStates).catch(console.error);
    }, []);

    const enterEditMode = () => {
        if (user) {
            setFormData({
                name: user.name,
                phone: user.contact?.phone || '',
                state: user.location?.state || 'Odisha',
                district: user.location?.district || '',
                block: user.location?.block || '',
                village: user.location?.village || '',
                pincode: user.location?.pincode || '',
                profilePicture: user.profilePicture || ''
            });
        }
        setEditMode(true);
    };

    const handleRefresh = async () => {
        await refetch();
    };

    // Location cascaded data fetching
    useEffect(() => {
        if (formData.state && editMode) {
            getDistrictsAPI(formData.state as string).then(setDistricts).catch(console.error);
        }
    }, [formData.state, editMode]);

    useEffect(() => {
        if (formData.district && editMode) {
            getBlocksAPI(formData.district as string).then(setBlocks).catch(console.error);
        }
    }, [formData.district, editMode]);

    useEffect(() => {
        if (formData.block && editMode) {
            getVillagesAPI(formData.block as string).then(setVillages).catch(console.error);
        }
    }, [formData.block, editMode]);

    // Handle unsaved changes warning for back button and clicking away
    useEffect(() => {
        (window as unknown as { isProfileEditing?: boolean }).isProfileEditing = editMode;

        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (editMode) {
                e.preventDefault();
                e.returnValue = ''; // Required for most browsers to show the native prompt
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            (window as unknown as { isProfileEditing?: boolean }).isProfileEditing = false;
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, [editMode]);

    // Handle react-router navigation blocks
    useEffect(() => {
        // This relies on standard popstate for back button
        const handlePopState = () => {
            if (lightboxOpen) {
                setLightboxOpen(false);
                setLightboxImage(null);
                return;
            }
            if (editMode) {
                const confirmLeave = window.confirm("You have unsaved changes. Are you sure you want to leave?");
                if (!confirmLeave) {
                    // Push state back to stay on page
                    window.history.pushState(null, '', window.location.pathname);
                } else {
                    setEditMode(false);
                }
            }
        };

        window.addEventListener('popstate', handlePopState);

        // As a preventive measure, immediately push state when entering edit mode
        // so that the first "back" triggers our popstate listener without actually leaving
        if (editMode) {
            window.history.pushState(null, '', window.location.pathname);
        }

        return () => {
            window.removeEventListener('popstate', handlePopState);
        };
    }, [editMode, lightboxOpen]);

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

    const handleLogout = () => {
        setLogoutDialogOpen(true);
    };

    const confirmLogout = async () => {
        setLogoutDialogOpen(false);
        try {
            await logoutUserAPI();
        } catch (error) {
            console.error('Logout API failed, proceeding with local clear', error);
        }
        // Remove only auth-related prefs to preserve onboarding state
        await Preferences.remove({ key: 'jwt_token' });
        await Preferences.remove({ key: 'user_data' });

        // Clear React Query cache so data doesn't bleed into next login
        queryClient.clear();

        window.dispatchEvent(new Event('auth-change'));
        navigate('/login');
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData((prev: Record<string, unknown>) => {
            const newData = { ...prev, [name]: value };
            if (name === 'state') {
                newData.district = ''; newData.block = ''; newData.village = '';
                setDistricts([]); setBlocks([]); setVillages([]);
            } else if (name === 'district') {
                newData.block = ''; newData.village = '';
                setBlocks([]); setVillages([]);
            } else if (name === 'block') {
                newData.village = '';
                setVillages([]);
            }
            return newData;
        });
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                setFormData((prev: Record<string, unknown>) => ({ ...prev, profilePicture: reader.result }));
            }
        };
        reader.readAsDataURL(file);
    };

    const handleSave = () => {
        setError(null);
        mutation.mutate(formData as Record<string, unknown>);
    };

    if (isLoading) {
        return (
            <Container sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
                <CircularProgress />
            </Container>
        );
    }

    const displayError = error || (isFetchError ? (fetchError as Error).message : null);

    if (displayError && !user) {
        return (
            <Container sx={{ pt: 4 }}>
                <Alert severity="error">{displayError}</Alert>
                <Button sx={{ mt: 2 }} variant="outlined" onClick={() => refetch()}>Retry</Button>
            </Container>
        );
    }

    return (
        <PullToRefresh onRefresh={handleRefresh} pullingContent="" maxPullDownDistance={100} resistance={2} backgroundColor="#F4F7F4">
            <Container maxWidth="sm" sx={{ pt: 2, pb: 'calc(env(safe-area-inset-bottom) + 96px)', minHeight: 'calc(100vh - 80px)' }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
                    <Typography variant="h5" fontWeight={800}>
                        My Profile
                    </Typography>
                </Box>

                {displayError && <Alert severity="error" sx={{ mb: 2 }}>{displayError}</Alert>}

                {/* Profile Header Card */}
                <Paper elevation={0} sx={{ p: 3, mb: 3, borderRadius: 2, border: '1px solid #eee' }}>
                    <Box display="flex" alignItems="center" gap={2}>
                        <Box position="relative">
                            <Avatar 
                                src={(formData.profilePicture as string) || (user?.profilePicture as string) || ''} 
                                onClick={() => {
                                    const imgSrc = (formData.profilePicture as string) || (user?.profilePicture as string);
                                    if (imgSrc) {
                                        openLightbox(imgSrc);
                                    }
                                }}
                                sx={{ 
                                    width: 80, height: 80, 
                                    border: '3px solid white', 
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                    cursor: ((formData.profilePicture as string) || (user?.profilePicture as string)) ? 'pointer' : 'default'
                                }}
                            >
                                {!formData.profilePicture && !user?.profilePicture && <Person fontSize="large" />}
                            </Avatar>
                            {editMode && (
                                <Box sx={{ position: 'absolute', bottom: -5, right: -5, bgcolor: 'primary.main', borderRadius: '50%', p: 0.5 }}>
                                    <IconButton color="inherit" onClick={() => fileInputRef.current?.click()} sx={{ p: 0.5 }}>
                                        <PhotoCamera sx={{ color: 'white', fontSize: 16 }} />
                                    </IconButton>
                                </Box>
                            )}
                            <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleImageUpload} />
                        </Box>

                        <Box sx={{ flexGrow: 1 }}>
                            {!editMode ? (
                                <>
                                    <Typography variant="h6" fontWeight="bold">{user?.name as string}</Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : ''} • {user?.location?.village ? `${user.location.village}, ${user.location.district}` : 'Location hidden'}
                                    </Typography>
                                    <Typography variant="caption" color="primary" fontWeight="bold">
                                        {user?.contact?.phone as string}
                                    </Typography>
                                </>
                            ) : (
                                <Box display="flex" flexDirection="column" gap={1}>
                                    <TextField size="small" label="Name" name="name" value={formData.name} onChange={handleChange} fullWidth />
                                    <TextField size="small" label="Phone" name="phone" value={formData.phone} onChange={handleChange} fullWidth disabled />
                                </Box>
                            )}
                        </Box>
                    </Box>

                    {editMode && (
                        <Box mt={3} display="flex" flexDirection="column" gap={2}>
                            <Typography variant="subtitle2" color="text.secondary">Location Details</Typography>
                            <TextField select size="small" label="State" name="state" value={formData.state} onChange={handleChange} fullWidth>
                                {states.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                            </TextField>
                            <TextField select size="small" label="District" name="district" value={formData.district} onChange={handleChange} fullWidth disabled={!formData.state || districts.length === 0}>
                                {districts.map(d => <MenuItem key={d} value={d}>{d}</MenuItem>)}
                            </TextField>
                            <TextField select size="small" label="Block" name="block" value={formData.block} onChange={handleChange} fullWidth disabled={!formData.district || blocks.length === 0}>
                                {blocks.map(b => <MenuItem key={b} value={b}>{b}</MenuItem>)}
                            </TextField>
                            <TextField select size="small" label="Village" name="village" value={formData.village} onChange={handleChange} fullWidth disabled={!formData.block || villages.length === 0}>
                                {villages.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                            </TextField>
                        </Box>
                    )}
                </Paper>

                {editMode && (
                    <Box mt={2} mb={4} display="flex" gap={2} justifyContent="flex-end">
                        <Button
                            variant="outlined"
                            color="error"
                            size="small"
                            onClick={() => {
                                setEditMode(false);
                                if (user) {
                                    setFormData({
                                        name: user.name,
                                        phone: user.contact?.phone || '',
                                        state: user.location?.state || 'Odisha',
                                        district: user.location?.district || '',
                                        block: user.location?.block || '',
                                        village: user.location?.village || '',
                                        pincode: user.location?.pincode || '',
                                        profilePicture: user.profilePicture || ''
                                    });
                                }
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="contained"
                            color="success"
                            size="small"
                            onClick={handleSave}
                            disabled={mutation.isPending}
                        >
                            {mutation.isPending ? <CircularProgress size={20} color="inherit" /> : 'Save Changes'}
                        </Button>
                    </Box>
                )}

                {!editMode && (
                    <>
                        <Button
                            variant="contained"
                            fullWidth
                            sx={{ mb: 3, borderRadius: 2, fontWeight: 'bold' }}
                            onClick={enterEditMode}
                        >
                            Edit Profile
                        </Button>

                        {/* Settings Sections */}
                        <Typography variant="overline" color="text.secondary" fontWeight="bold" sx={{ ml: 1 }}>
                            PREFERENCES
                        </Typography>
                        <Paper elevation={0} sx={{ borderRadius: 2, overflow: 'hidden', mb: 3, border: '1px solid #eee' }}>
                            <List disablePadding>
                                <ListItemButton onClick={enterEditMode}>
                                    <ListItemIcon><Person color="action" /></ListItemIcon>
                                    <ListItemText primary="Account Settings" secondary="Edit profile details" />
                                    <ChevronRight fontSize="small" color="disabled" />
                                </ListItemButton>
                                <Divider variant="inset" component="li" />
                                <ListItem>
                                    <ListItemIcon><Language color="action" /></ListItemIcon>
                                    <ListItemText primary="App Language" secondary={odia ? "Odia (ଓଡ଼ିଆ)" : "English"} />
                                    <Switch
                                        edge="end"
                                        checked={odia}
                                        onChange={(e) => setOdia(e.target.checked)}
                                        color="primary"
                                    />
                                </ListItem>
                            </List>
                        </Paper>

                        <Typography variant="overline" color="text.secondary" fontWeight="bold" sx={{ ml: 1 }}>
                            SUPPORT
                        </Typography>
                        <Paper elevation={0} sx={{ borderRadius: 2, overflow: 'hidden', mb: 4, border: '1px solid #eee' }}>
                            <List disablePadding>
                                <ListItemButton>
                                    <ListItemIcon><Help color="action" /></ListItemIcon>
                                    <ListItemText primary="Help & Support" secondary="FAQs, Contact Us" />
                                    <ChevronRight fontSize="small" color="disabled" />
                                </ListItemButton>
                                <Divider variant="inset" component="li" />
                                <ListItemButton>
                                    <ListItemIcon><Settings color="action" /></ListItemIcon>
                                    <ListItemText primary="App Version" secondary="v1.0.2 (Beta)" />
                                </ListItemButton>
                            </List>
                        </Paper>

                        {/* Logout Button */}
                        <Button
                            variant="outlined"
                            color="error"
                            fullWidth
                            startIcon={<Logout />}
                            onClick={handleLogout}
                            sx={{ borderRadius: 2, py: 1.5, textTransform: 'none', fontWeight: 600 }}
                        >
                            Log Out
                        </Button>
                    </>
                )}

                <Typography variant="caption" display="block" textAlign="center" color="text.disabled" sx={{ mt: 4 }}>
                    Ama Gaudhana © 2026 Odisha Govt.
                </Typography>

                {/* Logout Confirmation Dialog */}
                <Dialog
                    open={logoutDialogOpen}
                    onClose={() => setLogoutDialogOpen(false)}
                    PaperProps={{
                        sx: { borderRadius: 3, p: 1 }
                    }}
                >
                    <DialogTitle fontWeight="bold">Log Out</DialogTitle>
                    <DialogContent>
                        <DialogContentText>
                            Are you sure you want to log out of your account? You will need to login again to access your herd and profile.
                        </DialogContentText>
                    </DialogContent>
                    <DialogActions sx={{ px: 3, pb: 2 }}>
                        <Button onClick={() => setLogoutDialogOpen(false)} color="inherit" sx={{ fontWeight: 'bold' }}>
                            Cancel
                        </Button>
                        <Button onClick={confirmLogout} variant="contained" color="error" sx={{ fontWeight: 'bold', borderRadius: 2 }}>
                            Log Out
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
                                    alt="Profile Zoomed"
                                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                                />
                            </TransformComponent>
                        </TransformWrapper>
                    )}
                </Dialog>
            </Container>
        </PullToRefresh>
    );
};

export default UserProfile;

// Helper component for IconButton since it was used in code but not imported from MUI
function IconButton({ children, color, onClick, disabled, sx }: { children: React.ReactNode, color?: "inherit" | "primary" | "secondary" | "error" | "info" | "success" | "warning", onClick?: () => void, disabled?: boolean, sx?: Record<string, unknown> }) {
    return (
        <Button sx={{ minWidth: 'auto', p: 1, borderRadius: '50%', ...sx }} color={color} onClick={onClick} disabled={disabled}>
            {children}
        </Button>
    );
}
