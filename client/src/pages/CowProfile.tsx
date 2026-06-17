import React, { useState, useEffect } from 'react';
import {
    Container, Box, Typography, Paper, Chip, Stack, IconButton,
    List, ListItem, ListItemAvatar, Avatar, ListItemText, Tabs, Tab, Divider, Button, Dialog
} from '@mui/material';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import {
    ArrowBack, WaterDrop,
    PhotoLibrary, Info, QrCodeScanner, Cake, Scale,
    Female, Male, Person, LocalOffer,
    MonitorWeight
} from '@mui/icons-material';

interface CowProfileData {
    _id?: string;
    name?: string;
    breed?: string;
    tagNumber?: string;
    species?: string;
    sex?: string;
    dob?: string;
    ageMonths?: number;
    source?: string;
    sireTag?: string;
    damTag?: string;
    currentStatus?: string;
    isDispute?: boolean;
    lastWeight?: number;
    photos?: {
        faceProfile?: string;
        muzzle?: string;
        leftProfile?: string;
        rightProfile?: string;
        backView?: string;
        tailView?: string;
        selfie?: string;
    };
    healthStats?: {
        birthWeight?: number;
        motherWeightAtCalving?: number;
        growthStatus?: string;
        bodyConditionScore?: number;
    };
}
import { useNavigate, useParams } from 'react-router-dom';
import { getCowProfileAPI } from '../apis/apis';
import { getImageUrl } from '@gonidhi/shared';
import { CircularProgress } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import PullToRefresh from 'react-simple-pull-to-refresh';

