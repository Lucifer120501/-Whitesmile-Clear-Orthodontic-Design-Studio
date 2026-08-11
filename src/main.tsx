import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

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
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

