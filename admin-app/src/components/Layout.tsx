import { Box, Drawer, List, ListItem, ListItemIcon, ListItemText, AppBar, Toolbar, Typography, IconButton, Button, Avatar } from '@mui/material';
import {
  Dashboard as DashboardIcon,
  People as PeopleIcon,
  Pets as PetsIcon,
  Gavel as GavelIcon,
  Analytics as AnalyticsIcon,
  Logout as LogoutIcon,
  Menu as MenuIcon,
  AddCircle as AddCircleIcon,
  Search as SearchIcon,
  HourglassEmpty as HourglassEmptyIcon
} from '@mui/icons-material';
import { useNavigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import BrandingFooter from './BrandingFooter';
import { useState } from 'react';
import type { ReactNode } from 'react';

const drawerWidth = 240;

export default function Layout({ children }: { children?: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const menuItems = [
    { text: 'Dashboard', icon: <DashboardIcon />, path: '/' },
    { text: 'Farmers', icon: <PeopleIcon />, path: '/farmers' },
    { text: 'Cattle', icon: <PetsIcon />, path: '/cattle' },
    { text: 'Disputes', icon: <GavelIcon />, path: '/disputes' },
    { text: 'Register Cattle', icon: <AddCircleIcon />, path: '/add-cow' },
    { text: 'Search Cattle', icon: <SearchIcon />, path: '/search' },
    { text: 'Pending Logs', icon: <HourglassEmptyIcon />, path: '/pending-cattle' },
    { text: 'AI Insights', icon: <AnalyticsIcon />, path: '/analytics' },
  ];

  const drawer = (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ height: 'env(safe-area-inset-top)' }} />
      <Toolbar />
      <List sx={{ flexGrow: 1 }}>
        {menuItems.map((item) => {
          const isSelected = location.pathname === item.path;
          return (
            <ListItem
              key={item.text}
              onClick={() => {
                navigate(item.path);
                setMobileOpen(false);
              }}
              sx={{
                cursor: 'pointer',
                backgroundColor: isSelected ? 'rgba(28, 57, 187, 0.08)' : 'transparent',
                borderRight: isSelected ? '4px solid #1C39BB' : '4px solid transparent',
                '&:hover': {
                  backgroundColor: 'rgba(28, 57, 187, 0.04)'
                }
              }}
            >
              <ListItemIcon sx={{ color: location.pathname === item.path ? 'primary.main' : 'inherit' }}>
                {item.icon}
              </ListItemIcon>
              <ListItemText primary={item.text} sx={{ color: location.pathname === item.path ? 'primary.main' : 'inherit' }} />
            </ListItem>
          );
        })}
      </List>
      <Box sx={{ height: 'env(safe-area-inset-bottom)' }} />
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', width: '100%', overflowX: 'hidden' }}>
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, backgroundColor: 'primary.main', color: 'white', boxShadow: 1, pt: 'env(safe-area-inset-top)' }}>
        <Toolbar>
          <IconButton
            color="inherit"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ mr: 2, display: { sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>

          <Box sx={{
            bgcolor: 'white',
            borderRadius: '50%',
            p: 0.25,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: { xs: 36, sm: 44 },
            height: { xs: 36, sm: 44 },
            mr: 1.5,
            flexShrink: 0
          }}>
            <Box
              component="img"
              src="/logo.png"
              alt="GoNidhi Logo"
              sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          </Box>
          <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start' }}>
            <Typography variant="h6" noWrap component="div" sx={{ display: 'flex', alignItems: 'center', letterSpacing: '0.5px', lineHeight: 1.1 }}>
              <span style={{ fontWeight: 800, marginLeft: '4px' }}>GoNidhi</span>
            </Typography>

            <Box sx={{
              display: 'inline-flex',
              alignItems: 'center',
              bgcolor: 'rgba(255, 255, 255, 0.15)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '8px',
              px: 0.75,
              py: 0.1,
              mt: 0.5
            }}>
              <Typography variant="caption" sx={{
                fontWeight: 700,
                color: 'white',
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
                fontSize: '0.55rem'
              }}>
                Admin Portal
              </Typography>
            </Box>
          </Box>

          <IconButton color="inherit" onClick={() => { navigate('/profile'); setMobileOpen(false); }} sx={{ mr: 2 }}>
            <Avatar
              sx={{ width: 32, height: 32, border: '2px solid rgba(255,255,255,0.8)', bgcolor: 'white', color: 'primary.main', fontSize: '1rem', fontWeight: 'bold' }}
            >
              {user?.name?.charAt(0) || 'A'}
            </Avatar>
          </IconButton>

          <Button color="inherit" onClick={logout} startIcon={<LogoutIcon />} sx={{ display: { xs: 'none', sm: 'flex' } }}>
            Logout
          </Button>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>
      <Box component="main" sx={{ flexGrow: 1, p: { xs: 2, sm: 3 }, width: { sm: `calc(100% - ${drawerWidth}px)` }, maxWidth: '100%', minWidth: 0, boxSizing: 'border-box', overflow: 'hidden', backgroundColor: 'background.default', minHeight: '100vh', display: 'flex', flexDirection: 'column', pb: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
        <Box sx={{ height: 'env(safe-area-inset-top)' }} />
        <Toolbar />

        <Box sx={{ flexGrow: 1 }}>
          {children || <Outlet />}
        </Box>
        <Box sx={{ mt: 4, display: 'flex', justifyContent: 'center' }}>
          <BrandingFooter />
        </Box>
      </Box>
    </Box>
  );
}
