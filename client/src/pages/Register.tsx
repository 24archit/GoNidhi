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
import { registerFarmerAPI, getStatesAPI, getDistrictsAPI, getBlocksAPI, getVillagesAPI } from '../apis/apis';
import { useNavigate } from 'react-router-dom';
import { farmerRegisterFrontendSchema } from '@gonidhi/shared';

import BrandingFooter from '../components/BrandingFooter';

const Register: React.FC = () => {
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        name: '',
        phone: '',
        state: 'Odisha',
        district: '',
        block: '',
        village: '',
        password: '',
        confirmPassword: '',
    });

    const [states, setStates] = useState<string[]>([]);
    const [districts, setDistricts] = useState<string[]>([]);
    const [blocks, setBlocks] = useState<string[]>([]);
    const [villages, setVillages] = useState<string[]>([]);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    useEffect(() => {
        // Fetch states on mount
        getStatesAPI().then(setStates).catch(console.error);
    }, []);

    useEffect(() => {
        // Fetch districts when state changes
        if (formData.state) {
            getDistrictsAPI(formData.state).then(setDistricts).catch(console.error);
        }
    }, [formData.state]);

    useEffect(() => {
        // Fetch blocks when district changes
        if (formData.district) {
            getBlocksAPI(formData.district).then(setBlocks).catch(console.error);
        }
    }, [formData.district]);

    useEffect(() => {
        // Fetch villages when block changes
        if (formData.block) {
            getVillagesAPI(formData.block).then(setVillages).catch(console.error);
        }
    }, [formData.block]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData((prev) => {
            const newData = { ...prev, [name]: value };
            if (name === 'state') {
                newData.district = '';
                newData.block = '';
                newData.village = '';
            } else if (name === 'district') {
                newData.block = '';
                newData.village = '';
            } else if (name === 'block') {
                newData.village = '';
            }
            return newData;
        });

        // Also clear lists if value is empty
        if (name === 'state' && !value) {
            setDistricts([]);
            setBlocks([]);
            setVillages([]);
        }
        if (name === 'district' && !value) {
            setBlocks([]);
            setVillages([]);
        }
        if (name === 'block' && !value) {
            setVillages([]);
        }
    };

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const result = farmerRegisterFrontendSchema.safeParse(formData);
        if (!result.success) {
            setError(result.error.issues[0].message);
            return;
        }

        setLoading(true);

        try {
            await registerFarmerAPI(formData);

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
                    Farmer Registration
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={4} textAlign="center">
                    Please fill in your details to start using the app.
                </Typography>

                <Box component="form" onSubmit={handleRegister} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
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
                        select
                        label="Block"
                        name="block"
                        variant="outlined"
                        fullWidth
                        value={formData.block}
                        onChange={handleChange}
                        required
                        disabled={!formData.district || blocks.length === 0}
                    >
                        {blocks.map((blk) => (
                            <MenuItem key={blk} value={blk} sx={{ py: 0.5, fontSize: '0.9rem' }}>
                                {blk}
                            </MenuItem>
                        ))}
                    </TextField>

                    <TextField
                        select
                        label="Village"
                        name="village"
                        variant="outlined"
                        fullWidth
                        value={formData.village}
                        onChange={handleChange}
                        required
                        disabled={!formData.block || villages.length === 0}
                    >
                        {villages.map((vil) => (
                            <MenuItem key={vil} value={vil} sx={{ py: 0.5, fontSize: '0.9rem' }}>
                                {vil}
                            </MenuItem>
                        ))}
                    </TextField>

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