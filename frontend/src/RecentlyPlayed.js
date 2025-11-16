import React from 'react';
import { useQuery } from '@tanstack/react-query';
import api from './lib/api.js';
import './recentlyPlayed.css';

function RecentlyPlayed() {
  const { data: recentlyPlayed = [], isLoading, isError, error } = useQuery({
    queryKey: ['recentlyPlayed'],
    queryFn: () => api.get('/api/spotify/recently_played')
  });

  return (
    <div className="recently-played-container">
      <h1 className="page-title">Recently Played</h1>
      {isLoading && <p>Loading recently played songs…</p>}
      {isError && <p>Error loading songs: {String(error?.message || '')}</p>}
      {!isLoading && !isError && (
        <div className="recently-played-list">
          {recentlyPlayed.length === 0 ? (
            <p className="no-songs">No recently played songs</p>
          ) : (
            <table className="recently-played-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Track</th>
                  <th>Artist</th>
                  <th>Album</th>
                  <th>Played At</th>
                </tr>
              </thead>
              <tbody>
                {recentlyPlayed.map((song, index) => (
                  <tr key={index}>
                    <td>{index + 1}</td>
                    <td>
                      <a
                        href={song.trackUri}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="song-title"
                      >
                        {song.trackName}
                      </a>
                    </td>
                    <td>{song.artistName}</td>
                    <td>{song.albumName}</td>
                    <td>{new Date(song.playedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export default RecentlyPlayed;
