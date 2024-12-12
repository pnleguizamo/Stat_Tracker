import React, { useState, useEffect } from 'react';
import { getAccessToken } from "./spotifyAuthorization.js";
import './cards.css';

function TopArtists() {
    const [albums, setAlbums] = useState([]);
    const [timeframe, setTimeframe] = useState('lifetime');

    useEffect(() => {
        async function init() {
            const accessToken = await getAccessToken();
            const response = await fetch(`http://localhost:8081/api/mongo/top_albums/${timeframe}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            const albumData = await response.json();
            setAlbums(albumData);
        }
        init();
    }, [timeframe]);

    return (
        <div className="top-artists-container">
            <h2 className="page-title">Top Albums</h2>
            <h3>{timeframe}</h3>
            <div>
                <button className="btn-timeframe" onClick={() => setTimeframe('month')}>Last Month</button>
                <button className="btn-timeframe" onClick={() => setTimeframe('6months')}>Last 6 Months</button>
                <button className="btn-timeframe" onClick={() => setTimeframe('year')}>Last Year</button>
                <button className="btn-timeframe" onClick={() => setTimeframe('lifetime')}>All Time</button>
            </div>
            <div className="cards-wrapper">
                {albums.map((album) => (
                    <div key={album._id} className="artist-card">
                        <img src={album.image_url} alt={album._id} className="artist-img" />
                        <h3 className="artist-name">
                            <a
                                href={`https://open.spotify.com/artist/${album.spotify_id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {album._id}
                            </a>
                        </h3>
                        <p>{album.artist}</p>
                        <p className="play-count">{album.play_count} plays</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default TopArtists;
