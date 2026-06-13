import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  Box, Typography, Paper, Grid, CircularProgress, Button, Divider, Avatar, Card, CardContent, Chip, ImageList, ImageListItem, ImageListItemBar, Dialog, DialogTitle, DialogContent, DialogActions, Table, TableRow, TableCell, TableBody, TextField, Backdrop, MenuItem, Switch, FormControlLabel, IconButton
} from '@mui/material';
import { 
  ArrowBack as ArrowBackIcon, VerifiedUser as VerifiedUserIcon, Warning as WarningIcon, Pets as PetsIcon, LocalOffer as LocalOfferIcon, Person as PersonIcon, LocationOn as LocationOnIcon, Delete as DeleteIcon, Edit as EditIcon
} from '@mui/icons-material';
import axios from 'axios';

import { API_BASE } from '@ama-gau-dhana/shared';

interface CattleProfileData {
  _id: string;
  name?: string;
  tagNumber?: string;
  species?: string;
  breed?: string;
  sex?: string;
  dob?: string;
  ageMonths?: number;
  sireTag?: string;
  damTag?: string;
  source?: string;
  purchaseDetails?: { date?: string; price?: number };
  location?: { lat: number; lng: number };
  currentStatus?: string;
  lastWeight?: number;
  isSick?: boolean;
  isDispute?: boolean;
  healthStats?: {
    birthWeight?: number;
    motherWeightAtCalving?: number;
    growthStatus?: string;
    healthStatus?: string;
    bodyConditionScore?: number;
  };
  createdAt: string | Date;
  updatedAt?: string | Date;
  aiMetadata?: { status?: string; confidenceScore?: number; aiModelVersion?: string };
  photos?: { 
    faceProfile?: string; 
    muzzle?: string; 
    leftProfile?: string; 
    rightProfile?: string; 
    back?: string; 
    tail?: string;
  };
  farmerId?: {
    _id: string;
    name: string;
    contact?: { phone?: string };
    location?: { village?: string; district?: string };
  };
}

