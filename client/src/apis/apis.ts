/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from 'axios';
import { Preferences } from '@capacitor/preferences';

/**
 * Register a new farmer and save the JWT token
//  */
import { API_BASE } from '@gonidhi/shared';
export const registerFarmerAPI = async (formData: { name: string; phone: string; village: string; state: string; district: string; pincode?: string; password?: string }) => {
    try {
        const response = await axios.post(`${API_BASE}/api/farmer/auth/register`, formData);

        const data = response.data;

        if (!data.success) {
            throw new Error(data.message || 'Registration failed');
        }

        // Save Token securely
        await Preferences.set({ key: 'jwt_token', value: data.token });
        await Preferences.set({ key: 'user_data', value: JSON.stringify(data.user) });

        return data;
    } catch (error) {
        // If it's an axios error with a response, extract the message
        if (axios.isAxiosError(error) && error.response?.data?.message) {
            throw new Error(error.response.data.message);
        }
        throw error;
    }
};

/**
 * Location APIs
 */
export const getStatesAPI = async () => {
    const response = await axios.get(`${API_BASE}/api/farmer/location/states`);
    return response.data;
};

export const getDistrictsAPI = async (state: string) => {
    const response = await axios.get(`${API_BASE}/api/farmer/location/districts`, { params: { state } });
    return response.data;
};

export const getBlocksAPI = async (district: string) => {
    const response = await axios.get(`${API_BASE}/api/farmer/location/blocks`, { params: { district } });
    return response.data;
};

export const getVillagesAPI = async (block: string) => {
    const response = await axios.get(`${API_BASE}/api/farmer/location/villages`, { params: { block } });
    return response.data;
};

/**
 * Check server connectivity
 */
export const getServerHealthAPI = async () => {
    try {
        await axios.get(`${API_BASE}/api/health`, { timeout: 5000 });
        return { success: true, isOffline: false };
    } catch {
        return { success: false, isOffline: true };
    }
};

/**
 * Fetch all cows belonging to the logged-in farmer
 */
export const getMyCattleAPI = async ({ pageParam = 1, search = '', limit = 10 } = {}) => {
    try {
        const { value: token } = await Preferences.get({ key: 'jwt_token' });
        const { value: cached } = await Preferences.get({ key: 'cached_my_cattle' });

        if (!token) throw new Error('Not authenticated');

        try {
            const response = await axios.get(`${API_BASE}/api/farmer/cattle`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { page: pageParam, limit, search }
            });

            if (!response.data.success) {
                throw new Error(response.data.message || 'Failed to fetch cattle');
            }

            // Update cache only on page 1 load without search
            if (pageParam === 1 && !search) {
                await Preferences.set({ key: 'cached_my_cattle', value: JSON.stringify(response.data) });
            }

            return response.data;
        } catch (error) {
            // Fallback to cache if offline
            if (!navigator.onLine && cached) {
                console.warn('Network failed, falling back to cached cattle data.');
                const cachedData = JSON.parse(cached);
                // Return cached data but wrap it to match paginated structure
                return { ...cachedData, isOffline: true, data: search ? [] : cachedData.data };
            }
            throw error;
        }

    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.data?.message) {
            throw new Error(error.response.data.message);
        }
        throw error;
    }
};

/**
 * Delete a specific cow by its MongoDB ID
 */