const CowProfile: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [tabValue, setTabValue] = useState(0);
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

    const { data: cowDataResponse, isLoading, error, refetch } = useQuery({
        queryKey: ['cowProfile', id],
        queryFn: () => getCowProfileAPI(id as string),
        enabled: !!id,
        staleTime: Infinity,
    });

    const cowData = cowDataResponse?.data as CowProfileData | undefined;

    const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
        setTabValue(newValue);
    };

    if (isLoading) {
        return (
            <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', px: 3 }}>
                <CircularProgress size={48} sx={{ color: 'primary.main', mb: 3 }} />
                <Typography variant="h6" color="text.primary" sx={{ fontWeight: 'bold', mb: 1 }}>Loading Profile...</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', maxWidth: '300px' }}>
                    Server may be booting up, please hold on and do not close the app!
                </Typography>
            </Box>
        );
    }

    if (error || !cowData) {
        return (
            <Box sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="error" gutterBottom>{error instanceof Error ? error.message : 'Cow not found'}</Typography>
                <Button onClick={() => navigate(-1)} variant="outlined">Go Back</Button>
            </Box>
        );
    }

    const handleRefresh = async () => {
        await refetch();
    };

    return (
        <PullToRefresh onRefresh={handleRefresh} pullingContent="" maxPullDownDistance={100} resistance={2} backgroundColor="#F4F7F4">
            <Container maxWidth="sm" sx={{ p: 0, pb: 10 }}>
                {/* 1. HERO IMAGE HEADER */}
                <Box sx={{ position: 'relative', height: 240, bgcolor: '#eee' }}>
                    <IconButton
                        onClick={() => navigate(-1)}
                        sx={{ position: 'absolute', top: 'calc(max(16px, env(safe-area-inset-top)) + 16px)', left: 16, bgcolor: 'white', '&:hover': { bgcolor: 'white' }, zIndex: 20 }}
                    >
                        <ArrowBack />
                    </IconButton>
                    <img
                        src={getImageUrl(cowData?.photos?.muzzle) || "https://placehold.co/600x400"}
                        alt="Cow"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                    <Box sx={{
                        position: 'absolute', bottom: 0, left: 0, right: 0,
                        background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)',
                        p: 3, pt: 8, color: 'white'
                    }}>
                        <Typography variant="h4" fontWeight={800}>{cowData?.name}</Typography>
                        <Typography variant="body2" sx={{ opacity: 0.9 }}>Tag #{cowData?.tagNumber} • {cowData?.breed}</Typography>
                    </Box>
                </Box>

                {/* 2. MAIN CONTENT CONTAINER */}
                <Container sx={{ mt: -3, position: 'relative', zIndex: 10 }}>
                    <Paper elevation={3} sx={{ borderRadius: 3, overflow: 'hidden', mb: 3 }}>
                        {/* TABS HEADER */}
                        <Box sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'white' }}>
                            <Tabs value={tabValue} onChange={handleTabChange} variant="fullWidth" indicatorColor="primary">
                                <Tab icon={<Info />} iconPosition="start" label="Data" />
                                <Tab icon={<PhotoLibrary />} iconPosition="start" label="Gallery" />
                            </Tabs>
                        </Box>

                        {/* TAB PANEL 1: GALLERY */}
                        {tabValue === 1 && (
                            <Box sx={{ p: 2 }}>
                                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
                                    REQUIRED REGISTRATION PHOTOS
                                </Typography>
                                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2 }}>
                                    {[
                                        { label: 'Face Profile', key: 'faceProfile' as const },
                                        { label: 'Farmer Selfie', key: 'selfie' as const },
                                        { label: 'Muzzle (Nose)', key: 'muzzle' as const },
                                        { label: 'Left Profile', key: 'leftProfile' as const },
                                        { label: 'Right Profile', key: 'rightProfile' as const },
                                        { label: 'Back View', key: 'backView' as const },
                                        { label: 'Tail / Udders', key: 'tailView' as const }
                                    ].map(({ label, key }, index) => {
                                        const imageUrl = getImageUrl(cowData?.photos?.[key]) || `https://placehold.co/300x200?text=${label.split(' ')[0]}`;
                                        return (
                                            <Box key={index}>
                                                <Paper elevation={0}
                                                    onClick={() => openLightbox(imageUrl)}
                                                    sx={{
                                                        height: 120, bgcolor: '#f5f5f5', borderRadius: 2, overflow: 'hidden', position: 'relative',
                                                        border: '1px solid #eee', cursor: 'pointer'
                                                    }}>
                                                    <img
                                                        src={imageUrl}
                                                        alt={label}
                                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                                    />
                                                    <Typography variant="caption" sx={{
                                                        position: 'absolute', bottom: 0, left: 0, right: 0,
                                                        bgcolor: 'rgba(0,0,0,0.6)', color: 'white', p: 0.5, textAlign: 'center'
                                                    }}>
                                                        {label}
                                                    </Typography>
                                                </Paper>
                                            </Box>
                                        );
                                    })}
                                </Box>
                            </Box>
                        )}

                        {/* TAB PANEL 2: METADATA DETAILS */}
                        {tabValue === 0 && (
                            <Box sx={{ p: 2 }}>
                                {/* STATUS BADGES */}
                                <Stack direction="row" spacing={1} sx={{ mb: 3, flexWrap: 'wrap', gap: 1 }}>
                                    {cowData?.isDispute && (
                                        <Chip
                                            label="⚠️ DISPUTED OWNERSHIP"
                                            color="error"
                                            size="small"
                                            sx={{ fontWeight: 'bold', animation: 'pulse 1.5s infinite' }}
                                        />
                                    )}
                                    <Chip label={cowData?.currentStatus || 'Unknown'} color="success" size="small" icon={<WaterDrop />} />
                                    <Chip label={cowData?.healthStats?.growthStatus || 'Tracking'} variant="outlined" size="small" color="info" />
                                </Stack>

                                {/* SECTION 1: GENERAL / OWNER */}
                                <Typography variant="overline" color="text.secondary" fontWeight="bold">GENERAL & OWNER</Typography>
                                <List dense disablePadding sx={{ mb: 3, bgcolor: '#f9fafb', borderRadius: 2, p: 1 }}>
                                    <ListItem disableGutters>
                                        <ListItemAvatar><Avatar sx={{ width: 28, height: 28 }}><Person sx={{ fontSize: 18 }} /></Avatar></ListItemAvatar>
                                        <ListItemText primary="Owner Status" secondary="Verified Farmer" />
                                    </ListItem>
                                </List>

                                <Divider sx={{ mb: 2 }} />

                                {/* SECTION 2: ANIMAL DETAILS */}
                                <Typography variant="overline" color="text.secondary" fontWeight="bold">ANIMAL DETAILS</Typography>
                                <List dense>
                                    <ListItem disablePadding sx={{ mb: 1 }}>
                                        <ListItemAvatar><Avatar sx={{ bgcolor: 'primary.light', color: 'primary.main' }}><QrCodeScanner /></Avatar></ListItemAvatar>
                                        <ListItemText primary="Identity" secondary={`Tag: ${cowData?.tagNumber} | Source: ${cowData?.source}`} />
                                    </ListItem>
                                    <ListItem disablePadding sx={{ mb: 1 }}>
                                        <ListItemAvatar>
                                            <Avatar sx={{ bgcolor: 'info.light', color: 'info.main' }}>{cowData?.sex === 'Female' ? <Female /> : <Male />}</Avatar>
                                        </ListItemAvatar>
                                        <ListItemText primary="Species / Sex" secondary={`${cowData?.species} / ${cowData?.sex}`} />
                                    </ListItem>
                                    <ListItem disablePadding sx={{ mb: 1 }}>
                                        <ListItemAvatar><Avatar sx={{ bgcolor: 'warning.light', color: 'warning.main' }}><LocalOffer /></Avatar></ListItemAvatar>
                                        <ListItemText primary="Breed" secondary={cowData?.breed} />
                                    </ListItem>
                                    <ListItem disablePadding sx={{ mb: 1 }}>
                                        <ListItemAvatar><Avatar sx={{ bgcolor: 'secondary.light', color: 'secondary.main' }}><Cake /></Avatar></ListItemAvatar>
                                        <ListItemText primary="DOB & Age" secondary={`${cowData?.dob ? new Date(cowData.dob).toLocaleDateString() : 'Unknown'} (${cowData?.ageMonths ? `${cowData.ageMonths}m` : 'Unknown'})`} />
                                    </ListItem>
                                </List>

                                <Divider sx={{ mb: 2 }} />

                                {/* SECTION 3: LIFETIME & STATS */}
                                <Typography variant="overline" color="text.secondary" fontWeight="bold">LIFETIME & BODY STATS</Typography>
                                <List dense>
                                    <ListItem disablePadding sx={{ mb: 1 }}>
                                        <ListItemAvatar><Avatar sx={{ bgcolor: 'error.light', color: 'error.main' }}><SchemaIcon /></Avatar></ListItemAvatar>
                                        <ListItemText primary="Lineage (Sire / Dam)" secondary={`${cowData?.sireTag || 'N/A'} / ${cowData?.damTag || 'N/A'}`} />
                                    </ListItem>
                                    <ListItem disablePadding sx={{ mb: 1 }}>
                                        <ListItemAvatar><Avatar sx={{ bgcolor: 'grey.300', color: 'grey.800' }}><Scale /></Avatar></ListItemAvatar>
                                        <ListItemText
                                            primary="Birth Metrics"
                                            secondary={`Birth Wt: ${cowData?.healthStats?.birthWeight || '--'}kg | Mother's Wt: ${cowData?.healthStats?.motherWeightAtCalving || '--'}kg`}
                                        />
                                    </ListItem>
                                    <ListItem disablePadding sx={{ mb: 1 }}>
                                        <ListItemAvatar><Avatar sx={{ bgcolor: 'primary.light', color: 'primary.main' }}><MonitorWeight /></Avatar></ListItemAvatar>
                                        <ListItemText primary="Current Stats" secondary={`Weight: ${cowData?.lastWeight || '--'}kg | BCS: ${cowData?.healthStats?.bodyConditionScore || '--'}`} />
                                    </ListItem>
                                </List>

                            </Box>
                        )}
                    </Paper>
                </Container>

                {/* LIGHTBOX DIALOG */}
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

            </Container>
        </PullToRefresh>
    );
};

// Helper for Missing Icon
const SchemaIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="24px" height="24px"><path d="M0 0h24v24H0z" fill="none" /><path d="M14 17H4v2h10v-2zm6-8H4v2h16V9zM4 15h16v-2H4v2zM4 5v2h16V5H4z" /></svg>
);

export default CowProfile;