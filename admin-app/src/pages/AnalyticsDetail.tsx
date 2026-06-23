import React, { useState } from 'react';
import {
  Box, Typography, Paper, Grid, Chip, Button, Avatar, Divider,
  IconButton, Dialog, CircularProgress,
  Alert,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/Delete';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { API_BASE } from '@gonidhi/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PullToRefresh from 'react-simple-pull-to-refresh';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const renderVal = (v: any) => v == null ? <span style={{ color: '#aaa' }}>N/A</span> : <b>{typeof v === 'number' && !Number.isInteger(v) ? v.toFixed(2) : v}</b>;

const getStatusStyle = (status: string) => {
  const s = (status || '').toUpperCase();
  if (s === 'SUCCESS' || s === 'FOUND') return { bg: '#e8f5e9', color: '#2e7d32', border: '#a5d6a7' };
  if (['NOT_FOUND', 'FAILED', 'SPOOF_DETECTED', 'DISPUTE'].includes(s)) return { bg: '#ffebee', color: '#c62828', border: '#ef9a9a' };
  if (s === 'NOT_A_COW') return { bg: '#f3e5f5', color: '#6a1b9a', border: '#ce93d8' };
  if (s === 'DUPLICATE') return { bg: '#fff3e0', color: '#e65100', border: '#ffcc02' };
  return { bg: '#f5f5f5', color: '#616161', border: '#e0e0e0' };
};

const formatEndpoint = (ep?: string) => {
  if (!ep) return 'N/A';
  const lower = ep.toLowerCase();
  if (lower.includes('search')) return 'SEARCH';
  if (lower.includes('register') || lower.includes('registration')) return 'REGISTER';
  return 'UNKNOWN';
};

function ImageTile({ src, label, onClick }: { src?: string; label: string; onClick?: () => void }) {
  if (!src) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
        <Box sx={{
          width: '100%', aspectRatio: '1', minHeight: 80, maxHeight: 160,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: '#f5f5f5', borderRadius: 2, border: '1px dashed #ccc'
        }}>
          <Typography variant="caption" color="text.disabled" align="center" sx={{ px: 1 }}>No Image</Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{label}</Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
      <Box
        sx={{ position: 'relative', width: '100%', cursor: onClick ? 'zoom-in' : 'default', '&:hover .zoom-icon': { opacity: 1 } }}
        onClick={onClick}
      >
        <Box
          component="img"
          src={src}
          alt={label}
          sx={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 2, border: '1px solid', borderColor: 'divider', display: 'block' }}
        />
        {onClick && (
          <Box className="zoom-icon" sx={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            bgcolor: 'rgba(0,0,0,0.3)', borderRadius: 2, opacity: 0, transition: 'opacity 0.2s'
          }}>
            <ZoomInIcon sx={{ color: 'white', fontSize: 28 }} />
          </Box>
        )}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{label}</Typography>
    </Box>
  );
}

