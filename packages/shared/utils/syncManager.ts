/* eslint-disable @typescript-eslint/no-explicit-any */
import localforage from 'localforage';
import { base64ToFile } from './imageUtils';
import axios from 'axios';
import { Preferences } from '@capacitor/preferences';
import { API_BASE } from '@gonidhi/shared';
// Initialize stores
export const pendingCowsStore = localforage.createInstance({
    name: 'GoNidhi',
    storeName: 'pendingCows'
});

export const syncManager = {
    // Save a cow locally when offline
    savePendingCow: async (cowData: any) => {
        try {
            const id = Date.now().toString();
            await pendingCowsStore.setItem(id, { ...cowData, id, syncStatus: 'pending' });
            return id;
        } catch (err) {
            console.error('Error saving pending cow:', err);
            throw err;
        }
    },

    // Get all pending cows
    getPendingCows: async () => {
        try {
            const cows: any[] = [];
            await pendingCowsStore.iterate((value: any) => {
                cows.push(value);
            });
            return cows;
        } catch (err) {
            console.error('Error getting pending cows:', err);
            return [];
        }
    },

    // Remove a synced cow
    removePendingCow: async (id: string) => {
        try {
            await pendingCowsStore.removeItem(id);
        } catch (err) {
            console.error(`Error removing pending cow ${id}:`, err);
        }
    },

    // Upload all pending data when back online (stub function)
    syncAll: async (isAdmin = false, queryClient?: any) => {
        if (!navigator.onLine) return { success: false, syncedCount: 0 };

        try {
            const pendingCows = await syncManager.getPendingCows();
            if (pendingCows.length === 0) return { success: true, syncedCount: 0 };

            console.log(`Starting sync for ${pendingCows.length} cows...`);
            let syncedCount = 0;

            const tokenKey = isAdmin ? 'adminToken' : 'jwt_token';
            const { value: token } = await Preferences.get({ key: tokenKey });
            if (!token) throw new Error('Not authenticated');


            const registerEndpoint = isAdmin ? `${API_BASE}/api/admin/cattle/proxy-register` : `${API_BASE}/api/farmer/cattle`;

            for (const cow of pendingCows) {
                try {
                    const apiPayload = {
                        ...cow,
                        faceImage: base64ToFile(cow.faceImage, 'face_image.webp'),
                        muzzleImage: base64ToFile(cow.muzzleImage, 'muzzle_image.webp'),
                        leftImage: base64ToFile(cow.leftImage, 'left_image.webp'),
                        rightImage: base64ToFile(cow.rightImage, 'right_image.webp'),
                        backImage: base64ToFile(cow.backImage, 'back_image.webp'),
                        tailImage: base64ToFile(cow.tailImage, 'tail_image.webp'),
                        selfieImage: base64ToFile(cow.selfieImage, 'selfie_image.webp'),
                    };

                    const fd = new FormData();
                    Object.keys(apiPayload).forEach((key) => {
                        fd.append(key, apiPayload[key]);
                    });

                    // Send to backend API
                    const apiResponse = await axios.post(registerEndpoint, fd, {
                        headers: { Authorization: `Bearer ${token}` }
                    });

                    if (!apiResponse.data.success) {
                        throw new Error(apiResponse.data.message || 'Failed to register cow');
                    }

                    const savedCowId = apiResponse.data.data?._id || apiResponse.data._id;
                    if (!savedCowId) throw new Error('Registration failed to return Cow ID');

                    // Poll for AI result
                    let aiSuccess = false;
                    let attempts = 0;
                    const getCowEndpoint = isAdmin ? `${API_BASE}/api/admin/cattle/${savedCowId}` : `${API_BASE}/api/farmer/cattle/${savedCowId}`;

                    while (attempts < 20) {
                        await new Promise(resolve => setTimeout(resolve, 3000));
                        try {
                            const profileResponse = await axios.get(getCowEndpoint, {
                                headers: { Authorization: `Bearer ${token}` }
                            });

                            const aiStatus = profileResponse.data?.data?.aiMetadata?.status || profileResponse.data?.aiMetadata?.status;

                            if (aiStatus === 'SUCCESS' || aiStatus === 'DISPUTE') {
                                aiSuccess = true;
                                break;
                            } else if (aiStatus && aiStatus !== 'PENDING') {
                                throw new Error(aiStatus);
                            }
                        } catch (pollErr: any) {
                            if (pollErr.message && pollErr.message.includes('Registration failed')) {
                                throw new Error(pollErr.message);
                            } else if (pollErr.message === 'Cow not found or unauthorized' || pollErr.response?.status === 404) {
                                throw new Error('Registration failed: Removed by AI processes.');
                            }
                            // Otherwise it may be a network glitch, continue polling
                        }
                        attempts++;
                    }

                    if (aiSuccess) {
                        // Remove from pending store if successfully processed by AI
                        await syncManager.removePendingCow(cow.id);
                        syncedCount++;
                    } else {
                        throw new Error('Timeout waiting for AI verification.');
                    }
                } catch (err: any) {
                    console.error(`Failed to sync cow ${cow.id}:`, err);

                    // Determine if it was a validation/AI rejection or a network failure
                    const isValidationError = err.response?.status && err.response.status >= 400 && err.response.status < 500;
                    const isAiError = err.message && err.message.includes('Registration failed') || err.message === 'Timeout waiting for AI verification.';
                    const backendMsg = err.response?.data?.message || err.message || '';
                    const isDuplicateError = backendMsg.includes('already been registered') || backendMsg.includes('already exists') || backendMsg.includes('already registered');

                    if (isDuplicateError) {
                        // The cow is already registered or duplicate tag/photo, remove it from offline queue immediately
                        await syncManager.removePendingCow(cow.id);
                        console.warn(`Registration ${cow.id} discarded because it is already registered or a duplicate.`);
                    } else if (isValidationError || isAiError) {
                        try {
                            const newRetryCount = (cow.retryCount || 0) + 1;
                            if (newRetryCount >= 10) {
                                await syncManager.removePendingCow(cow.id);
                                console.warn(`Registration ${cow.id} discarded after exceeding 10 failed AI attempts.`);
                            } else {
                                await pendingCowsStore.setItem(cow.id, {
                                    ...cow,
                                    syncStatus: 'failed',
                                    retryCount: newRetryCount,
                                    errorMessage: backendMsg || 'Validation error from server',
                                });
                            }
                        } catch (updateErr) {
                            console.error('Failed to update pending cow status:', updateErr);
                        }
                    }
                }
            }

            console.log(`Successfully synced ${syncedCount} cows.`);

            if (syncedCount > 0 && queryClient) {
                // Invalidate the 'cows' query so the UI automatically fetches the latest herd list
                queryClient.invalidateQueries({ queryKey: ['cows'] });
            }

            return { success: true, syncedCount };

        } catch (err) {
            console.error('Sync failed:', err);
            return { success: false, syncedCount: 0 };
        }
    }
};
