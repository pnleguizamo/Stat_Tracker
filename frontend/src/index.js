import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 60 * 2,   // 2 minutes
      cacheTime: 1000 * 60 * 30,  // 30 minutes
      refetchOnWindowFocus: false
    }
  }
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <div>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </div>
);
