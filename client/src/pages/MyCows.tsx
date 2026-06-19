import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    Container, Box, TextField, InputAdornment, IconButton, Typography,
    Paper, Avatar, Chip, Stack, Button, CircularProgress
} from '@mui/material';
import {
    Search, FilterList, ArrowForwardIos, Add
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import PullToRefresh from 'react-simple-pull-to-refresh';
import { getMyCattleAPI } from '../apis/apis';
import { getImageUrl } from '@gonidhi/shared';

interface CowListSummary {
    _id: string;
    name: string;
    tagNumber: string;
    breed: string;
    species?: string;
    sex?: string;
    currentStatus: string;
    ageYears?: number;
    ageMonths?: number;
    photos?: { faceProfile?: string, muzzle?: string };
    isDispute?: boolean;
}

const MyCows: React.FC = () => {
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');

    // Debounce search input
    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedSearch(searchTerm);
        }, 500);
        return () => clearTimeout(handler);
    }, [searchTerm]);

    const {
        data: cowsResponse,
        isLoading,
        isFetchingNextPage,
        hasNextPage,
        fetchNextPage,
        refetch
    } = useInfiniteQuery({
        queryKey: ['cows', debouncedSearch],
        queryFn: ({ pageParam = 1 }) => getMyCattleAPI({ pageParam, search: debouncedSearch }),
        initialPageParam: 1,
        getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.currentPage + 1 : undefined,
    });

    const handleRefresh = async () => {
        await refetch();
    };

    // Flatten pages into a single array
    const cows: CowListSummary[] = cowsResponse?.pages.flatMap(page => page.data) || [];

    // Only show successful registrations that are not disputed
    const nonDisputedCows = cows.filter((cow) => !cow.isDispute);

    // Infinite scroll observer
    const observer = useRef<IntersectionObserver | null>(null);
    const lastCowElementRef = useCallback((node: HTMLDivElement | null) => {
        if (isLoading || isFetchingNextPage) return;
        if (observer.current) observer.current.disconnect();
        observer.current = new IntersectionObserver(entries => {
            if (entries[0].isIntersecting && hasNextPage) {
                fetchNextPage();
            }
        });
        if (node) observer.current.observe(node);
    }, [isLoading, isFetchingNextPage, hasNextPage, fetchNextPage]);

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Sick': return 'error';
            case 'Pregnant': return 'warning';
            case 'Heifer': return 'info';
            case 'Dry': return 'default';
            default: return 'success';
        }
    };

    // Use stats from the first page to get total count
    const totalCount = cowsResponse?.pages[0]?.stats?.totalNonDisputed || nonDisputedCows.length;

    return (
        <PullToRefresh onRefresh={handleRefresh} pullingContent=""
            maxPullDownDistance={100} resistance={2} backgroundColor="#F4F7F4">
            <Container maxWidth="sm" sx={{ pt: 2, pb: 12, minHeight: 'calc(100vh - 80px)' }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="h5" fontWeight={800} color="primary.main">
                            My Herd
                        </Typography>
                        <Chip label={`Total: ${totalCount}`} size="small" color="primary" variant="outlined" sx={{ fontWeight: 'bold' }} />
                    </Box>
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<Add fontSize="small" />}
                        onClick={() => navigate('/add-cow')}
                        sx={{
                            borderRadius: 6,
                            fontWeight: 600,
                            px: 1.5,
                            py: 0.5,
                            textTransform: 'none',
                            borderWidth: 1.5,
                            fontSize: '0.8rem',
                            '&:hover': { borderWidth: 1.5 }
                        }}
                    >
                        Register New
                    </Button>
                </Stack>

                {/* Search Bar */}
                <Paper elevation={0} sx={{ p: '2px 4px', display: 'flex', alignItems: 'center', border: '1px solid #ddd', borderRadius: 3, mb: 3 }}>
                    <InputAdornment position="start" sx={{ pl: 1 }}><Search color="action" /></InputAdornment>
                    <TextField
                        fullWidth
                        placeholder="Search Name or Tag ID"
                        variant="standard"
                        InputProps={{ disableUnderline: true }}
                        sx={{ ml: 1, flex: 1 }}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <IconButton sx={{ p: '10px' }}><FilterList /></IconButton>
                </Paper>

                {/* Cow List */}
                <Stack spacing={2}>
                    {isLoading && (
                        <Box sx={{ py: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                            <CircularProgress size={40} sx={{ mb: 2 }} />
                            <Typography variant="body1" color="text.primary" fontWeight="bold">Fetching your herd...</Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, maxWidth: '250px' }}>
                                Server may be booting up, please hold on and do not close the app!
                            </Typography>
                        </Box>
                    )}

                    {nonDisputedCows.map((cow, index) => {
                        const isLastItem = nonDisputedCows.length === index + 1;
                        return (
                            <Paper
                                key={cow._id}
                                ref={isLastItem ? lastCowElementRef : null}
                                elevation={0}
                                onClick={() => navigate(`/profile/${cow._id}`)}
                                sx={{
                                    p: 2, borderRadius: 3, border: '1px solid #eee',
                                    display: 'flex', alignItems: 'center', gap: 2,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s ease',
                                    '&:active': { bgcolor: '#f5f5f5', transform: 'scale(0.98)' }
                                }}
                            >
                                <Avatar src={getImageUrl(cow.photos?.faceProfile) || getImageUrl(cow.photos?.muzzle) || 'https://placehold.co/100'} variant="rounded" sx={{ width: 64, height: 64, borderRadius: 3 }} />

                                <Box sx={{ flexGrow: 1 }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5, width: '100%' }}>
                                        <Typography variant="subtitle1" fontWeight="bold" noWrap sx={{ mr: 1, flex: 1, minWidth: 0 }}>
                                            {cow.name ? cow.name : <Typography component="span" sx={{ fontStyle: 'italic', color: 'text.disabled', fontSize: 'inherit', fontWeight: 'inherit' }}>Unnamed</Typography>}
                                        </Typography>
                                        <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0, flexWrap: 'wrap', gap: 0.5, justifyContent: 'flex-end' }}>
                                            <Chip label={cow.species || 'Species N/A'} size="small" color={cow.species ? "primary" : "default"} sx={{ minHeight: 20, fontSize: '0.65rem', height: 'auto', opacity: cow.species ? 1 : 0.6 }} />
                                            <Chip label={cow.sex || 'Sex N/A'} size="small" color={cow.sex ? "secondary" : "default"} sx={{ minHeight: 20, fontSize: '0.65rem', height: 'auto', opacity: cow.sex ? 1 : 0.6 }} />
                                            {cow.sex === 'Female' && cow.currentStatus && (
                                                <Chip
                                                    label={cow.currentStatus}
                                                    size="small"
                                                    color={getStatusColor(cow.currentStatus) as "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning"}
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
                        );
                    })}

                    {isFetchingNextPage && (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                            <CircularProgress size={24} />
                        </Box>
                    )}

                    {!isLoading && nonDisputedCows.length === 0 && (
                        <Box sx={{ textAlign: 'center', py: 4, opacity: 0.6 }}>
                            <Typography variant="body1">No cattle found.</Typography>
                        </Box>
                    )}
                </Stack>

            </Container>
        </PullToRefresh>
    );
};

export default MyCows;

