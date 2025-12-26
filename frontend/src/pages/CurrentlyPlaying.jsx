import { useEffect, useMemo, useState } from "react";
import { useQuery } from '@tanstack/react-query';
import { Button, Container, Row, Col, Spinner, Card } from 'react-bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import '../styles/CurrentlyPlaying.css';
import api from '../lib/api.js';

function formatDate(value) {
  if (!value) return '--';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}


function CurrentlyPlaying() {
  const statusQuery = useQuery({
    queryKey: ['auth', 'status'],
    queryFn: () => api.get('/api/auth/status'),
    retry: false,
  });

  const currentlyPlayingQuery = useQuery({
    queryKey: ['spotify', 'currently_playing'],
    queryFn: () => api.get('/api/spotify/currently_playing'),
    retry: false,
    refetchInterval: 15000,
    staleTime: 10000,
  });

  const rollupQuery = useQuery({
    queryKey: ['mongo', 'dashboard'],
    queryFn: () => api.get('/api/mongo/dashboard'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const profileName = statusQuery.data?.spotifyUser?.display_name || '';
  const profileFromStatus = statusQuery.data?.spotifyUser || statusQuery.data;
  const profileImage = profileFromStatus?.images && profileFromStatus.images[0] ? profileFromStatus.images[0].url : '';
  const track = currentlyPlayingQuery.data || null;

  const rollup = rollupQuery.data || {};
  const snapshots = useMemo(() => {
    const raw = rollup.snapshots || {};
    return Object.fromEntries(
      Object.entries(raw).filter(([key]) => !key.toLowerCase().includes('year'))
    );
  }, [rollup]);
  const highlightWindowKey = rollup.highlights?.window;
  const highlightLabel = highlightWindowKey === 'last7' ? 'Past 7 Days' : highlightWindowKey === 'last30' ? 'Past 30 Days' : 'Recent';
  const highlightTracks = highlightWindowKey ? snapshots[highlightWindowKey]?.topTracks?.slice(0, 10) || [] : [];
  const highlightArtists = highlightWindowKey ? snapshots[highlightWindowKey]?.topArtists?.slice(0, 10) || [] : [];
  const highlightGenres = highlightWindowKey ? snapshots[highlightWindowKey]?.topGenres?.slice(0, 4) || [] : [];
  const topArtistCount = highlightArtists.slice(0, 10).length;
  const recentDaily = rollup.daily || [];

  const [isLabelMinutes, setIsLabelMinutes] = useState(true);
  function minutesLabel(minutes, alwaysHours = false) {
    if (!minutes) return '0 min';
    if ((minutes < 60 || isLabelMinutes) && !alwaysHours) return `${(minutes).toFixed(0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")} min`;
    const hrs = minutes / 60;
    return `${hrs.toFixed(1)} hr`;
  }

  function flipLabel(){
    setIsLabelMinutes(!isLabelMinutes);
  }

  const trend = useMemo(() => recentDaily.slice(-14), [recentDaily]);
  const maxMinutes = useMemo(
    () => Math.max(...trend.map(d => d.minutes || 0), 1),
    [trend]
  );

  const loading = statusQuery.isLoading || currentlyPlayingQuery.isLoading || rollupQuery.isLoading;
  const error = statusQuery.isError || currentlyPlayingQuery.isError || rollupQuery.isError ? (statusQuery.error || currentlyPlayingQuery.error || rollupQuery.error) : null;

  return (
    <div className="currently-playing">
      <div className="dashboard-hero">
        <div className="hero-left">
          {profileImage ? (
            <img src={profileImage} alt="Profile" className="profile-img" />
          ) : (
            <div className="profile-img placeholder" />
          )}
          <div>
            <p className="eyebrow">Listening dashboard</p>
            <h1 className="page-title">{profileName || 'Your Stats'}</h1>
            <p className="subdued">Last refreshed {rollup.generatedAt ? formatDate(rollup.generatedAt) : 'recently'}</p>
          </div>
        </div>
        <div className="hero-metrics">
          {snapshots && Object.keys(snapshots).map((window, index) =>
            <button key={index} className="minute-span metric-chip" onClick={flipLabel}>
              <span>{window}</span>
              <strong>{minutesLabel(Math.round((snapshots[window]?.totals?.msPlayed / 60000) || 0))}</strong>
            </button>
          )}
        </div>
      </div>

      <Container fluid className="dashboard-body">
        {error && <p className="error-text">{String(error?.message || error)}</p>}
        {loading && (
          <div className="centered">
            <Spinner animation="border" role="status">
              <span className="visually-hidden">Loading...</span>
            </Spinner>
          </div>
        )}

        {!loading && (
          <>
            <section className="section">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Live now</p>
                  <h2 className="section-title">Currently Playing</h2>
                </div>
                {track?.url && (
                  <Button
                    href={track.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="primary"
                    className="cta"
                  >
                    Listen on Spotify
                  </Button>
                )}
              </div>
              {track ? (
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
                  </Col>
                </Row>
              ) : (
                <div className="card empty-card">Nothing spinning right now.</div>
              )}
            </section>

            <section className="section">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Highlights</p>
                  <h2 className="section-title">Top of {highlightLabel}</h2>
                </div>
              </div>
              <Row className="g-3">
                <Col sm={6} lg={3}>
                  <Card className="stat-card">
                    <Card.Body>
                      <p className="eyebrow">Track</p>
                      {rollup.highlights?.track ? (
                        <>
                          <h3>{rollup.highlights.track.trackName}</h3>
                          <p className="subdued">{rollup.highlights.track.artistNames?.join(', ')}</p>
                          <p className="metric-detail">{rollup.highlights.track.plays || 0} plays</p>
                        </>
                      ) : (
                        <p className="subdued">No track data yet.</p>
                      )}
                    </Card.Body>
                  </Card>
                </Col>
                <Col sm={6} lg={3}>
                  <Card className="stat-card">
                    <Card.Body>
                      <p className="eyebrow">Artist</p>
                      {rollup.highlights?.artist ? (
                        <>
                          <h3>{rollup.highlights.artist.name}</h3>
                          <p className="subdued">{(rollup.highlights.artist.genres || []).slice(0, 2).join(', ')}</p>
                          <p className="metric-detail">{rollup.highlights.artist.plays || 0} plays</p>
                        </>
                      ) : (
                        <p className="subdued">No artist data yet.</p>
                      )}
                    </Card.Body>
                  </Card>
                </Col>
                <Col sm={6} lg={3}>
                  <Card className="stat-card">
                    <Card.Body>
                      <p className="eyebrow">Album</p>
                      {rollup.highlights?.album ? (
                        <>
                          <h3>{rollup.highlights.album.name}</h3>
                          <p className="subdued">{(rollup.highlights.album.artistNames || []).join(', ')}</p>
                          <p className="metric-detail">{rollup.highlights.album.plays || 0} plays</p>
                        </>
                      ) : (
                        <p className="subdued">No album data yet.</p>
                      )}
                    </Card.Body>
                  </Card>
                </Col>
                <Col sm={6} lg={3}>
                  <Card className="stat-card">
                    <Card.Body>
                      <p className="eyebrow">Genre</p>
                      {rollup.highlights?.genre ? (
                        <>
                          <h3>{rollup.highlights.genre.genre}</h3>
                          <p className="metric-detail">{rollup.highlights.genre.plays || 0} plays</p>
                        </>
                      ) : (
                        <p className="subdued">No genre data yet.</p>
                      )}
                    </Card.Body>
                  </Card>
                </Col>
              </Row>
            </section>

            <section className="section">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Habits</p>
                  <h2 className="section-title">Daily listening (last 14 days)</h2>
                </div>
              </div>
              <div className="trend-list">
                {trend.length === 0 && <div className="subdued">No listening yet.</div>}
                {trend.map(entry => {
                  const width = Math.max(6, Math.round(((entry.minutes || 0) / maxMinutes) * 100));
                  return (
                    <div className="trend-row" key={entry.day}>
                      <span className="trend-date">{formatDate(entry.day)}</span>
                      <div className="trend-bar">
                        <div className="trend-bar-fill" style={{ width: `${width}%` }} />
                      </div>
                      <span className="trend-value">{minutesLabel(entry.minutes || 0, true)}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="section">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Deep dive</p>
                  <h2 className="section-title">Favorites from {highlightLabel}</h2>
                </div>
              </div>
              <Row className="g-3">
                <Col md={6}>
                  <Card className="stat-card list-card">
                    <Card.Body>
                      <p className="eyebrow">Tracks</p>
                      {highlightTracks.length === 0 && <p className="subdued">No data yet.</p>}
                      <ul className="top-list">
                        {highlightTracks.map((item, idx) => (
                          <li key={`${item.trackId}-${idx}`}>
                            <div>
                              <span className="rank">#{idx + 1}</span>
                              <span className="title">{item.trackName}</span>
                              <span className="subdued">{(item.artistNames || []).join(', ')}</span>
                            </div>
                            <span className="metric-detail">{item.plays || 0} plays</span>
                          </li>
                        ))}
                      </ul>
                    </Card.Body>
                  </Card>
                </Col>
                <Col md={6}>
                  <Card className="stat-card list-card">
                    <Card.Body>
                      <p className="eyebrow">Artists</p>
                      {/*&& highlightGenres.length === 0*/}
                      {highlightArtists.length === 0 && <p className="subdued">No data yet.</p>}
                      <ul className="top-list">
                        {highlightArtists.map((artist, idx) => (
                          <li key={`${artist.artistId}-${idx}`}>
                            <div>
                              <span className="rank">#{idx + 1}</span>
                              <span className="title">{artist.name}</span>
                              <span className="subdued">{(artist.genres || []).slice(0, 2).join(', ')}</span>
                            </div>
                            <span className="metric-detail">{artist.plays || 0} plays</span>
                          </li>
                        ))}
                        {/* {highlightGenres.slice(0, 3).map((genre, idx) => (
                          <li key={`${genre.genre}-${idx}`}>
                            <div>
                              <span className="rank">#{topArtistCount + idx + 1}</span>
                              <span className="title">{genre.genre}</span>
                              <span className="subdued">genre</span>
                            </div>
                            <span className="metric-detail">{genre.plays || 0} plays</span>
                          </li>
                        ))} */}
                      </ul>
                    </Card.Body>
                  </Card>
                </Col>
              </Row>
            </section>
          </>
        )}
      </Container>
    </div>
  );
}

export default CurrentlyPlaying;
