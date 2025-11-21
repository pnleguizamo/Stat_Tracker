export async function redirectToAuthCodeFlow() {
    
    const clientId = process.env.REACT_APP_CLIENT_ID;

    const verifier = generateCodeVerifier(128);
    const challenge = await generateCodeChallenge(verifier);

    sessionStorage.setItem("verifier", verifier);

    const params = new URLSearchParams();
    params.append("client_id", clientId);
    params.append("response_type", "code");
    params.append("redirect_uri", `${process.env.REACT_APP_BASE_URL}/callback`);
    params.append("scope", "user-read-private user-read-email user-read-playback-state user-read-recently-played user-top-read");
    params.append("code_challenge_method", "S256");
    params.append("code_challenge", challenge);

    document.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

function generateCodeVerifier(length) {
    let text = '';
    let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

async function generateCodeChallenge(codeVerifier) {
    const data = new TextEncoder().encode(codeVerifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)]))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

export async function getAccessToken(code) {
    const verifier = sessionStorage.getItem("verifier");
    const clientId = process.env.REACT_APP_CLIENT_ID;

    if (!verifier) {
        throw new Error("Missing PKCE verifier in sessionStorage; user may have refreshed or opened callback directly.");
    }

    const params = new URLSearchParams();
    params.append("client_id", clientId);
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("redirect_uri", `${process.env.REACT_APP_BASE_URL}/callback`);
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
        const { access_token, refresh_token, expires_in } = data;

        
        if (!access_token) {
            throw new Error("Access token not found in the response.");
        }

        const me = await fetchProfile(access_token);

        const storeTokenRes = await fetch(`${process.env.REACT_APP_API_BASE_URL}/api/auth/complete`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    accessToken: access_token,
                    refreshToken: refresh_token,
                    expiresIn: expires_in,
                    spotifyUser: me
                })
            }
        );

        if (!storeTokenRes.ok) {
            const errText = await storeTokenRes.text();
            throw new Error(`Failed to complete auth: ${errText}`);
        }
        
        const user = await storeTokenRes.json();
        
        return data.access_token;

    } catch (error) {
        // Handle any error that occurs during the fetch operation
        console.error("Error during token exchange:", error);
        throw new Error(`Failed to exchange code for token: ${error.message}`);
    }
}

export async function fetchProfile(token) {
    const result = await fetch("https://api.spotify.com/v1/me", {
        method: "GET", headers: { Authorization: `Bearer ${token}` }
    });

    return await result.json();
}


// function populateUI(profile) {
//     document.getElementById("displayName").innerText = profile.display_name;
//     if (profile.images[0]) {
//         const profileImage = new Image(200, 200);
//         profileImage.src = profile.images[0].url;
//         document.getElementById("avatar").appendChild(profileImage);
//         document.getElementById("imgUrl").innerText = profile.images[0].url;
//     }
//     document.getElementById("id").innerText = profile.id;
//     document.getElementById("email").innerText = profile.email;
//     document.getElementById("uri").innerText = profile.uri;
//     document.getElementById("uri").setAttribute("href", profile.external_urls.spotify);
//     document.getElementById("url").innerText = profile.href;
//     document.getElementById("url").setAttribute("href", profile.href);
// }