import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TablePagination, CircularProgress, Avatar, Alert, AlertTitle, Button
} from '@mui/material';
import { Pets as PetsIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '@ama-gau-dhana/shared';

export default function PendingCattle() {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const navigate = useNavigate();

  const handleRowClick = (id: string) => {
    navigate(`/cattle/${id}`);
  };

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['pending-cattle', page, rowsPerPage],
    queryFn: async () => {
      const res = await axios.get(`${API_BASE}/api/admin/cattle/pending`, {
        params: { page: page + 1, limit: rowsPerPage }
      });
      if (res.data.success) {
        return { cattle: res.data.data, total: res.data.total };
      }
      throw new Error("Failed to fetch pending cattle");
    },
    staleTime: 180000, // Cache for 3 minutes for a nice user experience
  });

  const cattle = data?.cattle || [];
  const total = data?.total || 0;

  return (
    <Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
          Pending Registrations
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

      <Alert severity="warning" sx={{ mb: 3, borderRadius: 2 }}>
        <AlertTitle>System Cleanup Notice</AlertTitle>
        These are failed or stuck registrations (e.g. AI failures). To keep the database clean and ready, entries listed here are <strong>automatically deleted by 2 hours after their creation</strong>. No manual action is required. This page is for information purpose only.
      </Alert>

      {isError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load pending cattle: {(error as any).message}
        </Alert>
      )}

      <Paper sx={{ width: '100%', overflow: 'hidden', borderRadius: 3, boxShadow: '0 8px 32px rgba(0,0,0,0.05)', border: '1px solid rgba(0,0,0,0.05)' }}>
        <TableContainer sx={{ maxHeight: '65vh' }}>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ bgcolor: '#f8f9fa', fontWeight: 'bold' }}>Cattle Profile</TableCell>
                <TableCell sx={{ bgcolor: '#f8f9fa', fontWeight: 'bold' }}>Farmer</TableCell>
                <TableCell sx={{ bgcolor: '#f8f9fa', fontWeight: 'bold' }}>Created At</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {cattle.map((cow: any) => (
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
                    <Typography variant="body2">{new Date(cow.createdAt).toLocaleString()}</Typography>
                  </TableCell>
                </TableRow>
              ))}
              {cattle.length === 0 && !isLoading && !isError && (
                <TableRow>
                  <TableCell colSpan={3} align="center" sx={{ py: 4 }}>
                    <Typography variant="body1" color="textSecondary">No pending or stuck cattle found. Database is clean.</Typography>
                  </TableCell>
                </TableRow>
              )}
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={3} align="center" sx={{ py: 8 }}>
                    <CircularProgress size={40} />
                    <Typography variant="body2" sx={{ mt: 1 }} color="textSecondary">Loading pending cattle...</Typography>
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
  );
}
