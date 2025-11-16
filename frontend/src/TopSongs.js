import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card } from 'react-bootstrap';
import api from './lib/api.js';
import './cards.css';

function TopSongs() {
  const [songs, setSongs] = useState([]);

  useEffect(() => {
    async function init() {
      try {
        const songsRes = await api.get('/api/mongo/top_songs');
        console.log(songsRes); // Log the data to check the structure
        // Ensure songsRes is an array before setting the state
        setSongs(Array.isArray(songsRes) ? songsRes : []);
      } catch (err) {
        console.error('Error fetching top songs:', err);
      }
    }
    init();
  }, []);

  return (
    <div className="top-songs-container">
      <h1 className="page-title">Top Songs</h1>
      <Container>
        <Row className="g-4"> {}
          {songs.length === 0 ? (
            <p>Loading...</p>
          ) : (
            songs.map((song, index) => (
              <Col xs={12} md={4} lg={3} key={index}>
                <Card className="song-card">
                  <Card.Img variant="top" src={song.album_cover} alt={song._id.track_name} className="song-img" />
                  <Card.Body>
                    <Card.Title className="song-title">
                      {}
                      {song._id.track_name ? `${index + 1}. ${song._id.track_name}` : `${index + 1}. Title Not Available`}
                    </Card.Title>
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
    </div>
  );
}

export default TopSongs;
