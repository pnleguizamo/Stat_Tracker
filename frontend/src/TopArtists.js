import React, { useState, useEffect } from 'react';
import { getAccessToken } from "./spotifyAuthorization.js";
import './cards.css';

function TopArtists() {
    const [artists, setArtists] = useState([]);

    useEffect(() => {
        async function init() {
            const accessToken = await getAccessToken();
            const artistsResponse = await fetch("http://localhost:8081/api/mongo/top_artists", {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            const artistsData = await artistsResponse.json();
            setArtists(artistsData);
        }
        init();
    }, []);

    return (
        <div className="top-artists-container">
            <h2 className="page-title">Top Artists</h2>
            <div className="cards-wrapper">
                {artists.map((artist) => (
                    <div key={artist._id} className="artist-card">
                        <img src={artist.image_url} alt={artist._id} className="artist-img" />
                        <h3 className="artist-name">
                            <a 
                                href={`https://open.spotify.com/artist/${artist.spotify_id}`} 
                                target="_blank" 
                                rel="noopener noreferrer"
                            >
                                {artist._id}
                            </a>
                        </h3>
                        <p className="play-count">{artist.play_count} plays</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default TopArtists;
