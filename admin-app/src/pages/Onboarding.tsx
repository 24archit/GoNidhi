import React from 'react';
import { Box, Typography, Button, Container } from '@mui/material';
import { Swiper, SwiperSlide } from 'swiper/react';
import { Pagination, Autoplay } from 'swiper/modules';
import { useNavigate } from 'react-router-dom';
import { Preferences } from '@capacitor/preferences';

// Import Swiper styles
import 'swiper/css';
import 'swiper/css/pagination';

import BrandingFooter from '../components/BrandingFooter';

const Onboarding: React.FC = () => {
    const navigate = useNavigate();

    const handleFinish = async () => {
        // Save that the user has seen the intro
        await Preferences.set({ key: 'hasSeenIntroAdmin', value: 'true' });
        navigate('/login');
    };

    return (
        <Container
            maxWidth="sm"
            sx={{
                minHeight: '100vh',
                display: 'flex',
                flexDirection: 'column',
                bgcolor: 'background.default',
                pt: 'calc(env(safe-area-inset-top) + 32px)',
                pb: 4,
            }}
        >
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 2 }}>
                <img src="/logo.png" alt="GoNidhi Logo" style={{ width: '80px', height: '80px', objectFit: 'contain' }} />
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'primary.main', letterSpacing: 1, mt: 1, textTransform: 'uppercase' }}>
                    Government of Odisha
                </Typography>
            </Box>

            <Box sx={{ flexGrow: 1, width: '100%' }}>
                <Swiper
                    pagination={{ clickable: true }}
                    autoplay={{ delay: 3000, disableOnInteraction: false }}
                    modules={[Pagination, Autoplay]}
                    style={{ height: '100%', paddingBottom: '40px' }}
                >
                    <SwiperSlide>
                        <Box sx={{ p: 2, textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                            <Typography variant="h4" sx={{ fontWeight: 'bold' }} gutterBottom color="primary">
                                Admin Dashboard
                            </Typography>
                            <Typography variant="body1" color="text.secondary">
                                Manage the GoNidhi ecosystem, monitor farmers, and resolve disputes centrally.
                            </Typography>
                        </Box>
                    </SwiperSlide>

                    <SwiperSlide>
                        <Box sx={{ p: 2, textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                            <Typography variant="h4" sx={{ fontWeight: 'bold' }} gutterBottom color="primary">
                                AI Insights
                            </Typography>
                            <Typography variant="body1" color="text.secondary">
                                View detailed analytics and confidence scores from our biometric AI models to ensure data integrity.
                            </Typography>
                        </Box>
                    </SwiperSlide>

                    <SwiperSlide>
                        <Box sx={{ p: 2, textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                            <Typography variant="h4" sx={{ fontWeight: 'bold' }} gutterBottom color="primary">
                                Seamless Control
                            </Typography>
                            <Typography variant="body1" color="text.secondary">
                                Oversee cattle registrations and intervene securely when duplicates or spoof attempts occur.
                            </Typography>
                        </Box>
                    </SwiperSlide>
                </Swiper>
            </Box>

            <Box sx={{ display: 'flex', gap: 2, px: 2 }}>
                <Button
                    variant="contained"
                    fullWidth
                    size="large"
                    onClick={handleFinish}
                    sx={{
                        py: 2,
                        borderRadius: 2,
                        fontWeight: 'bold',
                        fontSize: '1.1rem',
                    }}
                >
                    Skip to Login
                </Button>
            </Box>

            <BrandingFooter />
        </Container>
    );
};

export default Onboarding;
