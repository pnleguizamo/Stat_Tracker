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

async function getAccessToken(code) {
    if(getStoredToken()){
        console.log("Stored Token");
        return getStoredToken();
    }

    const verifier = getVerifier();
    const clientId = process.env.CLIENT_ID;

    const params = new URLSearchParams();
    params.append("client_id", clientId);
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", "http://localhost:8080/callback");
    params.append("code_verifier", verifier);

    try {
        const result = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params
        });

        if (!result.ok) {
            const errorMessage = await result.text();
            throw new Error(`Error ${result.status}: ${errorMessage}`);
        }

        const data = await result.json();

        
        if (!data.access_token) {
            throw new Error("Access token not found in the response.");
        }
        setStoredToken(data.access_token);
        
        console.log("Fresh Token");
        return data.access_token;

    } catch (error) {
        // Handle any error that occurs during the fetch operation
        console.error("Error during token exchange:", error);
        throw new Error(`Failed to exchange code for token: ${error.message}`);
    }
}

async function fetchProfile(token) {
    const result = await fetch("https://api.spotify.com/v1/me", {
        method: "GET", headers: { Authorization: `Bearer ${token}` }
    });

    return await result.json();
}

module.exports = { storeVerifier, getVerifier, getAccessToken, fetchProfile };