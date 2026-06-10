import React, { useEffect } from 'react';
import { Box, Typography, CircularProgress } from '@mui/material';
import { motion, AnimatePresence } from 'framer-motion';
import { App } from '@capacitor/app';
import { useProcessing } from '../contexts/ProcessingContext';
import { Capacitor } from '@capacitor/core';

export const GlobalProcessingOverlay: React.FC = () => {
    const { isOpen, progress, title, status, hideCancel, stopProcessing } = useProcessing();

    useEffect(() => {
        if (!isOpen) return;

        // Block internal browser navigation
        const handlePopState = (e: PopStateEvent) => {
            e.preventDefault();
            const confirmLeave = window.confirm('Processing is active. Are you sure you want to cancel?');
            if (confirmLeave) {
                stopProcessing(true);
            } else {
                // Push state back to prevent navigation
                window.history.pushState(null, '', window.location.href);
            }
        };

        window.history.pushState(null, '', window.location.href);
        window.addEventListener('popstate', handlePopState);

        // Block Android Hardware Back Button
        let backButtonListener: any = null;
        if (Capacitor.isNativePlatform()) {
            App.addListener('backButton', () => {
                const confirmLeave = window.confirm('Processing is active. Are you sure you want to cancel?');
                if (confirmLeave) {
                    stopProcessing(true);
                }
            }).then(listener => {
                backButtonListener = listener;
            });
        }

        return () => {
            window.removeEventListener('popstate', handlePopState);
            if (backButtonListener) {
                backButtonListener.remove();
            }
        };
    }, [isOpen, stopProcessing]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        zIndex: 9999,
                        backgroundColor: 'rgba(0, 0, 0, 0.85)',
                        backdropFilter: 'blur(10px)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                    }}
                >
                    <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 140, height: 140, mb: 4 }}>
                        {/* Background glowing pulse */}
                        <motion.div
                            animate={{
                                scale: [1, 1.2, 1],
                                opacity: [0.2, 0.4, 0.2],
                            }}
                            transition={{
                                repeat: Infinity,
                                duration: 2,
                                ease: "easeInOut"
                            }}
                            style={{
                                position: 'absolute',
                                width: 140,
                                height: 140,
                                borderRadius: '50%',
                                background: 'radial-gradient(circle, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 70%)',
                                zIndex: 0
                            }}
                        />

                        {/* Faint Track */}
                        <svg width="140" height="140" viewBox="0 0 140 140" style={{ position: 'absolute', zIndex: 1 }}>
                            <circle cx="70" cy="70" r="64" stroke="rgba(255,255,255,0.08)" strokeWidth="4" fill="transparent" />
                        </svg>

                        {/* Animated Progress Ring */}
                        <motion.svg
                            width="140"
                            height="140"
                            viewBox="0 0 140 140"
                            style={{ position: 'absolute', zIndex: 2, rotate: -90 }}
                        >
                            <motion.circle
                                cx="70"
                                cy="70"
                                r="64"
                                stroke="#ffffff"
                                strokeWidth="4"
                                fill="transparent"
                                strokeLinecap="round"
                                initial={{ strokeDasharray: "0 403" }}
                                animate={
                                    progress > 0
                                        ? { strokeDasharray: `${(progress / 100) * 403} 403`, strokeDashoffset: 0 }
                                        : { strokeDasharray: ["0 403", "200 403", "0 403"], strokeDashoffset: [0, -200, -403] }
                                }
                                transition={
                                    progress > 0
                                        ? { duration: 0.5, ease: "easeOut" }
                                        : { repeat: Infinity, duration: 1.5, ease: "easeInOut" }
                                }
                                style={{
                                    filter: 'drop-shadow(0px 0px 4px rgba(255, 255, 255, 0.3))'
                                }}
                            />
                        </motion.svg>

                        {/* Number Display */}
                        <Box sx={{ zIndex: 3, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <Typography variant="h3" component="div" sx={{ fontWeight: 800, letterSpacing: '-1px', display: 'flex', alignItems: 'baseline' }}>
                                {Math.round(progress)}
                                <span style={{ fontSize: '1.25rem', fontWeight: 600, color: 'rgba(255,255,255,0.5)', marginLeft: '2px' }}>%</span>
                            </Typography>
                        </Box>
                    </Box>

                    <Typography variant="h5" sx={{ fontWeight: 800, mb: 1 }}>
                        {title}
                    </Typography>

                    <Typography variant="body1" sx={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center', px: 4, mb: 4 }}>
                        {status}
                    </Typography>

                    {!hideCancel && (
                        <Box
                            component={motion.button}
                            whileHover={{ scale: 1.05, backgroundColor: 'rgba(255,255,255,0.15)' }}
                            whileTap={{ scale: 0.95 }}
                            onClick={() => {
                                if (window.confirm('Processing is active. Are you sure you want to cancel?')) {
                                    stopProcessing(true);
                                }
                            }}
                            sx={{
                                background: 'rgba(255,255,255,0.08)',
                                border: '1px solid rgba(255,255,255,0.2)',
                                borderRadius: '30px',
                                color: 'white',
                                px: 4,
                                py: 1.5,
                                fontSize: '1rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                backdropFilter: 'blur(10px)',
                                transition: 'background 0.2s ease',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                outline: 'none',
                                mt: 2
                            }}
                        >
                            Cancel
                        </Box>
                    )}
                </motion.div>
            )}
        </AnimatePresence>
    );
};
