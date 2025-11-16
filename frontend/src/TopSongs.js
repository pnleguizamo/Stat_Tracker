import React from 'react';
import { Container, Row, Col, Card } from 'react-bootstrap';
import { useQuery } from '@tanstack/react-query';
import api from './lib/api.js';
import './cards.css';

function TopSongs() {
  const { data: songs = [], isLoading, isError, error } = useQuery({
    queryKey: ['topSongs'],
    queryFn: () => api.get('/api/mongo/top_songs')
  });

  return (
    <div className="top-songs-container">
      <h1 className="page-title">Top Songs</h1>
      {isLoading && <p>Loading top songs…</p>}
      {isError && <p>Error loading songs: {String(error?.message || '')}</p>}
      {!isLoading && !isError && (
        <Container>
          <Row className="g-4">
            {songs.length === 0 ? (
              <p>No songs found</p>
            ) : (
              songs.map((song, index) => (
                <Col xs={12} md={4} lg={3} key={index}>
                  <Card className="song-card">
                    <Card.Img variant="top" src={song.album_cover} alt={song._id.track_name} className="song-img" />
                    <Card.Body>
                      <Card.Text className="song-title">
                        {song._id.track_name ? `${index + 1}. ${song._id.track_name}` : `${index + 1}. Title Not Available`}
                      </Card.Text>
                      <Card.Text className="song-artist">
                        {song._id.artist_name || 'Artist Not Available'}
                      </Card.Text>
                      <Card.Text className="play-count">
                        {song.play_count} plays
                      </Card.Text>
                    </Card.Body>
                  </Card>
                </Col>
              ))
            )}
          </Row>
        </Container>
      )}
    </div>
  );
}

export default TopSongs;
