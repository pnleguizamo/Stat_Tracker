import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api.js';
import '../styles/cards.css';

function TopSongs() {
  const timeframes = [
    { key: 'last30', label: 'Last 30 days' },
    { key: 'last90', label: 'Last 90 days' },
    { key: 'last180', label: 'Last 6 months' },
    { key: 'ytd', label: 'This year' },
    { key: 'allTime', label: 'All time' },
  ];
  const [timeframe, setTimeframe] = useState(timeframes[0].key);
  const { data: songs = [], isLoading, isError, error } = useQuery({
    queryKey: ['topSongs', timeframe],
    queryFn: () => api.get(`/api/mongo/top_songs/${timeframe}`)
  });

  const timeframeLabel = timeframes.find(tf => tf.key === timeframe)?.label || timeframe;

  return (
    <div className="top-page">
      <div className="top-shell">
        <div className="top-header">
          <h2 className="page-title">Top Songs</h2>
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
          {isLoading && <p className="page-subtitle">Loading top songs…</p>}
          {isError && <p className="page-subtitle">Error loading songs: {String(error?.message || '')}</p>}
          {!isLoading && !isError && (
            <div className="cards-grid">
              {songs?.map((song, index) => {
                const name = song.trackName || song.trackId || 'Unknown track';
                const artist = song.artistNames?.join(', ') || 'Unknown artist';
                const image = song.images?.[0]?.url || null;
                const plays = song.plays ?? song.play_count ?? 0;
                return (
                  <div key={song.trackId || name + index} className="stat-card">
                    <span className="card-rank">#{index + 1}</span>
                    <div className="card-thumb">
                      {image ? (
                        <img src={image} alt={name} />
                      ) : (
                        <span className="card-title">{name.charAt(0)}</span>
                      )}
                    </div>
                    <h3 className="card-title">{name}</h3>
                    <p className="card-meta">{artist}</p>
                    <p className="play-count">{plays} plays</p>
                  </div>
                );
              })}
              {songs?.length === 0 && <p className="empty-state">No songs found for this window.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TopSongs;
