import { useMemo, useState } from "react";
import { PlayerAvatar } from "components/PlayerAvatar";
import "../styles/gameShell.css";
import "../styles/lobby.css";

type SandboxPlayer = {
  playerId: string;
  name: string;
  displayName?: string | null;
  avatar?: string | null;
  isHost?: boolean;
};

type SandboxRoom = {
  roomCode: string;
  players: SandboxPlayer[];
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const toDataUri = (svg: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const makeAvatarDataUri = (seed: number, label: string) => {
  const hue = (seed * 53) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue}, 88%, 58%)"/>
        <stop offset="100%" stop-color="hsl(${(hue + 40) % 360}, 84%, 42%)"/>
      </linearGradient>
    </defs>
    <rect width="100" height="100" rx="26" fill="url(#g)"/>
    <text x="50" y="61" text-anchor="middle" font-family="Arial, sans-serif" font-size="34" font-weight="700" fill="white">${label}</text>
  </svg>`;
  return toDataUri(svg);
};

const NAMES = [
  "Nova",
  "Pixel",
  "Echo",
  "Rook",
  "Miso",
  "Luna",
  "Atlas",
  "Rex",
  "Kai",
  "Skye",
  "Blitz",
  "Nyx",
  "Orion",
  "Vibe",
  "Bard",
  "Juno",
  "Quinn",
  "Rae",
  "Sol",
  "Tess",
  "Ash",
  "Ivy",
  "Zed",
  "Faye",
];

const labelStyle = {
  display: "grid",
  gap: 6,
  fontSize: 13,
  color: "#cbd5e1",
} as const;

const sectionStyle = {
  border: "1px solid #334155",
  borderRadius: 12,
  padding: "0.85rem",
  background: "#111827",
} as const;

export default function LobbySandbox() {
  const [playerCount, setPlayerCount] = useState(8);
  const [playersWithAvatars, setPlayersWithAvatars] = useState(8);
  const [longNamePct, setLongNamePct] = useState(25);
  const [previewWidth, setPreviewWidth] = useState(1280);
  const [seed, setSeed] = useState(1);

  const safePlayerCount = clamp(playerCount, 0, 30);
  const safePlayersWithAvatars = clamp(playersWithAvatars, 0, safePlayerCount);
  const safeLongNamePct = clamp(longNamePct, 0, 100);
  const safePreviewWidth = clamp(previewWidth, 540, 1800);

  const room = useMemo<SandboxRoom>(() => {
    const players: SandboxPlayer[] = [
      {
        playerId: "host-1",
        name: "Host",
        displayName: "DJ Host",
        isHost: true,
        avatar: makeAvatarDataUri(seed + 1000, "H"),
      },
    ];

    for (let i = 0; i < safePlayerCount; i += 1) {
      const number = i + 1;
      const shortName = NAMES[(i + seed) % NAMES.length];
      const shouldUseLongName =
        ((i * 37 + seed * 19) % 100) < safeLongNamePct;
      const displayName = shouldUseLongName
        ? `${shortName} Super Groove ${number}`
        : `${shortName} ${number}`;
      const initials = displayName
        .split(" ")
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase();

      players.push({
        playerId: `player-${number}`,
        name: displayName,
        displayName,
        avatar:
          i < safePlayersWithAvatars
            ? makeAvatarDataUri(seed * 71 + number * 11, initials || "P")
            : null,
      });
    }

    return {
      roomCode: "ABCD12",
      players,
    };
  }, [safePlayerCount, safePlayersWithAvatars, safeLongNamePct, seed]);

  const actualPlayers = room.players.filter((player) => !player.isHost);
  const joinPath = "/lobby";
  const joinUrl = `${window.location.origin}${joinPath}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=0&data=${encodeURIComponent(
    joinUrl
  )}`;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#020617",
        color: "#e2e8f0",
        padding: "1rem",
      }}
    >
      <div style={{ maxWidth: 1500, margin: "0 auto", display: "grid", gap: 16 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>Lobby Sandbox</h1>
        <p style={{ margin: 0, color: "#94a3b8" }}>
          Tune host-lobby spacing/animation with fake players before testing real sockets.
        </p>

        <div
          style={{
            ...sectionStyle,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 12,
          }}
        >
          <label style={labelStyle}>
            Players: {safePlayerCount}
            <input
              type="range"
              min={0}
              max={30}
              value={safePlayerCount}
              onChange={(event) => setPlayerCount(Number(event.target.value))}
            />
          </label>

          <label style={labelStyle}>
            Players with avatars: {safePlayersWithAvatars}
            <input
              type="range"
              min={0}
              max={safePlayerCount}
              value={safePlayersWithAvatars}
              onChange={(event) =>
                setPlayersWithAvatars(Number(event.target.value))
              }
            />
          </label>

          <label style={labelStyle}>
            Long name frequency: {safeLongNamePct}%
            <input
              type="range"
              min={0}
              max={100}
              value={safeLongNamePct}
              onChange={(event) => setLongNamePct(Number(event.target.value))}
            />
          </label>

          <label style={labelStyle}>
            Preview width: {safePreviewWidth}px
            <input
              type="range"
              min={540}
              max={1800}
              step={20}
              value={safePreviewWidth}
              onChange={(event) => setPreviewWidth(Number(event.target.value))}
            />
          </label>

          <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
            {[0, 1, 4, 8, 12, 20].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setPlayerCount(preset)}
                style={{ padding: "0.45rem 0.65rem", cursor: "pointer" }}
              >
                {preset}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSeed((prev) => prev + 1)}
              style={{ padding: "0.45rem 0.65rem", cursor: "pointer" }}
            >
              Randomize
            </button>
          </div>
        </div>

        <div
          style={{
            ...sectionStyle,
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            color: "#93c5fd",
            fontSize: 13,
          }}
        >
          <div>Room: {room.roomCode}</div>
          <div>Total in room: {room.players.length}</div>
          <div>Visible players: {actualPlayers.length}</div>
        </div>

        <div style={{ width: "100%", maxWidth: safePreviewWidth, margin: "0 auto" }}>
          <div className="game-shell-layout lobby-host-layout">
            <div className="lobby-host-topbar">
              <div className="lobby-host-topbar-left">
                <span className="lobby-brand">Spotify Stats Game</span>
                <button className="game-shell-button lobby-small-btn" type="button">
                  Leave
                </button>
              </div>

              <div className="lobby-code-block">
                <div className="lobby-code-eyebrow">Room Code</div>
                <div className="lobby-code">{room.roomCode}</div>
              </div>

              <div className="lobby-host-topbar-right">
                <div className="lobby-player-count">
                  {actualPlayers.length}{" "}
                  {actualPlayers.length === 1 ? "player" : "players"} joined
                </div>
                <button
                  className="game-shell-button lobby-start-btn"
                  type="button"
                  disabled={actualPlayers.length === 0}
                >
                  Start Game →
                </button>
              </div>
            </div>

            <div className="lobby-host-body">
              <div className="lobby-host-join-row">
                <div className="lobby-join-url">Scan to join faster</div>
                <div className="lobby-qr-wrap lobby-qr-wrap--large">
                  <img
                    src={qrSrc}
                    alt={`QR code to join room ${room.roomCode}`}
                    className="lobby-qr"
                  />
                  <div className="lobby-qr-label">{joinUrl}</div>
                </div>
              </div>
              {actualPlayers.length === 0 ? (
                <div className="lobby-empty">
                  <div className="lobby-empty-text">Waiting for players to join…</div>
                  <div className="lobby-empty-hint">Share the code above!</div>
                </div>
              ) : (
                <div className="lobby-player-grid">
                  {actualPlayers.map((player) => (
                    <div key={player.playerId} className="lobby-player-card">
                      <PlayerAvatar
                        player={player}
                        size={null}
                        className="lobby-player-avatar"
                        fallbackClassName="lobby-player-avatar--initials"
                        variant="simple"
                      />
                      <div className="lobby-player-name">
                        {player.displayName || player.name}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
