import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Box, Typography, Paper, Grid, CircularProgress, Button, Divider, Avatar, Card, CardContent, Chip, List, ListItem, ListItemIcon, ListItemText, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Backdrop, IconButton
} from '@mui/material';
import { 
  ArrowBack as ArrowBackIcon, Phone as PhoneIcon, Email as EmailIcon, LocationOn as LocationOnIcon, VerifiedUser as VerifiedUserIcon, CheckCircle as CheckCircleIcon, Warning as WarningIcon, Timeline as TimelineIcon, LocalPolice as AadharIcon, Edit as EditIcon
} from '@mui/icons-material';
import axios from 'axios';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import PullToRefresh from 'react-simple-pull-to-refresh';

import { API_BASE } from '@ama-gau-dhana/shared';

// Define explicit types to fix ESLint warnings
interface CowRecord {
  _id: string;
  createdAt: string | Date;
  name?: string;
  tagNumber?: string;
  breed?: string;
  isDispute?: boolean;
  aiMetadata?: { status?: string };
  photos?: { faceProfile?: string, muzzle?: string };
}

interface FarmerProfileData {
  _id: string;
  name: string;
  createdAt: string | Date;
  contact?: { phone?: string, email?: string };
  location?: { state?: string, district?: string, block?: string, village?: string, pincode?: string };
  aadharHash?: string;
  organization?: string;
  profilePicture?: string;
  stats?: { totalCattle: number; successAI: number; disputes: number; };
}

