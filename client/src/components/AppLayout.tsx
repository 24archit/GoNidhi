import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
    AppBar, Toolbar, Typography, Box, IconButton, BottomNavigation,
    BottomNavigationAction, Paper, Avatar, Stack, Drawer, List, ListItem,
    ListItemButton, ListItemIcon, ListItemText, Divider
} from '@mui/material';
import {
    Home as HomeIcon, Search as SearchIcon, Pets as CowIcon,
    Person as ProfileIcon, Menu as MenuIcon, Notifications as AlertIcon,
    CloudSync as CloudSyncIcon, AddCircle as AddCowIcon,
    WarningAmber
} from '@mui/icons-material';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import { syncManager } from '@gonidhi/shared';
import { Badge } from '@mui/material';
import BrandingFooter from './BrandingFooter';
import { useQuery } from '@tanstack/react-query';
import { getUserProfileAPI } from '../apis/apis';

interface AppLayoutProps {
    children: React.ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
    const [pendingCount, setPendingCount] = useState(0);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const mainRef = useRef<HTMLDivElement>(null);

    const { data: profileData } = useQuery({
        queryKey: ['userProfile'],
        queryFn: getUserProfileAPI
    });

    // Scroll to top of main container on route change
    useEffect(() => {
        if (mainRef.current) {
            mainRef.current.scrollTo(0, 0);
        }
    }, [location.pathname]);

    // Map current URL to BottomNavigation value
    let navValue = 0;
    if (location.pathname.startsWith('/my-cows')) navValue = 1;
    else if (location.pathname.startsWith('/search')) navValue = 2;
    else if (location.pathname.startsWith('/alerts')) navValue = 3;
    else if (location.pathname.startsWith('/user-profile')) navValue = 4;
    else navValue = 0; // Default to Home for '/' or unrecognized routes

    useEffect(() => {
        // Poll localforage occasionally to keep indicator updated (in a real app, use Context or Redux)
        let isChecking = false;
        const checkSyncs = async () => {
            if (isChecking) return;
            isChecking = true;
            try {
                const cows = await syncManager.getPendingCows();
                setPendingCount(cows.length);
            } finally {
                isChecking = false;
            }
        };
        checkSyncs();
        const interval = setInterval(checkSyncs, 10000);

        // Upload when coming online
        const handleOnline = async () => {
            const result = await syncManager.syncAll();
            if (result.success && result.syncedCount > 0) {
                setPendingCount(0);
            }
        };

        window.addEventListener('online', handleOnline);
        return () => {
            clearInterval(interval);
            window.removeEventListener('online', handleOnline);
        };
    }, []);

    // 1. Setup Status Bar Appearance on Mount
    useEffect(() => {
        if (Capacitor.isNativePlatform()) {
            StatusBar.setStyle({ style: Style.Dark }); // White text icons
            StatusBar.setBackgroundColor({ color: '#2E7D32' }); // Match your App Bar Green
            StatusBar.setOverlaysWebView({ overlay: false }); // Pushes app DOWN so it doesn't overlap
        }
    }, []);

    const handleNavClick = (path: string) => {
        if (location.pathname === '/add-cow') {
            const confirmLeave = window.confirm('You are currently registering a new cow. If you leave, your progress will be lost. Are you sure you want to exit?');
            if (confirmLeave) {
                navigate(path);
            }
        } else if (location.pathname === '/user-profile' && (window as unknown as { isProfileEditing?: boolean }).isProfileEditing) {
            const confirmLeave = window.confirm('You have unsaved changes. Are you sure you want to leave?');
            if (confirmLeave) {
                (window as unknown as { isProfileEditing?: boolean }).isProfileEditing = false;
                navigate(path);
            }
        } else {
            if (path === '/alerts') {
                alert('Alerts coming soon!');
            } else {
                navigate(path);
            }
        }
    };

