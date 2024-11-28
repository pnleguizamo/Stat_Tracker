export async function getCurrentlyPlayingTrack(accessToken) {
    const endpoint = "https://api.spotify.com/v1/me/player/currently-playing";

    try {
        const response = await fetch(endpoint, {
            method: "GET",
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        if (response.status === 204) {
            console.log("No track is currently playing.");
            return null;
        }

        if (!response.ok) {
            throw new Error(`Error: ${response.status} - ${response.statusText}`);
        }

        const data = await response.json();

        if (data && data.item) {
            const track = {
                name: data.item.name,
                artists: data.item.artists.map((artist) => artist.name).join(", "),
                album: data.item.album.name,
                url: data.item.external_urls.spotify,
                image: data.item.album.images[0]?.url,
            };
            
            return track;
        }

        console.log("No track is currently playing.");
        return null;
    } catch (error) {
        console.error("Failed to retrieve currently playing track:", error);
        return null;
    }
}



