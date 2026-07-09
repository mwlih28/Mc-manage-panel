import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import './i18n';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30000,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              background: '#131417',
              color: '#EDEDEF',
              border: '1px solid #26282D',
              borderRadius: '10px',
              fontSize: '13px',
              padding: '10px 14px',
              boxShadow: '0 8px 24px -8px rgba(0,0,0,0.5)',
            },
            success: { iconTheme: { primary: '#3EC896', secondary: '#131417' } },
            error: { iconTheme: { primary: '#F27074', secondary: '#131417' } },
          }}
        />
      </QueryClientProvider>
    </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
