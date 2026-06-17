import React, { useEffect, useState } from 'react';
import {
    Typography, Box, Paper, Button, List, Divider,
    CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions, Stack, Chip
} from '@mui/material';
import { CloudSync, ErrorOutline, Edit, CheckCircle, Cached, DeleteOutline } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { syncManager } from '@gonidhi/shared';

const OfflineSync: React.FC = () => {
    const navigate = useNavigate();
    const [cows, setCows] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [filter, setFilter] = useState<'all' | 'pending' | 'failed'>('all');

    const loadCows = async () => {
        setLoading(true);
        const pending = await syncManager.getPendingCows();
        setCows(pending);
        setLoading(false);
    };

    useEffect(() => {
        void loadCows();
    }, []);

    const handleSyncNow = async () => {
        setSyncing(true);
        await syncManager.syncAll();
        await loadCows();
        setSyncing(false);
    };

    const handleDelete = async () => {
        if (deleteId) {
            await syncManager.removePendingCow(deleteId);
            setDeleteId(null);
            loadCows();
        }
    };

    const handleEdit = (cow: any) => {
        // Pass the cow data and the exact ID to the AddCow form via state
        navigate('/add-cow', { state: { offlineDraft: cow } });
    };

    return (
        <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Typography variant="h6" fontWeight="bold">Offline Sync</Typography>
                <Button
                    variant="contained"
                    startIcon={syncing ? <CircularProgress size={20} color="inherit" /> : <CloudSync />}
                    onClick={handleSyncNow}
                    disabled={syncing || cows.length === 0 || !navigator.onLine}
                    sx={{ borderRadius: 6 }}
                >
                    Sync Now
                </Button>
            </Box>

            {!loading && cows.length > 0 && (
                <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
                    <Chip
                        label={`All (${cows.length})`}
                        color={filter === 'all' ? 'primary' : 'default'}
                        variant={filter === 'all' ? 'filled' : 'outlined'}
                        onClick={() => setFilter('all')}
                        sx={{ fontWeight: 600, borderRadius: 2 }}
                        clickable
                    />
                    <Chip
                        label={`Pending (${cows.filter(c => c.syncStatus !== 'failed').length})`}
                        color={filter === 'pending' ? 'warning' : 'default'}
                        variant={filter === 'pending' ? 'filled' : 'outlined'}
                        onClick={() => setFilter('pending')}
                        sx={{ fontWeight: 600, borderRadius: 2 }}
                        clickable
                    />
                    <Chip
                        label={`Failed (${cows.filter(c => c.syncStatus === 'failed').length})`}
                        color={filter === 'failed' ? 'error' : 'default'}
                        variant={filter === 'failed' ? 'filled' : 'outlined'}
                        onClick={() => setFilter('failed')}
                        sx={{ fontWeight: 600, borderRadius: 2 }}
                        clickable
                    />
                </Stack>
            )}

            {!navigator.onLine && (
                <Paper sx={{ p: 2, mb: 3, bgcolor: '#FFF3E0', color: '#E65100', display: 'flex', alignItems: 'center', gap: 1 }}>
                    <ErrorOutline />
                    <Typography variant="body2" fontWeight={600}>
                        You are currently offline. Syncing is disabled until you regain internet connection.
                    </Typography>
                </Paper>
            )}

            {loading ? (
                <Box textAlign="center" py={5}><CircularProgress /></Box>
            ) : cows.length === 0 ? (
                <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 4, bgcolor: '#F9FAFB' }} elevation={0}>
                    <CheckCircle sx={{ fontSize: 48, color: 'success.main', mb: 1 }} />
                    <Typography variant="h6" fontWeight={600}>All caught up!</Typography>
                    <Typography variant="body2" color="text.secondary">
                        There are no offline registrations waiting to be synced.
                    </Typography>
                </Paper>
            ) : (
                <List sx={{ flexGrow: 1, overflowY: 'auto', p: 1, px: 2 }}>
                    {cows.filter(cow => {
                        if (filter === 'all') return true;
                        if (filter === 'pending') return cow.syncStatus !== 'failed';
                        if (filter === 'failed') return cow.syncStatus === 'failed';
                        return true;
                    }).map((cow, index) => {
                        const isFailed = cow.syncStatus === 'failed';
                        return (
                            <Paper
                                key={cow.id}
                                elevation={0}
                                sx={{
                                    mb: 2.5,
                                    borderRadius: 2,
                                    overflow: 'hidden',
                                    border: '1px solid',
                                    borderColor: 'grey.200',
                                    boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
                                    bgcolor: 'white',
                                }}
                            >
                                {/* Status Header Ribbon */}
                                <Box sx={{
                                    px: 2, py: 1.25,
                                    bgcolor: isFailed ? '#FEF2F2' : '#FFFBEB',
                                    borderBottom: '1px solid',
                                    borderColor: isFailed ? '#FCA5A5' : '#FDE68A',
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        {isFailed ? <ErrorOutline color="error" fontSize="small" /> : <Cached color="warning" fontSize="small" />}
                                        <Typography variant="caption" fontWeight={800} color={isFailed ? 'error.main' : 'warning.main'} sx={{ letterSpacing: 0.5 }}>
                                            {index + 1}. {isFailed ? 'SYNC FAILED' : 'PENDING SYNC'}
                                        </Typography>
                                    </Box>
                                    <Typography variant="caption" color="text.secondary" fontWeight={600}>
                                        {cow.breed} • {cow.species}
                                    </Typography>
                                </Box>

                                {/* Main Content */}
                                <Box sx={{ p: 2 }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                                        <Box>
                                            <Typography variant="h6" fontWeight={800} lineHeight={1.2} mb={0.5} color="text.primary">
                                                {cow.name || `Tag #${cow.tagNo}`}
                                            </Typography>
                                            <Typography variant="body2" color="text.secondary" fontWeight={500}>
                                                Added: {cow.timestamp ? new Date(cow.timestamp).toLocaleDateString() : 'Recently'} | Sex: {cow.sex}
                                            </Typography>
                                        </Box>
                                    </Box>

                                    {/* Error Details if Failed */}
                                    {isFailed && cow.errorMessage && (
                                        <Box sx={{ mt: 2, mb: 1 }}>
                                            <Typography variant="caption" color="text.secondary" fontWeight={700} display="block" mb={0.5} sx={{ letterSpacing: 0.5 }}>
                                                ERROR LOG
                                            </Typography>
                                            <Typography variant="body2" color="error.main" sx={{
                                                bgcolor: '#FEF2F2', p: 1.5, borderRadius: 2,
                                                border: '1px dashed', borderColor: '#FCA5A5',
                                                fontFamily: 'monospace', fontSize: '0.75rem',
                                                wordBreak: 'break-word'
                                            }}>
                                                {cow.errorMessage}
                                            </Typography>
                                        </Box>
                                    )}

                                    <Divider sx={{ my: 2, borderStyle: 'dashed' }} />

                                    {/* Actions */}
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <Button
                                            color="inherit"
                                            startIcon={<DeleteOutline />}
                                            onClick={() => setDeleteId(cow.id)}
                                            sx={{ color: 'text.secondary', fontWeight: 600, px: 2, borderRadius: 4 }}
                                        >
                                            Discard
                                        </Button>
                                        {isFailed && (
                                            <Button
                                                variant="contained"
                                                color="primary"
                                                startIcon={<Edit />}
                                                onClick={() => handleEdit(cow)}
                                                sx={{ borderRadius: 6, px: 3, fontWeight: 700, boxShadow: 'none' }}
                                            >
                                                Edit & Retry
                                            </Button>
                                        )}
                                    </Box>
                                </Box>
                            </Paper>
                        );
                    })}
                </List>
            )}

            {/* Delete Confirmation Dialog */}
            <Dialog open={!!deleteId} onClose={() => setDeleteId(null)}>
                <DialogTitle>Discard Registration?</DialogTitle>
                <DialogContent>
                    <Typography>
                        Are you sure you want to permanently delete this offline registration? This action cannot be undone.
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteId(null)}>Cancel</Button>
                    <Button onClick={handleDelete} color="error" variant="contained">Delete</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default OfflineSync;
