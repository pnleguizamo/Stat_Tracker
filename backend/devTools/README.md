# Game bots

One Node process creates a separate Socket.IO client for each selected database user. Each gets a unique `g:bot-...` player ID, uses that user's listening history, and loads their saved Spotify display name and avatar. No browser is created for bots. Use your normal host browser to start and advance the game; existing round timers and reveals continue to operate normally.

## Run

Install backend dependencies with `npm install`. The runner loads `backend/.env` regardless of your current directory and requires the same Mongo settings and JWT_SECRET as the server.

Start the backend with bot support explicitly enabled:

```sh
cd backend
NODE_ENV=development ENABLE_DEV_BOTS=true npm start
```

In a second terminal, check user selection without connecting any bots:

```sh
cd backend
NODE_ENV=development ENABLE_DEV_BOTS=true npm run bots -- --check
```

Create a room in the host browser, then attach bots:

```sh
NODE_ENV=development ENABLE_DEV_BOTS=true npm run bots -- --room=ABCD --count=4
```

Automatic selection uses up to four saved profiles with track rollups, sorted by account ID. To choose specific people, use `--users=spotifyId1,spotifyId2` (the database account IDs, not display names). Avoid selecting a user who already plays in the room. Duplicate user assignments among room players are rejected when joining. The host is normally a separate display, outside the player roster.

Use `--url=http://127.0.0.1:3000` to override the backend address; otherwise PORT from backend/.env is used, falling back to 3000. Only localhost destinations are supported; in Docker, run the runner inside the API container. Both development and production servers accept bot tokens only when ENABLE_DEV_BOTS=true. Ordinary guest authentication does not acquire the bot's data identity.

Ctrl+C sends leaveRoom for connected bots and closes all clients. A reconnect within one run retains the same player ID and checks the server's existing answers before acting again. A new run creates new player IDs. An abrupt process kill uses the game's existing disconnect grace period.

## Test in the deployed app

The production image includes the bot runner dependency. The API defaults to bots disabled. After deploying this branch, enable bots in the root Compose .env with `ENABLE_DEV_BOTS=true`, then recreate the API:

```sh
docker compose up -d --build api
docker compose exec api npm run bots -- --check
```

Create a dedicated room in the normal host browser, then run bots inside the API container so localhost reaches the app and the existing Mongo settings reach the Pi database:

```sh
docker compose exec api npm run bots -- --room=ABCD --count=4
```

Ctrl+C ends the runner. Set `ENABLE_DEV_BOTS=false` and recreate the API after the test. Changing the server flag requires a container restart; changing it only for the runner does not enable the server. Completed test games are saved by the existing game history mechanism.

## Script actions

```sh
NODE_ENV=development ENABLE_DEV_BOTS=true npm run bots -- --room=ABCD --config=devTools/bots.example.json
```

The example works with automatic user selection. To customize individual users, add a `bots` array:

```json
{
  "minDelayMs": 3000,
  "maxDelayMs": 7000,
  "bots": [
    {
      "userId": "existing-spotify-account-id",
      "scripts": {
        "WHO_LISTENED_MOST": [{ "targetUserId": "another-account-id", "delayMs": 5000 }],
        "HEARDLE": [{ "guesses": ["wrong", "skip", "correct"] }],
        "HITSTER": [{ "gapIndex": "correct", "songGuess": "correct" }]
      },
      "disconnectAfterMs": 20000,
      "reconnectAfterMs": 1500
    }
  ]
}
```

The disconnect options are optional and simulate one client disconnect/reconnect per run. They begin when the runner starts, not at a particular round.

A script is an array of round instructions per minigame, counted from zero separately for each stage. A bot attaching midgame counts its first observed round as round zero. Top-level scripts apply to everyone; per-bot scripts replace that game's array. `delayMs` overrides the delay range for that round (and each Heardle snippet).

| Minigame | Script fields | Fallback |
| --- | --- | --- |
| Higher/Lower | `choice`: `LEFT` or `RIGHT` | Seeded random side |
| Who Listened Most / Guess Wrapped | `targetUserId`: database account ID | Seeded random connected player, including self |
| Heardle | `guesses`: per-snippet `wrong`, `skip`, `correct`, or explicit guess object | Different bots solve on snippet 1, 2, or 3 |
| Hitster | `gapIndex`: integer or `correct`; optional `songGuess`: `correct` or guess object | Seeded random valid gap, no song guess |

Explicit guesses use `{ "trackId": "...", "trackName": "...", "artistNames": ["..."] }`.

Correct Heardle guesses and Hitster placements use song metadata already present in the server state. These are scripted demonstrations, not bots listening to and recognizing audio. There is no LLM.

`--seed=take-1` repeats random decisions and delays for the same user and round order. Prompts still come from the real live game and may differ between runs. Exact session replay is not implemented. Two Truths & a Lie is not implemented in this checkout and has no bot handler.

## Diagnostics and verification

The runner logs connections, accepted actions, rejections, acknowledgement timeouts and reconnect attempts without printing tokens. It cancels pending actions when rounds or snippets change. It does not blindly retry an acknowledgement timeout, since the server may already have processed the answer. On reconnect it reads current server answers before scheduling again.

Preflight reads profiles and checks track rollups only. Shared song overlap, Wrapped summaries, Spotify token refresh and audio availability can still fail when starting a minigame. Host audio playback and player browser controls need browser testing. Completed runs use the existing game_sessions persistence; player IDs beginning with `g:bot-` identify these runs.

Run `npm run bots:test` for deterministic handler tests and an actual localhost Socket.IO integration test covering authentication, profile loading, joining, voting/reveal/scoring, reconnect and stale-action cancellation. The integration test substitutes Mongo profile reads and a round prompt; it does not use or modify your database.
