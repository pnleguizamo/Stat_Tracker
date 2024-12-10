import { useEffect, useState } from "react";
import { redirectToAuthCodeFlow, getAccessToken, fetchProfile } from "./spotifyAuthorization.js";
import { Button, Container, Row, Col } from 'react-bootstrap';
import 'bootstrap/dist/css/bootstrap.min.css';
import './CurrentlyPlaying.css';


function CurrentlyPlaying() {

  const [profileName, setProfileName] = useState("");
  const [profilePicture, setProfilePicture] = useState("");
  const [track, setTrack] = useState(null);

  useEffect(() => {
    async function init() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      // if (!code) {
      //   redirectToAuthCodeFlow();
      // } else {
        const accessToken = await getAccessToken(code);
        const profile = await fetchProfile(accessToken);

        // const profile = await fetch(`http://localhost:8081/api/spotify/auth/profile/${code}`);

        // populateUI(profile);
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

      // }
    }
    init();
  }, []);

  return (
    <div className="App">
      <h1>{profileName}</h1>
      <img src = {profilePicture} style={{ width: "250px" }}></img>
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
    </div>
  );
}

export default CurrentlyPlaying;
