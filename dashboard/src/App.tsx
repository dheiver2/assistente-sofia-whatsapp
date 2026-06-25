import { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Layout } from './components/Layout';
import { ToastProvider } from './components/Toast';
import { RoleProvider, useRole, type UserRole } from './hooks/useRole';
import { ErrorBoundary } from './components/ErrorBoundary';
import { API_BASE_URL } from './services/api';
import './App.css';

const Login = lazy(() => import('./pages/Login').then(m => ({ default: m.Login })));
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Sessions = lazy(() => import('./pages/Sessions').then(m => ({ default: m.Sessions })));
const Chats = lazy(() => import('./pages/Chats').then(m => ({ default: m.Chats })));
const Sales = lazy(() => import('./pages/Sales').then(m => ({ default: m.Sales })));
const Config = lazy(() => import('./pages/Config').then(m => ({ default: m.Config })));
const Contacts = lazy(() => import('./pages/Contacts').then(m => ({ default: m.Contacts })));
const Orders = lazy(() => import('./pages/Orders').then(m => ({ default: m.Orders })));
const Landing = lazy(() => import('./pages/Landing'));
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

function AppContent() {
  // Initialize from sessionStorage to avoid setState in effect
  const savedKey = sessionStorage.getItem('openwa_api_key');
  const [isAuthenticated, setIsAuthenticated] = useState(!!savedKey);
  const [, setApiKey] = useState(savedKey || '');
  const { setRole, role } = useRole();

  const handleLogin = async (key: string) => {
    setApiKey(key);
    sessionStorage.setItem('openwa_api_key', key);

    // Fetch the role from API
    try {
      const response = await fetch(`${API_BASE_URL}/auth/validate`, {
        method: 'POST',
        headers: { 'X-API-Key': key },
      });
      if (response.ok) {
        const data = await response.json();
        setRole(data.role as UserRole);
      }
    } catch {
      // Default to viewer if we can't fetch role
      setRole('viewer');
    }

    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    setApiKey('');
    setIsAuthenticated(false);
    setRole(null);
    sessionStorage.removeItem('openwa_api_key');
  };

  // Re-validate and get role on mount if already authenticated
  useEffect(() => {
    if (!savedKey) return;

    fetch(`${API_BASE_URL}/auth/validate`, {
      method: 'POST',
      headers: { 'X-API-Key': savedKey },
    })
      .then(res => res.json())
      .then(data => {
        if (data.valid && data.role) {
          setRole(data.role as UserRole);
        }
      })
      .catch(() => {
        // Keep existing role from localStorage if validation fails
      });
  }, [savedKey, setRole]);

  const loadingFallback = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <Loader2 className="animate-spin" size={32} />
    </div>
  );

  return (
    <ToastProvider>
      <BrowserRouter>
        <Suspense fallback={loadingFallback}>
        <Routes>
          <Route path="/landing" element={<Landing />} />
          {!isAuthenticated && (
            <Route path="*" element={<Login onLogin={handleLogin} />} />
          )}
          {isAuthenticated && (
          <Route path="/" element={<Layout onLogout={handleLogout} userRole={role} />}>
            <Route index element={<Dashboard />} />
            <Route path="sessoes" element={<Sessions />} />
            <Route path="conversas" element={<Chats />} />
            <Route path="vendas" element={<Sales />} />
            <Route path="pedidos" element={<Orders />} />
            <Route path="contatos" element={<Contacts />} />
            <Route path="config" element={<Config />} />
            {/* Legacy redirects — keep old URLs working */}
            <Route path="sessions" element={<Navigate to="/sessoes" replace />} />
            <Route path="chats" element={<Navigate to="/conversas" replace />} />
            <Route path="campanhas" element={<Navigate to="/vendas" replace />} />
            <Route path="recomendacoes" element={<Navigate to="/vendas?m=rec" replace />} />
            <Route path="sales" element={<Navigate to="/vendas" replace />} />
            <Route path="orders" element={<Navigate to="/pedidos" replace />} />
            <Route path="webhooks" element={<Navigate to="/config?tab=webhooks" replace />} />
            <Route path="templates" element={<Navigate to="/config?tab=templates" replace />} />
            <Route path="api-keys" element={<Navigate to="/config?tab=apikeys" replace />} />
            <Route path="infrastructure" element={<Navigate to="/config?tab=infra" replace />} />
            <Route path="plugins" element={<Navigate to="/config?tab=plugins" replace />} />
            <Route path="logs" element={<Navigate to="/config?tab=logs" replace />} />
            <Route path="message-tester" element={<Navigate to="/conversas" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
          )}
        </Routes>
        </Suspense>
      </BrowserRouter>
    </ToastProvider>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RoleProvider>
          <AppContent />
        </RoleProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
