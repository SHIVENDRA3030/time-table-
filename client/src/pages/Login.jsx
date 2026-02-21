import React from 'react';
import { SignIn } from '@clerk/clerk-react';

const Login = () => {
    return (
        <div className="relative flex min-h-screen items-center justify-center px-4 py-8">
            <div className="noise-overlay" />
            <div className="glass-panel grid w-full max-w-4xl overflow-hidden md:grid-cols-[1fr_auto]">
                <section className="hidden bg-gradient-to-br from-teal-700 to-emerald-700 p-8 text-white md:block">
                    <p className="chip border-white/40 bg-white/10 text-white">Welcome Back</p>
                    <h1 className="mt-4 text-4xl">Timetable Studio</h1>
                    <p className="mt-3 max-w-sm text-sm text-teal-100/90">
                        Secure sign-in for schedule operations, imports, and live timetable insights.
                    </p>
                </section>
                <section className="flex items-center justify-center p-4 sm:p-6">
                    <SignIn />
                </section>
            </div>
        </div>
    );
};

export default Login;
