import React, { useState, useEffect } from 'react';
import {
    Container,
    Box,
    Typography,
    TextField,
    Button,
    CircularProgress,
    Alert,
    MenuItem,
    IconButton,
    InputAdornment
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import BrandingFooter from '../components/BrandingFooter';

import { API_BASE, adminRegisterFrontendSchema } from '@gonidhi/shared';

const Register: React.FC = () => {
    const navigate = useNavigate();
    const { login } = useAuth();

    const [formData, setFormData] = useState({
        name: '',
        phone: '',
        password: '',
        confirmPassword: '',
        state: 'Odisha',
        district: '',
    });

    const [states, setStates] = useState<string[]>([]);
    const [districts, setDistricts] = useState<string[]>([]);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    useEffect(() => {
        axios.get(`${API_BASE}/api/farmer/location/states`)
            .then(res => setStates(res.data))
            .catch(console.error);
    }, []);

    useEffect(() => {
        if (formData.state) {
            axios.get(`${API_BASE}/api/farmer/location/districts`, { params: { state: formData.state } })
                .then(res => setDistricts(res.data))
                .catch(console.error);
        }
    }, [formData.state]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => {
            const newData = { ...prev, [name]: value };
            if (name === 'state') newData.district = '';
            return newData;
        });

        if (name === 'state' && !value) {
            setDistricts([]);
        }
    };

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const result = adminRegisterFrontendSchema.safeParse(formData);
        if (!result.success) {
            setError(result.error.issues[0].message);
            return;
        }

        setLoading(true);

        try {
            const response = await axios.post(`${API_BASE}/api/admin/auth/register`, {
                name: formData.name,
                phone: formData.phone,
                password: formData.password,
                state: formData.state,
                district: formData.district
            });
            if (response.data.success) {
                login(response.data.token, response.data.user);
                navigate('/', { replace: true });
            }
        } catch (err: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) {
            console.error('Registration API Error:', err);
            setError(err.response?.data?.message || 'Unable to connect to server. Check your network.');
        } finally {
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
                <Typography variant="h5" sx={{ fontWeight: 'bold', textAlign: 'center', mb: 1 }}>
                    Admin Registration
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2, textAlign: 'center' }}>
                    Please fill in your details to create an admin account.
                </Typography>

                <Box component="form" onSubmit={handleRegister} sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {error && <Alert severity="error">{error}</Alert>}

                    <TextField
                        label="Full Name"
                        name="name"
                        variant="outlined"
                        fullWidth
                        value={formData.name}
                        onChange={handleChange}
                        required
                        slotProps={{ htmlInput: { maxLength: 50 } }}
                    />
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
                        select
                        label="State"
                        name="state"
                        variant="outlined"
                        fullWidth
                        value={formData.state}
                        onChange={handleChange}
                        required
                    >
                        {states.map((st) => (
                            <MenuItem key={st} value={st} sx={{ py: 0.5, fontSize: '0.9rem' }}>
                                {st}
                            </MenuItem>
                        ))}
                    </TextField>

                    <TextField
                        select
                        label="District"
                        name="district"
                        variant="outlined"
                        fullWidth
                        value={formData.district}
                        onChange={handleChange}
                        required
                        disabled={!formData.state || districts.length === 0}
                    >
                        {districts.map((dist) => (
                            <MenuItem key={dist} value={dist} sx={{ py: 0.5, fontSize: '0.9rem' }}>
                                {dist}
                            </MenuItem>
                        ))}
                    </TextField>

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

                    <TextField
                        label="Confirm Password"
                        name="confirmPassword"
                        type={showConfirmPassword ? "text" : "password"}
                        variant="outlined"
                        fullWidth
                        value={formData.confirmPassword}
                        onChange={handleChange}
                        required
                        slotProps={{
                            input: {
                                endAdornment: (
                                    <InputAdornment position="end">
                                        <IconButton onClick={() => setShowConfirmPassword(!showConfirmPassword)} edge="end">
                                            {showConfirmPassword ? <VisibilityOff /> : <Visibility />}
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
                        {loading ? <CircularProgress size={24} color="inherit" /> : 'Register & Continue'}
                    </Button>
                    <Button
                        variant="text"
                        onClick={() => navigate('/login')}
                    >
                        Already have an account? Login Here
                    </Button>
                </Box>
            </Box>

            <BrandingFooter />
        </Container>
    );
};

export default Register;