    return (
        <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            height: '100vh',
            overflow: 'hidden',
            // CRITICAL FIX: Safe Area for Top (Status Bar) & Bottom (Home Bar)
            pt: 'env(safe-area-inset-top)',
            pb: 'env(safe-area-inset-bottom)',
            bgcolor: 'primary.main' // Fills the status bar area with green
        }}>

            {/* 2. TOP APP BAR */}
            <AppBar position="static" elevation={0} sx={{ zIndex: 1100 }}>
                <Toolbar>
                    <IconButton edge="start" color="inherit" sx={{ mr: { xs: 0.5, sm: 2 } }} onClick={() => setDrawerOpen(true)}>
                        <MenuIcon />
                    </IconButton>

                    <Stack direction="row" alignItems="center" sx={{ flexGrow: 1, gap: { xs: 1, sm: 1.5 }, minWidth: 0 }}>
                        <Box sx={{
                            bgcolor: 'white',
                            borderRadius: '50%',
                            p: 0.25,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: { xs: 36, sm: 44 },
                            height: { xs: 36, sm: 44 },
                            flexShrink: 0
                        }}>
                            <Box
                                component="img"
                                src="/logo.png"
                                alt="GoNidhi Logo"
                                sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                        </Box>
                        <Typography
                            variant="h6"
                            sx={{
                                lineHeight: 1.1,
                                fontSize: { xs: '1.1rem', sm: '1.25rem' },
                                fontWeight: 'bold',
                                minWidth: 0,
                                wordWrap: 'break-word'
                            }}
                        >
                            GoNidhi
                        </Typography>
                    </Stack>

                    <Stack direction="row" alignItems="center" spacing={{ xs: 0, sm: 1 }} sx={{ flexShrink: 0 }}>
                        <IconButton color="inherit" onClick={() => handleNavClick('/offline-sync')}>
                            <Badge badgeContent={pendingCount} color="error">
                                <CloudSyncIcon />
                            </Badge>
                        </IconButton>

                        <IconButton color="inherit" onClick={() => handleNavClick('/user-profile')} sx={{ p: 0.5, ml: { xs: 0, sm: 1 } }}>
                            <Avatar
                                src={(profileData?.user?.profilePicture as string) || ''}
                                sx={{ width: 32, height: 32, border: '2px solid rgba(255,255,255,0.8)' }}
                            >
                                {!profileData?.user?.profilePicture && <ProfileIcon fontSize="small" />}
                            </Avatar>
                        </IconButton>
                    </Stack>
                </Toolbar >
            </AppBar >

            {/* Navigation Drawer */}
            <Drawer anchor="left" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
                <Box sx={{ width: 280 }} role="presentation">
                    <Box sx={{ p: 3, pt: 'calc(env(safe-area-inset-top) + 24px)', bgcolor: 'primary.main', color: 'white', display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Box sx={{ bgcolor: 'white', borderRadius: '50%', p: 0.5, width: 48, height: 48, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                            <Box component="img" src="/logo.png" alt="Logo" sx={{ width: 40, height: 40, objectFit: 'contain' }} />
                        </Box>
                        <Box>
                            <Typography variant="h6" fontWeight="bold" sx={{ lineHeight: 1.1 }}>GoNidhi</Typography>
                        </Box>
                    </Box>
                    <List sx={{ pt: 1 }}>
                        <ListItem disablePadding>
                            <ListItemButton onClick={() => { setDrawerOpen(false); handleNavClick('/'); }}>
                                <ListItemIcon><HomeIcon color="primary" /></ListItemIcon>
                                <ListItemText primary="Home" />
                            </ListItemButton>
                        </ListItem>
                        <ListItem disablePadding>
                            <ListItemButton onClick={() => { setDrawerOpen(false); handleNavClick('/my-cows'); }}>
                                <ListItemIcon><CowIcon color="primary" /></ListItemIcon>
                                <ListItemText primary="My Herd" />
                            </ListItemButton>
                        </ListItem>
                        <ListItem disablePadding>
                            <ListItemButton onClick={() => { setDrawerOpen(false); handleNavClick('/search'); }}>
                                <ListItemIcon><SearchIcon color="primary" /></ListItemIcon>
                                <ListItemText primary="Search Cattle" />
                            </ListItemButton>
                        </ListItem>
                        <ListItem disablePadding>
                            <ListItemButton onClick={() => { setDrawerOpen(false); handleNavClick('/disputes'); }}>
                                <ListItemIcon><WarningAmber color="error" /></ListItemIcon>
                                <ListItemText primary="Disputed Cattle" />
                            </ListItemButton>
                        </ListItem>
                        <ListItem disablePadding>
                            <ListItemButton onClick={() => { setDrawerOpen(false); handleNavClick('/add-cow'); }}>
                                <ListItemIcon><AddCowIcon color="primary" /></ListItemIcon>
                                <ListItemText primary="Register New Cow" />
                            </ListItemButton>
                        </ListItem>

                        <Divider sx={{ my: 1 }} />

                        <ListItem disablePadding>
                            <ListItemButton onClick={() => { setDrawerOpen(false); handleNavClick('/offline-sync'); }}>
                                <ListItemIcon>
                                    <Badge badgeContent={pendingCount} color="error">
                                        <CloudSyncIcon color="action" />
                                    </Badge>
                                </ListItemIcon>
                                <ListItemText primary="Pending Syncs" />
                            </ListItemButton>
                        </ListItem>
                        <ListItem disablePadding>
                            <ListItemButton onClick={() => { setDrawerOpen(false); handleNavClick('/alerts'); }}>
                                <ListItemIcon><AlertIcon color="action" /></ListItemIcon>
                                <ListItemText primary="Notifications" />
                            </ListItemButton>
                        </ListItem>
                        <ListItem disablePadding>
                            <ListItemButton onClick={() => { setDrawerOpen(false); handleNavClick('/user-profile'); }}>
                                <ListItemIcon><ProfileIcon color="action" /></ListItemIcon>
                                <ListItemText primary="My Profile" />
                            </ListItemButton>
                        </ListItem>
                    </List>
                </Box>
            </Drawer>

            {/* 3. MAIN CONTENT (Scrollable) */}
            <Box
                component="main"
                ref={mainRef}
                sx={{
                    flexGrow: 1,
                    overflowY: 'auto',
                    bgcolor: 'background.default',
                    // Add extra padding at bottom so content isn't hidden behind Bottom Nav
                    pb: 8,
                    // Rounded corners at top to look like a modern "Sheet"
                    borderTopLeftRadius: 24,
                    borderTopRightRadius: 24,
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                <Box sx={{ flexGrow: 1, flexShrink: 0 }}>
                    {children}
                </Box>
                <BrandingFooter sx={{ mb: 2 }} />
            </Box >

            {/* 4. BOTTOM NAVIGATION */}
            < Paper
                sx={{
                    position: 'fixed',
                    bottom: 0, left: 0, right: 0,
                    zIndex: 1200, borderRadius: 0,
                    // CRITICAL: Push up from bottom home bar
                    pb: 'env(safe-area-inset-bottom)',
                    bgcolor: 'white'
                }}
                elevation={10}
            >
                <BottomNavigation
                    showLabels
                    value={navValue}
                >
                    <BottomNavigationAction value={0} label="Home" onClick={() => handleNavClick('/')} icon={<HomeIcon />} />
                    <BottomNavigationAction value={1} label="My Cows" onClick={() => handleNavClick('/my-cows')} icon={<CowIcon />} />

                    <BottomNavigationAction
                        value={2}
                        label="Search"
                        onClick={() => handleNavClick('/search')}
                        icon={
                            <Box sx={{
                                bgcolor: navValue === 2 ? 'primary.dark' : 'primary.main',
                                color: 'white',
                                p: 1.5,
                                borderRadius: '16px',
                                mt: -2,
                                border: '3px solid white',
                                boxShadow: navValue === 2
                                    ? '0px 6px 16px rgba(46, 125, 50, 0.4)'
                                    : '0px 4px 10px rgba(0,0,0,0.2)',
                                transition: 'all 0.2s ease-in-out',
                                transform: navValue === 2 ? 'scale(1.05)' : 'scale(1)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                <SearchIcon fontSize="medium" />
                            </Box>
                        }
                    />

                    <BottomNavigationAction value={3} label="Alerts" onClick={() => alert('Alerts coming soon!')} icon={<AlertIcon />} />
                    <BottomNavigationAction value={4} label="Profile" onClick={() => handleNavClick('/user-profile')} icon={<ProfileIcon />} />
                </BottomNavigation>
            </Paper >
        </Box >
    );
};

export default AppLayout;