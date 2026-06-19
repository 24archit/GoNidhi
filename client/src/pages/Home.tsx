import React, { useState, useEffect } from 'react';
import { Box, Typography, Button, Stack, Alert, AlertTitle, Collapse, CircularProgress, Paper, Avatar, Chip } from '@mui/material';
import PetsIcon from '@mui/icons-material/Pets';
import FavoriteIcon from '@mui/icons-material/Favorite';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import ArrowForwardIos from '@mui/icons-material/ArrowForwardIos';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import PullToRefresh from 'react-simple-pull-to-refresh';
import { getMyCattleAPI } from '../apis/apis';
import { Preferences } from '@capacitor/preferences';
import { getImageUrl } from '@gonidhi/shared';

// Importing your existing dashboard components
import StatCard from '../components/dashboard/StatCard';
import ActionGrid from '../components/dashboard/ActionGrid';

interface CowSummary {
    _id: string;
    name: string;
    breed: string;
    currentStatus: string;
    isSick: boolean;
    isDispute?: boolean;
    species?: string;
    sex?: string;
    tagNumber?: string;
    ageYears?: number;
    ageMonths?: number;
    photos?: { faceProfile?: string; muzzle?: string };
}

const getStatusColor = (status: string) => {
    switch (status) {
        case 'Sick': return 'error';
        case 'Pregnant': return 'warning';
        case 'Heifer': return 'info';
        case 'Dry': return 'default';
        default: return 'success';
    }
};


// Cache the name in memory so it doesn't flicker during asynchronous fetching on tab switches
let cachedFarmerName = '';

