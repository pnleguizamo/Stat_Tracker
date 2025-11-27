import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import { Spinner } from 'react-bootstrap';

export default function ProtectedRoute({ children }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['auth','status'],
    queryFn: () => api.get('/api/auth/status'),
    retry: false,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div style={{display:'flex', justifyContent:'center', padding:24}}>
        <Spinner animation="border" />
      </div>
    );
  }

  if (isError || !data?.accountId) {
    return <Navigate to="/" replace />;
  }
  return children;
}
