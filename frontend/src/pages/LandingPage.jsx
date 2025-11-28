import '../styles/LandingPage.css';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api.js';

const LandingPage = () => {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: () => api.get('/api/auth/status'),
    retry: false,
    staleTime: 30_000
  });
  const [loadingGuest, setLoadingGuest] = useState(false);

  async function redirectToAuthCodeFlow() {
    try {
      const json = await api.post('/api/auth/start');
      if (!json || !json.url) throw new Error('No authorize URL returned from server');
      document.location = json.url;
    } catch (err) {
      const message = err?.message || 'Failed to start auth flow';
      console.error('redirectToAuthCodeFlow error', err);
      throw new Error(message);
    }
  }

  async function continueAsGuest(ev) {
    ev && ev.preventDefault();
    try {
      setLoadingGuest(true);
      const json = await api.post('/api/auth/guest');
      if (!json || !json.accountId) throw new Error('Guest login failed');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      console.error('Guest login error', err);
      alert('Guest login failed. Check console for details.');
    } finally {
      setLoadingGuest(false);
    }
  }

  useEffect(() => {
    if (!isLoading && data?.accountId) {
      navigate('/dashboard', { replace: true });
    }
  }, [data, isLoading, navigate]);

  return (
    <>{!isLoading && (
      <div className="landing-page">
        <div className="card landing-card">
          <header className="landing-header">
            <h1 className="title">Spotify Stats</h1>
            <p className="tagline">Explore listening stats and play games! Sign in with Spotify or try the demo.</p>
          </header>

          <div className="actions">
            <button onClick={redirectToAuthCodeFlow} className="login-btn">
              Login with Spotify
            </button>

            <div className="guest-cta">
              <button
                className="guest-btn"
                onClick={continueAsGuest}
                disabled={loadingGuest}
              >
                {loadingGuest ? 'Starting guest session...' : 'Continue as Guest'}
              </button>
            </div>
          </div>

          <footer className="landing-footer">
            <small>Demo accounts have limited access to a sample spotify user's data.</small>
          </footer>
        </div>
      </div>
    )}</>
  );
};

export default LandingPage;
