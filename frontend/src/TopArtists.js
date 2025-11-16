import React, { useState, useEffect } from 'react';
import api from './lib/api.js';
import './cards.css';

function TopArtists() {
    const [artists, setArtists] = useState([]);
    const [timeframe, setTimeframe] = useState('lifetime');

    useEffect(() => {
        async function init() {
            try {
                const artistsData = await api.get(`/api/mongo/top_artists/${timeframe}`);
                setArtists(artistsData || []);
            } catch (err) {
                console.error('Error fetching top artists:', err);
            }
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
