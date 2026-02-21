import { useLayoutEffect } from 'react';
import { useAuth } from '@clerk/clerk-react';
import api from '../services/api';

const AxiosInterceptor = ({ children }) => {
    const { getToken, isLoaded, isSignedIn } = useAuth();

    useLayoutEffect(() => {
        if (!isLoaded || !isSignedIn) return;

        const requestInterceptor = api.interceptors.request.use(
            async (config) => {
                const token = await getToken();
                if (token) {
                    config.headers = config.headers ?? {};
                    config.headers.Authorization = `Bearer ${token}`;
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
    }, [getToken, isLoaded, isSignedIn]);

    if (!isLoaded) return null;

    return children;
};

export default AxiosInterceptor;
