import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import LandingPage from './LandingPage';
import CurrentlyPlaying from './CurrentlyPlaying'; // Page for handling the callback after login
import RecentlyPlayed from './RecentlyPlayed';

function App() {
  return (
    <Router>
        <Routes>
          <Route path="/" element={<LandingPage/>} />
          <Route path="/callback" element={<CurrentlyPlaying/>} />
          <Route path="/recently_played" element={<RecentlyPlayed/>} />
          
        </Routes>
    </Router>
  );
}

export default App;
