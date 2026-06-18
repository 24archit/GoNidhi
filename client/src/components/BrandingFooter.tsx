import React from 'react';
import { Box, Typography, Stack } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';

import ocacLogo from '../assets/ocac.png';
import iiitLogo from '../assets/iiit.png';

interface BrandingFooterProps {
    sx?: SxProps<Theme>;
}

const BrandingFooter: React.FC<BrandingFooterProps> = ({ sx }) => {
    return (
        <Box sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            opacity: 0.3,
            zIndex: 0,
            pointerEvents: 'none',
            mt: 'auto',
            py: 3,
            ...sx
        }}>
            <Stack direction="row" spacing={3} sx={{ mb: 1, alignItems: 'center' }}>
                <img src={ocacLogo} alt="OCAC" style={{ height: 40, objectFit: 'contain' }} />
                <img src={iiitLogo} alt="IIIT" style={{ height: 40, objectFit: 'contain' }} />
            </Stack>
            <Typography variant="caption" fontWeight="bold" color="text.secondary" sx={{ textAlign: 'center' }}>
                A Government of Odisha Initiative<br />
                Built by OCAC & IIIT-Bhubaneswar
            </Typography>
        </Box>
    );
};

export default BrandingFooter;
