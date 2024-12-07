import React from 'react';
import { useState, useEffect } from 'react';
import { getAccessToken } from "./spotifyAuthorization.js";


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
        <div>
            <h1>Recently Played Songs</h1>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px' }}>
                <thead>
                    <tr style={{ backgroundColor: '#f2f2f2' }}>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Track Name</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Artist</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Album</th>
                        <th style={{ padding: '10px', textAlign: 'left' }}>Played At</th>
                    </tr>
                </thead>
                <tbody>
                    {recentlyPlayed.length === 0 ? (
                        <tr>
                            <td colSpan="4" style={{ padding: '10px', textAlign: 'center' }}>No recently played songs</td>
                        </tr>
                    ) : (
                        recentlyPlayed.map((song, index) => (
                            <tr key={index}>
                                <td style={{ padding: '10px' }}>
                                    <a href={song.trackUri} target="_blank" rel="noopener noreferrer">{song.trackName}</a>
                                </td>
                                <td style={{ padding: '10px' }}>{song.artistName}</td>
                                <td style={{ padding: '10px' }}>{song.albumName}</td>
                                <td style={{ padding: '10px' }}>{new Date(song.playedAt).toLocaleString()}</td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
};


export default RecentlyPlayed;