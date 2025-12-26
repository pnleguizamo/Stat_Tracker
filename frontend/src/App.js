import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
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
import PlayerScreen from 'game/player/PlayerScreen.tsx';
import HostGameScreen from 'game/host/HostGame.tsx';
import Wrapped from 'pages/Wrapped.jsx';

function App() {
  return (
    <div>
    <Router>
        <ProtectedRoute><AppNavbar /></ProtectedRoute>
        <Routes>
          <Route path="/" element={<LandingPage/>} />
          <Route path="/dashboard" element={<ProtectedRoute><CurrentlyPlaying/></ProtectedRoute>} />
          <Route path="/recently_played" element={<ProtectedRoute><RecentlyPlayed/></ProtectedRoute>} />
          <Route path="/top_artists" element={<ProtectedRoute><TopArtists/></ProtectedRoute>} />
          <Route path="/top_albums" element={<ProtectedRoute><TopAlbums/></ProtectedRoute>} />
          <Route path="/top_songs" element={<ProtectedRoute><TopSongs/></ProtectedRoute>} />
          <Route path="/wrapped" element={<ProtectedRoute><Wrapped/></ProtectedRoute>} />
          <Route path="/upload_history" element={<ProtectedRoute><FileUpload/></ProtectedRoute>} />
          <Route path="/lobby" element={<ProtectedRoute><GameLobby/></ProtectedRoute>} />
          <Route path="/game/:roomCode" element={<PlayerScreen />} />
          <Route path="/game/host/:roomCode/setup" element={<StagePlanner />} />
          <Route path="/game/host/:roomCode/play" element={<HostGameScreen />} />
        </Routes>
    </Router>
    </div>
  );
}

export default App;
