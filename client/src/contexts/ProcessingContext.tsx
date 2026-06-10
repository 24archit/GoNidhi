import React, { createContext, useContext, useState, ReactNode } from 'react';

interface ProcessingState {
    isOpen: boolean;
    progress: number;
    title: string;
    status: string;
    hideCancel: boolean;
}

interface ProcessingContextType extends ProcessingState {
    startProcessing: (title: string, initialStatus?: string, hideCancel?: boolean) => AbortSignal;
    updateProgress: (progress: number, status?: string) => void;
    stopProcessing: (abort?: boolean) => void;
}

const ProcessingContext = createContext<ProcessingContextType | undefined>(undefined);

export const ProcessingProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const abortControllerRef = React.useRef<AbortController | null>(null);
    const [state, setState] = useState<ProcessingState>({
        isOpen: false,
        progress: 0,
        title: '',
        status: '',
        hideCancel: false
    });

    const startProcessing = (title: string, initialStatus: string = '', hideCancel: boolean = false) => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort(); // Abort any stale one
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;

        setState({
            isOpen: true,
            progress: 0,
            title,
            status: initialStatus,
            hideCancel
        });
        
        return controller.signal;
    };

    const updateProgress = (progress: number, status?: string) => {
        setState(prev => ({
            ...prev,
            progress: Math.min(100, Math.max(0, progress)), // Clamp 0-100
            ...(status !== undefined ? { status } : {})
        }));
    };

    const stopProcessing = (abort: boolean = false) => {
        if (abort && abortControllerRef.current) {
            abortControllerRef.current.abort();
        }
        setState(prev => ({ ...prev, isOpen: false }));
        // Let animations complete before resetting text/progress
        setTimeout(() => {
            setState({ isOpen: false, progress: 0, title: '', status: '', hideCancel: false });
        }, 500); 
    };

    return (
        <ProcessingContext.Provider value={{ ...state, startProcessing, updateProgress, stopProcessing }}>
            {children}
        </ProcessingContext.Provider>
    );
};

export const useProcessing = () => {
    const context = useContext(ProcessingContext);
    if (context === undefined) {
        throw new Error('useProcessing must be used within a ProcessingProvider');
    }
    return context;
};
