import React, { useState } from 'react';
import api from '../lib/api.js';
import '../styles/cards.css';
import { useQuery } from '@tanstack/react-query';

function TopAlbums() {
    const [timeframe, setTimeframe] = useState('lifetime');
    const { data: albums = [], isLoading, isError, error } = useQuery({
        queryKey : ['topAlbums', timeframe], 
        queryFn: () => api.get(`/api/mongo/top_albums/${timeframe}`)
    });

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
            {isLoading && <p>Loading top albums…</p>}
            {isError && <p>Error loading albums: {String(error?.message || '')}</p>}
            <div className="cards-wrapper">
                {!isLoading && !isError && albums?.map((album) => (
                    <div key={album._id} className="artist-card">
                        <img src={album.image_url} alt={album._id} className="artist-img" />
                        <h3 className="artist-name">{album._id}</h3>
                        <p>{album.artist}</p>
                        <p className="play-count">{album.play_count} plays</p>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default TopAlbums;
