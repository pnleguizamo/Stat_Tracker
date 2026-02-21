import { BrowserRouter as Router, Route, Routes, Outlet } from 'react-router-dom';
import LandingPage from './pages/LandingPage.jsx';
import CurrentlyPlaying from './pages/CurrentlyPlaying.jsx';
import RecentlyPlayed from './pages/RecentlyPlayed.jsx';
import AppNavbar from './components/NavBar.jsx';
import TopArtists from './pages/TopArtists.jsx';
import TopSongs from './pages/TopSongs.jsx';
import FileUpload from './pages/FileUpload.jsx';
import TopAlbums from './pages/TopAlbums.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import GameLobby from './pages/GameLobby.tsx';
import StagePlanner from './game/host/StagePlanner.tsx';
import PlayerScreen from './game/player/PlayerScreen.tsx';
import HostGameScreen from './game/host/HostGame.tsx';
import Wrapped from './pages/Wrapped.jsx';
import PlayerVotesSandbox from './pages/PlayerVotesSandbox.tsx';

function ProtectedLayout() {
  return (
    <ProtectedRoute>
      <div>
        <AppNavbar />
        <Outlet />
      </div>
    </ProtectedRoute>
  );
}

function App() {
  return (
    <div>
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/game/:roomCode" element={<PlayerScreen />} />
        <Route path="/game/host/:roomCode/setup" element={<StagePlanner />} />
        <Route path="/game/host/:roomCode/play" element={<HostGameScreen />} />
        <Route path="/sandbox/player-votes" element={<PlayerVotesSandbox />} />
        <Route element={<ProtectedLayout />}>
          <Route path="/dashboard" element={<CurrentlyPlaying />} />
          <Route path="/recently_played" element={<RecentlyPlayed />} />
          <Route path="/top_artists" element={<TopArtists />} />
          <Route path="/top_albums" element={<TopAlbums />} />
          <Route path="/top_songs" element={<TopSongs />} />
          <Route path="/wrapped" element={<Wrapped />} />
          <Route path="/upload_history" element={<FileUpload />} />
          <Route path="/lobby" element={<GameLobby />} />
        </Route>
      </Routes>
    </Router>
    </div>
  );
}

export default App;
