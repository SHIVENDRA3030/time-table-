import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import api from './services/api';
import authClient from './services/auth';
import { MeProvider, useMe } from './context/MeContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Timetables from './pages/Timetables';
import ViewerPortal from './pages/ViewerPortal';
import NotFound from './pages/NotFound';
import NotProvisioned from './pages/NotProvisioned';
import Login from './pages/Login';
import AxiosInterceptor from './components/AxiosInterceptor';
import DesignerPage from './pages/admin/DesignerPage';
import MasterDataPage from './pages/admin/MasterDataPage';
import ImportPage from './pages/admin/ImportPage';
import UsersPage from './pages/admin/UsersPage';
import AccessPage from './pages/admin/AccessPage';
import RequestsPage from './pages/admin/RequestsPage';
import AuditPage from './pages/admin/AuditPage';
import MyTimetablePage from './pages/faculty/MyTimetablePage';
import MyRequestsPage from './pages/faculty/MyRequestsPage';

// Replaces Clerk's <SignedIn>/<SignedOut> gate with a Neon Auth session check.
function RequireAuth({ children }) {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return null;
  if (!session?.user) return <Navigate to="/login" replace />;
  return children;
}

// Allowlist gate: signed-in users not yet added to the portal see the
// "not added to any college or faculty" screen instead of the app shell.
function ProvisionGate({ children }) {
  const { me, loading } = useMe();
  if (loading || !me) return null;
  if (me.user && me.provisioned === false) return <NotProvisioned />;
  return children;
}

// Role gate for the admin and faculty portals. `roles` accepts a role list;
// users without an assigned role are treated as viewers.
function RequireRole({ roles, children }) {
  const { me, loading } = useMe();
  if (loading || !me) return null;
  if (!me.user) return <Navigate to="/login" replace />;
  if (!roles.includes(me.role)) return <Navigate to="/" replace />;
  return children;
}

function RequireFaculty({ children }) {
  const { me, loading } = useMe();
  if (loading || !me) return null;
  if (!me.user) return <Navigate to="/login" replace />;
  if (!me.faculty) return <Navigate to="/" replace />;
  return children;
}

const ADMIN_TABS = [
  { to: '/admin/designer', label: 'Timetable Designer', roles: ['admin', 'editor'] },
  { to: '/admin/master-data', label: 'Master Data', roles: ['admin', 'editor'] },
  { to: '/admin/import', label: 'Import', roles: ['admin', 'editor'] },
  { to: '/admin/requests', label: 'Requests', roles: ['admin'] },
  { to: '/admin/users', label: 'Users & Roles', roles: ['admin'] },
  { to: '/admin/access', label: 'Access', roles: ['admin'] },
  { to: '/admin/audit', label: 'Audit Log', roles: ['admin'] },
];

function AdminLayout() {
  const { me } = useMe();
  const role = me?.role || 'viewer';
  const location = useLocation();
  const isAdmin = role === 'admin';
  const [pendingCount, setPendingCount] = useState(null);
  const tabs = ADMIN_TABS.filter((tab) => tab.roles.includes(role));

  // Pending faculty requests badge (admins); refreshes on every admin navigation.
  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    api.get('/requests', { params: { status: 'pending' } })
      .then((res) => { if (active) setPendingCount(Array.isArray(res.data) ? res.data.length : 0); })
      .catch(() => {});
    return () => { active = false; };
  }, [isAdmin, location.pathname]);

  return (
    <div>
      <nav className="tabs mx-auto mb-5 w-full max-w-[1320px] px-3 md:px-6">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => `tab${isActive ? ' is-active' : ''}`}
          >
            {tab.label}
            {tab.to === '/admin/requests' && isAdmin && pendingCount > 0 ? (
              <span className="badge-count">{pendingCount}</span>
            ) : null}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}

// Viewers and unassigned users get the read-only published-timetable home;
// admins and editors get the operations dashboard; students land directly on
// their own section's published timetable.
function Home() {
  const { me, loading } = useMe();
  if (loading) return null;
  const role = me?.role;
  if (role === 'admin' || role === 'editor') return <Dashboard />;
  if (me?.student) return <ViewerPortal fixedSectionId={me.student.section_id} />;
  return <ViewerPortal />;
}

function App() {
  return (
    <BrowserRouter>
      <AxiosInterceptor>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={
            <RequireAuth>
              <MeProvider>
                <ProvisionGate>
                  <Layout />
                </ProvisionGate>
              </MeProvider>
            </RequireAuth>
            }>
              <Route index element={<Home />} />
              <Route path="timetables" element={<Timetables />} />

            <Route path="portal" element={
              <RequireFaculty roles={['admin', 'editor', 'viewer']}>
                <MyTimetablePage />
              </RequireFaculty>
            } />
            <Route path="portal/requests" element={
              <RequireFaculty>
                <MyRequestsPage />
              </RequireFaculty>
            } />

            <Route path="admin" element={
              <RequireRole roles={['admin', 'editor']}>
                <AdminLayout />
              </RequireRole>
            }>
              <Route index element={<Navigate to="/admin/designer" replace />} />
              <Route path="designer" element={<DesignerPage />} />
              <Route path="master-data" element={<MasterDataPage />} />
              <Route path="import" element={<ImportPage />} />
              <Route path="requests" element={
                <RequireRole roles={['admin']}><RequestsPage /></RequireRole>
              } />
              <Route path="users" element={
                <RequireRole roles={['admin']}><UsersPage /></RequireRole>
              } />
              <Route path="access" element={
                <RequireRole roles={['admin']}><AccessPage /></RequireRole>
              } />
              <Route path="audit" element={
                <RequireRole roles={['admin']}><AuditPage /></RequireRole>
              } />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Route>
          <Route path="*" element={
            <RequireAuth>
              <MeProvider>
                <ProvisionGate>
                  <NotFound />
                </ProvisionGate>
              </MeProvider>
            </RequireAuth>
          } />
        </Routes>
      </AxiosInterceptor>
    </BrowserRouter>
  );
}

export default App;
