import React, { CSSProperties } from "react";

export type AvatarIdentity = {
  avatar?: string | null;
  displayName?: string | null;
  name?: string | null;
};

type PlayerAvatarProps = {
  player: AvatarIdentity;
  size?: number | null;
  className?: string;
  imgClassName?: string;
  fallbackClassName?: string;
  imgStyle?: CSSProperties;
  fallbackStyle?: CSSProperties;
  variant?: "default" | "simple";
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

const joinClasses = (...values: Array<string | undefined>) => values.filter(Boolean).join(" ");

export const PlayerAvatar: React.FC<PlayerAvatarProps> = ({
  player,
  size = 34,
  className,
  imgClassName,
  fallbackClassName,
  imgStyle,
  fallbackStyle,
  variant = "default",
}) => {
  const label = player.displayName || player.name || "Player";
  const hasFixedSize = typeof size === "number";
  const baseStyle: CSSProperties = {
    ...(hasFixedSize ? { width: size, height: size } : {}),
    borderRadius: "50%",
    flexShrink: 0,
  };
  const imageBaseStyle: CSSProperties = {
    ...baseStyle,
    objectFit: "cover",
    ...(variant === "default" ? { border: "1px solid rgba(255,255,255,0.14)" } : {}),
  };
  const fallbackBaseStyle: CSSProperties =
    variant === "simple"
      ? {
          ...baseStyle,
          background: "#2b6cb0",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 700,
          ...(hasFixedSize ? { fontSize: Math.max(10, size * 0.35) } : {}),
        }
      : {
          ...baseStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg, rgba(59, 130, 246, 0.42), rgba(15, 23, 42, 0.92))",
          border: "1px solid rgba(96, 165, 250, 0.35)",
          color: "#dbeafe",
          fontWeight: 700,
          ...(hasFixedSize ? { fontSize: Math.max(9, Math.round(size * 0.35)) } : {}),
        };

  if (player.avatar) {
    return (
      <img
        src={player.avatar}
        alt={label}
        className={joinClasses(className, imgClassName)}
        style={{ ...imageBaseStyle, ...imgStyle }}
      />
    );
  }

  return (
    <div
      className={joinClasses(className, fallbackClassName)}
      style={{ ...fallbackBaseStyle, ...fallbackStyle }}
    >
      {getInitials(label)}
    </div>
  );
};
