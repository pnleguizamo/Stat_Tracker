function fetchJSON() {
    
    return new Promise((resolve, reject) => {
        fetch("./data.json")
            .then((response) => { return response.json() })
            .then((data) => {resolve(data)})
            .catch((error) => { 
                console.log(error)
                reject("Failed");
            });
    });
}

const tbody = document.getElementById('recently_played_body');



async function main(){
    const data = await fetchJSON();
    console.log("Branc");
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
        newRow.appendChild(link);
        newRow.appendChild(playedAt);
        newRow.appendChild(link);
    
        tbody.append(newRow);
    }
    
}

main();