function ScoreBar({ label, value, threshold, higherIsBetter = true }: { label: string; value: number | null | undefined; threshold?: number; higherIsBetter?: boolean }) {
  const pct = value != null ? Math.max(0, Math.min(1, value)) * 100 : null;

  let color = 'primary.main';
  let icon = null;

  if (value != null && threshold != null) {
    if (higherIsBetter) {
      if (value >= threshold) {
        color = 'success.main';
        icon = <CheckCircleIcon sx={{ fontSize: 14, color: 'success.main' }} />;
      } else if (value >= threshold - 0.15) {
        color = 'warning.main';
        icon = <CancelIcon sx={{ fontSize: 14, color: 'warning.main' }} />;
      } else {
        color = 'error.main';
        icon = <CancelIcon sx={{ fontSize: 14, color: 'error.main' }} />;
      }
    } else {
      if (value <= threshold) {
        color = 'success.main';
        icon = <CheckCircleIcon sx={{ fontSize: 14, color: 'success.main' }} />;
      } else if (value <= threshold + 0.15) {
        color = 'warning.main';
        icon = <CancelIcon sx={{ fontSize: 14, color: 'warning.main' }} />;
      } else {
        color = 'error.main';
        icon = <CancelIcon sx={{ fontSize: 14, color: 'error.main' }} />;
      }
    }
  }

  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{label}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="caption" sx={{ fontWeight: 800, color }}>
            {pct != null ? `${pct.toFixed(2)}%` : 'N/A'}
          </Typography>
          {icon}
        </Box>
      </Box>
      {pct != null && (
        <Box sx={{ height: 6, bgcolor: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
          <Box sx={{
            height: '100%', width: `${pct}%`, borderRadius: 3,
            bgcolor: color,
            transition: 'width 0.6s ease'
          }} />
        </Box>
      )}
    </Box>
  );
}

function SectionCard({ title, color = '#1C39BB', children }: { title: string; color?: string; children: React.ReactNode }) {
  return (
    <Paper sx={{ borderRadius: 2, border: '1px solid', borderColor: 'divider', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <Box sx={{ px: 2, py: 1.25, bgcolor: color, display: 'flex', alignItems: 'center' }}>
        <Typography variant="subtitle2" sx={{ color: 'white', fontWeight: 700, letterSpacing: 0.3 }}>{title}</Typography>
      </Box>
      <Box sx={{ p: 2 }}>{children}</Box>
    </Paper>
  );
}

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', py: 0.75, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 'none' } }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, mr: 1, flexShrink: 0 }}>{label}</Typography>
      <Typography variant="caption" sx={{ textAlign: 'right', wordBreak: 'break-all' }}>{value}</Typography>
    </Box>
  );
}

export default function AnalyticsDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { data: log, isLoading, refetch } = useQuery({
    queryKey: ['analyticsDetail', id],
    queryFn: async () => {
      const res = await axios.get(`${API_BASE}/api/admin/analytics/ai-logs/${id}`);
      if (res.data.success) return res.data.data;
      throw new Error('Failed to fetch analytics detail');
    },
    enabled: !!id,
  });

  const handleToggleCorrect = async (newVal: boolean) => {
    if (!log) return;
    const finalVal = log.isAiOutcomeCorrect === newVal ? null : newVal;

    // Optimistic update
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryClient.setQueryData(['analyticsDetail', id], (old: any) => ({ ...old, isAiOutcomeCorrect: finalVal }));

    try {
      await axios.put(`${API_BASE}/api/admin/analytics/ai-logs/${id}`, { isAiOutcomeCorrect: finalVal });
      queryClient.invalidateQueries({ queryKey: ['analytics-logs'] });
    } catch {
      // Revert
      queryClient.invalidateQueries({ queryKey: ['analyticsDetail', id] });
    }
  };

  const handleDelete = async () => {
    try {
      await axios.delete(`${API_BASE}/api/admin/analytics/ai-logs/${id}`);
      queryClient.invalidateQueries({ queryKey: ['analytics-logs'] });
      navigate('/analytics', { replace: true });
    } catch {
      alert('Failed to delete log.');
    }
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '50vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!log) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Inference log not found.</Alert>
        <Button sx={{ mt: 2 }} startIcon={<ArrowBackIcon />} onClick={() => navigate('/analytics')}>Back to List</Button>
      </Box>
    );
  }

  const status = log.matchStatus || (log.success ? 'SUCCESS' : 'FAILED');
  const { bg, color, border } = getStatusStyle(status);

  let targetProfileId: string | null = null;
  let profileButtonText = "View Cattle Profile";
  const validStatuses = ['SUCCESS', 'FOUND', 'DUPLICATE'];

  if (validStatuses.includes(status)) {
    if (log.matchedCowId && log.matchedCowId !== 'Unknown') {
      targetProfileId = log.matchedCowId;
      profileButtonText = "View Matched Cattle Profile";
    } else if (formatEndpoint(log.endpoint) === 'SEARCH' && log.cowId && log.cowId !== 'Unknown') {
      targetProfileId = log.cowId;
      profileButtonText = "View Matched Cattle Profile";
    } else if (formatEndpoint(log.endpoint) === 'REGISTER' && status === 'SUCCESS' && log.cowId && log.cowId !== 'Unknown') {
      targetProfileId = log.cowId;
      profileButtonText = "View Registered Cattle Profile";
    }
  }

  const handleRefresh = async () => {
    await refetch();
  };

  return (
    <PullToRefresh onRefresh={handleRefresh} pullingContent="" maxPullDownDistance={100} resistance={2}>
      <Box sx={{ width: '100%', overflowX: 'hidden' }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
          <IconButton onClick={() => navigate('/analytics')} sx={{ mr: 1, ml: -1, color: 'text.secondary' }}>
            <ArrowBackIcon />
          </IconButton>
          <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary', letterSpacing: '-0.01em' }}>
            Inference Details
          </Typography>
        </Box>


        {/* Status Hero */}
        <Paper sx={{ borderRadius: 2, mb: 3, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
          <Box sx={{ height: 4, bgcolor: color }} />
          <Box sx={{ p: 2.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
              {/* Thumbnail or avatar */}
              <Box sx={{ flexShrink: 0 }}>
                {log.muzzleImgUrl || log.faceImgUrl ? (
                  <Box sx={{ position: 'relative', width: 72, height: 72 }} onClick={() => setPreviewImg(log.muzzleImgUrl || log.faceImgUrl)}>
                    <Box component="img" src={log.muzzleImgUrl || log.faceImgUrl} alt="input"
                      sx={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 2, border: '1px solid', borderColor: 'divider', cursor: 'zoom-in' }} />
                    {log.muzzleImgUrl && log.faceImgUrl && (
                      <Box component="img" src={log.faceImgUrl} alt="face"
                        sx={{ position: 'absolute', bottom: -6, right: -6, width: 32, height: 32, objectFit: 'cover', borderRadius: 1, border: '2px solid white', boxShadow: '0 1px 4px rgba(0,0,0,0.2)', cursor: 'zoom-in' }}
                        onClick={(e) => { e.stopPropagation(); setPreviewImg(log.faceImgUrl); }} />
                    )}
                  </Box>
                ) : (
                  <Avatar sx={{ width: 72, height: 72, bgcolor: '#f0f4ff', color: 'primary.main', fontSize: 32, borderRadius: 2 }}>🐄</Avatar>
                )}
              </Box>

              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1 }}>
                  <Chip label={status.replace(/_/g, ' ')} size="small"
                    sx={{ bgcolor: bg, color, border: `1px solid ${border}`, fontWeight: 700, fontSize: '0.75rem' }} />
                  <Chip label={formatEndpoint(log.endpoint)} size="small" variant="outlined" color="primary" sx={{ fontWeight: 600 }} />
                  {log.farmerId && (
                    <Chip
                      label={(log.farmerId === 'admin' || log.farmerId === 'admin_proxy') ? 'Action By: Admin' : `Action By: ${log.farmerId.substring(0, 8)}`}
                      size="small"
                      variant="outlined"
                      color="secondary"
                      sx={{ fontWeight: 600, cursor: (log.farmerId !== 'admin' && log.farmerId !== 'admin_proxy') ? 'pointer' : 'default' }}
                      title={`User ID: ${log.farmerId}`}
                      onClick={(log.farmerId !== 'admin' && log.farmerId !== 'admin_proxy') ? () => navigate(`/farmers/${log.farmerId}`) : undefined}
                    />
                  )}
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {new Date(log.timestamp).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'medium' })}
                  {' · '}
                  <b>{(log.inferenceTimeMs / 1000).toFixed(2)}s</b> inference
                </Typography>
                {targetProfileId && (
                  <Button
                    size="small"
                    variant="outlined"
                    color="primary"
                    onClick={() => navigate(`/cattle/${targetProfileId}`)}
                    sx={{ textTransform: 'none', borderRadius: 2, fontWeight: 600 }}
                  >
                    {profileButtonText}
                  </Button>
                )}
              </Box>

              {/* Final Confidence Score */}
              {formatEndpoint(log.endpoint) === 'SEARCH' && (log.ensembleScore != null || log.xgbMappedScore != null) && (
                <Box sx={{ textAlign: 'center', flexShrink: 0 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600, textTransform: 'uppercase', fontSize: '0.6rem', mb: 0.5 }}>
                    Confidence
                  </Typography>
                  <Typography sx={{
                    fontSize: '2rem', fontWeight: 900, lineHeight: 1,
                    color: (log.ensembleScore ?? log.xgbMappedScore) >= 0.85 ? 'success.main'
                      : (log.ensembleScore ?? log.xgbMappedScore) >= 0.6 ? 'warning.main' : 'error.main'
                  }}>
                    {((log.ensembleScore ?? log.xgbMappedScore) * 100).toFixed(2)}%
                  </Typography>
                </Box>
              )}
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* AI Correctness Toggle */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>Was AI outcome correct?</Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  size="small"
                  variant={log.isAiOutcomeCorrect === true ? 'contained' : 'outlined'}
                  color="success"
                  startIcon={<ThumbUpIcon />}
                  onClick={() => handleToggleCorrect(true)}
                  sx={{ borderRadius: 2, textTransform: 'none' }}
                >
                  Yes
                </Button>
                <Button
                  size="small"
                  variant={log.isAiOutcomeCorrect === false ? 'contained' : 'outlined'}
                  color="error"
                  startIcon={<ThumbDownIcon />}
                  onClick={() => handleToggleCorrect(false)}
                  sx={{ borderRadius: 2, textTransform: 'none' }}
                >
                  No
                </Button>
              </Box>
              {log.isAiOutcomeCorrect === null || log.isAiOutcomeCorrect === undefined ? (
                <Chip label="Unmarked" size="small" icon={<HelpOutlineIcon />} variant="outlined" sx={{ color: 'text.disabled' }} />
              ) : null}
            </Box>
          </Box>
        </Paper>

        {/* Main Content Grid */}
        <Grid container spacing={2} sx={{ mb: 2 }}>

          {/* Input Images */}
          <Grid size={{ xs: 12, md: 4 }}>
            <SectionCard title="Input Images" color="#1565c0">
              <Grid container spacing={1.5}>
                <Grid size={{ xs: 6 }}>
                  <ImageTile src={log.muzzleImgUrl} label="Muzzle" onClick={log.muzzleImgUrl ? () => setPreviewImg(log.muzzleImgUrl) : undefined} />
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <ImageTile src={log.faceImgUrl} label="Face" onClick={log.faceImgUrl ? () => setPreviewImg(log.faceImgUrl) : undefined} />
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <ImageTile src={log.muzzleCropUrl} label="Muzzle Crop" onClick={log.muzzleCropUrl ? () => setPreviewImg(log.muzzleCropUrl) : undefined} />
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <ImageTile src={log.faceCropUrl} label="Face Crop" onClick={log.faceCropUrl ? () => setPreviewImg(log.faceCropUrl) : undefined} />
                </Grid>
              </Grid>

              {log.bestWrongAnswerImageUrl && (
                <Box sx={{ mt: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>Top DB Match Image</Typography>
                    {log.matchedCowId && log.matchedCowId !== 'Unknown' && (
                      <Button
                        size="small"
                        variant="text"
                        sx={{ textTransform: 'none', fontSize: '0.7rem', py: 0, minHeight: 0 }}
                        onClick={() => navigate(`/cattle/${log.matchedCowId}`)}
                      >
                        View Profile
                      </Button>
                    )}
                  </Box>
                  <Box
                    component="img"
                    src={log.bestWrongAnswerImageUrl}
                    alt="DB Match"
                    onClick={() => setPreviewImg(log.bestWrongAnswerImageUrl)}
                    sx={{ width: '100%', maxHeight: 160, objectFit: 'contain', borderRadius: 2, border: '1px solid', borderColor: 'divider', cursor: 'zoom-in', bgcolor: '#fafafa' }}
                  />
                </Box>
              )}
            </SectionCard>
          </Grid>

          {/* Detection Checks + Record Metadata — stacked in middle column */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
              <SectionCard title="Detection Checks" color="#4527a0">
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, display: 'block', mb: 1, textTransform: 'uppercase', fontSize: '0.65rem' }}>
                  Muzzle Detector
                </Typography>
                <ScoreBar label="Detection Confidence" value={log.muzzleConfM} threshold={log.muzzleThreshold ?? 0.5} />
                <ScoreBar label="Spoof Probability" value={log.spoofProbM} threshold={log.spoofThreshold ?? 0.5} higherIsBetter={false} />

                <Divider sx={{ my: 1.5 }} />
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, display: 'block', mb: 1, textTransform: 'uppercase', fontSize: '0.65rem' }}>
                  Face Detector
                </Typography>
                <ScoreBar label="Detection Confidence" value={log.muzzleConfF} />
                <ScoreBar label="Spoof Probability" value={log.spoofProbF} threshold={log.spoofThreshold ?? 0.5} higherIsBetter={false} />
              </SectionCard>

              <SectionCard title="Record Metadata" color="#5d4037">
                <DataRow label="Timestamp" value={new Date(log.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' })} />
                <DataRow label="Endpoint" value={formatEndpoint(log.endpoint)} />
                <DataRow label="Status" value={status ? status.replace(/_/g, ' ') : 'N/A'} />
                <DataRow label="Action By" value={log.farmerId ? ((log.farmerId === 'admin' || log.farmerId === 'admin_proxy') ? 'Admin' : `User: ${log.farmerId}`) : 'N/A'} />
                <DataRow label="Inference Time" value={`${(log.inferenceTimeMs / 1000).toFixed(2)} s`} />
              </SectionCard>

              {log.semanticTags && Object.keys(log.semanticTags).length > 0 && (
                <SectionCard title="Semantic Tags (CLIP)" color="#00838f">
                  {Object.entries(log.semanticTags).map(([key, value]) => (
                    <DataRow 
                      key={key} 
                      label={key.replace('semantic_', '').toUpperCase()} 
                      value={<Chip label={String(value).replace(/_/g, ' ')} size="small" variant="outlined" sx={{ textTransform: 'capitalize', fontWeight: 600 }} />} 
                    />
                  ))}
                </SectionCard>
              )}
            </Box>
          </Grid>

          {/* AI Pipeline */}
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <SectionCard title="AI Pipeline Scores" color="#1b5e20">
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, display: 'block', mb: 1, textTransform: 'uppercase', fontSize: '0.65rem' }}>
                Step 1 · Expert Features
              </Typography>
              <ScoreBar label="Spatial Muzzle Sim" value={log.spatialMuzzleSim} threshold={0.6} />
              <ScoreBar label="Spatial Face Sim" value={log.spatialFaceSim} threshold={0.6} />
              <ScoreBar label="Face Legacy Score" value={log.faceSimilarityScore} threshold={0.6} />
              <ScoreBar label="Muzzle Legacy Score" value={log.muzzleSimilarityScore} threshold={0.6} />
              <DataRow label="Physical Ridge Matches" value={renderVal(log.lgMatches)} />
              <DataRow label="Inlier Ratio" value={renderVal(log.tradInlierRatio)} />
              <DataRow label="LBP Distance" value={renderVal(log.tradLbpDist)} />
              <DataRow label="Aligned SSIM" value={renderVal(log.tradAlignedSsim)} />
              <Box sx={{ mt: 2 }} />
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, display: 'block', mb: 1, textTransform: 'uppercase', fontSize: '0.65rem' }}>
                Step 2 · ML Classifier (XGBoost)
              </Typography>
              <ScoreBar label="XGB Mapped Score" value={log.xgbMappedScore} threshold={0.85} />

              <Divider sx={{ my: 1.5 }} />
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, display: 'block', mb: 1, textTransform: 'uppercase', fontSize: '0.65rem' }}>
                Step 3 · Gatekeeper Verdict
              </Typography>
              <ScoreBar label="DS Belief Match" value={log.dsBeliefMatch} threshold={0.60} />
              <ScoreBar label="DS Belief Mismatch" value={log.dsBeliefMismatch} threshold={0.50} higherIsBetter={false} />
              <ScoreBar label="DS Uncertainty" value={log.dsUncertainty} threshold={0.50} higherIsBetter={false} />

              <Divider sx={{ my: 1.5 }} />
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, display: 'block', mb: 1, textTransform: 'uppercase', fontSize: '0.65rem' }}>
                Step 4 · Final Verdict
              </Typography>
              <ScoreBar label="Final Ensemble Conf." value={log.ensembleScore} threshold={0.85} />
            </SectionCard>
          </Grid>

          {/* Reasoning */}
          {log.reason && (
            <Grid size={{ xs: 12 }}>
              <SectionCard title="💬  AI Reasoning" color="#37474f">
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                  {log.reason}
                </Typography>
              </SectionCard>
            </Grid>
          )}
        </Grid>


        {/* Danger Zone */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2, mb: 4 }}>
          <Button
            variant="outlined"
            color="error"
            startIcon={<DeleteIcon />}
            onClick={() => setDeleteOpen(true)}
            sx={{ borderRadius: 2 }}
          >
            Delete Record
          </Button>
        </Box>

        {/* Image Lightbox */}
        <Dialog open={!!previewImg} onClose={() => setPreviewImg(null)} maxWidth="md" fullWidth>
          <Box sx={{ position: 'relative', bgcolor: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
            <IconButton
              onClick={() => setPreviewImg(null)}
              sx={{ position: 'absolute', top: 8, right: 8, bgcolor: 'rgba(255,255,255,0.15)', color: 'white', '&:hover': { bgcolor: 'rgba(255,255,255,0.25)' } }}
            >
              ✕
            </IconButton>
            {previewImg && (
              <Box component="img" src={previewImg} alt="Preview"
                sx={{ width: '100%', maxHeight: '85vh', objectFit: 'contain' }} />
            )}
          </Box>
        </Dialog>

        {/* Delete Dialog */}
        <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}>
          <Box sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Delete Record?</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              This will permanently delete this inference log. This action cannot be undone.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
              <Button onClick={() => setDeleteOpen(false)} sx={{ borderRadius: 2 }}>Cancel</Button>
              <Button variant="contained" color="error" onClick={handleDelete} sx={{ borderRadius: 2 }}>Delete</Button>
            </Box>
          </Box>
        </Dialog>
      </Box>
    </PullToRefresh>
  );
}
