import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Typography, Paper, Grid, Chip, Button, Collapse, FormGroup,
  FormControlLabel, Checkbox, Divider, Skeleton, InputAdornment,
  TextField, IconButton, Badge, Tooltip, FormControl, Select, MenuItem
} from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import DownloadIcon from '@mui/icons-material/Download';
import SearchIcon from '@mui/icons-material/Search';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ThumbUpIcon from '@mui/icons-material/ThumbUp';
import ThumbDownIcon from '@mui/icons-material/ThumbDown';
import RemoveIcon from '@mui/icons-material/Remove';
import RefreshIcon from '@mui/icons-material/Refresh';
import CircularProgress from '@mui/material/CircularProgress';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { API_BASE } from '@ama-gau-dhana/shared';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';

// ─── Status helpers ────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { dot: string; label: string }> = {
  SUCCESS:        { dot: '#22c55e', label: 'Success' },
  FOUND:          { dot: '#22c55e', label: 'Found' },
  NOT_FOUND:      { dot: '#ef4444', label: 'Not Found' },
  FAILED:         { dot: '#ef4444', label: 'Failed' },
  SPOOF_DETECTED: { dot: '#ef4444', label: 'Spoof' },
  DISPUTE:        { dot: '#f59e0b', label: 'Dispute' },
  DUPLICATE:      { dot: '#f59e0b', label: 'Duplicate' },
  NOT_A_COW:      { dot: '#8b5cf6', label: 'Not a Cow' },
};

const getMeta = (status: string) =>
  STATUS_META[status?.toUpperCase()] ?? { dot: '#9ca3af', label: status || '—' };

