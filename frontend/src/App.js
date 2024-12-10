import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import LandingPage from './LandingPage';
import CurrentlyPlaying from './CurrentlyPlaying'; // Page for handling the callback after login
import RecentlyPlayed from './RecentlyPlayed';
import AppNavbar from './NavBar';
import TopArtists from './TopArtists';
import TopSongs from './TopSongs';
import FileUpload from './FileUpload';

function App() {
  return (
    <div>
    <Router>
        <AppNavbar />
        <Routes>
          <Route path="/" element={<LandingPage/>} />
          <Route path="/callback" element={<CurrentlyPlaying/>} />
          <Route path="/recently_played" element={<RecentlyPlayed/>} />
          <Route path="/top_artists" element={<TopArtists/>} />
          <Route path="/top_songs" element={<TopSongs/>} />
          <Route path="/upload_history" element={<FileUpload/>} />
          
        </Routes>
    </Router>
    </div>
  );
}

export default App;
