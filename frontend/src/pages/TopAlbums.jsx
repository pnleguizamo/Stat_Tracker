import React, { useState } from 'react';
import api from '../lib/api.js';
import '../styles/cards.css';
import { useQuery } from '@tanstack/react-query';

function TopAlbums() {
    const timeframes = [
        { key: 'last30', label: 'Last 30 days' },
        { key: 'last90', label: 'Last 90 days' },
        { key: 'last180', label: 'Last 6 months' },
        { key: 'ytd', label: 'This year' },
        { key: 'allTime', label: 'All time' },
    ];
    const [timeframe, setTimeframe] = useState(timeframes[0].key);
    const { data: albums = [], isLoading, isError, error } = useQuery({
        queryKey : ['topAlbums', timeframe],
        queryFn: () => api.get(`/api/mongo/top_albums/${timeframe}`)
    });

    const timeframeLabel = timeframes.find(tf => tf.key === timeframe)?.label || timeframe;

    return (
        <div className="top-page">
            <div className="top-shell">
                <div className="top-header">
                    <h2 className="page-title">Top Albums</h2>
                    <div className="pill-group">
                        {timeframes.map(tf => (
                            <button
                                key={tf.key}
                                className={`pill ${tf.key === timeframe ? 'active' : ''}`}
                                onClick={() => setTimeframe(tf.key)}
                            >
                                {tf.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="cards-wrapper">
                    {isLoading && <p className="page-subtitle">Loading top albums…</p>}
                    {isError && <p className="page-subtitle">Error loading albums: {String(error?.message || '')}</p>}
                    {!isLoading && !isError && (
                        <div className="cards-grid">
                            {albums?.map((album, idx) => {
                                const title = album.name || album._id || album.albumId || 'Unknown album';
                                const artistNames = album.artist || album.artistNames?.join(', ') || 'Unknown artist';
                                const image = album.image_url || album.images?.[0]?.url || null;
                                const plays = album.play_count ?? album.plays ?? 0;
                                return (
                                    <div key={album._id || album.albumId || title + idx} className="stat-card">
                                        <span className="card-rank">#{idx + 1}</span>
                                        <div className="card-thumb">
                                            {image ? (
                                                <img src={image} alt={title} />
                                            ) : (
                                                <span className="card-title">{title.charAt(0)}</span>
                                            )}
                                        </div>
                                        <h3 className="card-title">{title}</h3>
                                        <p className="card-meta">{artistNames}</p>
                                        <p className="play-count">{plays} plays</p>
                                    </div>
                                );
                            })}
                            {albums?.length === 0 && <p className="empty-state">No albums found for this window.</p>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default TopAlbums;
