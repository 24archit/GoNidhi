import React, { useState } from 'react';
import {
    Container,
    Box,
    Typography,
    TextField,
    Button,
    CircularProgress,
    Alert,
    IconButton,
    InputAdornment
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { loginFarmerAPI } from '../apis/apis';
import { useNavigate } from 'react-router-dom';
import { loginSchema } from '@gonidhi/shared';

import BrandingFooter from '../components/BrandingFooter';

const Login: React.FC = () => {
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        phone: '',
        password: '',
    });

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const result = loginSchema.safeParse(formData);
        if (!result.success) {
            setError(result.error.issues[0].message);
            return;
        }

        setLoading(true);

        try {
            await loginFarmerAPI(formData.phone, formData.password);

            // Notify App.tsx to re-evaluate local preferences and auth token
            window.dispatchEvent(new Event('auth-change'));
            navigate('/', { replace: true });
        } catch (err: unknown) {
            console.error('Registration API Error:', err);
            const errorMessage = err instanceof Error ? err.message : 'Unable to connect to server. Check your network.';
            setError(errorMessage);
            setLoading(false);
        }
    };

    return (
        <Container maxWidth="sm" sx={{ position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column', p: 3, pt: 'calc(env(safe-area-inset-top) + 24px)' }}>
            <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
                    <img src="/logo.png" alt="GoNidhi Logo" style={{ width: '80px', height: '80px', objectFit: 'contain' }} />
                    <Typography variant="h4" sx={{ fontWeight: 800, color: 'primary.main', mt: 1 }}>
                        GoNidhi
                    </Typography>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', letterSpacing: 1, textTransform: 'uppercase' }}>
                        Government of Odisha
                    </Typography>
                </Box>
                <Typography variant="h5" fontWeight="bold" gutterBottom textAlign="center">
                    Farmer Login
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={4} textAlign="center">
                    Welcome back! Please enter your phone number to continue.
                </Typography>

                <Box component="form" onSubmit={handleLogin} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {error && <Alert severity="error">{error}</Alert>}

                    <TextField
                        label="Phone Number"
                        name="phone"
                        type="tel"
                        variant="outlined"
                        fullWidth
                        value={formData.phone}
                        onChange={handleChange}
                        required
                        slotProps={{ htmlInput: { maxLength: 10 } }}
                    />
                    <TextField
                        label="Password"
                        name="password"
                        type={showPassword ? "text" : "password"}
                        variant="outlined"
                        fullWidth
                        value={formData.password}
                        onChange={handleChange}
                        required
                        slotProps={{
                            input: {
                                endAdornment: (
                                    <InputAdornment position="end">
                                        <IconButton onClick={() => setShowPassword(!showPassword)} edge="end">
                                            {showPassword ? <VisibilityOff /> : <Visibility />}
                                        </IconButton>
                                    </InputAdornment>
                                )
                            }
                        }}
                    />
                    <Button
                        type="submit"
                        variant="contained"
                        size="large"
                        disabled={loading}
                        sx={{ mt: 2, py: 1.5, borderRadius: 2, fontWeight: 'bold' }}
                    >
                        {loading ? <CircularProgress size={24} color="inherit" /> : 'Login'}
                    </Button>
                    <Button
                        variant="text"
                        onClick={() => navigate('/register')}
                    >
                        Don't have an account? Register Here
                    </Button>
                </Box>
            </Box>

            <BrandingFooter />
        </Container>
    );
};

export default Login;