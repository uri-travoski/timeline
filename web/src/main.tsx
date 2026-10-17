import { StrictMode, Suspense, lazy, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import './index.css';
import { ApiError } from './lib/api';
import { applyTheme, useMe } from './lib/hooks';
import { Layout } from './components/Layout';
import { ComposerProvider } from './components/Composer';
import { Spinner, Toaster } from './components/ui';
import Feed from './pages/Feed';
import Login from './pages/Login';

// After an upgrade, an open tab may ask for code chunks that no longer exist: reload once.
window.addEventListener('vite:preloadError', () => {
  if (sessionStorage.getItem('tl-reloaded') !== '1') {
    sessionStorage.setItem('tl-reloaded', '1');
    location.reload();
  }
});
setTimeout(() => sessionStorage.removeItem('tl-reloaded'), 10_000);

const Reels = lazy(() => import('./pages/Reels'));
const PostPage = lazy(() => import('./pages/PostPage'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Reminders = lazy(() => import('./pages/Reminders'));
const Trash = lazy(() => import('./pages/Trash'));
const Agents = lazy(() => import('./pages/Agents'));
const Settings = lazy(() => import('./pages/Settings'));
const Admin = lazy(() => import('./pages/Admin'));
const Me = lazy(() => import('./pages/Me'));

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, refetchOnWindowFocus: false },
  },
});

const page = (el: React.ReactNode) => (
  <Suspense fallback={<div className="grid place-items-center py-20"><Spinner size={26} /></div>}>{el}</Suspense>
);

const router = createBrowserRouter([
  {
    element: <Gate />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: '/', element: <Feed /> },
          { path: '/reels', element: page(<Reels />) },
          { path: '/post/:id', element: page(<PostPage />) },
          { path: '/notifications', element: page(<Notifications />) },
          { path: '/reminders', element: page(<Reminders />) },
          { path: '/trash', element: page(<Trash />) },
          { path: '/agents', element: page(<Agents />) },
          { path: '/settings', element: page(<Settings />) },
          { path: '/settings/storage', element: page(<Settings />) },
          { path: '/admin', element: page(<Admin />) },
          { path: '/me', element: page(<Me />) },
          { path: '*', element: <Feed /> },
        ],
      },
    ],
  },
]);

import { Outlet } from 'react-router';

function Gate() {
  const me = useMe();
  const client = useQueryClient();
  useEffect(() => {
    const onUnauth = () => client.setQueryData(['me'], undefined);
    window.addEventListener('tl:unauthorized', onUnauth);
    return () => window.removeEventListener('tl:unauthorized', onUnauth);
  }, [client]);
  useEffect(() => {
    if (me.data) applyTheme(me.data.user.settings.theme);
  }, [me.data?.user.settings.theme]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // Re-register the service worker (web push) if permission was granted earlier.
    if (me.data && 'serviceWorker' in navigator && window.Notification?.permission === 'granted') navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, [!!me.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (me.isLoading) return <div className="grid h-dvh place-items-center"><Spinner size={30} /></div>;
  if (!me.data) return <Login />;
  return (
    <ComposerProvider>
      <Outlet />
    </ComposerProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
);
