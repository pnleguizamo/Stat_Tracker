import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Container, Row, Col, Card, Spinner, Nav } from 'react-bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import api from '../lib/api.js';

const WINDOW_LABELS = {
  last7: 'Last 7 Days',
  last30: 'Last 30 Days',
  last90: 'Last 90 Days',
  last180: 'Last 6 Months',
  ytd: 'Year to Date',
  allTime: 'All Time'
};

function Wrapped() {
  const snapshotQuery = useQuery({
    queryKey: ['mongo', 'snapshot'],
    queryFn: () => api.get('/api/mongo/snapshot'),
    retry: false,
  });

  const windows = snapshotQuery.data?.windows || {};
  const windowKeys = Object.keys(windows);
  const [selectedWindow, setSelectedWindow] = useState(windowKeys[0] || 'allTime');

  const currentWindow = windows[selectedWindow] || {};
  const topTracks = currentWindow.topTracks?.slice(0, 10) || [];
  const topArtists = currentWindow.topArtists?.slice(0, 10) || [];
  const topAlbums = currentWindow.topAlbums?.slice(0, 10) || [];
  const topGenres = currentWindow.topGenres?.slice(0, 5) || [];
  const totals = currentWindow.totals || {};

  const loading = snapshotQuery.isLoading;
  const error = snapshotQuery.isError ? snapshotQuery.error : null;

  function formatMinutes(ms) {
    if (!ms) return '0 min';
    const minutes = ms / 60000;
    return `${Math.round(minutes)} min`;
    const hrs = minutes / 60;
    return `${hrs.toFixed(1)} hr`;
  }

  if (loading) {
    return (
      <Container className="mt-5 text-center">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading...</span>
        </Spinner>
      </Container>
    );
  }

  if (error) {
    return (
      <Container className="mt-5">
        <p className="text-danger">{String(error?.message || error)}</p>
      </Container>
    );
  }

  return (
    <Container fluid className="py-4">
      <div className="mb-4">
        <h1>Your Wrapped</h1>
        <p className="text-muted">Explore your listening history across different timeframes</p>
      </div>

      {windowKeys.length > 0 && (
        <Nav variant="pills" className="mb-4">
          {windowKeys.map(key => (
            <Nav.Item key={key}>
              <Nav.Link 
                active={selectedWindow === key}
                onClick={() => setSelectedWindow(key)}
                className="text-dark"
              >
                {WINDOW_LABELS[key] || key}
              </Nav.Link>
            </Nav.Item>
          ))}
        </Nav>
      )}

      {windowKeys.length === 0 && (
        <p className="text-muted">No wrapped data available yet. Keep listening!</p>
      )}

      {currentWindow && (
        <>
          <section className="mb-4">
            <Card>
              <Card.Body>
                <h3 className="mb-3">Overview</h3>
                <Row>
                  <Col md={4}>
                    <p className="mb-1 text-muted">Total Listening Time</p>
                    <h4>{formatMinutes(totals.msPlayed)}</h4>
                  </Col>
                  <Col md={4}>
                    <p className="mb-1 text-muted">Unique Tracks</p>
                    <h4>{currentWindow.uniqueTracks || 0}</h4>
                  </Col>
                  <Col md={4}>
                    <p className="mb-1 text-muted">Unique Artists</p>
                    <h4>{currentWindow.uniqueArtists || 0}</h4>
                  </Col>
                </Row>
              </Card.Body>
            </Card>
          </section>

          <Row className="g-3">
            <Col md={6}>
              <Card>
                <Card.Body>
                  <h4 className="mb-3">Top Tracks</h4>
                  {topTracks.length === 0 && <p className="text-muted">No tracks yet</p>}
                  <ul className="list-unstyled">
                    {topTracks.map((track, idx) => (
                      <li key={`${track.trackId}-${idx}`} className="mb-3 pb-3 border-bottom">
                        <div className="d-flex justify-content-between align-items-start">
                          <div>
                            <span className="badge bg-secondary me-2">#{idx + 1}</span>
                            <strong>{track.trackName}</strong>
                            <div className="text-muted small">
                              {(track.artistNames || []).join(', ')}
                            </div>
                          </div>
                          <span className="text-muted">{track.plays} plays</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card.Body>
              </Card>
            </Col>

            <Col md={6}>
              <Card>
                <Card.Body>
                  <h4 className="mb-3">Top Artists</h4>
                  {topArtists.length === 0 && <p className="text-muted">No artists yet</p>}
                  <ul className="list-unstyled">
                    {topArtists.map((artist, idx) => (
                      <li key={`${artist.artistId}-${idx}`} className="mb-3 pb-3 border-bottom">
                        <div className="d-flex justify-content-between align-items-start">
                          <div>
                            <span className="badge bg-secondary me-2">#{idx + 1}</span>
                            <strong>{artist.name}</strong>
                            <div className="text-muted small">
                              {(artist.genres || []).slice(0, 2).join(', ')}
                            </div>
                          </div>
                          <span className="text-muted">{artist.plays} plays</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card.Body>
              </Card>
            </Col>

            <Col md={6}>
              <Card>
                <Card.Body>
                  <h4 className="mb-3">Top Albums</h4>
                  {topAlbums.length === 0 && <p className="text-muted">No albums yet</p>}
                  <ul className="list-unstyled">
                    {topAlbums.map((album, idx) => (
                      <li key={`${album.albumId}-${idx}`} className="mb-3 pb-3 border-bottom">
                        <div className="d-flex justify-content-between align-items-start">
                          <div>
                            <span className="badge bg-secondary me-2">#{idx + 1}</span>
                            <strong>{album.name}</strong>
                            <div className="text-muted small">
                              {(album.artistNames || []).join(', ')}
                            </div>
                          </div>
                          <span className="text-muted">{album.plays} plays</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card.Body>
              </Card>
            </Col>

            <Col md={6}>
              <Card>
                <Card.Body>
                  <h4 className="mb-3">Top Genres</h4>
                  {topGenres.length === 0 && <p className="text-muted">No genres yet</p>}
                  <ul className="list-unstyled">
                    {topGenres.map((genre, idx) => (
                      <li key={`${genre.genre}-${idx}`} className="mb-3 pb-3 border-bottom">
                        <div className="d-flex justify-content-between align-items-start">
                          <div>
                            <span className="badge bg-secondary me-2">#{idx + 1}</span>
                            <strong>{genre.genre}</strong>
                          </div>
                          <span className="text-muted">{genre.plays} plays</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </>
      )}
    </Container>
  );
}

export default Wrapped;