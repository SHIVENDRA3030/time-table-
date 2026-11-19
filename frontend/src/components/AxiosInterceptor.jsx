import { useLayoutEffect } from 'react';
import authClient from '../services/auth';
import api from '../services/api';

const AxiosInterceptor = ({ children }) => {
    useLayoutEffect(() => {
        const requestInterceptor = api.interceptors.request.use(
            async (config) => {
                // Neon Auth session JWT (~15 min expiry); token() re-fetches when stale.
                try {
                    const { data } = await authClient.token();
                    // Shape differs across @neon/auth versions: data.token or data.session.token
                    const token = data?.token ?? data?.session?.token;
                    if (token) {
                        config.headers = config.headers ?? {};
                        config.headers.Authorization = `Bearer ${token}`;
                    }
                } catch {
                    // No session — send unauthenticated and let the API answer 401.
                }
                return config;
            },
            (error) => {
                return Promise.reject(error);
            }
        );

        return () => {
            api.interceptors.request.eject(requestInterceptor);
        };
    }, []);

    return children;
};

export default AxiosInterceptor;
