import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary';
import { ThemeProvider } from './theme';
import './index.css';

// ── Global fetch wrapper ─────────────────────────────────────────────────
// 1) Prepends the server address (set on the login page) to relative /api
//    URLs so remote users can reach the admin's server over the LAN.
// 2) Attaches the auth token (Authorization: Bearer) to every request.
// Reads localStorage on every call so address/token changes apply instantly.
if (typeof window !== 'undefined') {
  const origFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    let url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let base = (localStorage.getItem('wsServerAddress') || '').trim().replace(/\/+$/, '');
    if (base && !/^https?:\/\//i.test(base)) {
      base = ''; // Ignore malformed server address
    }
    if (base && url.startsWith('/')) {
      url = base + url;
    }
    const headers = new Headers(init?.headers || {});
    const token = localStorage.getItem('wsAuthToken');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return origFetch(url, { ...init, headers });
  };
}

// Gracefully handle and filter out benign Vite HMR WebSocket connection errors
if (typeof window !== 'undefined') {
  const isViteWebsocketError = (err: any): boolean => {
    if (!err) return false;
    const str = String(err.message || err.stack || err.reason || err).toLowerCase();
    return (
      str.includes('websocket') ||
      str.includes('web socket') ||
      str.includes('closed without opened') ||
      str.includes('failed to connect to socket')
    );
  };

  window.addEventListener('unhandledrejection', (event) => {
    if (isViteWebsocketError(event.reason)) {
      event.preventDefault();
      event.stopPropagation();
      console.warn('Filtered out Vite development HMR WebSocket rejection.');
    }
  });

  window.addEventListener('error', (event) => {
    if (isViteWebsocketError(event.error) || isViteWebsocketError(event.message)) {
      event.preventDefault();
      event.stopPropagation();
      console.warn('Filtered out Vite development HMR WebSocket error.');
    }
  }, true);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);

