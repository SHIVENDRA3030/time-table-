import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import authClient from '../services/auth';
import api from '../services/api';

const MeContext = createContext({ me: null, loading: true, refresh: () => {} });

// Resolves the signed-in user's app role, faculty link (email match), and the
// first-admin bootstrap state. Used by the nav, route guards, and both portals.
export const MeProvider = ({ children }) => {
    const { data: session, isPending } = authClient.useSession();
    const [me, setMe] = useState(null);
    const [loading, setLoading] = useState(true);

    const userId = session?.user?.id;

    const fetchMe = useCallback(async () => {
        if (!userId) {
            setMe(null);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const res = await api.get('/me');
            setMe(res.data);
        } catch {
            // /me unreachable — fail open in the UI (the API still gates every
            // route); provisioned defaults to true so the shell can render.
            setMe({ user: session.user, role: null, faculty: null, student: null, provisioned: true, needsBootstrap: false });
        } finally {
            setLoading(false);
        }
    }, [userId, session]);

    useEffect(() => {
        if (isPending) return;
        fetchMe();
    }, [isPending, fetchMe]);

    const value = useMemo(() => ({ me, loading, refresh: fetchMe }), [me, loading, fetchMe]);
    return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
};

export const useMe = () => useContext(MeContext);