export default function CattleProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [cattle, setCattle] = useState<CattleProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [telemetryOpen, setTelemetryOpen] = useState(false);
  const [telemetryLog, setTelemetryLog] = useState<any>(null);
  const [loadingTelemetry, setLoadingTelemetry] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editData, setEditData] = useState<any>({});
  const [initialEditData, setInitialEditData] = useState<any>({});
  const [savingEdit, setSavingEdit] = useState(false);

  const handleEditOpen = () => {
    const initialData = {
      name: cattle?.name || '',
      tagNumber: cattle?.tagNumber || '',
      breed: cattle?.breed || '',
      sex: cattle?.sex || '',
      dob: cattle?.dob ? new Date(cattle.dob).toISOString().split('T')[0] : '',
      ageMonths: cattle?.ageMonths || '',
      sireTag: cattle?.sireTag || '',
      damTag: cattle?.damTag || '',
      source: cattle?.source || '',
      currentStatus: cattle?.currentStatus || '',
      lastWeight: cattle?.lastWeight || '',
      isSick: cattle?.isSick || false,
      isDispute: cattle?.isDispute || false,
      healthStats: {
        birthWeight: cattle?.healthStats?.birthWeight || '',
        motherWeightAtCalving: cattle?.healthStats?.motherWeightAtCalving || '',
        bodyConditionScore: cattle?.healthStats?.bodyConditionScore || '',
        growthStatus: cattle?.healthStats?.growthStatus || '',
        healthStatus: cattle?.healthStats?.healthStatus || ''
      }
    };
    setEditData(initialData);
    setInitialEditData(initialData);
    setEditOpen(true);
  };

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

  const handleEditClose = (_?: any, reason?: string) => {
    if (savingEdit) return; // Completely ignore close attempts if API is running
    
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
      if (!payload.dob) delete payload.dob;
      if (!payload.ageMonths) delete payload.ageMonths;
      
      const res = await axios.put(`${API_BASE}/api/admin/cattle/${id}`, payload);
      if (res.data.success) {
        setCattle(res.data.data);
        setEditOpen(false);
      }
    } catch (err) {
      console.error("Failed to update cattle", err);
      alert("Failed to update cattle");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    try {
      await axios.delete(`${API_BASE}/api/admin/cattle/${id}`);
      setDeleteConfirmOpen(false);
      navigate('/cattle');
    } catch (err: any) {
      if (err.response && err.response.status === 404) {
        // The cattle was already deleted (e.g. via background script or another session)
        setDeleteConfirmOpen(false);
        navigate('/cattle');
      } else {
        console.error("Failed to delete cattle", err);
        alert("Failed to delete cattle");
      }
    }
  };

  const handleFetchTelemetry = async () => {
    setTelemetryOpen(true);
    if (telemetryLog) return; // Already fetched
    
    setLoadingTelemetry(true);
    try {
      const res = await axios.get(`${API_BASE}/api/admin/analytics/ai-logs?cowId=${id}`);
      if (res.data.success && res.data.data.length > 0) {
        setTelemetryLog(res.data.data[0]);
      } else {
        setTelemetryLog(null);
      }
    } catch (err) {
      console.error("Failed to fetch telemetry", err);
      setTelemetryLog(null);
    } finally {
      setLoadingTelemetry(false);
    }
  };

  useEffect(() => {
    const fetchCattle = async () => {
      try {
        const res = await axios.get(`${API_BASE}/api/admin/cattle/${id}`);
        if (res.data.success) {
          setCattle(res.data.data);
        }
      } catch (err) {
        console.error("Failed to fetch cattle profile", err);
      } finally {
        setLoading(false);
      }
    };
    fetchCattle();
  }, [id]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60vh' }}>
        <CircularProgress size={48} />
        <Typography variant="body1" sx={{ mt: 2, color: 'text.secondary' }}>Loading cattle profile...</Typography>
      </Box>
    );
  }

  if (!cattle) {
    return (
      <Box sx={{ textAlign: 'center', mt: 5 }}>
        <Typography variant="h5" color="error">Cattle not found</Typography>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/cattle')} sx={{ mt: 2 }}>Back to Cattle Directory</Button>
      </Box>
    );
  }

  const photos = Object.entries(cattle.photos || {}).filter(([_, url]) => !!url);

  // --- Derived Secondary Information ---
  let exactAge = 'N/A';
  if (cattle.dob) {
    const birthDate = new Date(cattle.dob);
    const now = new Date();
    let years = now.getFullYear() - birthDate.getFullYear();
    let months = now.getMonth() - birthDate.getMonth();
    if (months < 0) {
      years--;
      months += 12;
    }
    exactAge = `${years} yrs, ${months} mos`;
  } else if (cattle.ageMonths !== undefined) {
    exactAge = `${Math.floor(cattle.ageMonths / 12)} yrs, ${cattle.ageMonths % 12} mos`;
  }

  let daysSincePurchase = 'N/A';
  if (cattle.purchaseDetails?.date) {
    const pDate = new Date(cattle.purchaseDetails.date);
    const diffTime = Math.abs(new Date().getTime() - pDate.getTime());
    daysSincePurchase = `${Math.floor(diffTime / (1000 * 60 * 60 * 24))} days ago`;
  }

  let weightGain = 'N/A';
  if (cattle.lastWeight && cattle.healthStats?.birthWeight) {
    const gain = cattle.lastWeight - cattle.healthStats.birthWeight;
    weightGain = `${gain > 0 ? '+' : ''}${gain} kg`;
  }

  let birthToMotherRatio = 'N/A';
  if (cattle.healthStats?.birthWeight && cattle.healthStats?.motherWeightAtCalving) {
    birthToMotherRatio = `${((cattle.healthStats.birthWeight / cattle.healthStats.motherWeightAtCalving) * 100).toFixed(1)}%`;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Button 
          startIcon={<ArrowBackIcon />} 
          onClick={() => navigate('/cattle')}
          sx={{ color: 'text.secondary', '&:hover': { backgroundColor: 'transparent', color: 'primary.main' } }}
          disableRipple
        >
          Back to Cattle Directory
        </Button>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button 
            variant="outlined" 
            color="primary" 
            startIcon={<EditIcon />} 
            onClick={handleEditOpen}
            sx={{ display: { xs: 'none', sm: 'flex' } }}
          >
            Edit Details
          </Button>
          <IconButton 
            color="primary" 
            onClick={handleEditOpen}
            sx={{ display: { xs: 'flex', sm: 'none' }, border: '1px solid', borderColor: 'primary.main', borderRadius: 1 }}
          >
            <EditIcon />
          </IconButton>
        </Box>
      </Box>

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
          src={cattle.photos?.faceProfile || cattle.photos?.muzzle}
          variant="rounded"
          sx={{ width: 120, height: 120, bgcolor: 'primary.main', fontSize: '2.5rem', fontWeight: 'bold', boxShadow: 2 }}
        >
          <PetsIcon fontSize="large" />
        </Avatar>
        <Box sx={{ flexGrow: 1, textAlign: { xs: 'center', md: 'left' } }}>
          <Typography variant="h5" sx={{ fontWeight: 800, color: 'primary.main', mb: 0.5, fontSize: { xs: '1.5rem', sm: '1.75rem', md: '2rem' } }}>
            {cattle.name || 'Unnamed Cow'}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1, justifyContent: { xs: 'center', md: 'flex-start' } }}>
            <Chip icon={<LocalOfferIcon fontSize="small"/>} label={`Tag: ${cattle.tagNumber || 'None'}`} variant="outlined" color="primary" />
            <Chip label={`Species: ${cattle.species || 'N/A'}`} variant="outlined" size="small" />
            <Chip icon={<PetsIcon fontSize="small"/>} label={`Breed: ${cattle.breed || 'N/A'}`} variant="outlined" />
            <Chip label={`Sex: ${cattle.sex || 'N/A'}`} variant="outlined" size="small" />
            <Chip label={`Age: ${exactAge}`} variant="outlined" size="small" />
            {cattle.aiMetadata?.status === 'SUCCESS' ? (
              <Chip icon={<VerifiedUserIcon fontSize="small"/>} label="AI Verified" color="success" size="small" />
            ) : cattle.isDispute ? (
              <Chip icon={<WarningIcon fontSize="small"/>} label="Disputed" color="error" size="small" />
            ) : (
              <Chip label={cattle.aiMetadata?.status || 'Pending'} color="default" size="small" />
            )}
          </Box>
        </Box>
      </Paper>

      <Grid container spacing={4}>
        {/* Left Column: Photos & AI Details */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>Biometric Captures</Typography>
          {photos.length === 0 ? (
            <Paper elevation={0} sx={{ p: 4, textAlign: 'center', border: '1px dashed', borderColor: 'divider', borderRadius: 2, mb: 4 }}>
              <Typography color="textSecondary">No images available for this cattle.</Typography>
            </Paper>
          ) : (
            <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', mb: 4 }}>
              <ImageList sx={{ width: '100%', m: 0 }} cols={3} rowHeight={200}>
                {photos.map(([key, url]) => (
                  <ImageListItem key={key}>
                    <img
                      src={`${url}?w=248&fit=crop&auto=format`}
                      srcSet={`${url}?w=248&fit=crop&auto=format&dpr=2 2x`}
                      alt={key}
                      loading="lazy"
                      style={{ height: '100%', objectFit: 'cover' }}
                    />
                    <ImageListItemBar
                      title={key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                      position="bottom"
                      sx={{ background: 'rgba(0,0,0,0.6)' }}
                    />
                  </ImageListItem>
                ))}
              </ImageList>
            </Paper>
          )}

          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>AI Verification Metadata</Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main', mb: 1, fontSize: { xs: '1.5rem', md: '1.75rem' } }}>
                    {cattle.aiMetadata?.status || 'N/A'}
                  </Typography>
                  <Typography variant="body2" color="textSecondary" sx={{ mb: 2 }}>Verification Status</Typography>
                  
                  {cattle.aiMetadata?.status === 'SUCCESS' && (
                    <Button variant="outlined" color="primary" fullWidth onClick={handleFetchTelemetry}>
                      View Telemetry Report
                    </Button>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>

          {/* Detailed Info Cards */}
          <Grid container spacing={2} sx={{ mt: 2 }}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, height: '100%' }}>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>Identity & Lineage</Typography>
                  <Divider sx={{ mb: 2 }} />
                  <Typography variant="body2" sx={{ mb: 1 }}><b>Date of Birth:</b> {cattle.dob ? new Date(cattle.dob).toLocaleDateString() : 'N/A'}</Typography>
                  <Typography variant="body2" sx={{ mb: 1 }}><b>Sire Tag:</b> {cattle.sireTag || 'N/A'}</Typography>
                  <Typography variant="body2" sx={{ mb: 1 }}><b>Dam Tag:</b> {cattle.damTag || 'N/A'}</Typography>
                  <Typography variant="body2" sx={{ mb: 1 }}><b>Source:</b> {cattle.source || 'N/A'}</Typography>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    <b>Purchase Info:</b> {cattle.purchaseDetails?.date ? `${new Date(cattle.purchaseDetails.date).toLocaleDateString()} (₹${cattle.purchaseDetails.price || 'N/A'})` : 'N/A'}
                  </Typography>
                  {cattle.purchaseDetails?.date && (
                    <Typography variant="body2" sx={{ mb: 1, color: 'text.secondary' }}>
                      ↳ <i>Purchased {daysSincePurchase}</i>
                    </Typography>
                  )}
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, height: '100%' }}>
                <CardContent>
                  <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>Health & Production</Typography>
                  <Divider sx={{ mb: 2 }} />
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    <b>Current Status:</b> {cattle.currentStatus || 'N/A'} 
                    {cattle.isSick && <Chip label="Sick" color="error" size="small" sx={{ ml: 1, height: 20 }} />}
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 1 }}><b>Last Weight:</b> {cattle.lastWeight ? `${cattle.lastWeight} kg` : 'N/A'}</Typography>
                  <Typography variant="body2" sx={{ mb: 1 }}><b>Birth Weight:</b> {cattle.healthStats?.birthWeight ? `${cattle.healthStats.birthWeight} kg` : 'N/A'}</Typography>
                  <Typography variant="body2" sx={{ mb: 1 }}><b>Mother Wt at Calving:</b> {cattle.healthStats?.motherWeightAtCalving ? `${cattle.healthStats.motherWeightAtCalving} kg` : 'N/A'}</Typography>
                  <Typography variant="body2" sx={{ mb: 1 }}><b>Body Condition Score:</b> {cattle.healthStats?.bodyConditionScore || 'N/A'}</Typography>
                  <Typography variant="body2" sx={{ mb: 1 }}><b>Growth Status:</b> {cattle.healthStats?.growthStatus || 'N/A'}</Typography>
                  <Typography variant="body2" sx={{ mb: 1 }}><b>Health Status Notes:</b> {cattle.healthStats?.healthStatus || 'N/A'}</Typography>
                  
                  {/* Derived Health Stats */}
                  {(weightGain !== 'N/A' || birthToMotherRatio !== 'N/A') && (
                    <Box sx={{ mt: 2, p: 1.5, bgcolor: 'rgba(0,0,0,0.02)', borderRadius: 1, border: '1px dashed', borderColor: 'divider' }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 0.5, color: 'text.secondary' }}>Derived Analytics</Typography>
                      {weightGain !== 'N/A' && (
                        <Typography variant="body2"><b>Total Weight Gain:</b> {weightGain}</Typography>
                      )}
                      {birthToMotherRatio !== 'N/A' && (
                        <Typography variant="body2"><b>Birth/Mother Weight Ratio:</b> {birthToMotherRatio}</Typography>
                      )}
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        </Grid>

        {/* Right Column: Owner Details */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, mb: 4 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                <PersonIcon color="primary" sx={{ mr: 1 }} />
                <Typography variant="h6" sx={{ fontWeight: 'bold' }}>Owner Information</Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              {cattle.farmerId ? (
                <>
                  <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 0.5 }}>
                    {cattle.farmerId.name}
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 1, color: 'text.secondary' }}>
                    Contact: {cattle.farmerId.contact?.phone || 'N/A'}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', mt: 2 }}>
                    <LocationOnIcon fontSize="small" sx={{ color: 'text.secondary', mr: 0.5, mt: 0.2 }} />
                    <Typography variant="body2" color="textSecondary">
                      {cattle.farmerId.location?.village}, {cattle.farmerId.location?.district}
                    </Typography>
                  </Box>
                  <Button 
                    variant="outlined" 
                    fullWidth 
                    sx={{ mt: 3 }}
                    onClick={() => navigate(`/farmers/${cattle.farmerId?._id}`)}
                  >
                    View Farmer Profile
                  </Button>
                </>
              ) : (
                <Typography variant="body2" color="text.secondary">Orphaned Record (No Farmer Associated)</Typography>
              )}
            </CardContent>
          </Card>
          
          <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <CardContent>
              <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 2 }}>Registration Details</Typography>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="body2" sx={{ mb: 1 }}>
                <b>System ID:</b> {cattle._id}
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <b>Registered On:</b> {new Date(cattle.createdAt).toLocaleDateString()}
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <b>Last Updated:</b> {cattle.updatedAt ? new Date(cattle.updatedAt).toLocaleDateString() : 'N/A'}
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <b>Scan Coordinates:</b> {cattle.location ? (
                  <a 
                    href={`https://www.google.com/maps?q=${cattle.location.lat},${cattle.location.lng}`} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{ color: '#1976d2', textDecoration: 'none' }}
                  >
                    {cattle.location.lat.toFixed(4)}, {cattle.location.lng.toFixed(4)}
                  </a>
                ) : 'N/A'}
              </Typography>
            </CardContent>
          </Card>
          
          <Box sx={{ mt: 4, display: 'flex', justifyContent: 'flex-end' }}>
            <Button 
              variant="outlined" 
              color="error" 
              startIcon={<DeleteIcon />} 
              onClick={() => setDeleteConfirmOpen(true)}
            >
              Delete Record
            </Button>
          </Box>
        </Grid>
      </Grid>

      {/* Telemetry Report Dialog */}
      <Dialog open={telemetryOpen} onClose={() => setTelemetryOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold', bgcolor: 'primary.main', color: 'white' }}>
          AI Telemetry Report
        </DialogTitle>
        <DialogContent sx={{ mt: 2 }}>
          {loadingTelemetry ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
          ) : telemetryLog ? (
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold', width: '40%' }}>Inference Time (ms)</TableCell>
                  <TableCell>{telemetryLog.inferenceTimeMs} ms</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>Muzzle Similarity Score</TableCell>
                  <TableCell>{telemetryLog.muzzleSimilarityScore !== undefined ? telemetryLog.muzzleSimilarityScore : 'N/A'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>Face Similarity Score</TableCell>
                  <TableCell>{telemetryLog.faceSimilarityScore !== undefined ? telemetryLog.faceSimilarityScore : 'N/A'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>Spatial Muzzle Sim</TableCell>
                  <TableCell>{telemetryLog.spatialMuzzleSim !== undefined ? telemetryLog.spatialMuzzleSim : 'N/A'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>Spatial Face Sim</TableCell>
                  <TableCell>{telemetryLog.spatialFaceSim !== undefined ? telemetryLog.spatialFaceSim : 'N/A'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>Muzzle Conf (M/F)</TableCell>
                  <TableCell>{telemetryLog.muzzleConfM !== undefined ? `${telemetryLog.muzzleConfM} / ${telemetryLog.muzzleConfF}` : 'N/A'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>Spoof Prob (M/F)</TableCell>
                  <TableCell>{telemetryLog.spoofProbM !== undefined ? `${telemetryLog.spoofProbM} / ${telemetryLog.spoofProbF}` : 'N/A'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>Muzzle Post LG Score</TableCell>
                  <TableCell>{telemetryLog.muzzlePostLgScore !== undefined ? telemetryLog.muzzlePostLgScore : 'N/A'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>LG Matches</TableCell>
                  <TableCell>{telemetryLog.lgMatches !== undefined ? telemetryLog.lgMatches : 'N/A'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>Ensemble Score</TableCell>
                  <TableCell>{telemetryLog.ensembleScore !== undefined ? telemetryLog.ensembleScore : 'N/A'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>DS Belief Match/Mismatch</TableCell>
                  <TableCell>{telemetryLog.dsBeliefMatch !== undefined ? `${telemetryLog.dsBeliefMatch} / ${telemetryLog.dsBeliefMismatch}` : 'N/A'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>DS Uncertainty</TableCell>
                  <TableCell>{telemetryLog.dsUncertainty !== undefined ? telemetryLog.dsUncertainty : 'N/A'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>XGB Score / Mapped</TableCell>
                  <TableCell>{telemetryLog.xgbScore !== undefined ? `${telemetryLog.xgbScore} / ${telemetryLog.xgbMappedScore}` : 'N/A'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>Trad LBP / HOG Dist</TableCell>
                  <TableCell>{telemetryLog.tradLbpDist !== undefined ? `${telemetryLog.tradLbpDist} / ${telemetryLog.tradHogDist}` : 'N/A'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>Trad Inlier Ratio / SSIM</TableCell>
                  <TableCell>{telemetryLog.tradInlierRatio !== undefined ? `${telemetryLog.tradInlierRatio} / ${telemetryLog.tradAlignedSsim}` : 'N/A'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>Morphology (Beads/Area/Ecc)</TableCell>
                  <TableCell>
                    {telemetryLog.tradMorphology 
                      ? `${telemetryLog.tradMorphology.beadCount || 'N/A'} / ${telemetryLog.tradMorphology.avgArea || 'N/A'} / ${telemetryLog.tradMorphology.avgEccentricity || 'N/A'}` 
                      : 'N/A'}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>Reason</TableCell>
                  <TableCell>{telemetryLog.reason || 'N/A'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>Muzzle/Spoof Thresholds</TableCell>
                  <TableCell>{telemetryLog.muzzleThreshold !== undefined ? `${telemetryLog.muzzleThreshold} / ${telemetryLog.spoofThreshold}` : 'N/A'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>Matched Cow Name</TableCell>
                  <TableCell>{telemetryLog.matchedCowName || 'N/A'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>AI Endpoint</TableCell>
                  <TableCell>{telemetryLog.endpoint || 'N/A'}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell variant="head" sx={{ fontWeight: 'bold' }}>Timestamp</TableCell>
                  <TableCell>{new Date(telemetryLog.timestamp).toLocaleString()}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          ) : (
            <Typography color="error">No telemetry logs found for this registration.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTelemetryOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
      >
        <DialogTitle sx={{ color: 'error.main' }}>Delete Cattle Record</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete <b>{cattle.name || cattle.tagNumber || 'this cow'}</b>? This action cannot be undone and will permanently remove all biometric data, metadata, and history.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained">
            Delete Permanently
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onClose={handleEditClose} maxWidth="md" fullWidth>
        <DialogTitle>Edit Cattle Record</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12 }}><Typography variant="subtitle2" color="primary">Identity & Lineage</Typography></Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth label="Name" value={editData.name} onChange={e => setEditData({...editData, name: e.target.value})} size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth label="Tag Number" value={editData.tagNumber} onChange={e => setEditData({...editData, tagNumber: e.target.value})} size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField fullWidth label="Breed" value={editData.breed} onChange={e => setEditData({...editData, breed: e.target.value})} size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField fullWidth select label="Sex" value={editData.sex} onChange={e => setEditData({...editData, sex: e.target.value})} size="small">
                <MenuItem value="Female">Female</MenuItem>
                <MenuItem value="Male">Male</MenuItem>
                <MenuItem value="Freemartin">Freemartin</MenuItem>
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField fullWidth select label="Source" value={editData.source} onChange={e => setEditData({...editData, source: e.target.value})} size="small">
                <MenuItem value="Home Born">Home Born</MenuItem>
                <MenuItem value="Purchase">Purchase</MenuItem>
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth label="Date of Birth" type="date" slotProps={{ inputLabel: { shrink: true } }} value={editData.dob} onChange={e => setEditData({...editData, dob: e.target.value})} size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth label="Age in Months" type="number" value={editData.ageMonths} onChange={e => setEditData({...editData, ageMonths: parseInt(e.target.value) || ''})} size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth label="Sire Tag" value={editData.sireTag} onChange={e => setEditData({...editData, sireTag: e.target.value})} size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth label="Dam Tag" value={editData.damTag} onChange={e => setEditData({...editData, damTag: e.target.value})} size="small" />
            </Grid>
            
            <Grid size={{ xs: 12 }} sx={{ mt: 2 }}><Typography variant="subtitle2" color="primary">Health & Production Status</Typography></Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth select label="Current Status" value={editData.currentStatus} onChange={e => setEditData({...editData, currentStatus: e.target.value})} size="small">
                <MenuItem value="Calf">Calf</MenuItem>
                <MenuItem value="Heifer">Heifer</MenuItem>
                <MenuItem value="Milking">Milking</MenuItem>
                <MenuItem value="Dry">Dry</MenuItem>
                <MenuItem value="Pregnant">Pregnant</MenuItem>
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth label="Last Weight (kg)" type="number" value={editData.lastWeight} onChange={e => setEditData({...editData, lastWeight: parseFloat(e.target.value) || ''})} size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField fullWidth label="Birth Weight (kg)" type="number" value={editData.healthStats?.birthWeight} onChange={e => setEditData({...editData, healthStats: {...editData.healthStats, birthWeight: parseFloat(e.target.value) || ''}})} size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField fullWidth label="Mother Wt at Calving (kg)" type="number" value={editData.healthStats?.motherWeightAtCalving} onChange={e => setEditData({...editData, healthStats: {...editData.healthStats, motherWeightAtCalving: parseFloat(e.target.value) || ''}})} size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField fullWidth label="Body Condition Score" type="number" value={editData.healthStats?.bodyConditionScore} onChange={e => setEditData({...editData, healthStats: {...editData.healthStats, bodyConditionScore: parseFloat(e.target.value) || ''}})} size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth label="Growth Status" value={editData.healthStats?.growthStatus} onChange={e => setEditData({...editData, healthStats: {...editData.healthStats, growthStatus: e.target.value}})} size="small" />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField fullWidth label="Health Status Notes" value={editData.healthStats?.healthStatus} onChange={e => setEditData({...editData, healthStats: {...editData.healthStats, healthStatus: e.target.value}})} size="small" />
            </Grid>
            
            <Grid size={{ xs: 12 }} sx={{ mt: 1, display: 'flex', gap: 4 }}>
              <FormControlLabel control={<Switch checked={editData.isSick} onChange={(e: any) => setEditData({...editData, isSick: e.target.checked})} color="error" />} label="Mark as Sick" />
              <FormControlLabel control={<Switch checked={editData.isDispute} onChange={(e: any) => setEditData({...editData, isDispute: e.target.checked})} color="warning" />} label="Mark as Disputed" />
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
  );
}
