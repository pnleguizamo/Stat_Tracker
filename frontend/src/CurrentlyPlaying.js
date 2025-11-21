import { useEffect, useState } from "react";
import { getAccessToken, fetchProfile } from "./spotifyAuthorization.js";
import { Button, Container, Row, Col } from 'react-bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import './CurrentlyPlaying.css';
import api from './lib/api.js';


function CurrentlyPlaying() {
  const timeframes = [
    { label: "Past Week", value: "week" },
    { label: "Past 6 Months", value: "6months" },
    { label: "Past Year", value: "year" },
    { label: "Lifetime", value: "lifetime" },
  ];

  const [data, setData] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [profileName, setProfileName] = useState("");
  const [profilePicture, setProfilePicture] = useState("");
  const [track, setTrack] = useState(null);

  useEffect(() => {
    async function init() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      const accessToken = await getAccessToken(code);
      const profile = await fetchProfile(accessToken);

      setProfileName(profile.display_name);
      setProfilePicture(profile.images[0].url);


      try {
        const track = await api.get('/api/spotify/currently_playing');
        setTrack(track);
      } catch (err) {
        console.error('Error fetching currently playing track:', err);
      }

      setLoading(true);
      setError(null);

      try {
        const results = {};
        for (const timeframe of timeframes) {
          const minutes = await api.get(`/api/mongo/minutes_streamed/${timeframe.value}`);
          results[timeframe.value] = minutes;
        }
        setData(results);
      } catch (err) {
        console.error(err);
        setError("Failed to fetch minutes streamed for some or all timeframes.");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, []);

  return (
    <div className="App">
      <h1>{profileName}</h1>
      <img src={profilePicture} style={{ width: "250px" }}></img>
      <h2>Currently Playing</h2>

      {track ? (
        <Container className="py-4">
          <Row className="align-items-center">
            <Col xs={12} md={3} className="mb-3 mb-md-0">
              <img
                src={track.image}
                alt="Album cover"
                className="img-fluid rounded"
              />
            </Col>
            <Col xs={12} md={9}>
              <h2 className="display-4">{track.name}</h2>
              <p className="lead">{track.artists}</p>
              <p className="lead">{track.album}</p>
              <Button
                href={track.url}
                target="_blank"
                rel="noopener noreferrer"
                variant="primary"
                className="mt-3"
              >
                Listen on Spotify
              </Button>
            </Col>
          </Row>
        </Container>
      ) : (
        <div>No track is currently playing.</div>
      )}
      {/* <h1>Recently Listened Minutes</h1> */}
      {error && <p>{error}</p>}
      {loading && <p>Loading...</p>}

      {/* Timeframes Grid */}
      {!loading && !error && (
        <div className="grid-container">
          {timeframes.map(({ label, value }) => (
            <div className="grid-item" key={value}>
              <h3>{label}</h3>
              <p>{data[value] !== undefined ? data[value].toFixed(2) : "--"} minutes streamed</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default CurrentlyPlaying;
