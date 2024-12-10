import React, { useState, useEffect } from 'react';
import { getAccessToken } from "./spotifyAuthorization.js";
import './recentlyPlayed.css'; // Updated CSS file for styling

function RecentlyPlayed() {
  const [recentlyPlayed, setRecentlyPlayed] = useState([]);

  useEffect(() => {
    async function init() {
      const accessToken = await getAccessToken();

      const response = await fetch("http://localhost:8081/api/spotify/recently_played", {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      const tracks = await response.json();
      setRecentlyPlayed(tracks);
    }
    init();
  }, []);

  return (
    <div className="recently-played-container">
      <h1 className="page-title">Recently Played</h1>
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
    </div>
  );
}

export default RecentlyPlayed;
