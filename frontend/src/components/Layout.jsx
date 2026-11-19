import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  House,
  CalendarBlank,
  BookOpen,
  SlidersHorizontal,
  Sun,
  Moon,
  SignOut,
  UserCircle,
  ListChecks,
  X,
} from '@phosphor-icons/react';
import api from '../services/api';
import authClient from '../services/auth';
import { useMe } from '../context/MeContext';
import RouteTransition from './RouteTransition';

const THEME_KEY = 'timetable-theme';

const getInitialTheme = () => {
    if (typeof window === 'undefined') return 'light';

    const stored = window.localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;

    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    return prefersDark ? 'dark' : 'light';
};

const getPageMeta = (pathname) => {
    if (pathname.startsWith('/admin/designer')) {
        return {
            title: 'Timetable Designer',
            subtitle: 'Drag classes across the week, resolve conflicts as they surface, and publish when the schedule holds.'
        };
    }
    if (pathname.startsWith('/admin/master-data')) {
        return {
            title: 'Master Data',
            subtitle: 'Define the college structure: programs, sections, subjects, faculty, rooms, periods, and workloads.'
        };
    }
    if (pathname.startsWith('/admin/import') || pathname.startsWith('/upload')) {
        return {
            title: 'Import',
            subtitle: 'Upload semester sheets, run a dry preview, then insert the scheduling data.'
        };
    }
    if (pathname.startsWith('/admin/requests')) {
        return {
            title: 'Change Requests',
            subtitle: 'Review faculty reschedule and cancellation requests, then apply or decline them.'
        };
    }
    if (pathname.startsWith('/admin/users')) {
        return {
            title: 'Users & Roles',
            subtitle: 'Decide who designs timetables, who views them, and who administers the system.'
        };
    }
    if (pathname.startsWith('/admin/access')) {
        return {
            title: 'Access',
            subtitle: 'Manage the portal-access allowlist for staff and students.'
        };
    }
    if (pathname.startsWith('/admin/audit')) {
        return {
            title: 'Audit Log',
            subtitle: 'Every change, import, and decision is recorded with its actor and timestamp.'
        };
    }
    if (pathname.startsWith('/admin')) {
        return {
            title: 'Administration',
            subtitle: 'Design, maintain, and govern the timetable from one place.'
        };
    }
    if (pathname.startsWith('/portal/requests')) {
        return {
            title: 'My Requests',
            subtitle: 'Reschedule and cancellation requests you have raised, and their outcomes.'
        };
    }
    if (pathname.startsWith('/portal')) {
        return {
            title: 'Faculty Portal',
            subtitle: 'Your teaching schedule, with self-service actions for the classes you own.'
        };
    }
    if (pathname.startsWith('/timetables')) {
        return {
            title: 'Timetables',
            subtitle: 'Filter by section, faculty, or room and inspect the weekly grid.'
        };
    }

    return {
        title: 'Overview',
        subtitle: 'Track resource readiness and move from import to published timetable.'
    };
};

const Monogram = ({ size = 32 }) => (
    <span className="chip-monogram" style={size === 32 ? undefined : { width: size, height: size, fontSize: size * 0.375 }}>
        T<span className="chip-monogram-dot" />S
    </span>
);