const confidenceColor = (v: number) =>
  v >= 0.85 ? '#22c55e' : v >= 0.6 ? '#f59e0b' : '#ef4444';

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
          sx={{
            width: 26, height: 26, borderRadius: 1,
            bgcolor: value === true ? '#dcfce7' : 'transparent',
            color: value === true ? '#16a34a' : '#9ca3af',
            border: '1px solid',
            borderColor: value === true ? '#bbf7d0' : 'transparent',
            '&:hover': { bgcolor: '#f0fdf4', color: '#16a34a', borderColor: '#bbf7d0' },
            transition: 'all 0.15s',
          }}
        >
          <ThumbUpIcon sx={{ fontSize: 13 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="Mark incorrect">
        <IconButton
          size="small"
          onClick={e => handleClick(e, false)}
          sx={{
            width: 26, height: 26, borderRadius: 1,
            bgcolor: value === false ? '#fee2e2' : 'transparent',
            color: value === false ? '#dc2626' : '#9ca3af',
            border: '1px solid',
            borderColor: value === false ? '#fecaca' : 'transparent',
            '&:hover': { bgcolor: '#fef2f2', color: '#dc2626', borderColor: '#fecaca' },
            transition: 'all 0.15s',
          }}
        >
          <ThumbDownIcon sx={{ fontSize: 13 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

// ─── Single row ────────────────────────────────────────────────────────────────
function LogRow({ log, onCorrectnessChange, onClick }: {
  log: any;
  onCorrectnessChange: (id: string, val: boolean | null) => void;
  onClick: () => void;
}) {
  const status = log.matchStatus || (log.success ? 'SUCCESS' : 'FAILED');
  const meta = getMeta(status);
  const confidence = log.ensembleScore ?? log.xgbMappedScore ?? null;
  const ts = new Date(log.timestamp);

  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '28px 56px 1fr auto auto auto auto' },
        alignItems: 'center',
        gap: { xs: 1, sm: 2 },
        px: 2,
        py: 1.5,
        cursor: 'pointer',
        borderBottom: '1px solid',
        borderColor: 'divider',
        transition: 'background 0.12s',
        '&:hover': { bgcolor: 'rgba(0,0,0,0.025)' },
        '&:last-child': { borderBottom: 'none' },
      }}
    >
      {/* Status dot */}
      <Box sx={{ display: { xs: 'none', sm: 'flex' }, justifyContent: 'center' }}>
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: meta.dot, flexShrink: 0 }} />
      </Box>

      {/* Thumbnail */}
      <Box sx={{ display: { xs: 'none', sm: 'block' }, flexShrink: 0 }}>
        {log.muzzleImgUrl || log.faceImgUrl ? (
          <Box
            component="img"
            src={log.muzzleImgUrl || log.faceImgUrl}
            alt=""
            sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 1, border: '1px solid', borderColor: 'divider', display: 'block' }}
          />
        ) : (
          <Box sx={{ width: 40, height: 40, borderRadius: 1, bgcolor: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography sx={{ fontSize: 18, lineHeight: 1 }}>🐄</Typography>
          </Box>
        )}
      </Box>

      {/* Main info */}
      <Box sx={{ minWidth: 0 }}>
        {/* Mobile: show status dot inline */}
        <Box sx={{ display: { xs: 'flex', sm: 'none' }, alignItems: 'center', gap: 0.75, mb: 0.25 }}>
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: meta.dot, flexShrink: 0 }} />
          <Typography variant="caption" sx={{ color: meta.dot, fontWeight: 600, fontSize: '0.7rem' }}>{meta.label}</Typography>
        </Box>

        <Typography
          variant="body2"
          sx={{ fontWeight: 600, color: 'text.primary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.82rem' }}
        >
          {log.matchedCowName || log.cowName || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>No match</span>}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.2 }}>
          <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.72rem' }}>
            {ts.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            {' '}
            {ts.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </Typography>
          <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.72rem' }}>·</Typography>
          <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.72rem', fontFamily: 'monospace' }}>
            {log.inferenceTimeMs}ms
          </Typography>
          {/* Mobile: show endpoint */}
          <Box sx={{ display: { xs: 'block', sm: 'none' } }}>
            <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.72rem' }}>· {log.endpoint?.toUpperCase()}</Typography>
          </Box>
        </Box>
      </Box>

      {/* Status badge — desktop */}
      <Box sx={{ display: { xs: 'none', sm: 'block' }, flexShrink: 0 }}>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600, fontSize: '0.7rem',
            color: meta.dot,
            bgcolor: `${meta.dot}18`,
            px: 1, py: 0.4,
            borderRadius: 1,
            whiteSpace: 'nowrap',
            display: 'block',
          }}
        >
          {meta.label}
        </Typography>
      </Box>

      {/* Endpoint — desktop */}
      <Box sx={{ display: { xs: 'none', sm: 'block' }, flexShrink: 0 }}>
        <Typography variant="caption" sx={{ color: '#6b7280', fontFamily: 'monospace', fontSize: '0.72rem' }}>
          {log.endpoint?.toUpperCase() || '—'}
        </Typography>
      </Box>

      {/* Confidence */}
      <Box sx={{ flexShrink: 0, minWidth: 38, textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
        {confidence !== null ? (
          <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.78rem', color: confidenceColor(confidence), fontFamily: 'monospace' }}>
            {(confidence * 100).toFixed(0)}%
          </Typography>
        ) : (
          <Typography variant="caption" sx={{ color: '#d1d5db' }}><RemoveIcon sx={{ fontSize: 12 }} /></Typography>
        )}
      </Box>

      {/* AI correctness toggle */}
      <Box sx={{ flexShrink: 0 }} onClick={e => e.stopPropagation()}>
        <CorrectnessToggle
          value={log.isAiOutcomeCorrect}
          onChange={val => onCorrectnessChange(log._id, val)}
        />
      </Box>

      {/* Chevron */}
      <Box sx={{ display: { xs: 'none', sm: 'flex' }, flexShrink: 0 }}>
        <ChevronRightIcon sx={{ fontSize: 16, color: '#d1d5db' }} />
      </Box>
    </Box>
  );
}