export const deleteCowAPI = async (cowId: string) => {
    try {
        const { value: token } = await Preferences.get({ key: 'jwt_token' });
        if (!token) throw new Error('Not authenticated');

        const response = await axios.delete(`${API_BASE}/api/farmer/cattle/${cowId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.data.success) {
            throw new Error(response.data.message || 'Failed to delete cow');
        }

        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.data?.message) {
            throw new Error(error.response.data.message);
        }
        throw error;
    }
};

/**
 * Fetch a single cow profile by ID
 */
export const getCowProfileAPI = async (cowId: string) => {
    const { value: token } = await Preferences.get({ key: 'jwt_token' });
    if (!token) throw new Error('Not authenticated');

    try {
        const response = await axios.get(`${API_BASE}/api/farmer/cattle/${cowId}`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.data.success) {
            throw new Error(response.data.message || 'Failed to fetch cow profile');
        }

        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const err = new Error(error.response?.data?.message || 'Server Error') as any;
            err.responseStatus = error.response?.status;
            err.isRejected = error.response?.data?.isRejected;
            err.status = error.response?.data?.status;
            throw err;
        }
        throw error;
    }
};

/**
 * Register a new cow to the farmer's herd
 */
export const registerCowAPI = async (cowData: Record<string, any>, signal?: AbortSignal) => {
    try {
        const { value: token } = await Preferences.get({ key: 'jwt_token' });
        if (!token) throw new Error('Not authenticated');

        const formData = new FormData();

        Object.keys(cowData).forEach((key) => {
            formData.append(key, cowData[key]);
        });

        const response = await axios.post(`${API_BASE}/api/farmer/cattle`, formData, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
            signal
        });

        if (!response.data.success) {
            const err = new Error(response.data.message || 'Failed to register cow') as Error & { responseStatus?: number };
            err.responseStatus = response.status === 200 ? 400 : response.status;
            throw err;
        }

        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const err = new Error(error.response?.data?.message || error.message) as Error & { responseStatus?: number };
            err.responseStatus = error.response?.status;
            throw err;
        }
        throw error;
    }
};

/**
 * Login an existing farmer and save the JWT token
 */
export const loginFarmerAPI = async (phone: string, password?: string) => {
    try {
        const response = await axios.post(`${API_BASE}/api/farmer/auth/login`, { phone, password });

        const data = response.data;

        if (!data.success) {
            throw new Error(data.message || 'Login failed');
        }

        // Save Token securely
        await Preferences.set({ key: 'jwt_token', value: data.token });
        await Preferences.set({ key: 'user_data', value: JSON.stringify(data.user) });

        return data;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.data?.message) {
            throw new Error(error.response.data.message);
        }
        throw error;
    }
};

/**
 * Search for a cow using AI (Face & Muzzle)
 */
export const searchCowAPI = async (searchData: { faceImage: string; muzzleImage: string }, signal?: AbortSignal) => {
    try {
        const { value: token } = await Preferences.get({ key: 'jwt_token' });
        if (!token) throw new Error('Not authenticated');

        const formData = new FormData();

        formData.append('faceImage', searchData.faceImage);
        formData.append('muzzleImage', searchData.muzzleImage);

        const response = await axios.post(`${API_BASE}/api/farmer/cattle/search`, formData, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
            signal
        });

        if (!response.data.success) {
            throw new Error(response.data.message || 'Search failed');
        }

        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.data?.message) {
            throw new Error(error.response.data.message);
        }
        throw error;
    }
};

/**
 * User Profile APIs
 */
export const getUserProfileAPI = async () => {
    try {
        const { value: token } = await Preferences.get({ key: 'jwt_token' });
        if (!token) throw new Error('Not authenticated');

        const response = await axios.get(`${API_BASE}/api/farmer/user/profile`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.data.success) {
            throw new Error(response.data.message || 'Failed to fetch user profile');
        }

        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.data?.message) {
            throw new Error(error.response.data.message);
        }
        throw error;
    }
};

export const updateUserProfileAPI = async (profileData: Record<string, unknown>) => {
    try {
        const { value: token } = await Preferences.get({ key: 'jwt_token' });
        if (!token) throw new Error('Not authenticated');

        const response = await axios.put(`${API_BASE}/api/farmer/user/profile`, profileData, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!response.data.success) {
            throw new Error(response.data.message || 'Failed to update user profile');
        }

        // Optionally update locally cached user data if needed
        await Preferences.set({
            key: 'user_data', value: JSON.stringify({
                id: response.data.user._id,
                name: response.data.user.name,
                role: response.data.user.role,
                phone: response.data.user.contact?.phone
            })
        });

        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.data?.message) {
            throw new Error(error.response.data.message);
        }
        throw error;
    }
};

export const logoutUserAPI = async () => {
    try {
        const { value: token } = await Preferences.get({ key: 'jwt_token' });
        if (!token) return { success: true };

        const response = await axios.post(`${API_BASE}/api/farmer/user/logout`, {}, {
            headers: { Authorization: `Bearer ${token}` }
        });

        return response.data;
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.data?.message) {
            throw new Error(error.response.data.message);
        }
        throw error;
    }
};
