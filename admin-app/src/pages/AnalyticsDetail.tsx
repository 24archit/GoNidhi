import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Paper, Grid, Chip, Button, Avatar, Divider,
  IconButton, Dialog, Select, MenuItem, FormControl, CircularProgress,
  Alert, Tooltip
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/Delete';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import { API_BASE } from '@ama-gau-dhana/shared';

const renderPct = (v: any) => v == null ? <span style={{ color: '#aaa' }}>N/A</span> : <b>{(v * 100).toFixed(2)}%</b>;
const renderVal = (v: any) => v == null ? <span style={{ color: '#aaa' }}>N/A</span> : <b>{v}</b>;

const getStatusStyle = (status: string) => {
  const s = (status || '').toUpperCase();
  if (s === 'SUCCESS' || s === 'FOUND') return { bg: '#e8f5e9', color: '#2e7d32', border: '#a5d6a7' };
  if (['NOT_FOUND', 'FAILED', 'SPOOF_DETECTED', 'DISPUTE'].includes(s)) return { bg: '#ffebee', color: '#c62828', border: '#ef9a9a' };
  if (s === 'NOT_A_COW') return { bg: '#f3e5f5', color: '#6a1b9a', border: '#ce93d8' };
  if (s === 'DUPLICATE') return { bg: '#fff3e0', color: '#e65100', border: '#ffcc02' };
  return { bg: '#f5f5f5', color: '#616161', border: '#e0e0e0' };
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
  const isGood = value != null && threshold != null
    ? (higherIsBetter ? value >= threshold : value < threshold)
    : null;

  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{label}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography variant="caption" sx={{ fontWeight: 800, color: isGood === true ? 'success.main' : isGood === false ? 'error.main' : 'text.primary' }}>
            {pct != null ? `${pct.toFixed(1)}%` : 'N/A'}
          </Typography>
          {isGood === true && <CheckCircleIcon sx={{ fontSize: 14, color: 'success.main' }} />}
          {isGood === false && <CancelIcon sx={{ fontSize: 14, color: 'error.main' }} />}
        </Box>
      </Box>
      {pct != null && (
        <Box sx={{ height: 6, bgcolor: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
          <Box sx={{
            height: '100%', width: `${pct}%`, borderRadius: 3,
            bgcolor: isGood === true ? 'success.main' : isGood === false ? 'error.main' : 'primary.main',
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
  const [log, setLog] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [previewImg, setPreviewImg] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  useEffect(() => {
    if (!id) return;
    setIsLoading(true);
    axios.get(`${API_BASE}/api/admin/analytics/ai-logs/${id}`)
      .then(res => { if (res.data.success) setLog(res.data.data); })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [id]);

  const handleToggleCorrect = async (newVal: boolean) => {
    if (!log) return;
    const finalVal = log.isAiOutcomeCorrect === newVal ? null : newVal;
    setLog((prev: any) => ({ ...prev, isAiOutcomeCorrect: finalVal }));
    try {
      await axios.put(`${API_BASE}/api/admin/analytics/ai-logs/${id}`, { isAiOutcomeCorrect: finalVal });
    } catch {
      // revert
      setLog((prev: any) => ({ ...prev, isAiOutcomeCorrect: log.isAiOutcomeCorrect }));
    }
  };

  const handleDelete = async () => {
    try {
      await axios.delete(`${API_BASE}/api/admin/analytics/ai-logs/${id}`);
      navigate('/analytics', { replace: true });
    } catch {
      alert('Failed to delete log.');
    }
  };

  const handleCopyId = () => {
    navigator.clipboard.writeText(id || '');
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
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

  return (
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
                <Chip label={log.endpoint?.toUpperCase() || 'N/A'} size="small" variant="outlined" color="primary" sx={{ fontWeight: 600 }} />

              </Box>
              <Typography variant="h6" sx={{ fontWeight: 800, color: 'text.primary', mb: 0.25 }}>
                {log.matchedCowName || log.cowName || 'No Match Found'}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {new Date(log.timestamp).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'medium' })}
                {' · '}
                <b>{log.inferenceTimeMs}ms</b> inference
              </Typography>
              {log.cowId && (
                <Typography variant="caption" sx={{ color: 'text.disabled', fontFamily: 'monospace', display: 'block', mt: 0.5 }}>
                  Matched ID: {log.cowId}
                </Typography>
              )}
            </Box>

            {/* Final Confidence Score */}
              {log.endpoint === 'search' && (log.ensembleScore != null || log.xgbMappedScore != null) && (
              <Box sx={{ textAlign: 'center', flexShrink: 0 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontWeight: 600, textTransform: 'uppercase', fontSize: '0.6rem', mb: 0.5 }}>
                  Confidence
                </Typography>
                <Typography sx={{
                  fontSize: '2rem', fontWeight: 900, lineHeight: 1,
                  color: (log.ensembleScore ?? log.xgbMappedScore) >= 0.85 ? 'success.main'
                    : (log.ensembleScore ?? log.xgbMappedScore) >= 0.6 ? 'warning.main' : 'error.main'
                }}>
                  {((log.ensembleScore ?? log.xgbMappedScore) * 100).toFixed(0)}%
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
          <SectionCard title="📸  Input Images" color="#1565c0">
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
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, display: 'block', mb: 1 }}>Top DB Match Image</Typography>
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

        {/* Detection Checks */}
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <SectionCard title="🔬  Detection Checks" color="#4527a0">
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
        </Grid>

        {/* AI Pipeline */}
        <Grid size={{ xs: 12, sm: 6, md: 4 }}>
          <SectionCard title="🧠  AI Pipeline Scores" color="#1b5e20">
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, display: 'block', mb: 1, textTransform: 'uppercase', fontSize: '0.65rem' }}>
              Step 1 · Expert Features
            </Typography>
            <ScoreBar label="Spatial Muzzle Sim" value={log.spatialMuzzleSim} threshold={0.6} />
            <ScoreBar label="Spatial Face Sim" value={log.spatialFaceSim} threshold={0.6} />
            <ScoreBar label="Face Legacy Score" value={log.faceSimilarityScore} threshold={0.6} />
            <ScoreBar label="Muzzle Legacy Score" value={log.muzzleSimilarityScore} threshold={0.6} />
            <DataRow label="Physical Ridge Matches" value={renderVal(log.lgMatches)} />
            <DataRow label="Inlier Ratio" value={renderVal(log.tradInlierRatio)} />

            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, display: 'block', mb: 1, textTransform: 'uppercase', fontSize: '0.65rem' }}>
              Step 2 · ML Classifier (XGBoost)
            </Typography>
            <ScoreBar label="XGB Mapped Score" value={log.xgbMappedScore} threshold={0.85} />

            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, display: 'block', mb: 1, textTransform: 'uppercase', fontSize: '0.65rem' }}>
              Step 3 · Gatekeeper Verdict
            </Typography>
            <ScoreBar label="DS Belief Match" value={log.dsBeliefMatch} threshold={0.60} />
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

        {/* Raw Metadata */}
        <Grid size={{ xs: 12, sm: 6 }}>
          <SectionCard title="📋  Record Metadata" color="#5d4037">
            <DataRow label="Record ID" value={<Typography component="span" sx={{ fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all' }}>{log._id}</Typography>} />
            <DataRow label="Timestamp" value={new Date(log.timestamp).toISOString()} />
            <DataRow label="Inference Time" value={`${log.inferenceTimeMs} ms`} />
            <DataRow label="Endpoint" value={log.endpoint?.toUpperCase() || 'N/A'} />
            <DataRow label="Aligned SSIM" value={renderVal(log.tradAlignedSsim)} />
            <DataRow label="LBP Distance" value={renderVal(log.tradLbpDist)} />
            <DataRow label="Muzzle Threshold" value={renderVal(log.muzzleThreshold)} />
            <DataRow label="Spoof Threshold" value={renderVal(log.spoofThreshold)} />
          </SectionCard>
        </Grid>
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
  );
}
