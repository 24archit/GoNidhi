import { Grid, Paper, Typography, Box, CircularProgress } from '@mui/material';
import axios from 'axios';
import PullToRefresh from 'react-simple-pull-to-refresh';
import { People, Pets, Gavel, Warning } from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';

import { API_BASE } from '@ama-gau-dhana/shared';
import { useAuth } from '../contexts/AuthContext';

interface SystemStats {
  totalFarmers: number;
  totalCattle: number;
  totalDisputes: number;
  activeDisputes: number;
}

export default function Dashboard() {
  const { user } = useAuth();
  
  const { data: stats, isLoading: loading, refetch } = useQuery({
    queryKey: ['dashboardStats'],
    queryFn: async () => {
      const response = await axios.get(`${API_BASE}/api/admin/analytics/stats`);
      if (response.data.success) {
        return response.data.data as SystemStats;
      }
      throw new Error("Failed to fetch stats");
    }
  });

  if (loading) return <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}><CircularProgress /></Box>;

  const statCards = [
    { title: 'Total Farmers', value: stats?.totalFarmers || 0, icon: <People fontSize="large" color="primary" /> },
    { title: 'Registered Cattle', value: stats?.totalCattle || 0, icon: <Pets fontSize="large" color="primary" /> },
    { title: 'Active Disputes', value: stats?.activeDisputes || 0, icon: <Warning fontSize="large" color="error" /> },
    { title: 'Total Disputes', value: stats?.totalDisputes || 0, icon: <Gavel fontSize="large" color="secondary" /> },
  ];

  const handleRefresh = async () => {
    await refetch();
  };

  return (
    <PullToRefresh onRefresh={handleRefresh} pullingContent="" maxPullDownDistance={100} resistance={2}>
      <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 800, color: 'text.primary' }}>
          Welcome, <Box component="span" sx={{ color: 'primary.main' }}>{user?.name || 'Admin'}</Box>
        </Typography>
      </Box>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold', color: 'primary.main' }}>
        Overview
      </Typography>
      <Grid container spacing={3} sx={{ mt: 1 }}>
        {statCards.map((stat, idx) => (
          <Grid size={{ xs: 12, sm: 6, md: 3 }} key={idx}>
            <Paper sx={{ p: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: 1 }}>
              <Box>
                <Typography color="textSecondary" variant="subtitle2">
                  {stat.title}
                </Typography>
                <Typography variant="h4" sx={{ fontWeight: 'bold' }}>
                  {stat.value}
                </Typography>
              </Box>
              <Box sx={{ p: 1.5, borderRadius: '50%', backgroundColor: 'rgba(0,0,0,0.04)' }}>
                {stat.icon}
              </Box>
            </Paper>
          </Grid>
        ))}
      </Grid>
      
      <Box sx={{ mt: 4 }}>
        <Paper sx={{ p: 3, borderRadius: 1, minHeight: 300 }}>
          <Typography variant="h6" gutterBottom sx={{ fontWeight: 'bold' }}>
            Recent System Activity
          </Typography>
          <Typography color="textSecondary">
            System logs and recent events will be displayed here...
          </Typography>
        </Paper>
      </Box>
      </Box>
    </PullToRefresh>
  );
}
