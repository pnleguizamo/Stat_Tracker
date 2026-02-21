import { CSSProperties, FC, PropsWithChildren } from "react";

const joinClasses = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

type SharedProps = PropsWithChildren<{
  className?: string;
}>;

type HostCardProps = SharedProps & {
  padded?: boolean;
  subtle?: boolean;
  style?: CSSProperties;
};

type HostStateMessageProps = SharedProps & {
  error?: boolean;
};

export const HostMinigameStack: FC<SharedProps> = ({ className, children }) => (
  <div className={joinClasses("host-minigame-stack", className)}>{children}</div>
);

export const HostCard: FC<HostCardProps> = ({
  className,
  padded = false,
  subtle = false,
  style,
  children,
}) => {
  return (
    <div
      className={joinClasses(
        "host-minigame-card",
        padded && "host-minigame-card--padded",
        subtle && "host-minigame-card--subtle",
        className
      )}
      style={style}
    >
      {children}
    </div>
  );
};

export const HostActionRow: FC<SharedProps> = ({ className, children }) => (
  <div className={joinClasses("host-minigame-action-row", className)}>{children}</div>
);

export const HostStateMessage: FC<HostStateMessageProps> = ({
  className,
  error = false,
  children,
}) => (
  <div
    className={joinClasses(
      "host-minigame-state",
      error && "host-minigame-error",
      className
    )}
  >
    {children}
  </div>
);

type HostChipProps = SharedProps;

export const HostChip: FC<HostChipProps> = ({
  className,
  children,
}) => (
  <span
    className={joinClasses(
      "host-minigame-chip",
      className
    )}
  >
    {children}
  </span>
);
