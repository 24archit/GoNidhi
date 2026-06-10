import React from 'react';
import { motion } from 'framer-motion';

// Instagram/iOS style horizontal slide + fade.
// Using translate3d-equivalent (x) and opacity ensures hardware acceleration.
const pageVariants = {
    initial: { opacity: 0, x: 12 },
    in: { opacity: 1, x: 0 },
    out: { opacity: 0, x: -12 },
};

const pageTransition = {
    type: 'tween' as const,
    // Custom cubic-bezier for a snappy, native-feeling easing curve
    ease: [0.25, 0.8, 0.25, 1] as const,
    duration: 0.22,
};

const PageTransition: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    return (
        <motion.div
            initial="initial"
            animate="in"
            exit="out"
            variants={pageVariants}
            transition={pageTransition}
            style={{ 
                width: '100%', 
                position: 'relative',
                // Force GPU acceleration on low-end phones
                willChange: 'transform, opacity' 
            }}
        >
            {children}
        </motion.div>
    );
};

export default PageTransition;
