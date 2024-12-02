import React from 'react';
import './LandingPage.css';
import { redirectToAuthCodeFlow, getAccessToken, fetchProfile } from "./spotifyAuthorization.js";

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
