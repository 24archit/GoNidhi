import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useOutlet } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { CssBaseline, CircularProgress, Box, Typography, Stack, Button } from '@mui/material';
import { Preferences } from '@capacitor/preferences';
import { AnimatePresence, motion } from 'framer-motion';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      gcTime: 1000 * 60 * 3, // 3 minutes
      refetchOnWindowFocus: false,
    },
  },
});

import theme from './theme';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Farmers from './pages/Farmers';
import FarmerProfile from './pages/FarmerProfile';
import Cattle from './pages/Cattle';
import CattleProfile from './pages/CattleProfile';
import Disputes from './pages/Disputes';
import Analytics from './pages/Analytics';
import AnalyticsDetail from './pages/AnalyticsDetail';
import Login from './pages/Login';
import Register from './pages/Register';
import Onboarding from './pages/Onboarding';
import Profile from './pages/Profile';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AddCow, SearchCow, ProcessingProvider, GlobalProcessingOverlay } from '@gonidhi/shared';
import PendingCattle from './pages/PendingCattle';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

import ocacLogo from './assets/ocac.png';
import iiitLogo from './assets/iiit.png';
import { ErrorOutline } from '@mui/icons-material';
import { Geolocation } from '@capacitor/geolocation';

const PageTransition = ({ children }: { children: React.ReactNode }) => {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      transition={{ duration: 0.3 }}
      style={{ height: '100%', width: '100%' }}
    >
      {children}
    </motion.div>
  );
};

