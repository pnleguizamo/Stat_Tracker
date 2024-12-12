import React, { useState, useEffect } from 'react';
import { getAccessToken } from "./spotifyAuthorization.js";
import './cards.css';

function TopArtists() {
    const [artists, setArtists] = useState([]);
    const [timeframe, setTimeframe] = useState('lifetime');

    useEffect(() => {
        async function init() {
            const accessToken = await getAccessToken();
            const artistsResponse = await fetch(`http://localhost:8081/api/mongo/top_artists/${timeframe}`, {
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
    }, [timeframe]);

    return (
        <div className="top-artists-container">
            <h2 className="page-title">Top Artists</h2>
            <h3>{timeframe}</h3>
            <div>
                <button className="btn-timeframe" onClick={() => setTimeframe('month')}>Last Month</button>
                <button className="btn-timeframe" onClick={() => setTimeframe('6months')}>Last 6 Months</button>
                <button className="btn-timeframe" onClick={() => setTimeframe('year')}>Last Year</button>
                <button className="btn-timeframe" onClick={() => setTimeframe('lifetime')}>All Time</button>
            </div>
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
