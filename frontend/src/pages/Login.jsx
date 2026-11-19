import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import authClient from '../services/auth';
import api from '../services/api';

const NOT_ADDED_MSG = 'You are not added to any college or faculty yet. Please contact your administrator.';

const Login = () => {
    const navigate = useNavigate();
    const { data: session, isPending } = authClient.useSession();
    const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
    const [form, setForm] = useState({ name: '', email: '', password: '' });
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    if (!isPending && session?.user) {
        return <Navigate to="/" replace />;
    }

    const handleChange = (e) => {
        setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSubmitting(true);
        try {
            // Allowlist gate: only emails added by the management portal may
            // sign in or register. If the check is unreachable, fall through to
            // the auth attempt — the API itself still rejects unprovisioned users.
            const email = form.email.trim().toLowerCase();
            try {
                const gate = await api.post('/access/check', { email });
                if (!gate.data?.allowed) {
                    setError(NOT_ADDED_MSG);
                    return;
                }
            } catch {
                // Gate lookup failed; let authentication proceed and let the API decide.
            }

            const result = mode === 'signin'
                ? await authClient.signIn.email({ email, password: form.password })
                : await authClient.signUp.email({ email, password: form.password, name: form.name || email.split('@')[0] });

            if (result.error) {
                setError(result.error.message || 'Authentication failed.');
            } else {
                navigate('/', { replace: true });
            }
        } catch (err) {
            setError(err?.message || 'Authentication failed.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="flex min-h-screen items-center justify-center px-4 py-8">
            <div className="card grid w-full max-w-4xl overflow-hidden md:grid-cols-[1fr_auto]">
                <section className="hidden flex-col justify-between bg-[var(--text-1)] p-8 text-[var(--bg)] md:flex">
                    <span className="chip-monogram">
                        T<span className="chip-monogram-dot" />S
                    </span>
                    <div>
                        <h1 className="text-[32px] leading-9">Timetable Studio</h1>
                        <p className="mt-3 max-w-sm text-sm opacity-80">
                            Secure sign-in for schedule operations, imports, and live timetable data.
                        </p>
                    </div>
                    <p className="font-mono text-[11px] leading-[14px] tracking-[0.08em] opacity-60">
                        MONO CIRCUIT · SCHEDULING SYSTEM
                    </p>
                </section>
                <section className="flex items-center justify-center p-4 sm:p-6">
                    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
                        <h2 className="text-[24px] leading-[30px]">
                            {mode === 'signin' ? 'Sign in' : 'Create account'}
                        </h2>

                        {mode === 'signup' && (
                            <label className="block">
                                <span className="caption block">Name</span>
                                <input
                                    type="text"
                                    name="name"
                                    value={form.name}
                                    onChange={handleChange}
                                    className="input-shell mt-1 w-full"
                                    autoComplete="name"
                                />
                            </label>
                        )}

                        <label className="block">
                            <span className="caption block">
                                Email <span className="text-[var(--danger)]">*</span>
                            </span>
                            <input
                                type="email"
                                name="email"
                                required
                                value={form.email}
                                onChange={handleChange}
                                className="input-shell mt-1 w-full"
                                autoComplete="email"
                            />
                        </label>

                        <label className="block">
                            <span className="caption block">
                                Password <span className="text-[var(--danger)]">*</span>
                            </span>
                            <input
                                type="password"
                                name="password"
                                required
                                minLength={8}
                                value={form.password}
                                onChange={handleChange}
                                className="input-shell mt-1 w-full"
                                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                            />
                        </label>

                        {error && (
                            <p className="alert-danger" role="alert">
                                {error}
                            </p>
                        )}

                        <button type="submit" disabled={submitting} className="btn-primary w-full">
                            {submitting ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
                        </button>

                        <button
                            type="button"
                            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(''); }}
                            className="btn-ghost w-full"
                        >
                            {mode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Sign in'}
                        </button>
                    </form>
                </section>
            </div>
        </div>
    );
};

export default Login;
