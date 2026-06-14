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
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import BrandingFooter from '../components/BrandingFooter';

import { API_BASE } from '@ama-gau-dhana/shared';

const Login: React.FC = () => {
    const navigate = useNavigate();
    const { login } = useAuth();

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
        setLoading(true);

        try {
            const response = await axios.post(`${API_BASE}/api/admin/auth/login`, formData);
            if (response.data.success) {
                await login(response.data.token, response.data.user);
                // navigate is removed here. AnimatedRoutes will automatically unmount Login and Redirect to / 
                // when isAuthenticated flips to true. This stops the race condition.
            }
        } catch (err: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) {
            console.error('Login API Error:', err);
            setError(err.response?.data?.message || 'Unable to connect to server. Check your network.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Container maxWidth="sm" sx={{ position: 'relative', minHeight: '100vh', display: 'flex', flexDirection: 'column', p: 3, pt: 'calc(env(safe-area-inset-top) + 24px)' }}>
            <Box sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
                    <img src="/logo.png" alt="Ama Gaudhana Logo" style={{ width: '80px', height: '80px', objectFit: 'contain' }} />
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'primary.main', letterSpacing: 1, mt: 1, textTransform: 'uppercase' }}>
                        Govt. of Odisha
                    </Typography>
                </Box>
                <Typography variant="h5" sx={{ fontWeight: 'bold', textAlign: 'center', mb: 1 }}>
                    Admin Login
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2, textAlign: 'center' }}>
                    Welcome back! Please enter your phone number and password to continue.
                </Typography>

                <Box component="form" onSubmit={handleLogin} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
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