export default function FarmerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [editData, setEditData] = useState<any>({}); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [initialEditData, setInitialEditData] = useState<any>({}); // eslint-disable-line @typescript-eslint/no-explicit-any
  const [savingEdit, setSavingEdit] = useState(false);

  const { data: farmer, isLoading: loading } = useQuery({
    queryKey: ['farmer', id],
    queryFn: async () => {
      const res = await axios.get(`${API_BASE}/api/admin/users/farmers/${id}`);
      if (res.data.success) return res.data.data as FarmerProfileData;
      throw new Error("Failed to fetch farmer");
    },
    enabled: !!id,
  });

  const {
    data: cattleData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage: loadingCattle
  } = useInfiniteQuery({
    queryKey: ['farmer-cattle', id],
    queryFn: async ({ pageParam = 1 }) => {
      const res = await axios.get(`${API_BASE}/api/admin/users/farmers/${id}/cattle?page=${pageParam}&limit=10`);
      return res.data;
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.currentPage < lastPage.totalPages) {
        return lastPage.currentPage + 1;
      }
      return undefined;
    },
    initialPageParam: 1,
    enabled: !!id,
  });

  const cowsList = cattleData?.pages.flatMap(page => page.data) || [];
  const hasMoreCattle = !!hasNextPage;

  const isModified = JSON.stringify(editData) !== JSON.stringify(initialEditData);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (editOpen && isModified) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [editOpen, isModified]);

  const handleEditOpen = () => {
    const initialData = {
      name: farmer?.name || '',
      contact: {
        phone: farmer?.contact?.phone || '',
        email: farmer?.contact?.email || ''
      },
      location: {
        state: farmer?.location?.state || '',
        district: farmer?.location?.district || '',
        block: farmer?.location?.block || '',
        village: farmer?.location?.village || '',
        pincode: farmer?.location?.pincode || ''
      },
      aadharHash: farmer?.aadharHash || '',
      organization: farmer?.organization || ''
    };
    setEditData(initialData);
    setInitialEditData(initialData);
    setEditOpen(true);
  };

  const handleEditClose = (_?: unknown, reason?: string) => {
    if (savingEdit) return; 
    
    if (reason === 'backdropClick' && isModified) {
      if (!window.confirm("You have unsaved changes. Are you sure you want to discard them?")) {
        return;
      }
    }
    
    setEditOpen(false);
  };

  const handleEditSave = async () => {
    setSavingEdit(true);
    try {
      const payload = { ...editData };
      const res = await axios.put(`${API_BASE}/api/admin/users/farmers/${id}`, payload);
      if (res.data.success) {
        queryClient.invalidateQueries({ queryKey: ['farmer', id] });
        setEditOpen(false);
      }
    } catch (err) {
      console.error("Failed to update farmer", err);
      alert("Failed to update farmer details.");
    } finally {
      setSavingEdit(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <CircularProgress size={48} />
        <Typography variant="body1" sx={{ mt: 2, color: 'text.secondary' }}>Loading farmer profile...</Typography>
      </Box>
    );
  }

  if (!farmer) {
    return (
      <Box sx={{ textAlign: 'center', mt: 5 }}>
        <Typography variant="h5" color="error">Farmer not found</Typography>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/farmers')} sx={{ mt: 2 }}>Back to Farmers</Button>
      </Box>
    );
  }

  const activities = cowsList
    .slice(0, 3) // Limit to top 3 recent registrations since it's already sorted by backend
    .map((cow: CowRecord) => ({
      id: cow._id,
      date: new Date(cow.createdAt),
      action: 'Registered Cattle',
      details: `${cow.name || 'Unnamed'} (${cow.tagNumber || 'No Tag'})`,
      status: cow.aiMetadata?.status === 'SUCCESS' ? 'success' : (cow.isDispute ? 'warning' : 'info')
    }));

  // Add join date as the final activity
  activities.push({
    id: 'join',
    date: new Date(farmer.createdAt),
    action: 'Joined Ama-GauDhana',
    details: 'Account created via mobile app.',
    status: 'primary'
  });

  const totalCattle = farmer.stats?.totalCattle || 0;
  const successAI = farmer.stats?.successAI || 0;
  const disputes = farmer.stats?.disputes || 0;

  // Derived Information
  const daysActive = Math.floor((new Date().getTime() - new Date(farmer.createdAt).getTime()) / (1000 * 3600 * 24));
  const cowsPerMonth = daysActive > 0 ? ((totalCattle / daysActive) * 30).toFixed(1) : totalCattle;

  const handleRefresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['farmer', id] }),
      queryClient.invalidateQueries({ queryKey: ['farmer-cattle', id] })
    ]);
  };

  return (
    <PullToRefresh onRefresh={handleRefresh} pullingContent="" maxPullDownDistance={100} resistance={2}>
    <Box>
      <Button 
        startIcon={<ArrowBackIcon />} 
        onClick={() => navigate('/farmers')}
        sx={{ mb: 2, color: 'text.secondary', '&:hover': { backgroundColor: 'transparent', color: 'primary.main' } }}
        disableRipple
      >
        Back to Farmers Directory
      </Button>

      {/* Hero Section */}
      <Paper 
        elevation={0} 
        sx={{ 
          p: 4, mb: 4, borderRadius: 3, 
          background: 'linear-gradient(135deg, rgba(28, 57, 187, 0.05) 0%, rgba(28, 57, 187, 0.15) 100%)',
          border: '1px solid rgba(28, 57, 187, 0.1)',
          display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { xs: 'center', md: 'flex-start' }, gap: 3
        }}
      >
        <Avatar 
          src={farmer.profilePicture}
          sx={{ width: 100, height: 100, bgcolor: 'primary.main', fontSize: '2.5rem', fontWeight: 'bold', boxShadow: 2 }}
        >
          {!farmer.profilePicture && farmer.name.charAt(0).toUpperCase()}
        </Avatar>
        <Box sx={{ flexGrow: 1, textAlign: { xs: 'center', md: 'left' } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: { xs: 'center', md: 'flex-start' }, gap: 2 }}>
            <Typography variant="h5" sx={{ fontWeight: 800, color: 'primary.main', mb: 0, fontSize: { xs: '1.5rem', sm: '1.75rem', md: '2rem' } }}>
              {farmer.name}
            </Typography>
            <Button 
              variant="outlined" 
              color="primary" 
              size="small" 
              startIcon={<EditIcon />} 
              onClick={handleEditOpen} 
              sx={{ borderRadius: 2, display: { xs: 'none', sm: 'flex' } }}
            >
              Edit Profile
            </Button>
            <IconButton 
              color="primary" 
              onClick={handleEditOpen} 
              size="small"
              sx={{ display: { xs: 'flex', sm: 'none' }, border: '1px solid', borderColor: 'primary.main', borderRadius: 2 }}
            >
              <EditIcon fontSize="small" />
            </IconButton>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1, justifyContent: { xs: 'center', md: 'flex-start' } }}>
            <Chip icon={<PhoneIcon fontSize="small"/>} label={farmer.contact?.phone} variant="outlined" color="primary" />
            {farmer.contact?.email && <Chip icon={<EmailIcon fontSize="small"/>} label={farmer.contact.email} variant="outlined" />}
            {farmer.aadharHash && <Chip icon={<VerifiedUserIcon fontSize="small"/>} label="Aadhar Verified" color="success" size="small" />}
            {farmer.organization && <Chip icon={<AadharIcon fontSize="small"/>} label={farmer.organization} color="secondary" size="small" />}
          </Box>
        </Box>
      </Paper>

      <Grid container spacing={4}>
        {/* Left Column: Stats & Cattle */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>Herd Analytics</Typography>
          <Grid container spacing={2} sx={{ mb: 4 }}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'primary.main', fontSize: { xs: '1.75rem', md: '2.125rem' } }}>{totalCattle}</Typography>
                  <Typography variant="body2" color="textSecondary">Total Registered</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'success.main', fontSize: { xs: '1.75rem', md: '2.125rem' } }}>{successAI}</Typography>
                  <Typography variant="body2" color="textSecondary">AI Verified (Success)</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Typography variant="h4" sx={{ fontWeight: 'bold', color: disputes > 0 ? 'error.main' : 'text.disabled', fontSize: { xs: '1.75rem', md: '2.125rem' } }}>{disputes}</Typography>
                  <Typography variant="body2" color="textSecondary">Active Disputes</Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>Derived Analytics</Typography>
          <Grid container spacing={2} sx={{ mb: 4 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'rgba(25, 118, 210, 0.03)' }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main', fontSize: { xs: '1.5rem', md: '1.75rem' } }}>{cowsPerMonth}</Typography>
                  <Typography variant="body2" color="textSecondary">Registrations / Month</Typography>
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'rgba(25, 118, 210, 0.03)' }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main', fontSize: { xs: '1.5rem', md: '1.75rem' } }}>{daysActive}</Typography>
                  <Typography variant="body2" color="textSecondary">Days Active</Typography>
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>Registered Cattle Details</Typography>
          {totalCattle === 0 ? (
            <Paper elevation={0} sx={{ p: 4, textAlign: 'center', border: '1px dashed', borderColor: 'divider', borderRadius: 2 }}>
              <Typography color="textSecondary">This farmer hasn't registered any cattle yet.</Typography>
            </Paper>
          ) : (
            <Grid container spacing={2}>
              {cowsList.map((cow: CowRecord) => (
                <Grid size={{ xs: 12, sm: 6 }} key={cow._id}>
                  <Card 
                    elevation={0} 
                    sx={{ 
                      border: '1px solid', 
                      borderColor: 'divider', 
                      borderRadius: 2, 
                      display: 'flex', 
                      overflow: 'hidden',
                      cursor: 'pointer',
                      transition: 'transform 0.2s, box-shadow 0.2s',
                      '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', borderColor: 'primary.main' }
                    }}
                    onClick={() => navigate(`/cattle/${cow._id}`)}
                  >
                    <Box 
                      component="img" 
                      src={cow.photos?.faceProfile || cow.photos?.muzzle || 'https://via.placeholder.com/100'} 
                      sx={{ width: 100, height: 100, objectFit: 'cover', bgcolor: 'grey.100' }} 
                    />
                    <CardContent sx={{ flexGrow: 1, py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 'bold', lineHeight: 1.2 }}>
                        {cow.name || 'Unnamed Cow'}
                      </Typography>
                      <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mb: 1 }}>
                        Tag: {cow.tagNumber || 'None'} • {cow.breed || 'Unknown Breed'}
                      </Typography>
                      {cow.aiMetadata?.status === 'SUCCESS' ? (
                        <Chip icon={<CheckCircleIcon />} label="AI Verified" size="small" color="success" variant="outlined" />
                      ) : cow.isDispute ? (
                        <Chip icon={<WarningIcon />} label="Disputed" size="small" color="error" />
                      ) : (
                        <Chip label={cow.aiMetadata?.status || 'Pending'} size="small" color="default" variant="outlined" />
                      )}
                    </CardContent>
                  </Card>
                </Grid>
              ))}
            </Grid>
          )}

          {hasMoreCattle && (
            <Box sx={{ mt: 3, textAlign: 'center' }}>
              <Button 
                variant="outlined" 
                onClick={() => fetchNextPage()}
                disabled={loadingCattle}
              >
                {loadingCattle ? <CircularProgress size={24} /> : 'Load More Cattle'}
              </Button>
            </Box>
          )}
        </Grid>

        {/* Right Column: Location & Timeline */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, mb: 4 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <LocationOnIcon color="primary" sx={{ mr: 1 }} />
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>Location Profile</Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="body2" sx={{ mb: 1 }}><b>State:</b> {farmer.location?.state}</Typography>
              <Typography variant="body2" sx={{ mb: 1 }}><b>District:</b> {farmer.location?.district}</Typography>
              <Typography variant="body2" sx={{ mb: 1 }}><b>Block:</b> {farmer.location?.block || 'N/A'}</Typography>
              <Typography variant="body2" sx={{ mb: 1 }}><b>Village:</b> {farmer.location?.village}</Typography>
              <Typography variant="body2"><b>Pincode:</b> {farmer.location?.pincode || 'N/A'}</Typography>
            </CardContent>
          </Card>

          <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <TimelineIcon color="primary" sx={{ mr: 1 }} />
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>Recent Activity</Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              
              <List sx={{ pt: 0 }}>
                {activities.map((activity) => (
                  <ListItem key={activity.id} alignItems="flex-start" sx={{ px: 0 }}>
                      <ListItemIcon sx={{ minWidth: 40, mt: 0.5 }}>
                        <CheckCircleIcon color={activity.status as any /* eslint-disable-line @typescript-eslint/no-explicit-any */} />
                      </ListItemIcon>
                    <ListItemText 
                      primary={
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                          {activity.action}
                        </Typography>
                      }
                      secondary={
                        <Box component="span" sx={{ display: 'flex', flexDirection: 'column' }}>
                          <Typography variant="caption" color="textSecondary">
                            {activity.date.toLocaleDateString()} at {activity.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </Typography>
                          <Typography variant="body2" sx={{ mt: 0.5, color: 'text.primary' }}>
                            {activity.details}
                          </Typography>
                        </Box>
                      }
                    />
                  </ListItem>
                ))}
              </List>

            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onClose={handleEditClose} maxWidth="md" fullWidth>
        <DialogTitle>Edit Farmer Record</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12 }}><Typography variant="subtitle2" color="primary">Personal & Contact Info</Typography></Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField fullWidth label="Name" value={editData.name} onChange={e => setEditData({...editData, name: e.target.value})} size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField fullWidth label="Phone" value={editData.contact?.phone} onChange={e => setEditData({...editData, contact: { ...editData.contact, phone: e.target.value }})} size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField fullWidth label="Email" value={editData.contact?.email} onChange={e => setEditData({...editData, contact: { ...editData.contact, email: e.target.value }})} size="small" />
            </Grid>

            <Grid size={{ xs: 12 }} sx={{ mt: 2 }}><Typography variant="subtitle2" color="primary">Location</Typography></Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField fullWidth label="State" value={editData.location?.state} onChange={e => setEditData({...editData, location: { ...editData.location, state: e.target.value }})} size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField fullWidth label="District" value={editData.location?.district} onChange={e => setEditData({...editData, location: { ...editData.location, district: e.target.value }})} size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField fullWidth label="Block" value={editData.location?.block} onChange={e => setEditData({...editData, location: { ...editData.location, block: e.target.value }})} size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 8 }}>
              <TextField fullWidth label="Village" value={editData.location?.village} onChange={e => setEditData({...editData, location: { ...editData.location, village: e.target.value }})} size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField fullWidth label="Pincode" value={editData.location?.pincode} onChange={e => setEditData({...editData, location: { ...editData.location, pincode: e.target.value }})} size="small" />
            </Grid>

            <Grid size={{ xs: 12 }} sx={{ mt: 2 }}><Typography variant="subtitle2" color="primary">Additional Information</Typography></Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth label="Organization" value={editData.organization} onChange={e => setEditData({...editData, organization: e.target.value})} size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth label="Aadhar ID" value={editData.aadharHash} onChange={e => setEditData({...editData, aadharHash: e.target.value})} size="small" />
            </Grid>
          </Grid>
          <Backdrop
            sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1, position: 'absolute' }}
            open={savingEdit}
          >
            <CircularProgress color="inherit" />
            <Typography variant="h6" sx={{ ml: 2 }}>Saving changes...</Typography>
          </Backdrop>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => handleEditClose(null, 'cancelButton')}>Cancel</Button>
          <Button onClick={handleEditSave} variant="contained" disabled={savingEdit || !isModified}>
            {savingEdit ? <CircularProgress size={24} /> : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
    </PullToRefresh>
  );
}
