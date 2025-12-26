import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api.js';
import '../styles/cards.css';

function TopArtists() {
    const timeframes = [
        { key: 'last30', label: 'Last 30 days' },
        { key: 'last90', label: 'Last 90 days' },
        { key: 'last180', label: 'Last 6 months' },
        { key: 'ytd', label: 'This year' },
        { key: 'allTime', label: 'All time' },
    ];
    const [timeframe, setTimeframe] = useState(timeframes[0].key);
    const { data: artists = [], isLoading, isError, error } = useQuery({
        queryKey: ['topArtists', timeframe],
        queryFn: () => api.get(`/api/mongo/top_artists/${timeframe}`)
    });

    const timeframeLabel = timeframes.find(tf => tf.key === timeframe)?.label || timeframe;

    return (
        <div className="top-page">
            <div className="top-shell">
                <div className="top-header">
                    <h2 className="page-title">Top Artists</h2>
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
                    {isLoading && <p className="page-subtitle">Loading top artists…</p>}
                    {isError && <p className="page-subtitle">Error loading artists: {String(error?.message || '')}</p>}
                    {!isLoading && !isError && (
                        <div className="cards-grid">
                            {artists?.map((artist, idx) => {
                                const name = artist.name || artist._id || artist.artistId || 'Unknown artist';
                                const image = artist.image_url || artist.images?.[0]?.url || null;
                                const plays = artist.play_count ?? artist.plays ?? 0;
                                return (
                                    <div key={artist._id || artist.artistId || name + idx} className="stat-card">
                                        <span className="card-rank">#{idx + 1}</span>
                                        <div className="card-thumb">
                                            {image ? (
                                                <img src={image} alt={name} />
                                            ) : (
                                                <span className="card-title">{name.charAt(0)}</span>
                                            )}
                                        </div>
                                        <h3 className="card-title">{name}</h3>
                                        <p className="play-count">{plays} plays</p>
                                    </div>
                                );
                            })}
                            {artists?.length === 0 && <p className="empty-state">No artists found for this window.</p>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default TopArtists;
