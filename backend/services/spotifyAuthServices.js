let storedVerifier = null;  // Temporary in-memory storage (can be replaced with a DB or session)

let access_token = null;

// Store the verifier
function storeVerifier(verifier) {
    storedVerifier = verifier;
}

// Retrieve the stored verifier
function getVerifier() {
    return storedVerifier;
}

function setStoredToken(token) {
    access_token = token;
}

function getStoredToken() {
    return access_token;
}



module.exports = { storeVerifier, getVerifier };