import React, { useState } from 'react';
import {
  Box, Typography, Paper, Grid, Chip, Button, Collapse, FormGroup, IconButton,
  FormControlLabel, Checkbox, Badge, Tooltip, FormControl, Select, MenuItem,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TablePagination, Avatar
} from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import DownloadIcon from '@mui/icons-material/Download';

import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import RemoveIcon from '@mui/icons-material/Remove';
import RefreshIcon from '@mui/icons-material/Refresh';
import CircularProgress from '@mui/material/CircularProgress';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '@gonidhi/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PullToRefresh from 'react-simple-pull-to-refresh';

// ─── Status helpers ────────────────────────────────────────────────────────────
const getStatusStyle = (status: string) => {
  const s = (status || '').toUpperCase();
  if (s === 'SUCCESS' || s === 'FOUND') return { bg: '#e8f5e9', color: '#2e7d32', border: '#a5d6a7', label: s.replace(/_/g, ' ') };
  if (['NOT_FOUND', 'FAILED', 'SPOOF_DETECTED'].includes(s)) return { bg: '#ffebee', color: '#c62828', border: '#ef9a9a', label: s.replace(/_/g, ' ') };
  if (s === 'NOT_A_COW') return { bg: '#f3e5f5', color: '#6a1b9a', border: '#ce93d8', label: 'NOT A COW' };
  if (['DUPLICATE', 'DISPUTE'].includes(s)) return { bg: '#fff3e0', color: '#e65100', border: '#ffcc02', label: s.replace(/_/g, ' ') };
  return { bg: '#f5f5f5', color: '#616161', border: '#e0e0e0', label: s || 'N/A' };
};

const confidenceColor = (v: number) =>
  v >= 0.85 ? 'success.main' : v >= 0.6 ? 'warning.main' : 'error.main';

const formatEndpoint = (ep?: string) => {
  if (!ep) return 'N/A';
  const lower = ep.toLowerCase();
  if (lower.includes('search')) return 'SEARCH';
  if (lower.includes('register') || lower.includes('registration')) return 'REGISTER';
  return 'UNKNOWN';
};