const Layout = () => {
    const [profileOpen, setProfileOpen] = useState(false);
    const [theme, setTheme] = useState(getInitialTheme);
    const location = useLocation();
    const navigate = useNavigate();
    const { me, refresh } = useMe();
    const { data: session } = authClient.useSession();
    const user = session?.user;
    const [claiming, setClaiming] = useState(false);

    const role = me?.role || 'viewer';
    const isFaculty = Boolean(me?.faculty);
    const isAdmin = role === 'admin';

    const navItems = useMemo(() => {
        const items = [
            { to: '/', label: 'Dashboard', icon: House, end: true },
            { to: '/timetables', label: 'Timetables', icon: CalendarBlank },
        ];
        if (isFaculty) items.push({ to: '/portal', label: 'My Portal', icon: BookOpen });
        if (role === 'admin' || role === 'editor') {
            items.push({ to: '/admin/designer', label: 'Admin', icon: SlidersHorizontal });
        }
        return items;
    }, [role, isFaculty]);

    const claimAdmin = async () => {
        setClaiming(true);
        try {
            await api.post('/admin/bootstrap');
            await refresh();
        } catch (err) {
            console.warn('Bootstrap failed:', err?.response?.data?.error || err?.message);
        } finally {
            setClaiming(false);
        }
    };

    const handleSignOut = async () => {
        try {
            await authClient.signOut();
        } finally {
            navigate('/login', { replace: true });
        }
    };

    const pageMeta = useMemo(() => getPageMeta(location.pathname), [location.pathname]);

    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        window.localStorage.setItem(THEME_KEY, theme);
    }, [theme]);

    // Mobile bottom tab bar: Today · Browse · Approvals · Profile (max 4).
    const tabItems = [{ to: '/', label: 'Today', icon: House, end: true }];
    tabItems.push({ to: '/timetables', label: 'Browse', icon: CalendarBlank });
    if (isAdmin) tabItems.push({ to: '/admin/requests', label: 'Approvals', icon: ListChecks });
    else if (isFaculty) tabItems.push({ to: '/portal/requests', label: 'Approvals', icon: ListChecks });
    else if (role === 'editor') tabItems.push({ to: '/admin/designer', label: 'Design', icon: SlidersHorizontal });

    const isDark = theme === 'dark';
    const initial = (user?.name || user?.email || '?').slice(0, 1).toUpperCase();

    return (
        <div className="app-shell flex min-h-screen">
            <aside className="sidebar">
                <div className="flex items-center gap-3 px-3 py-4">
                    <Monogram />
                    <div className="rail-hide min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--text-1)]">Timetable Studio</p>
                        <p className="truncate font-mono text-[11px] leading-[14px] text-[var(--text-3)]">SCHEDULING SYSTEM</p>
                    </div>
                </div>

                <nav className="flex flex-1 flex-col gap-1 px-2 py-2">
                    {navItems.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.end}
                            className={({ isActive }) => `sidebar-item${isActive ? ' is-active' : ''}`}
                            title={item.label}
                        >
                            <item.icon size={18} weight="regular" />
                            <span className="rail-hide">{item.label}</span>
                        </NavLink>
                    ))}
                </nav>

                <div className="rail-hide px-4 pb-4">
                    <p className="font-mono text-[11px] leading-[14px] text-[var(--text-3)]">MONO CIRCUIT · v1.0</p>
                </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
                <header className="topbar">
                    <div className="flex items-center gap-2 md:hidden">
                        <Monogram size={28} />
                        <span className="text-sm font-semibold text-[var(--text-1)]">Timetable Studio</span>
                    </div>
                    <p className="hidden truncate text-sm font-medium text-[var(--text-2)] md:block">
                        {pageMeta.title}
                    </p>

                    <div className="ml-auto flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
                            className="icon-btn"
                            title="Switch theme"
                        >
                            {isDark ? <Sun size={18} /> : <Moon size={18} />}
                        </button>
                        <span
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-2)] text-xs font-semibold text-[var(--text-1)]"
                            title={user?.email || ''}
                        >
                            {initial}
                        </span>
                        <button
                            type="button"
                            onClick={handleSignOut}
                            className="icon-btn"
                            title="Sign out"
                        >
                            <SignOut size={18} />
                        </button>
                    </div>
                </header>

                <main className="flex-1 px-4 pb-28 pt-6 md:px-6 md:pb-10">
                    <div className="mx-auto w-full max-w-[1320px]">
                        <section className="mb-6">
                            <h1 className="text-[28px] leading-[34px] md:text-[32px] md:leading-9">{pageMeta.title}</h1>
                            <p className="section-subtitle">{pageMeta.subtitle}</p>
                        </section>
                        {me?.needsBootstrap && !isAdmin && (
                            <section className="card-strong mb-6 flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                                <div>
                                    <p className="caption">First-time setup</p>
                                    <p className="mt-2 max-w-2xl text-sm text-[var(--text-2)]">
                                        No administrator exists yet. Claim admin access to configure roles, design timetables, and open the admin portal.
                                    </p>
                                </div>
                                <button type="button" onClick={claimAdmin} disabled={claiming} className="btn-primary">
                                    {claiming ? 'Claiming…' : 'Claim admin access'}
                                </button>
                            </section>
                        )}
                        <RouteTransition />
                    </div>
                </main>

                <footer className="border-t border-[var(--line)] px-4 py-4 text-center md:px-6">
                    <p className="font-mono text-[11px] leading-[14px] text-[var(--text-3)]">© 2026 TIMETABLE STUDIO</p>
                </footer>
            </div>

            <nav className="tabbar">
                {tabItems.map((item) => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        className={({ isActive }) => `tabbar-item${isActive ? ' is-active' : ''}`}
                    >
                        <item.icon size={20} weight="regular" className="tabbar-icon" />
                        {item.label}
                    </NavLink>
                ))}
                <button
                    type="button"
                    className={`tabbar-item${profileOpen ? ' is-active' : ''}`}
                    onClick={() => setProfileOpen(true)}
                >
                    <UserCircle size={20} weight="regular" className="tabbar-icon" />
                    Profile
                </button>
            </nav>

            {profileOpen && (
                <div className="fixed inset-0 z-[60] md:hidden" onClick={() => setProfileOpen(false)}>
                    <div className="absolute inset-0 bg-[rgba(16,18,16,0.4)]" />
                    <div
                        className="sheet-up absolute inset-x-0 bottom-0 rounded-t-xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-[var(--shadow-4)]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="mb-4 flex items-center justify-between">
                            <p className="text-sm font-semibold text-[var(--text-1)]">Profile</p>
                            <button type="button" className="icon-btn" onClick={() => setProfileOpen(false)} title="Close">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="mb-4 flex items-center gap-3">
                            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--surface-2)] text-sm font-semibold text-[var(--text-1)]">
                                {initial}
                            </span>
                            <div className="min-w-0">
                                <p className="truncate text-sm text-[var(--text-1)]">{user?.name || 'Signed in'}</p>
                                <p className="truncate font-mono text-[11px] leading-[14px] text-[var(--text-3)]">
                                    {user?.email || ''}
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
                            className="sidebar-item"
                        >
                            {isDark ? <Sun size={18} /> : <Moon size={18} />}
                            <span>Theme: {isDark ? 'Dark' : 'Light'}</span>
                        </button>
                        <button type="button" onClick={handleSignOut} className="sidebar-item text-[var(--danger)]">
                            <SignOut size={18} />
                            <span>Sign out</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Layout;
