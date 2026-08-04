import { Link } from "react-router-dom";
import ProfileAvatar from "./ProfileAvatar";
import SidebarIcon from "./SidebarIcon";
import { Badge } from "./ui";
import { getIdentityBadges, normalizePlayerIdentity } from "./playerIdentityViewModel";
import { SkeletonAvatar, SkeletonBadge, SkeletonText } from "./LoadingSkeletons";

const AVATAR_SIZE_BY_VARIANT = Object.freeze({
  full: "hero",
  compact: "md",
  inline: "sm",
  leaderboard: "lg",
  match: "lg",
  admin: "md",
});

export default function PlayerIdentity({
  player,
  variant = "compact",
  className = "",
  href = "",
  label = "",
  isCurrent = false,
  isWinner = false,
  confirmedUnranked = false,
  showUsername = true,
  showBadges = true,
  showPrivateMeta = true,
  allowEmailFallback = false,
  actions = null,
}) {
  const identity = normalizePlayerIdentity(player, {
    variant,
    isCurrent,
    isWinner,
    allowEmailFallback,
  });
  const badges = showBadges ? getIdentityBadges(identity, { confirmedUnranked }) : [];
  const content = (
    <>
      <ProfileAvatar
        image={identity.avatar}
        name={identity.displayName}
        seed={identity.id}
        size={AVATAR_SIZE_BY_VARIANT[variant] || "md"}
        isCurrent={identity.isCurrent}
        isWinner={identity.isWinner}
        className="player-identity__avatar"
      />
      <div className="player-identity__content">
        {label ? <span className="player-identity__label">{label}</span> : null}
        <strong className="player-identity__name" title={identity.displayName}>
          <span aria-hidden="true">{identity.displayName}</span>
          <span className="sr-only">{identity.displayName}</span>
        </strong>
        {showUsername && identity.username ? (
          <span className="player-identity__username" title={`@${identity.username}`}>@{identity.username}</span>
        ) : null}
        {variant === "admin" && showPrivateMeta && identity.email ? (
          <span className="player-identity__private-meta">{identity.email}</span>
        ) : null}
        {badges.length ? (
          <span className="player-identity__badges" aria-label="Competitive identity details">
            {badges.map((badge) => (
              <Badge key={badge.id} tone={badge.tone} icon={<SidebarIcon name={badge.icon} decorative />}>
                {badge.label}
              </Badge>
            ))}
          </span>
        ) : null}
      </div>
      {actions ? <div className="player-identity__actions">{actions}</div> : null}
    </>
  );
  const classes = [
    "player-identity",
    `player-identity--${variant}`,
    identity.isCurrent ? "player-identity--current" : "",
    identity.isWinner ? "player-identity--winner" : "",
    identity.unavailable ? "player-identity--unavailable" : "",
    className,
  ].filter(Boolean).join(" ");
  const accessibleLabel = `${identity.displayName}${identity.isCurrent ? ", current player" : ""}${identity.isWinner ? ", winner" : ""}`;

  return href ? (
    <Link className={`${classes} player-identity--linked`} to={href} aria-label={accessibleLabel}>
      {content}
    </Link>
  ) : (
    <div className={classes} aria-label={accessibleLabel}>{content}</div>
  );
}

export function PlayerIdentitySkeleton({ variant = "compact", className = "" }) {
  const size = { full: 112, compact: 48, inline: 36, leaderboard: 56, match: 64, admin: 48 }[variant] || 48;
  return (
    <div className={`player-identity player-identity--${variant} player-identity--skeleton ${className}`.trim()} aria-hidden="true">
      <SkeletonAvatar size={size} />
      <div className="player-identity__content"><SkeletonText lines={variant === "inline" ? 1 : 2} />{variant !== "inline" ? <SkeletonBadge /> : null}</div>
    </div>
  );
}
