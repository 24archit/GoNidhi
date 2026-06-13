/**
 * Helper utility to determine the Deep Learning API Endpoint.
*/

export const getDlApiUrl = (): string => {
    return process.env.DL_MODEL_SERVER_LINK;
};


