import React from "react";
import { Player } from "types/game";

type PlayerAvatarProps = {
  player: Player;
  size?: number;
  className?: string;
};

function getInitials(name?: string | null) {
  return (name || "")
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

// TODOo use in more places
export const PlayerAvatar: React.FC<PlayerAvatarProps> = ({ player, size = 34, className }) => {
  const label = player.displayName || player.name || "Player";

  if (player.avatar) {
    return (
      <img
        src={player.avatar}
        alt={label}
        className={className}
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          objectFit: "cover",
          border: "1px solid rgba(255,255,255,0.14)",
          flexShrink: 0,
        }}
      />
    );
  }

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(145deg, rgba(59, 130, 246, 0.42), rgba(15, 23, 42, 0.92))",
        border: "1px solid rgba(96, 165, 250, 0.35)",
        color: "#dbeafe",
        fontWeight: 700,
        fontSize: Math.max(9, Math.round(size * 0.35)),
        flexShrink: 0,
      }}
    >
      {getInitials(label)}
    </div>
  );
};