const LocationGuard = ({ children }: { children: React.ReactNode }) => {
  const [hasLocation, setHasLocation] = useState<boolean | null>(null);

  useEffect(() => {
    const checkLocation = async () => {
      try {
        // Try getting position directly. On the web this triggers the browser's permission prompt automatically.
        await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
        setHasLocation(true);
      } catch (err) {
        console.error("Initial location fetch failed, attempting explicit permission request", err);
        // Fallback for native platforms where explicit permission requests may be required
        try {
          let perm = await Geolocation.checkPermissions();
          if (perm.location !== 'granted') {
            perm = await Geolocation.requestPermissions();
          }
          if (perm.location === 'granted') {
            await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
            setHasLocation(true);
            return;
          }
        } catch (permErr) {
          console.error("Permission check/request error", permErr);
        }
        setHasLocation(false);
      }
    };
    checkLocation();
  }, []);

  if (hasLocation === null) {
    return <Box sx={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center' }}><CircularProgress /></Box>;
  }

  if (!hasLocation) {
    return (
      <Box sx={{ p: 4, height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
        <ErrorOutline color="error" sx={{ fontSize: 64, mb: 2 }} />
        <Typography variant="h5" fontWeight="bold" gutterBottom>Location Required</Typography>
        <Typography variant="body1" color="text.secondary" mb={4}>
          GoNidhi requires your GPS location to be turned on to verify livestock registration areas. Please enable your Location Services and location permissions to continue using the app.
        </Typography>
        <Button variant="contained" onClick={() => window.location.reload()}>Retry</Button>
      </Box>
    );
  }

  return <>{children}</>;
};

const AnimatedOutlet = () => {
  const outlet = useOutlet();
  return <Box>{outlet}</Box>;
};

const MainLayout = ({ isFirstLaunch, isAuthenticated }: { isFirstLaunch: boolean; isAuthenticated: boolean }) => {
  if (!isAuthenticated) {
    return isFirstLaunch ? <Navigate to="/onboarding" replace /> : <Navigate to="/login" replace />;
  }

  return (
    <ProcessingProvider>
      <Layout>
        <AnimatedOutlet />
        <GlobalProcessingOverlay />
      </Layout>
    </ProcessingProvider>
  );
};

const AnimatedRoutes: React.FC<{ isFirstLaunch: boolean }> = ({ isFirstLaunch }) => {
  const { isAuthenticated } = useAuth();
  const location = useLocation();
  const isAuthRoute = ['/login', '/register', '/onboarding'].includes(location.pathname);

  return (
    <AnimatePresence mode="popLayout">
      <Routes location={location} key={isAuthRoute ? location.pathname : 'main-app'}>
        {/* Auth Routes */}
        <Route path="/onboarding" element={<PageTransition>{isFirstLaunch ? <Onboarding /> : <Navigate to="/" replace />}</PageTransition>} />
        <Route path="/login" element={<PageTransition>{isAuthenticated ? <Navigate to="/" replace /> : <Login />}</PageTransition>} />
        <Route path="/register" element={<PageTransition>{isAuthenticated ? <Navigate to="/" replace /> : <Register />}</PageTransition>} />

        {/* Main App Routes (Guarded & Wrapped in Layout) */}
        <Route element={<MainLayout isFirstLaunch={isFirstLaunch} isAuthenticated={isAuthenticated} />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/farmers" element={<Farmers />} />
          <Route path="/farmers/:id" element={<FarmerProfile />} />
          <Route path="/cattle" element={<Cattle />} />
          <Route path="/cattle/:id" element={<CattleProfile />} />
          <Route path="/disputes" element={<Disputes />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/analytics/:id" element={<AnalyticsDetail />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/add-cow" element={<AddCow isAdmin={true} />} />
          <Route path="/search" element={<SearchCow isAdmin={true} />} />
          <Route path="/pending-cattle" element={<PendingCattle />} />
        </Route>

        {/* Fallback route */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </AnimatePresence>
  );
};

const App: React.FC = () => {
  const [isFirstLaunch, setIsFirstLaunch] = useState<boolean | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isAppLoaded, setIsAppLoaded] = useState(false);

  useEffect(() => {
    // Configure Native Android Status Bar (prevents overlapping)
    if (Capacitor.isNativePlatform()) {
      StatusBar.setStyle({ style: Style.Dark });
      StatusBar.setBackgroundColor({ color: '#1C39BB' }); // Match admin-app theme
      StatusBar.setOverlaysWebView({ overlay: false });
    }

    // Yield to the browser render cycle first, then simulate loading
    const timer = setTimeout(() => {
      setIsAppLoaded(true);
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const checkAppState = async () => {
      // Check onboarding
      const { value: introValue } = await Preferences.get({ key: 'hasSeenIntroAdmin' });
      setIsFirstLaunch(introValue !== 'true');

      // Check auth token (from Capacitor Preferences)
      const { value: tokenValue } = await Preferences.get({ key: 'adminToken' });
      setIsAuthenticated(!!tokenValue);
    };
    checkAppState();
  }, []);

  // Show a loading spinner while checking local storage
  if (isFirstLaunch === null || isAuthenticated === null || !isAppLoaded) {
    return (
      <ThemeProvider theme={theme}>
        <Box
          sx={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.default',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Ambient orbs */}
          <Box sx={{ position: 'absolute', width: 300, height: 300, borderRadius: '50%', background: 'rgba(28, 57, 187, 0.07)', top: -120, right: -80, filter: 'blur(50px)', pointerEvents: 'none' }} />
          <Box sx={{ position: 'absolute', width: 200, height: 200, borderRadius: '50%', background: 'rgba(245, 0, 87, 0.06)', bottom: -80, left: -60, filter: 'blur(50px)', pointerEvents: 'none' }} />

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          >
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                px: 3,
                py: 4,
              }}
            >
              {/* GoNidhi Logo */}
              <motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Box
                  sx={{
                    width: 84, height: 84, borderRadius: '20px',
                    bgcolor: 'background.paper',
                    boxShadow: '0px 4px 20px rgba(28, 57, 187, 0.18), 0 0 0 1px rgba(28, 57, 187, 0.12)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    mb: 2,
                  }}
                >
                  <Box component="img" src="/logo.png" alt="GoNidhi"
                    sx={{ width: 56, height: 56, objectFit: 'contain', borderRadius: '10px' }} />
                </Box>
              </motion.div>

              {/* Brand name */}
              <Typography variant="h4" sx={{ color: 'text.primary', lineHeight: 1 }}>
                <Box component="span" sx={{ color: 'primary.main' }}>GoNidhi</Box>
              </Typography>

              {/* Govt badge */}
              <Box
                sx={{
                  display: 'inline-flex', alignItems: 'center', gap: 0.75,
                  mt: 0.75,
                  fontSize: '0.69rem', fontWeight: 600, letterSpacing: '0.3px',
                  color: 'secondary.main',
                  background: 'rgba(245, 0, 87, 0.07)',
                  border: '1px solid rgba(245, 0, 87, 0.18)',
                  borderRadius: '20px', px: 1.5, py: '4px',
                }}
              >
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'secondary.main', flexShrink: 0 }} />
                Government of Odisha
              </Box>

              {/* Accent line */}
              <Box sx={{ width: 36, height: 3, borderRadius: 1, mt: 1.5, mb: 1.5, background: 'linear-gradient(90deg, #1C39BB, #4f6bff)' }} />

              {/* Built by */}
              <Typography variant="caption" sx={{ color: 'text.secondary', mb: 1, fontSize: '0.68rem' }}>
                Built by
              </Typography>

              <Stack direction="row" spacing={2.5} sx={{ alignItems: 'center' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                  <Box component="img" src={ocacLogo} alt="OCAC"
                    sx={{ height: 36, objectFit: 'contain' }} />
                  <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.secondary', fontWeight: 600 }}>
                    OCAC
                  </Typography>
                </Box>

                <Box sx={{ width: '1px', height: 36, bgcolor: 'divider' }} />

                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                  <Box component="img" src={iiitLogo} alt="IIIT Bhubaneswar"
                    sx={{ height: 36, objectFit: 'contain' }} />
                  <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.secondary', fontWeight: 600 }}>
                    IIIT Bhubaneswar
                  </Typography>
                </Box>
              </Stack>
            </Box>
          </motion.div>

          {/* Loader */}
          <Box sx={{ mt: 4 }}>
            <CircularProgress size={28} thickness={4} sx={{ color: 'primary.main' }} />
          </Box>
        </Box>
      </ThemeProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <Router>
            <LocationGuard>
              <AnimatedRoutes isFirstLaunch={isFirstLaunch} />
            </LocationGuard>
          </Router>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
