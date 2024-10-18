export function fetchJSON(filepath) {
    
    return new Promise((resolve, reject) => {
        fetch(`./${filepath}.json`)
            .then((response) => { return response.json() })
            .then((data) => {resolve(data)})
            .catch((error) => { 
                console.log(error)
                reject("Failed");
            });
    });
}

const tbody = document.getElementById('recently_played_body');

export async function populateTableBody(tbody, filepath, recent){
    const data = await fetchJSON(filepath);

    if (recent) {
        for (let row of data){
            const newRow = document.createElement('tr');
            const albumCover = document.createElement('td');
            const img = document.createElement('img');
            const trackName = document.createElement('td');
            const artistName = document.createElement('td');
            const playedAt = document.createElement('td');
            const link = document.createElement('td');
            const a = document.createElement('a');
        
            img.src = row.albumCover;
            img.width = 50;
            albumCover.appendChild(img);
            trackName.textContent = row.trackName;
            artistName.textContent = row.artistName;
            playedAt.textContent = row.playedAt;
            a.href = row.trackUrl;
            a.innerHTML = "Spotify Link";
            link.appendChild(a);
    
            newRow.appendChild(albumCover);
            newRow.appendChild(trackName);
            newRow.appendChild(artistName);
            newRow.appendChild(playedAt);
            newRow.appendChild(link);
        
            tbody.append(newRow);
        }
    }
    else{
        for (let row of data){
            const newRow = document.createElement('tr');
            const albumCover = document.createElement('td');
            const img = document.createElement('img');
            const trackName = document.createElement('td');
            const artistName = document.createElement('td');
            const link = document.createElement('td');
            const a = document.createElement('a');
        
            img.src = row.album.images[0].url;
            img.width = 50;
            albumCover.appendChild(img);
            trackName.textContent = row.name;
            artistName.textContent = row.artists[0].name;
            a.href = row.external_urls.spotify;
            a.innerHTML = "Spotify Link";
            link.appendChild(a);
    
            newRow.appendChild(albumCover);
            newRow.appendChild(trackName);
            newRow.appendChild(artistName);
            // newRow.appendChild(playedAt);
            newRow.appendChild(link);
        
            tbody.append(newRow);
        }
    
    }
    

    
    }
