import React from "react";

type RadialTimerProps = {
  /** Time remaining in ms — used to calculate progress if `progress` is not provided */
  remainingMs?: number;
  /** Total time in ms — used to calculate progress if `progress` is not provided */
  totalMs?: number;
  /** Direct 0-to-1 progress value (overrides time-based calculation) */
  progress?: number;
  /** SVG size in px */
  size?: number;
  /** Ring stroke width */
  strokeWidth?: number;
  /** Override the center label (defaults to seconds remaining) */
  label?: string;
  className?: string;
};

function getColor(progress: number): string {
  if (progress > 0.33) return "#38bdf8";   // cyan
  if (progress > 0.17) return "#f59e0b";   // amber
  return "#ef4444";                          // red
}

export const RadialTimer: React.FC<RadialTimerProps> = ({
  remainingMs,
  totalMs,
  progress: directProgress,
  size = 48,
  strokeWidth = 4,
  label,
  className,
}) => {
  const progress =
    directProgress != null
      ? Math.max(0, Math.min(1, directProgress))
      : remainingMs != null && totalMs != null && totalMs > 0
        ? Math.max(0, Math.min(1, remainingMs / totalMs))
        : 0;

  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - progress);
  const color = getColor(progress);

  const seconds =
    remainingMs != null ? Math.max(0, Math.ceil(remainingMs / 1000)) : null;
  const displayLabel = label ?? (seconds != null ? `${seconds}` : "");

  const urgentClass =
    remainingMs != null && remainingMs > 0 && remainingMs < 5000
      ? "radial-timer--critical"
      : remainingMs != null && remainingMs > 0 && remainingMs < 10000
        ? "radial-timer--urgent"
        : "";

  return (
    <div
      className={["radial-timer", urgentClass, className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(148, 163, 184, 0.15)"
          strokeWidth={strokeWidth}
        />
        {/* Foreground arc */}
        <circle
          className="radial-timer__ring"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        {/* Center text */}
        {displayLabel && (
          <text
            x={size / 2}
            y={size / 2}
            textAnchor="middle"
            dominantBaseline="central"
            fill={color}
            fontSize={size * 0.3}
            fontWeight={700}
            fontFamily="var(--gs-font-family)"
          >
            {displayLabel}
          </text>
        )}
      </svg>
    </div>
  );
};
