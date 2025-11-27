import './LandingPage.css';
import api from './lib/api.js';

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

const LandingPage = () => {
  return (
    <div className="landing-page">
      <header className="landing-header">
        <h1>Welcome to Our Spotify App</h1>
        <p>Sign in with your Spotify account to get started</p>
      </header>

      <div className="button-container">
        <button onClick={redirectToAuthCodeFlow} className="login-btn">
          Login with Spotify
        </button>
      </div>
    </div>
  );
};

export default LandingPage;
