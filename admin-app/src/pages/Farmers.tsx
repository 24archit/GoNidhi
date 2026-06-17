import { useEffect, useState } from 'react';
import PullToRefresh from 'react-simple-pull-to-refresh';
import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TablePagination, TextField, InputAdornment, Chip, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, DialogContentText, Button, CircularProgress, Avatar
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { Search as SearchIcon, Delete as DeleteIcon, Person as PersonIcon, Phone as PhoneIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import axios from 'axios';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { API_BASE } from '@gonidhi/shared';



export default function Farmers() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0); // 0-indexed for MUI
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const navigate = useNavigate();

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [farmerToDelete, setFarmerToDelete] = useState<string | null>(null);

  const handleRowClick = (id: string) => {
    navigate(`/farmers/${id}`);
  };

  const handleDeleteClick = (id: string) => {
    setFarmerToDelete(id);
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!farmerToDelete) return;
    try {
      await axios.delete(`${API_BASE}/api/admin/users/farmers/${farmerToDelete}`);
      setDeleteConfirmOpen(false);

      queryClient.invalidateQueries({ queryKey: ['farmers'] });

      setFarmerToDelete(null);
    } catch (err) {
      console.error("Failed to delete farmer", err);
      alert("Failed to delete farmer");
    }
  };

  // Debounce search input
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(search), 500);
    return () => clearTimeout(handler);
  }, [search]);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['farmers', page, rowsPerPage, debouncedSearch],
    queryFn: async () => {
      const res = await axios.get(`${API_BASE}/api/admin/users/farmers`, {
        params: {
          page: page + 1, // 1-indexed for backend
          limit: rowsPerPage,
          search: debouncedSearch
        }
      });
      if (res.data.success) {
        return { farmers: res.data.data, total: res.data.total };
      }
      throw new Error("Failed to fetch farmers");
    },
    staleTime: 180000
  });

  const farmers = data?.farmers || [];
  const total = data?.total || 0;

  const handleChangePage = (_: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleRefresh = async () => {
    await refetch();
  };

  return (
    <PullToRefresh onRefresh={handleRefresh} pullingContent="" maxPullDownDistance={100} resistance={2}>
      <Box>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
          <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
            Farmers Management
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
            placeholder="Search by name or phone..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
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
                  <TableCell sx={{ bgcolor: '#f8f9fa', fontWeight: 'bold' }}>Farmer Profile</TableCell>
                  <TableCell sx={{ bgcolor: '#f8f9fa', fontWeight: 'bold' }}>Contact</TableCell>
                  <TableCell sx={{ bgcolor: '#f8f9fa', fontWeight: 'bold' }}>Location</TableCell>
                  <TableCell sx={{ bgcolor: '#f8f9fa', fontWeight: 'bold' }}>Herd Size</TableCell>
                  <TableCell sx={{ bgcolor: '#f8f9fa', fontWeight: 'bold' }}>Joined On</TableCell>
                  <TableCell sx={{ bgcolor: '#f8f9fa', fontWeight: 'bold' }}>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {farmers.map((farmer) => (
                  <TableRow
                    hover
                    key={farmer._id}
                    sx={{
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'rgba(28, 57, 187, 0.04)' }
                    }}
                    onClick={() => handleRowClick(farmer._id)}
                  >
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Avatar
                          src={farmer.profilePicture}
                          sx={{ width: 48, height: 48, bgcolor: 'primary.light', boxShadow: 1 }}
                        >
                          {!farmer.profilePicture && <PersonIcon />}
                        </Avatar>
                        <Typography variant="body1" sx={{ fontWeight: 600, color: 'text.primary' }}>
                          {farmer.name || 'Unnamed Farmer'}
                        </Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <PhoneIcon fontSize="small" color="action" />
                        <Typography variant="body2">{farmer.contact?.phone || 'N/A'}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>{farmer.location?.village || 'Unknown Village'}</Typography>
                      <Typography variant="caption" color="textSecondary">{farmer.location?.district}, {farmer.location?.state}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={`${farmer.cows?.length || 0} Cattle`} color="primary" variant="outlined" size="small" sx={{ fontWeight: 'bold' }} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="textSecondary">{new Date(farmer.createdAt).toLocaleDateString()}</Typography>
                    </TableCell>
                    <TableCell>
                      <IconButton aria-label="delete row" size="small" color="error" onClick={(e) => { e.stopPropagation(); handleDeleteClick(farmer._id); }}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {farmers.length === 0 && !isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                      <Typography variant="body1" color="textSecondary">No farmers found in the system.</Typography>
                    </TableCell>
                  </TableRow>
                )}
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} align="center" sx={{ py: 8 }}>
                      <CircularProgress size={40} />
                      <Typography variant="body2" sx={{ mt: 1 }} color="textSecondary">Loading farmers...</Typography>
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
            onPageChange={handleChangePage}
            onRowsPerPageChange={handleChangeRowsPerPage}
          />
        </Paper>

        {/* Delete Confirmation Dialog */}
        <Dialog
          open={deleteConfirmOpen}
          onClose={() => setDeleteConfirmOpen(false)}
        >
          <DialogTitle>Delete Farmer Record</DialogTitle>
          <DialogContent>
            <DialogContentText>
              Are you sure you want to delete this farmer? This will also remove any cattle associated with them. This action cannot be undone.
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
            <Button onClick={handleConfirmDelete} color="error" variant="contained">
              Delete
            </Button>
          </DialogActions>
        </Dialog>

      </Box>
    </PullToRefresh>
  );
}
