// Update client/src/App.tsx
import React, { useEffect, useState } from 'react';
import { preloadMuzzleModel } from '@gonidhi/shared';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useOutlet } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { CssBaseline, CircularProgress, Box, Typography, Stack } from '@mui/material';
import theme from './theme/theme';
import { Preferences } from '@capacitor/preferences';
import { AnimatePresence, motion } from 'framer-motion';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './queryClient';
import PageTransition from './components/PageTransition';
import { syncManager } from '@gonidhi/shared';
import { getServerHealthAPI } from './apis/apis';
import { ProcessingProvider } from '@gonidhi/shared';
import { GlobalProcessingOverlay } from '@gonidhi/shared';
import { Geolocation } from '@capacitor/geolocation';
import ocacLogo from '../src/assets/ocac.png';
import iiitLogo from '../src/assets/iiit.png';
// Add this near your other imports at the top
import * as tf from '@tensorflow/tfjs';
// Import Pages
import AppLayout from './components/AppLayout';
import Home from './pages/Home';
// Lazy load heavy AI and camera routes
const AddCow = React.lazy(() => import('@gonidhi/shared').then(module => ({ default: module.AddCow })));
const SearchCow = React.lazy(() => import('@gonidhi/shared').then(module => ({ default: module.SearchCow })));
import CowProfile from './pages/CowProfile';
import MyCows from './pages/MyCows';
import UserProfile from './pages/UserProfile';
import Onboarding from './pages/Onboarding';
import Register from './pages/Register';
import Login from './pages/Login';
import OfflineSync from './pages/OfflineSync';
import Disputes from './pages/Disputes';
import { ErrorOutline } from '@mui/icons-material';
import { Button } from '@mui/material';
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
  // Instagram uses instant tab switching. No page slide animations here!
  return (
    <React.Suspense fallback={
      <Box sx={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center' }}>
        <CircularProgress />
      </Box>
    }>
      {outlet}
    </React.Suspense>
  );
};

const MainLayout = ({ isFirstLaunch, isAuthenticated }: { isFirstLaunch: boolean; isAuthenticated: boolean }) => {
  if (isFirstLaunch) return <Navigate to="/onboarding" replace />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  return (
    <AppLayout>
      <AnimatedOutlet />
    </AppLayout>
  );
};

const AnimatedRoutes: React.FC<{ isFirstLaunch: boolean; isAuthenticated: boolean }> = ({ isFirstLaunch, isAuthenticated }) => {
  const location = useLocation();
  // We only animate the Login/Register/Onboarding transitions. Main app is instant.
  const isAuthRoute = ['/login', '/register', '/onboarding'].includes(location.pathname);

  return (
    <AnimatePresence mode="popLayout">
      <Routes location={location} key={isAuthRoute ? location.pathname : 'main-app'}>
        {/* Auth Routes */}
        <Route path="/onboarding" element={<PageTransition>{isFirstLaunch ? <Onboarding /> : <Navigate to="/" replace />}</PageTransition>} />
        <Route path="/register" element={<PageTransition>{isAuthenticated ? <Navigate to="/" replace /> : <Register />}</PageTransition>} />
        <Route path="/login" element={<PageTransition>{isAuthenticated ? <Navigate to="/" replace /> : <Login />}</PageTransition>} />

        {/* Main App Routes (Guarded & Wrapped in Layout) */}
        <Route element={<MainLayout isFirstLaunch={isFirstLaunch} isAuthenticated={isAuthenticated} />}>
          <Route path="/" element={<Home />} />
          <Route path="/home" element={<Navigate to="/" replace />} />
          <Route path="/add-cow" element={<AddCow />} />
          <Route path="/search" element={<SearchCow />} />
          <Route path="/profile/:id" element={<CowProfile />} />
          <Route path="/my-cows" element={<MyCows />} />
          <Route path="/user-profile" element={<UserProfile />} />
          <Route path="/offline-sync" element={<OfflineSync />} />
          <Route path="/disputes" element={<Disputes />} />
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
  const [isAppReady, setIsAppReady] = useState(false);

  useEffect(() => {
    // Yield to the browser render cycle first, then start health check
    const timer = setTimeout(async () => {
      try {
        await Promise.allSettled([
          getServerHealthAPI()
        ]);
        setIsAppReady(true);
      } catch (err) {
        console.error('Initialization error:', err);
        setIsAppReady(true); // Continue anyway so we don't block app forever
      }
    }, 1000); // 1-second delay ensures your app's initial UI loads smoothly

    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const checkAppState = async () => {
      // Check onboarding
      const { value: introValue } = await Preferences.get({ key: 'hasSeenIntro' });
      setIsFirstLaunch(introValue !== 'true');

      // Check auth token
      const { value: tokenValue } = await Preferences.get({ key: 'jwt_token' });
      setIsAuthenticated(!!tokenValue);
    };
    checkAppState();

    window.addEventListener('auth-change', checkAppState);

    return () => {
      window.removeEventListener('auth-change', checkAppState);
    };
  }, []);

  // Show a loading spinner while checking local storage
  if (isFirstLaunch === null || isAuthenticated === null || !isAppReady) {
    return (
      <ThemeProvider theme={theme}>
        <Box
          sx={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.default', // ← #FFF9F2, NOT primary.main
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Ambient orbs */}
          <Box sx={{ position: 'absolute', width: 300, height: 300, borderRadius: '50%', background: 'rgba(249,125,9,0.07)', top: -120, right: -80, filter: 'blur(50px)', pointerEvents: 'none' }} />
          <Box sx={{ position: 'absolute', width: 200, height: 200, borderRadius: '50%', background: 'rgba(4,106,56,0.06)', bottom: -80, left: -60, filter: 'blur(50px)', pointerEvents: 'none' }} />

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
                    boxShadow: '0px 4px 20px rgba(249,125,9,0.18), 0 0 0 1px rgba(249,125,9,0.12)',
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
                  background: 'rgba(4,106,56,0.07)',
                  border: '1px solid rgba(4,106,56,0.18)',
                  borderRadius: '20px', px: 1.5, py: '4px',
                }}
              >
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'secondary.main', flexShrink: 0 }} />
                Government of Odisha
              </Box>

              {/* Accent line */}
              <Box sx={{ width: 36, height: 3, borderRadius: 1, mt: 1.5, mb: 1.5, background: 'linear-gradient(90deg, #F97D09, #FFB067)' }} />

              {/* Built by */}
              <Typography variant="caption" sx={{ color: 'text.secondary', mb: 1, fontSize: '0.68rem' }}>
                Built by
              </Typography>

              <Stack direction="row" spacing={2.5} alignItems="center">
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
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <ProcessingProvider>
          <Router>
            <LocationGuard>
              <AnimatedRoutes isFirstLaunch={isFirstLaunch} isAuthenticated={isAuthenticated} />
            </LocationGuard>
          </Router>
          <GlobalProcessingOverlay />
        </ProcessingProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;