import { useEffect, useState } from "react";
import { redirectToAuthCodeFlow, getAccessToken, fetchProfile } from "./spotifyAuthorization.js";
import { Button, Container, Row, Col, Card, Form } from 'react-bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import './CurrentlyPlaying.css';


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

  const [songOfTheDay, setSongOfTheDay] = useState(null);
  const [newRating, setNewRating] = useState(0);

  useEffect(() => {
    async function init() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      const accessToken = await getAccessToken(code);
      const profile = await fetchProfile(accessToken);

      setProfileName(profile.display_name);
      setProfilePicture(profile.images[0].url);


      const response = await fetch("http://localhost:8081/api/spotify/currently_playing", {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const track = await response.json();
      setTrack(track);

      setLoading(true);
      setError(null);

      try {
        const results = {};
        for (const timeframe of timeframes) {
          const response = await fetch(`http://localhost:8081/api/mongo/minutes_streamed/${timeframe.value}`);
          if (!response.ok) {
            throw new Error(`Failed to fetch for timeframe: ${timeframe.value}`);
          }
          const minutes = await response.json();
          results[timeframe.value] = minutes;
        }
        setData(results);
      } catch (err) {
        console.error(err);
        setError("Failed to fetch minutes streamed for some or all timeframes.");
      } finally {
        setLoading(false);
      }

      try {
        const response = await fetch("http://localhost:8081/api/mongo/song-of-the-day");
        if (!response.ok) {
          throw new Error("Failed to fetch song of the day");
        }
        const song = await response.json();
        setSongOfTheDay(song);
      } catch (err) {
        console.error("Error fetching song of the day:", err);
      }
    }



    init();
  }, []);


  const handleRatingChange = (e) => {
    setNewRating(parseFloat(e.target.value));
  };

  const updateRating = async () => {
    try {
      const response = await fetch("http://localhost:8081/api/mongo/update-rating", {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rating: newRating }),
      });

      if (!response.ok) {
        throw new Error("Failed to update rating");
      }
      setSongOfTheDay(prevSong => ({ ...prevSong, rating: newRating }));
    } catch (err) {
      console.error("Error updating rating:", err);
    }
  };


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

      {/* Song of the Day Card */}
      {songOfTheDay && (
        <Card className="mt-4">
          <Card.Header as="h5">Song of the Day</Card.Header>
          <Card.Body>
            <Card.Title>{songOfTheDay.master_metadata_track_name}</Card.Title>
            <Card.Text>
              Artist: {songOfTheDay.master_metadata_album_artist_name}<br />
              Album: {songOfTheDay.master_metadata_album_album_name}<br />
              Current Rating: {songOfTheDay.rating}
            </Card.Text>
            <Form>
              <Form.Group>
                <Form.Label>Update Rating:</Form.Label>
                <Form.Control
                  type="number"
                  min="0"
                  max="5"
                  step="1"
                  value={newRating}
                  onChange={handleRatingChange}
                />
              </Form.Group>
              <Button variant="primary" onClick={updateRating} className="mt-2">
                Update Rating
              </Button>
            </Form>
          </Card.Body>
        </Card>
      )}
    </div>
  );
}

export default CurrentlyPlaying;
