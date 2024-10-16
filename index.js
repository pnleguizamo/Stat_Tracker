// Fetch the JSON data
fetch('data.json')
  .then(response => response.json())
  .then(data => {
    // Get the container element where the cards will be displayed
    const cardContainer = document.getElementById('music-cards');

    // Iterate over the data and create a card for each track
    data.forEach(track => {
      // Create the card element using Bootstrap classes and the custom class
      const card = `
  <div class="col">
    <div class="card mb-4 shadow-sm">
      <img src="${track.albumCover}" class="card-img-top" alt="Album Cover">
      <div class="card-body">
        <h5 class="card-title">${track.trackName}</h5>
        <p class="card-text">Artist: ${track.artistName}</p>
        <p class="card-text">Album: ${track.albumName}</p>
        <a href="${track.trackUrl}" class="btn custom-btn" target="_blank">Listen on Spotify</a>
      </div>
    </div>
  </div>
`;


      // Append the card to the container
      cardContainer.innerHTML += card;
    });
  })
  .catch(error => {
    console.error('Error fetching the music data:', error);
  });