// ─── Stat tile ─────────────────────────────────────────────────────────────────
function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Box>
      <Typography variant="caption" sx={{ color: '#6b7280', fontWeight: 500, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '1.5rem', fontWeight: 700, color: 'text.primary', lineHeight: 1.15, mt: 0.25 }}>
        {value}
      </Typography>
      {sub && <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.7rem' }}>{sub}</Typography>}
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
  const [searchQuery, setSearchQuery] = useState('');

  const rowsPerPage = 25;

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    refetch,
    isRefetching
  } = useInfiniteQuery({
    queryKey: ['analytics-logs', appliedFilters],
    queryFn: async ({ pageParam = 1 }) => {
      const res = await axios.get(`${API_BASE}/api/admin/analytics/ai-logs`, {
        params: {
          page: pageParam,
          limit: rowsPerPage,
          statuses: appliedFilters.statuses.join(',') || undefined,
          types: appliedFilters.types.join(',') || undefined,
          year: appliedFilters.year || undefined,
        }
      });
      return res.data;
    },
    getNextPageParam: (lastPage, allPages) => {
      const totalLoaded = allPages.reduce((acc, page) => acc + (page.data?.length || 0), 0);
      if (lastPage.success && totalLoaded < lastPage.total) {
        return allPages.length + 1;
      }
      return undefined;
    },
    initialPageParam: 1,
    staleTime: 180000
  });

  const logs = data?.pages.flatMap(page => page.data) || [];
  const total = data?.pages[0]?.total || 0;
  const metrics = data?.pages[0]?.metrics || { avgTime: 0, successRate: 0, totalInferences: 0 };
  const isLoading = isFetching && !isFetchingNextPage;

  // Optimistic correctness update in list
  const handleCorrectnessChange = async (id: string, val: boolean | null) => {
    queryClient.setQueryData(['analytics-logs', appliedFilters], (oldData: any) => {
      if (!oldData) return oldData;
      return {
        ...oldData,
        pages: oldData.pages.map((page: any) => ({
          ...page,
          data: page.data.map((log: any) => log._id === id ? { ...log, isAiOutcomeCorrect: val } : log)
        }))
      };
    });

    try {
      await axios.put(`${API_BASE}/api/admin/analytics/ai-logs/${id}`, { isAiOutcomeCorrect: val });
    } catch {
      // revert by invalidating cache
      queryClient.invalidateQueries({ queryKey: ['analytics-logs'] });
    }
  };

  const handleApplyFilters = () => {
    setAppliedFilters({ statuses: selectedStatuses, types: selectedTypes, year: selectedYear });
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
      a.href = url; a.download = 'ai_insights_export.csv';
      document.body.appendChild(a); a.click(); a.remove();
    } catch { alert('Failed to export.'); }
    finally { setIsExporting(false); }
  };

  const filteredLogs = searchQuery.trim()
    ? logs.filter(l =>
        [l.matchedCowName, l.cowName, l.endpoint, l.matchStatus]
          .some(v => (v || '').toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : logs;

  const hasMore = hasNextPage;
  const activeFilterCount = appliedFilters.statuses.length + appliedFilters.types.length + (appliedFilters.year ? 1 : 0);

  return (
    <Box sx={{ width: '100%', overflowX: 'hidden' }}>

      {/* ── Page header ── */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Box>
          <Typography sx={{ fontSize: '1.15rem', fontWeight: 700, color: 'text.primary', letterSpacing: '-0.01em' }}>
            AI Inference Logs
          </Typography>
          <Typography variant="caption" sx={{ color: '#9ca3af' }}>
            Biometric identification audit trail
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={isRefetching ? <CircularProgress size={15} /> : <RefreshIcon sx={{ fontSize: 15 }} />}
            onClick={() => queryClient.resetQueries({ queryKey: ['analytics-logs', appliedFilters] })}
            disabled={isFetching || isRefetching || isExporting}
            sx={{ borderRadius: 1.5, textTransform: 'none', fontSize: '0.8rem', borderColor: 'divider', color: 'text.secondary', '&:hover': { borderColor: 'text.primary', color: 'text.primary' } }}
          >
            {isRefetching ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button
            size="small"
            variant="outlined"
            startIcon={<DownloadIcon sx={{ fontSize: 15 }} />}
            onClick={handleExport}
            disabled={isExporting}
            sx={{ borderRadius: 1.5, textTransform: 'none', fontSize: '0.8rem', borderColor: 'divider', color: 'text.secondary', '&:hover': { borderColor: 'text.primary', color: 'text.primary' } }}
          >
            {isExporting ? 'Exporting…' : 'Export'}
          </Button>
        </Box>
      </Box>

      {/* ── Stat strip ── */}
      <Paper
        variant="outlined"
        sx={{ mb: 3, borderRadius: 2, overflow: 'hidden', boxShadow: 'none' }}
      >
        <Grid container>
          {[
            { label: 'Total Inferences', value: String(metrics.totalInferences || total) },
            { label: 'Avg Inference Time', value: `${Math.round(metrics.avgTime)} ms` },
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

      {/* ── Toolbar ── */}
      <Box sx={{ display: 'flex', gap: 1, mb: showFilters ? 1.5 : 2, flexWrap: 'wrap' }}>
        <TextField
          placeholder="Search records…"
          size="small"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          sx={{
            flex: 1, minWidth: 160,
            '& .MuiOutlinedInput-root': {
              borderRadius: 1.5, fontSize: '0.82rem',
              '& fieldset': { borderColor: 'divider' },
            }
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 16, color: '#9ca3af' }} />
              </InputAdornment>
            )
          }}
        />
        <Badge badgeContent={activeFilterCount || null} color="primary" sx={{ '& .MuiBadge-badge': { fontSize: '0.65rem', minWidth: 16, height: 16 } }}>
          <Button
            size="small"
            variant={showFilters ? 'contained' : 'outlined'}
            startIcon={<FilterListIcon sx={{ fontSize: 15 }} />}
            onClick={() => setShowFilters(!showFilters)}
            sx={{ borderRadius: 1.5, textTransform: 'none', fontSize: '0.8rem', borderColor: 'divider', color: showFilters ? undefined : 'text.secondary', whiteSpace: 'nowrap' }}
          >
            Filter
          </Button>
        </Badge>
        {activeFilterCount > 0 && (
          <Button
            size="small"
            variant="text"
            sx={{ color: '#9ca3af', textTransform: 'none', fontSize: '0.8rem', '&:hover': { color: 'error.main' } }}
            onClick={() => setAppliedFilters({ statuses: [], types: [], year: '' })}
          >
            Clear
          </Button>
        )}
      </Box>

      {/* ── Filter panel ── */}
      <Collapse in={showFilters}>
        <Paper variant="outlined" sx={{ mb: 2, p: 2, borderRadius: 1.5, boxShadow: 'none' }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.68rem', letterSpacing: '0.04em', display: 'block', mb: 1 }}>
                Match Status
              </Typography>
              <Grid container spacing={0}>
                {ALL_STATUSES.map(s => (
                  <Grid key={s.value} size={{ xs: 6 }}>
                    <FormControlLabel
                      control={
                        <Checkbox size="small" checked={selectedStatuses.includes(s.value)}
                          onChange={e => setSelectedStatuses(prev => e.target.checked ? [...prev, s.value] : prev.filter(x => x !== s.value))}
                          sx={{ py: 0.4, '& .MuiSvgIcon-root': { fontSize: 16 } }}
                        />
                      }
                      label={<Typography sx={{ fontSize: '0.8rem' }}>{s.label}</Typography>}
                      sx={{ m: 0 }}
                    />
                  </Grid>
                ))}
              </Grid>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.68rem', letterSpacing: '0.04em', display: 'block', mb: 1 }}>
                Type
              </Typography>
              <FormGroup>
                {ALL_TYPES.map(t => (
                  <FormControlLabel key={t.value}
                    control={<Checkbox size="small" checked={selectedTypes.includes(t.value)}
                      onChange={e => setSelectedTypes(prev => e.target.checked ? [...prev, t.value] : prev.filter(x => x !== t.value))}
                      sx={{ py: 0.4, '& .MuiSvgIcon-root': { fontSize: 16 } }} />}
                    label={<Typography sx={{ fontSize: '0.8rem' }}>{t.label}</Typography>}
                    sx={{ m: 0 }}
                  />
                ))}
              </FormGroup>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', fontSize: '0.68rem', letterSpacing: '0.04em', display: 'block', mb: 1 }}>
                Year
              </Typography>
              <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
                <Select value={selectedYear} displayEmpty onChange={e => setSelectedYear(e.target.value)} sx={{ borderRadius: 1.5, fontSize: '0.82rem' }}>
                  <MenuItem value=""><em>All</em></MenuItem>
                  <MenuItem value="2024">2024</MenuItem>
                  <MenuItem value="2025">2025</MenuItem>
                  <MenuItem value="2026">2026</MenuItem>
                </Select>
              </FormControl>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button size="small" variant="text" sx={{ color: '#9ca3af', textTransform: 'none', fontSize: '0.78rem' }}
                  onClick={() => { setSelectedStatuses([]); setSelectedTypes([]); setSelectedYear(''); }}>
                  Reset
                </Button>
                <Button size="small" variant="contained" onClick={handleApplyFilters}
                  sx={{ borderRadius: 1.5, textTransform: 'none', fontSize: '0.78rem', flex: 1 }}>
                  Apply
                </Button>
              </Box>
            </Grid>
          </Grid>
        </Paper>
      </Collapse>

      {/* ── Table ── */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden', boxShadow: 'none' }}>
        {/* Column headers — desktop only */}
        <Box sx={{
          display: { xs: 'none', sm: 'grid' },
          gridTemplateColumns: '28px 56px 1fr auto auto auto auto',
          gap: 2, px: 2, py: 1,
          bgcolor: '#fafafa',
          borderBottom: '1px solid', borderColor: 'divider',
        }}>
          {['', '', 'Record', 'Status', 'Type', 'Conf.', 'AI Correct?'].map((h, i) => (
            <Typography key={i} variant="caption" sx={{ color: '#6b7280', fontWeight: 600, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {h}
            </Typography>
          ))}
        </Box>

        {/* Rows */}
        {isLoading && logs.length === 0
          ? Array.from({ length: 8 }).map((_, i) => (
              <Box key={i} sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Skeleton variant="text" width="60%" height={18} />
                <Skeleton variant="text" width="35%" height={14} />
              </Box>
            ))
          : filteredLogs.map(log => (
              <LogRow
                key={log._id}
                log={log}
                onCorrectnessChange={handleCorrectnessChange}
                onClick={() => navigate(`/analytics/${log._id}`)}
              />
            ))
        }

        {/* Empty state */}
        {!isLoading && filteredLogs.length === 0 && (
          <Box sx={{ py: 8, textAlign: 'center' }}>
            <Typography sx={{ color: '#9ca3af', fontSize: '0.875rem' }}>No records match your criteria</Typography>
          </Box>
        )}

        {/* Footer: count + load more */}
        <Box sx={{
          px: 2, py: 1.25, borderTop: '1px solid', borderColor: 'divider',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', bgcolor: '#fafafa'
        }}>
          <Typography variant="caption" sx={{ color: '#9ca3af', fontSize: '0.72rem' }}>
            {filteredLogs.length} of {total} records
          </Typography>
          {hasMore && !searchQuery && (
            <Button
              size="small"
              variant="text"
              disabled={isFetchingNextPage}
              onClick={() => fetchNextPage()}
              sx={{ color: 'primary.main', textTransform: 'none', fontSize: '0.78rem' }}
            >
              {isFetchingNextPage ? 'Loading…' : `Load ${Math.min(rowsPerPage, total - logs.length)} more`}
            </Button>
          )}
        </Box>
      </Paper>
    </Box>
  );
}
