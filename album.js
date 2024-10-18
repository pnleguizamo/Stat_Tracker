// Fetch JSON data (replace with the correct path to your JSON file)
async function fetchJSON() {
    const response = await fetch('top_artists.json'); // Update with your actual JSON path
    if (!response.ok) {
        throw new Error('Network response was not ok');
    }
    return await response.json();
}

// Populate the cards with artist data, including numbering
function populateArtists(container) {
    fetchJSON().then((artists) => {
        artists.forEach((artist, index) => {
            const card = document.createElement('div');
            card.className = 'col mb-4'; // Single column per row

            // Create the card HTML, with numbering
            // Create the card HTML, with Spotify logo in the button
card.innerHTML = `
<div class="card custom-card">
    <img src="${artist.images[0].url}" class="card-img-top" alt="${artist.name}">
    <div class="card-body">
        <h5 class="card-title">${index + 1}. ${artist.name}</h5>
        <p class="card-text">Genres: ${artist.genres.join(', ')}</p>
        <a href="${artist.external_urls.spotify}" target="_blank" class="btn btn-success custom-btn">
            <i class="fab fa-spotify"></i> Listen on Spotify
        </a>
    </div>
</div>
`;


            // Append the card to the container
            container.appendChild(card);
        });
    }).catch((error) => console.error('Error fetching data:', error));
}

// On DOM load, populate the artist cards
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('artist-cards');
    populateArtists(container);
});
