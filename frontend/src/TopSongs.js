import React from 'react';
import { useState, useEffect } from 'react';
import { getAccessToken } from "./spotifyAuthorization.js";


function TopSongs() {

    const [songs, setSongs] = useState([]);

    useEffect(() => {
        async function init() {

            const accessToken = await getAccessToken();

            const response = await fetch("http://localhost:8081/api/mongo/top_songs", {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            const songsRes = await response.json();
            setSongs(songsRes);


        }
        init();
    }, []);
    
    return (
        <div>

            <h1>Top Songs</h1>
            <ul>
                {songs ? songs.map((song, index) => (
                    <li key={song._id.track_name}>
                        <span><strong>{index + 1}. {song._id.track_name}</strong> - {song._id.artist_name} : {song.play_count} plays <br/></span>
                        <img src = {song.album_cover} style={{ width: "100px", height: "100px" }} ></img>
                    </li>
                )) : 
                    <li>
                        <p>Songs Loading</p>
                    </li>}
            </ul>
        </div>
    );
};


export default TopSongs;