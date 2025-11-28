import { useEffect, useState } from "react";
import { useQuery } from '@tanstack/react-query';
import { Button, Container, Row, Col, Spinner } from 'react-bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import '../styles/CurrentlyPlaying.css';
import api from '../lib/api.js';

function CurrentlyPlaying() {
  const timeframes = [
    { label: "Past Week", value: "week" },
    { label: "Past 6 Months", value: "6months" },
    { label: "Past Year", value: "year" },
    { label: "Lifetime", value: "lifetime" },
  ];

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

  const minutesQuery = useQuery({
    queryKey: ['mongo', 'minutes_streamed'],
    queryFn: async () => {
      const results = {};
      for (const timeframe of timeframes) {
        results[timeframe.value] = await api.get(`/api/mongo/minutes_streamed/${timeframe.value}`);
      }
      return results;
    },
    retry: false,
  });

  const profileName = statusQuery.data?.spotifyUser?.display_name || '';
  const profileFromStatus = statusQuery.data?.spotifyUser || statusQuery.data;
  const profileImage = profileFromStatus?.images && profileFromStatus.images[0] ? profileFromStatus.images[0].url : '';
  const track = currentlyPlayingQuery.data || null;
  const data = minutesQuery.data || {};
  const loading = statusQuery.isLoading || currentlyPlayingQuery.isLoading || minutesQuery.isLoading;
  const error = statusQuery.isError || currentlyPlayingQuery.isError || minutesQuery.isError ? (statusQuery.error || currentlyPlayingQuery.error || minutesQuery.error) : null;

  return (
    <div className="App">
      <h1>{profileName}</h1>
      {profileImage ? (
        <img src={profileImage} alt="Profile" style={{ width: "250px", borderRadius: 8 }} />
      ) : (
        <div style={{ width: 250, height: 250, background: '#eee', borderRadius: 8 }} />
      )}
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
      {error && <p>{String(error?.message || error)}</p>}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}>
          <Spinner animation="border" role="status">
            <span className="visually-hidden">Loading...</span>
          </Spinner>
        </div>
      )}

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