const Home: React.FC = () => {
    const navigate = useNavigate();

    // Initialize with cached value so there is no flicker
    const [farmerName, setFarmerName] = useState<string>(cachedFarmerName);

    const { data: cowsResponse, isLoading, refetch, isError } = useQuery({
        queryKey: ['cows'],
        queryFn: getMyCattleAPI,
        retry: 1,
    });

    const handleRefresh = async () => {
        await refetch();
    };

    const cows = cowsResponse?.data || [];
    const isOffline = cowsResponse?.isOffline || false;
    const stats = cowsResponse?.stats || { totalNonDisputed: 0, totalPregnant: 0, totalDisputed: 0 };

    // Filter out disputed cows for the top 2 recent list display
    const nonDisputedCows = cows.filter((c: CowSummary) => !c.isDispute);

    useEffect(() => {
        const fetchUserData = async () => {
            try {
                // Load user name
                const { value: userDataStr } = await Preferences.get({ key: 'user_data' });
                if (userDataStr) {
                    try {
                        const userData = JSON.parse(userDataStr);
                        if (userData?.name && userData.name !== cachedFarmerName) {
                            cachedFarmerName = userData.name;
                            setFarmerName(userData.name);
                        }
                    } catch (e) {
                        console.error("Failed to parse user data", e);
                    }
                }
            } catch (err) {
                console.error("Failed to load user data", err);
            }
        };
        fetchUserData();
    }, []);

    if (isLoading) {
        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', height: '80vh', alignItems: 'center', justifyContent: 'center', px: 3 }}>
                <CircularProgress size={48} sx={{ color: 'primary.main', mb: 3 }} />
                <Typography variant="h6" color="text.primary" sx={{ fontWeight: 'bold', mb: 1 }}>Connecting to Server...</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', maxWidth: '300px' }}>
                    If the server was asleep, this may take up to 50 seconds to boot up. Please do not close the app!
                </Typography>
            </Box>
        );
    }

    return (
        <PullToRefresh onRefresh={handleRefresh} pullingContent=""
            maxPullDownDistance={100} resistance={2} backgroundColor="#F4F7F4">
            <Box sx={{ p: 2, minHeight: 'calc(100vh - 80px)' }}>
                {/* 0. Offline Alert */}
                <Collapse in={isOffline || isError}>
                    <Alert 
                        severity="warning" 
                        icon={<WifiOffIcon />}
                        sx={{ mb: 2, borderRadius: '12px' }}
                    >
                        <AlertTitle sx={{ fontWeight: 'bold' }}>Offline Mode</AlertTitle>
                        Showing last fetched information. You can still register cattle; they will be synced later.
                    </Alert>
                </Collapse>

                {/* 1. Greeting Section */}
                <Box sx={{ mb: 3 }}>
                    <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                        Welcome{farmerName ? `, ${farmerName}` : ''} !
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        Here is your herd overview.
                    </Typography>
                </Box>

                {/* 2. Statistics Overview */}
                <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                    <Box sx={{ flex: 1 }}>
                        <Box onClick={() => navigate('/my-cows')} sx={{ cursor: 'pointer', height: '100%', transition: '0.2s', '&:active': { transform: 'scale(0.98)' } }}>
                            <StatCard label="Total Cattle" value={stats.totalNonDisputed} icon={PetsIcon} color="text.primary" />
                        </Box>
                    </Box>
                    <Box sx={{ flex: 1 }}>
                        <StatCard label="Pregnant" value={stats.totalPregnant} icon={FavoriteIcon} color="warning.main" />
                    </Box>
                </Stack>

                <Stack direction="row" spacing={2} sx={{ mb: 4 }}>
                    <Box sx={{ flex: 1 }}>
                        <Box onClick={() => navigate('/disputes')} sx={{ cursor: 'pointer', height: '100%', transition: '0.2s', '&:active': { transform: 'scale(0.98)' } }}>
                            <StatCard 
                                label="Disputed" 
                                value={stats.totalDisputed} 
                                icon={PetsIcon} 
                                color="error.main" 
                            />
                        </Box>
                    </Box>
                    <Box sx={{ flex: 1 }} />
                </Stack>

                {/* 3. Quick Actions */}
                <ActionGrid />

                {/* 4. Dynamic Herd List (Zero-State vs Populated) */}
                <Box sx={{ mb: 2 }}>
                    <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>
                        Your Herd
                    </Typography>

                    {nonDisputedCows.length === 0 ? (
                        /* ZERO-STATE UI: Shown when there are no cows */
                        <Box sx={{
                            textAlign: 'center',
                            py: 6,
                            px: 2,
                            bgcolor: 'background.paper',
                            borderRadius: '12px',
                            boxShadow: '0px 4px 12px rgba(0,0,0,0.05)',
                            border: '1px dashed',
                            borderColor: 'grey.300'
                        }}>
                            <PetsIcon sx={{ fontSize: 60, color: 'grey.400', mb: 2 }} />
                            <Typography variant="h6" color="text.secondary" sx={{ fontWeight: 'bold', mb: 1 }}>
                                Welcome!
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 3, px: 2 }}>
                                You have 0 registered cows. Tap the '+' button to add your first animal.
                            </Typography>
                            <Button
                                variant="contained"
                                color="primary"
                                onClick={() => navigate('/add-cow')}
                                sx={{ borderRadius: '12px', px: 4, py: 1.5, fontWeight: 'bold' }}
                            >
                                + Register Cattle
                            </Button>
                        </Box>
                    ) : (
                        /* POPULATED STATE UI: Shown when cows exist */
                        <Box>
                            {nonDisputedCows.slice(0, 2).map((cow: CowSummary) => (
                                <Paper
                                    key={cow._id}
                                    elevation={0}
                                    onClick={() => navigate(`/profile/${cow._id}`)}
                                    sx={{
                                        p: 2, borderRadius: 3, border: '1px solid #eee',
                                        display: 'flex', alignItems: 'center', gap: 2,
                                        cursor: 'pointer', mb: 2,
                                        transition: 'all 0.2s ease',
                                        '&:active': { bgcolor: '#f5f5f5', transform: 'scale(0.98)' }
                                    }}
                                >
                                    <Avatar src={getImageUrl(cow.photos?.faceProfile) || getImageUrl(cow.photos?.muzzle) || 'https://placehold.co/100'} variant="rounded" sx={{ width: 64, height: 64, borderRadius: 3 }} />

                                    <Box sx={{ flexGrow: 1 }}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.5, gap: 1 }}>
                                            <Typography variant="subtitle1" fontWeight="bold" noWrap sx={{ flex: 1, minWidth: 0 }}>
                                                {cow.name ? cow.name : <Typography component="span" sx={{ fontStyle: 'italic', color: 'text.disabled', fontSize: 'inherit', fontWeight: 'inherit' }}>Unnamed</Typography>}
                                            </Typography>
                                            <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0, flexWrap: 'wrap', gap: 0.5, justifyContent: 'flex-end' }}>
                                                <Chip label={cow.species || 'Species N/A'} size="small" color={cow.species ? "primary" : "default"} sx={{ minHeight: 20, fontSize: '0.65rem', height: 'auto', opacity: cow.species ? 1 : 0.6 }} />
                                                <Chip label={cow.sex || 'Sex N/A'} size="small" color={cow.sex ? "secondary" : "default"} sx={{ minHeight: 20, fontSize: '0.65rem', height: 'auto', opacity: cow.sex ? 1 : 0.6 }} />
                                                {cow.sex === 'Female' && cow.currentStatus && (
                                                    <Chip
                                                        label={cow.currentStatus}
                                                        size="small"
                                                        color={getStatusColor(cow.currentStatus) as any}
                                                        sx={{ minHeight: 20, height: 'auto', fontSize: '0.65rem', fontWeight: 600 }}
                                                    />
                                                )}
                                            </Stack>
                                        </Box>

                                        <Stack direction="row" spacing={1} alignItems="center">
                                            <Typography variant="caption" sx={{ bgcolor: 'grey.100', px: 0.8, py: 0.2, borderRadius: 1, color: cow.tagNumber ? 'text.primary' : 'text.disabled', fontStyle: cow.tagNumber ? 'normal' : 'italic' }}>
                                                #{cow.tagNumber || 'N/A'}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {cow.breed || <span style={{ fontStyle: 'italic', opacity: 0.6 }}>Breed N/A</span>} • {(cow.ageYears || cow.ageMonths) ? `${cow.ageYears ? `${cow.ageYears}y ` : ''}${cow.ageMonths ? `${cow.ageMonths}m` : ''}` : <span style={{ fontStyle: 'italic', opacity: 0.6 }}>Age N/A</span>}
                                            </Typography>
                                        </Stack>
                                    </Box>

                                    <ArrowForwardIos fontSize="small" sx={{ color: '#ccc', fontSize: 14 }} />
                                </Paper>
                            ))}

                            <Button
                                fullWidth
                                variant="outlined"
                                onClick={() => navigate('/my-cows')}
                                sx={{ mt: 2, borderRadius: '12px' }}
                            >
                                View All Cattle
                            </Button>
                        </Box>
                    )}
                </Box>
            </Box>
        </PullToRefresh>
    );
};

export default Home;