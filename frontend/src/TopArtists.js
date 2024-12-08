import React from 'react';
import { useState, useEffect } from 'react';
import { getAccessToken } from "./spotifyAuthorization.js";


function TopArtists() {

    const [artists, setArtists] = useState([]);

    useEffect(() => {
        async function init() {

            const accessToken = await getAccessToken();

            const artistsResponse = await fetch("http://localhost:8081/api/mongo/top_artists", {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            const artists = await artistsResponse.json();
            setArtists(artists);


        }
        init();
    }, []);

    return (
        <div>

            <h1>Top Artists</h1>
            <ul>
                {artists.map((artist, index) => (
                    <li key={artist._id}>
                        <strong>{index + 1}. {artist._id}</strong> - {artist.play_count} plays <br/>
                        <img src = {artist.image_url} style={{ width: "100px", height: "100px" }}></img>

                    </li>
                ))}
            </ul>
        </div>
    );
};


export default TopArtists;