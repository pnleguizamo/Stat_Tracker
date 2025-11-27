import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import LandingPage from './LandingPage';
import CurrentlyPlaying from './CurrentlyPlaying';
import RecentlyPlayed from './RecentlyPlayed';
import AppNavbar from './NavBar';
import TopArtists from './TopArtists';
import TopSongs from './TopSongs';
import FileUpload from './FileUpload';
import TopAlbums from './TopAlbums';
import ProtectedRoute from './ProtectedRoute';

function App() {
  return (
    <div>
    <Router>
        <AppNavbar />
        <Routes>
          <Route path="/" element={<LandingPage/>} />
          <Route path="/dashboard" element={<ProtectedRoute><CurrentlyPlaying/></ProtectedRoute>} />
          <Route path="/recently_played" element={<ProtectedRoute><RecentlyPlayed/></ProtectedRoute>} />
          <Route path="/top_artists" element={<ProtectedRoute><TopArtists/></ProtectedRoute>} />
          <Route path="/top_albums" element={<ProtectedRoute><TopAlbums/></ProtectedRoute>} />
          <Route path="/top_songs" element={<ProtectedRoute><TopSongs/></ProtectedRoute>} />
          <Route path="/upload_history" element={<ProtectedRoute><FileUpload/></ProtectedRoute>} />
        </Routes>
    </Router>
    </div>
  );
}

export default App;
