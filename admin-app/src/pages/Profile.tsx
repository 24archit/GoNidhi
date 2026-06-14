import { Box, Typography, Paper, Grid, Avatar, Divider, Button } from '@mui/material';
import { useAuth } from '../contexts/AuthContext';
import { AccountCircle as AccountCircleIcon, Phone as PhoneIcon, Security as SecurityIcon } from '@mui/icons-material';

export default function Profile() {
  const { user, logout } = useAuth();

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto', mt: 4 }}>
      <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold', color: 'primary.main', textAlign: 'center' }}>
        Admin Profile
      </Typography>

      <Paper sx={{ p: 4, borderRadius: 1, mt: 3, textAlign: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
        <Avatar 
          sx={{ width: 100, height: 100, mx: 'auto', mb: 2, bgcolor: 'primary.main', fontSize: '3rem' }}
        >
          {user?.name?.charAt(0) || 'A'}
        </Avatar>
        
        <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
          {user?.name}
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          System Administrator
        </Typography>

        <Divider sx={{ my: 3 }} />

        <Grid container spacing={3} sx={{ textAlign: 'left' }}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <AccountCircleIcon sx={{ color: 'primary.main', mr: 2 }} />
              <Box>
                <Typography variant="caption" color="text.secondary">Full Name</Typography>
                <Typography variant="body1" sx={{ fontWeight: '500' }}>{user?.name || 'N/A'}</Typography>
              </Box>
            </Box>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <PhoneIcon sx={{ color: 'primary.main', mr: 2 }} />
              <Box>
                <Typography variant="caption" color="text.secondary">Contact Number</Typography>
                <Typography variant="body1" sx={{ fontWeight: '500' }}>{(user as any /* eslint-disable-line @typescript-eslint/no-explicit-any */)?.contact?.phone || 'N/A'}</Typography>
              </Box>
            </Box>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <SecurityIcon sx={{ color: 'primary.main', mr: 2 }} />
              <Box>
                <Typography variant="caption" color="text.secondary">Role</Typography>
                <Typography variant="body1" sx={{ fontWeight: '500' }}>{user?.role === 'ADMIN' ? 'Super Admin' : (user?.role || 'Admin')}</Typography>
              </Box>
            </Box>
          </Grid>
        </Grid>

        <Box sx={{ mt: 4 }}>
          <Button variant="outlined" color="error" fullWidth onClick={logout}>
            Log Out
          </Button>
        </Box>
      </Paper>
    </Box>
  );
}
