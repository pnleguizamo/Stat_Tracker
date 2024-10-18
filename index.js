// Fetch the JSON data
fetch("top_albums.json")
  .then((response) => response.json())
  .then((data) => {
    // Get the container element where the cards will be displayed
    const cardContainer = document.getElementById("music-cards");

    // Iterate over the data and create a card for each track
    data.forEach((track) => {
      // Create the card element using Bootstrap classes and the custom class
      const card = `
         <div class="col">
            <div class="card mb-4 shadow-sm">
                <img src="${track.images[0].url}" class="card-img-top" alt="Album Cover">
                <div class="card-body">
                    <h5 class="card-title"> ${track.name}</h5>
                    <p class="card-text"> Artist: ${track.artists[0].name}</p>
                    <p class="card-text"><i class="fas fa-compact-disc"></i> Album: ${track.name}</p>
                    <a href="${track.external_urls.spotify}" target="_blank" class="btn btn-success custom-btn">
            <i class="fab fa-spotify"></i> Listen on Spotify</a>
                </div>
            </div>
        </div>
`;

      // Append the card to the container
      cardContainer.innerHTML += card;
    });
  })
  .catch((error) => {
    console.error("Error fetching the music data:", error);
  });
