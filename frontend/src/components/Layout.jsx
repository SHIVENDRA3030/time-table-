import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { UserButton } from '@clerk/clerk-react';
import RouteTransition from './RouteTransition';

const navItems = [
    { to: '/', label: 'Dashboard' },
    { to: '/upload', label: 'Upload' },
    { to: '/timetables', label: 'Timetables' },
];

const THEME_KEY = 'timetable-theme';

const getInitialTheme = () => {
    if (typeof window === 'undefined') return 'light';

    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;

    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
};

const getPageMeta = (pathname) => {
    if (pathname.startsWith('/upload')) {
        return {
            title: 'Bulk Import Studio',
            subtitle: 'Upload semester sheets, run safe previews, and watch scheduling data land cleanly.'
        };
    }

    if (pathname.startsWith('/timetables')) {
        return {
            title: 'Live Timetable Explorer',
            subtitle: 'Filter by section, faculty, or room and inspect occupancy patterns with dynamic views.'
        };
    }

    return {
        title: 'Academic Command Center',
        subtitle: 'Track resource readiness and move from upload to published timetable in one workspace.'
    };
};

const Layout = () => {
    const [mobileOpen, setMobileOpen] = useState(false);
    const [theme, setTheme] = useState(getInitialTheme);
    const location = useLocation();

    const pageMeta = useMemo(() => getPageMeta(location.pathname), [location.pathname]);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        window.localStorage.setItem(THEME_KEY, theme);
    }, [theme]);

    const getNavClass = ({ isActive }) =>
        `rounded-lg px-3 py-2 text-sm font-semibold transition ${isActive
            ? 'bg-white/90 text-[var(--ink-900)] shadow-sm'
            : 'text-white hover:bg-white/15'}`;

    const isDark = theme === 'dark';

    return (
        <div className="relative flex min-h-screen flex-col">
            <div className="noise-overlay" />

            <header className="sticky top-0 z-40 border-b border-white/15 bg-[var(--nav-bg)] backdrop-blur-xl">
                <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-2 px-3 py-3 sm:px-4 md:px-6">
                    <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                        <div className="pulse-ring flex h-9 w-9 items-center justify-center rounded-xl border border-white/40 bg-white/15 text-xs font-bold tracking-[0.2em] text-white sm:h-10 sm:w-10">
                            TMS
                        </div>
                        <div className="min-w-0">
                            <p className="truncate text-[1.05rem] font-semibold tracking-wide text-white sm:text-base">
                                Timetable Studio
                            </p>
                            <p className="hidden text-xs text-teal-100/80 sm:block">Scheduling workspace</p>
                        </div>
                    </div>

                    <nav className="hidden items-center gap-2 md:flex">
                        {navItems.map((item) => (
                            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={getNavClass}>
                                {item.label}
                            </NavLink>
                        ))}
                    </nav>

                    <div className="flex shrink-0 items-center gap-2 md:gap-3">
                        <button
                            type="button"
                            onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
                            className="hidden rounded-lg border border-white/35 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20 md:inline-flex"
                            title="Switch theme"
                        >
                            {isDark ? 'Light' : 'Dark'}
                        </button>
                        <button
                            type="button"
                            onClick={() => setMobileOpen((prev) => !prev)}
                            className="rounded-lg border border-white/35 bg-white/10 px-3 py-2 text-xs font-semibold text-white md:hidden"
                        >
                            {mobileOpen ? 'Close' : 'Menu'}
                        </button>
                        <div className="rounded-full border border-white/30 bg-white/10 p-1">
                            <UserButton />
                        </div>
                    </div>
                </div>

                {mobileOpen && (
                    <nav className="mx-4 mb-3 grid gap-2 rounded-xl border border-white/20 bg-white/10 p-2 backdrop-blur-md md:hidden">
                        <button
                            type="button"
                            onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
                            className="rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-100 transition hover:bg-white/15"
                        >
                            Theme: {isDark ? 'Dark' : 'Light'}
                        </button>
                        {navItems.map((item) => (
                            <NavLink
                                key={item.to}
                                to={item.to}
                                end={item.to === '/'}
                                className={getNavClass}
                                onClick={() => setMobileOpen(false)}
                            >
                                {item.label}
                            </NavLink>
                        ))}
                    </nav>
                )}
            </header>

            <main className="relative flex-1 px-4 pb-10 pt-7 md:px-6 md:pt-9">
                <div className="mx-auto w-full max-w-7xl">
                    <section className="glass-panel mb-6 px-5 py-5 md:px-7 md:py-6">
                        <span className="chip">Live workspace</span>
                        <h1 className="section-title mt-3">{pageMeta.title}</h1>
                        <p className="section-subtitle">{pageMeta.subtitle}</p>
                    </section>
                    <RouteTransition />
                </div>
            </main>

            <footer className="border-t border-white/25 px-4 py-4 text-center text-sm text-[var(--ink-600)] md:px-6">
                <p>&copy; 2026 College Timetable System</p>
            </footer>
        </div>
    );
};

export default Layout;
