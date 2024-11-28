import { fetchJSON } from "./track_util.js";

const ctx = document.getElementById('genreChart').getContext('2d');

const artists = await fetchJSON("top_artists");

let genreMap = new Map();

artists.forEach(artist => {
    artist.genres.forEach(genre => {
        genreMap.set(genre, (genreMap.has(genre) ? genreMap.get(genre) + 1 : 1));
    }
    )
});

// console.log(genreMap);

let sortedGenreArray = [...genreMap.entries()].sort((a, b) => b[1] - a[1]);
let sortedGenreMap = new Map(sortedGenreArray);

// console.log(sortedGenreMap);

const data = {
    labels: [...sortedGenreMap.keys()],
    datasets: [{
        data: [...sortedGenreMap.values()],  
        backgroundColor: Array.from({ length: sortedGenreMap.size }, getRandomColor), 
        hoverOffset: 4
    }]
};

new Chart(ctx, {
    type: 'pie',
    data: data,
    options: {
        plugins: {
            title: {
                display: true,
                text: 'Top Genres'
            },
            legend: {
                position: 'top'
            }
        },
        responsive: true
    }
});

function getRandomColor() {
    const randomColor = `#${Math.floor(Math.random() * 16777215).toString(16)}`;
    return randomColor;
}