// ─── Inline correctness toggle ─────────────────────────────────────────────────
function CorrectnessToggle({ value, onChange }: { value: boolean | null | undefined; onChange: (v: boolean | null) => void }) {
  const handleClick = (e: React.MouseEvent, next: boolean) => {
    e.stopPropagation();
    onChange(value === next ? null : next);
  };

  return (
    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
      <Tooltip title="Mark correct">
        <IconButton
          size="small"
          onClick={e => handleClick(e, true)}
          color={value === true ? 'success' : 'default'}
          sx={{
            width: 28, height: 28, borderRadius: 1,
            bgcolor: value === true ? '#e8f5e9' : 'transparent',
            border: '1px solid',
            borderColor: value === true ? '#a5d6a7' : 'transparent',
          }}
        >
          <ThumbUpIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Mark incorrect">
        <IconButton
          size="small"
          onClick={e => handleClick(e, false)}
          color={value === false ? 'error' : 'default'}
          sx={{
            width: 28, height: 28, borderRadius: 1,
            bgcolor: value === false ? '#ffebee' : 'transparent',
            border: '1px solid',
            borderColor: value === false ? '#ef9a9a' : 'transparent',
          }}
        >
          <ThumbDownIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function LogRow({ log, onCorrectnessChange, onClick }: {
  log: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  onCorrectnessChange: (id: string, val: boolean | null) => void;
  onClick: () => void;
}) {
  const statusRaw = log.matchStatus || (log.success ? 'SUCCESS' : 'FAILED');
  const style = getStatusStyle(statusRaw);
  const confidence = log.ensembleScore ?? log.xgbMappedScore ?? null;
  const ts = new Date(log.timestamp);

  return (
    <TableRow
      hover
      onClick={onClick}
      sx={{
        cursor: 'pointer',
        '&:hover': { bgcolor: 'rgba(28, 57, 187, 0.04)' }
      }}
    >
      <TableCell>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar
            src={log.muzzleImgUrl || log.faceImgUrl}
            sx={{ width: 48, height: 48, bgcolor: 'primary.light', boxShadow: 1 }}
            variant="rounded"
          >
            🐄
          </Avatar>
          <Box>
            <Typography variant="body1" sx={{ fontWeight: 600, color: 'text.primary' }}>
              {ts.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', bgcolor: 'rgba(0,0,0,0.05)', px: 1, py: 0.2, borderRadius: 1, display: 'inline-block', mt: 0.5 }}>
              Inference: {(log.inferenceTimeMs / 1000).toFixed(2)}s
            </Typography>
          </Box>
        </Box>
      </TableCell>
      <TableCell>
        <Chip
          label={style.label}
          size="small"
          sx={{ bgcolor: style.bg, color: style.color, border: `1px solid ${style.border}`, fontWeight: 'bold' }}
        />
      </TableCell>
      <TableCell>
        <Chip label={formatEndpoint(log.endpoint)} size="small" variant="outlined" color="primary" sx={{ fontWeight: 600 }} />
      </TableCell>
      <TableCell>
        {confidence !== null ? (
          <Typography variant="body2" sx={{ fontWeight: 700, color: confidenceColor(confidence), fontFamily: 'monospace' }}>
            {(confidence * 100).toFixed(0)}%
          </Typography>
        ) : (
          <Typography variant="body2" color="text.disabled"><RemoveIcon sx={{ fontSize: 16 }} /></Typography>
        )}
      </TableCell>
      <TableCell onClick={e => e.stopPropagation()}>
        <CorrectnessToggle
          value={log.isAiOutcomeCorrect}
          onChange={val => onCorrectnessChange(log._id, val)}
        />
      </TableCell>
      <TableCell>
        <ChevronRightIcon color="action" />
      </TableCell>
    </TableRow>
  );
}

// ─── Stat tile ─────────────────────────────────────────────────────────────────
function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </Typography>
      <Typography variant="h4" sx={{ fontWeight: 700, color: 'text.primary', mt: 0.5 }}>
        {value}
      </Typography>
      {sub && <Typography variant="body2" color="text.secondary">{sub}</Typography>}
    </Box>
  );
}

// ─── Constants ─────────────────────────────────────────────────────────────────
const ALL_STATUSES = [
  { label: 'Success', value: 'SUCCESS' },
  { label: 'Found', value: 'FOUND' },
  { label: 'Not Found', value: 'NOT_FOUND' },
  { label: 'Not a Cow', value: 'NOT_A_COW' },
  { label: 'Duplicate', value: 'DUPLICATE' },
  { label: 'Dispute', value: 'DISPUTE' },
  { label: 'Spoof Detected', value: 'SPOOF_DETECTED' },
];
const ALL_TYPES = [
  { label: 'Registration', value: 'registration' },
  { label: 'Search', value: 'search' },
];

// ─── Page ──────────────────────────────────────────────────────────────────────
export default function Analytics() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isExporting, setIsExporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedYear, setSelectedYear] = useState('');
  const [appliedFilters, setAppliedFilters] = useState({ statuses: [] as string[], types: [] as string[], year: '' });

  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(50);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['analytics-logs', appliedFilters, page, rowsPerPage],
    queryFn: async () => {
      const res = await axios.get(`${API_BASE}/api/admin/analytics/ai-logs`, {
        params: {
          page: page + 1,
          limit: rowsPerPage,
          statuses: appliedFilters.statuses.join(',') || undefined,
          types: appliedFilters.types.join(',') || undefined,
          year: appliedFilters.year || undefined,
        }
      });
      return res.data;
    },
    staleTime: 180000
  });

  const logs = data?.data || [];
  const total = data?.total || 0;
  const metrics = data?.metrics || { avgTime: 0, successRate: 0, totalInferences: 0 };

  // Optimistic correctness update in list
  const handleCorrectnessChange = async (id: string, val: boolean | null) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryClient.setQueryData(['analytics-logs', appliedFilters, page, rowsPerPage], (oldData: any) => {
      if (!oldData) return oldData;
      return {
        ...oldData,
        data: oldData.data.map((log: any) => log._id === id ? { ...log, isAiOutcomeCorrect: val } : log) // eslint-disable-line @typescript-eslint/no-explicit-any
      };
    });

    try {
      await axios.put(`${API_BASE}/api/admin/analytics/ai-logs/${id}`, { isAiOutcomeCorrect: val });
    } catch {
      queryClient.invalidateQueries({ queryKey: ['analytics-logs'] });
    }
  };

  const handleApplyFilters = () => {
    setAppliedFilters({ statuses: selectedStatuses, types: selectedTypes, year: selectedYear });
    setPage(0);
    setShowFilters(false);
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams({
        statuses: appliedFilters.statuses.join(','),
        types: appliedFilters.types.join(','),
        year: appliedFilters.year,
      });
      const res = await axios.get(`${API_BASE}/api/admin/analytics/ai-logs/export?${params}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = 'ai_logs_export.csv';
      document.body.appendChild(a); a.click(); a.remove();
    } catch { alert('Failed to export.'); }
    finally { setIsExporting(false); }
  };

  const activeFilterCount = appliedFilters.statuses.length + appliedFilters.types.length + (appliedFilters.year ? 1 : 0);

  return (
    <PullToRefresh onRefresh={async () => { await refetch(); }} pullingContent="" maxPullDownDistance={100} resistance={2}>
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, mb: 3 }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
              AI Inference Logs
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Badge badgeContent={activeFilterCount || null} color="primary" sx={{ '& .MuiBadge-badge': { right: 5, top: 5 } }}>
              <Button
                size="small"
                variant={showFilters ? 'contained' : 'outlined'}
                startIcon={<FilterListIcon />}
                onClick={() => setShowFilters(!showFilters)}
                sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}
              >
                Filters
              </Button>
            </Badge>
            {activeFilterCount > 0 && (
              <Button
                size="small"
                variant="text"
                color="error"
                sx={{ textTransform: 'none', fontWeight: 600 }}
                onClick={() => setAppliedFilters({ statuses: [], types: [], year: '' })}
              >
                Clear
              </Button>
            )}
            <Button
              size="small"
              variant="outlined"
              startIcon={isRefetching ? <CircularProgress size={20} /> : <RefreshIcon />}
              onClick={() => { queryClient.resetQueries({ queryKey: ['analytics-logs', appliedFilters] }); refetch(); }}
              disabled={isLoading || isRefetching || isExporting}
              sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
            >
              {isRefetching ? 'Refreshing…' : 'Refresh'}
            </Button>
            <Button
              size="small"
              variant="contained"
              color="primary"
              startIcon={<DownloadIcon />}
              onClick={handleExport}
              disabled={isExporting}
              sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}
            >
              {isExporting ? 'Exporting…' : 'Export'}
            </Button>
          </Box>
        </Box>

        {/* ── Stat strip ── */}
        <Paper variant="outlined" sx={{ mb: 3, borderRadius: 2, overflow: 'hidden' }}>
          <Grid container>
            {[
              { label: 'Total Inferences', value: String(metrics.totalInferences || total) },
              { label: 'Avg Inference Time', value: `${(metrics.avgTime / 1000).toFixed(2)}s` },
              { label: 'Success Rate', value: `${(metrics.successRate * 100).toFixed(1)}%` },
            ].map((s, i, arr) => (
              <Grid key={s.label} size={{ xs: 12, sm: 4 }}>
                <Box sx={{ px: 3, py: 2, borderRight: { sm: i < arr.length - 1 ? '1px solid' : 'none' }, borderColor: 'divider', borderBottom: { xs: i < arr.length - 1 ? '1px solid' : 'none', sm: 'none' } }}>
                  <StatTile label={s.label} value={s.value} />
                </Box>
              </Grid>
            ))}
          </Grid>
        </Paper>

        {/* ── Filter panel ── */}
        <Collapse in={showFilters}>
          <Paper variant="outlined" sx={{ mb: 3, p: 3, borderRadius: 2, bgcolor: 'background.paper' }}>
            <Grid container spacing={4}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ textTransform: 'uppercase', mb: 1.5 }}>
                  Match Status
                </Typography>
                <Grid container spacing={1}>
                  {ALL_STATUSES.map(s => (
                    <Grid key={s.value} size={{ xs: 6 }}>
                      <FormControlLabel
                        control={
                          <Checkbox checked={selectedStatuses.includes(s.value)}
                            onChange={e => setSelectedStatuses(prev => e.target.checked ? [...prev, s.value] : prev.filter(x => x !== s.value))}
                          />
                        }
                        label={<Typography variant="body2">{s.label}</Typography>}
                      />
                    </Grid>
                  ))}
                </Grid>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ textTransform: 'uppercase', mb: 1.5 }}>
                  Type
                </Typography>
                <FormGroup>
                  {ALL_TYPES.map(t => (
                    <FormControlLabel key={t.value}
                      control={<Checkbox checked={selectedTypes.includes(t.value)}
                        onChange={e => setSelectedTypes(prev => e.target.checked ? [...prev, t.value] : prev.filter(x => x !== t.value))} />}
                      label={<Typography variant="body2">{t.label}</Typography>}
                    />
                  ))}
                </FormGroup>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Typography variant="subtitle2" color="text.secondary" sx={{ textTransform: 'uppercase', mb: 1.5 }}>
                  Year
                </Typography>
                <FormControl fullWidth sx={{ mb: 2 }}>
                  <Select value={selectedYear} displayEmpty onChange={e => setSelectedYear(e.target.value)} sx={{ borderRadius: 2 }}>
                    <MenuItem value=""><em>All Years</em></MenuItem>
                    <MenuItem value="2024">2024</MenuItem>
                    <MenuItem value="2025">2025</MenuItem>
                    <MenuItem value="2026">2026</MenuItem>
                  </Select>
                </FormControl>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button variant="outlined" color="inherit" fullWidth onClick={() => { setSelectedStatuses([]); setSelectedTypes([]); setSelectedYear(''); }}>
                    Reset
                  </Button>
                  <Button variant="contained" color="primary" fullWidth onClick={handleApplyFilters}>
                    Apply
                  </Button>
                </Box>
              </Grid>
            </Grid>
          </Paper>
        </Collapse>

        {/* ── Table ── */}
        <Paper sx={{ width: '100%', overflow: 'hidden', borderRadius: 3, boxShadow: '0 8px 32px rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <TableContainer sx={{ maxHeight: 'calc(100vh - 250px)' }}>
            <Table stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ bgcolor: '#f8f9fa', fontWeight: 'bold' }}>Record</TableCell>
                  <TableCell sx={{ bgcolor: '#f8f9fa', fontWeight: 'bold' }}>Status</TableCell>
                  <TableCell sx={{ bgcolor: '#f8f9fa', fontWeight: 'bold' }}>Type</TableCell>
                  <TableCell sx={{ bgcolor: '#f8f9fa', fontWeight: 'bold' }}>Confidence</TableCell>
                  <TableCell sx={{ bgcolor: '#f8f9fa', fontWeight: 'bold' }}>AI Correct?</TableCell>
                  <TableCell sx={{ bgcolor: '#f8f9fa', fontWeight: 'bold' }}></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {logs.map((log: any) => ( // eslint-disable-line @typescript-eslint/no-explicit-any
                  <LogRow
                    key={log._id}
                    log={log}
                    onCorrectnessChange={handleCorrectnessChange}
                    onClick={() => navigate(`/analytics/${log._id}`)}
                  />
                ))}

                {logs.length === 0 && !isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                      <Typography variant="body1" color="textSecondary">No records match your criteria.</Typography>
                    </TableCell>
                  </TableRow>
                )}

                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 8 }}>
                      <CircularProgress size={40} />
                      <Typography variant="body2" sx={{ mt: 1 }} color="textSecondary">Loading analytics logs...</Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          <TablePagination
            rowsPerPageOptions={[10, 25, 50, 100]}
            component="div"
            count={total}
            rowsPerPage={rowsPerPage}
            page={page}
            onPageChange={(_, p) => setPage(p)}
            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            sx={{ borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}
          />
        </Paper>
      </Box>
    </PullToRefresh>
  );
}

