import axios from 'axios';

export const dlApiClient = axios.create({
    baseURL: (process.env.DL_MODEL_SERVER_LINK).trim(),
});

dlApiClient.interceptors.request.use((config) => {
    const token = process.env.DL_API_KEY;
    if (token) {
        config.headers['Authorization'] = `Bearer ${token}`;
    }
    return config;
}, (error) => {
    return Promise.reject(error);
});
