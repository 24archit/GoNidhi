import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PullToRefresh from 'react-simple-pull-to-refresh';
import { 
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer, 
  TableHead, TableRow, TablePagination, TextField, InputAdornment, Button, Chip, CircularProgress, Avatar
} from '@mui/material';
import { Search as SearchIcon, LocationOn as LocationOnIcon, Pets as PetsIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';

import { API_BASE } from '@ama-gau-dhana/shared';

export default function Cattle() {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const navigate = useNavigate();

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(search), 500);
    return () => clearTimeout(handler);
  }, [search]);

  const handleRowClick = (id: string) => {
    navigate(`/cattle/${id}`);
  };

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['cattle', page, rowsPerPage, debouncedSearch],
    queryFn: async () => {
      const res = await axios.get(`${API_BASE}/api/admin/cattle`, {
        params: { page: page + 1, limit: rowsPerPage, search: debouncedSearch }
      });
      if (res.data.success) {
        return { cattle: res.data.data, total: res.data.total };
      }
      throw new Error("Failed to fetch cattle");
    },
    staleTime: 180000
  });

  const cattle = data?.cattle || [];
  const total = data?.total || 0;

  const handleRefresh = async () => {
    await refetch();
  };

  return (
    <PullToRefresh onRefresh={handleRefresh} pullingContent="" maxPullDownDistance={100} resistance={2}>
      <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
          Cattle Directory
        </Typography>
        <Button 
          variant="outlined" 
          startIcon={isRefetching ? <CircularProgress size={20} /> : <RefreshIcon />} 
          onClick={() => { setPage(0); refetch(); }}
          disabled={isLoading || isRefetching}
          sx={{ borderRadius: 2 }}
        >
          {isRefetching ? 'Refreshing...' : 'Refresh'}
        </Button>
      </Box>

      <Paper sx={{ p: 2, mb: 3, borderRadius: 2 }}>
        <TextField
          fullWidth
          variant="outlined"
          placeholder="Global Search across all herds..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment>,
            }
          }}
          size="small"
        />
      </Paper>

      <Paper sx={{ width: '100%', overflow: 'hidden', borderRadius: 3, boxShadow: '0 8px 32px rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.05)' }}>
        <TableContainer sx={{ maxHeight: '65vh' }}>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ bgcolor: '#f8f9fa', fontWeight: 'bold' }}>Cattle Profile</TableCell>
                <TableCell sx={{ bgcolor: '#f8f9fa', fontWeight: 'bold' }}>Farmer</TableCell>
                <TableCell sx={{ bgcolor: '#f8f9fa', fontWeight: 'bold' }}>Location</TableCell>
                <TableCell sx={{ bgcolor: '#f8f9fa', fontWeight: 'bold' }}>Registration Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {cattle.map((cow) => (
                <TableRow 
                  hover 
                  key={cow._id} 
                  sx={{ 
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'rgba(28, 57, 187, 0.04)' }
                  }} 
                  onClick={() => handleRowClick(cow._id)}
                >
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Avatar 
                        src={cow.photos?.faceProfile || cow.photos?.muzzle} 
                        sx={{ width: 48, height: 48, bgcolor: 'primary.light', boxShadow: 1 }}
                      >
                        <PetsIcon />
                      </Avatar>
                      <Box>
                        <Typography variant="body1" sx={{ fontWeight: 600, color: 'text.primary' }}>
                          {cow.name || 'Unnamed Cow'}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', bgcolor: 'rgba(0,0,0,0.05)', px: 1, py: 0.2, borderRadius: 1 }}>
                          ID: {cow.tagNumber || 'Un-tagged'}
                        </Typography>
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>{cow.farmerId?.name || 'Unknown'}</Typography>
                    <Typography variant="caption" color="textSecondary">{cow.farmerId?.contact?.phone || 'No phone'}</Typography>
                  </TableCell>
                  <TableCell>
                    {cow.location ? (
                      <Button
                        size="small"
                        startIcon={<LocationOnIcon fontSize="small" />}
                        href={`https://www.google.com/maps?q=${cow.location.lat},${cow.location.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()} // Prevent row click when clicking maps link
                        sx={{ textTransform: 'none', borderRadius: 2, bgcolor: 'rgba(25, 118, 210, 0.05)' }}
                      >
                        View on Map
                      </Button>
                    ) : (
                      <Typography variant="caption" color="textSecondary">No Location</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip 
                      label={cow.aiMetadata?.status || 'UNKNOWN'} 
                      color={cow.aiMetadata?.status === 'SUCCESS' ? 'success' : (cow.isDispute ? 'error' : 'warning')} 
                      size="small" 
                      variant="outlined"
                      sx={{ fontWeight: 'bold' }}
                    />
                  </TableCell>
                </TableRow>
              ))}
              {cattle.length === 0 && !isLoading && (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 4 }}>
                    <Typography variant="body1" color="textSecondary">No cattle found in this directory.</Typography>
                  </TableCell>
                </TableRow>
              )}
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ py: 8 }}>
                    <CircularProgress size={40} />
                    <Typography variant="body2" sx={{ mt: 1 }} color="textSecondary">Loading cattle directory...</Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          rowsPerPageOptions={[10, 25, 50]}
          component="div"
          count={total}
          rowsPerPage={rowsPerPage}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
        />
      </Paper>
    </Box>
    </PullToRefresh>
  );
}
