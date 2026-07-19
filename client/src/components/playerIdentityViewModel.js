const VARIANT_BADGE_LIMITS = Object.freeze({
  full: 3,
  compact: 2,
  inline: 1,
  leaderboard: 2,
  match: 2,
  admin: 3,
});

export function getPlayerDisplayName(player, { fallback = "Player", allowEmail = false } = {}) {
  const candidate = firstText(
    player?.display_name,
    player?.displayName,
    player?.name,
    player?.username,
    allowEmail ? player?.email : ""
  );
  return candidate || fallback;
}

export function getPlayerUsername(player) {
  return cleanText(player?.username).replace(/^@+/, "");
}

export function normalizePlayerIdentity(player, options = {}) {
  const source = player || {};
  const variant = VARIANT_BADGE_LIMITS[options.variant] ? options.variant : "compact";
  const displayName = getPlayerDisplayName(source, {
    fallback: options.fallbackName || "Player",
    allowEmail: variant === "admin" && options.allowEmailFallback === true,
  });
  const username = getPlayerUsername(source);
  const rank = optionalPositiveNumber(source.rank ?? source.position);
  const points = optionalNonNegativeNumber(source.points);

  return {
    id: cleanText(source.id ?? source._id),
    displayName,
    username: username && username.localeCompare(displayName, undefined, { sensitivity: "accent" }) !== 0
      ? username
      : "",
    avatar: source.profile_image || source.avatar || source.image || "",
    rank,
    points,
    status: cleanText(source.status),
    role: cleanText(source.role),
    email: variant === "admin" ? cleanText(source.email) : "",
    memberSince: source.created_at || source.member_since || null,
    variant,
    isCurrent: Boolean(options.isCurrent),
    isWinner: Boolean(options.isWinner),
    unavailable: Boolean(source.unavailable || source.available === false),
    badgeLimit: VARIANT_BADGE_LIMITS[variant],
  };
}

export function formatPlayerRank(rank, { context = "Rank", confirmedUnranked = false } = {}) {
  const value = optionalPositiveNumber(rank);
  if (value == null) return confirmedUnranked ? "Unranked" : "";
  return `${context} #${new Intl.NumberFormat("en-US").format(value)}`;
}

export function formatPlayerPoints(points, { short = false } = {}) {
  const value = optionalNonNegativeNumber(points);
  if (value == null) return "";
  const formatted = new Intl.NumberFormat("en-US").format(value);
  return short ? `${formatted} pts` : `${formatted} points`;
}

export function getIdentityBadges(identity, { confirmedUnranked = false } = {}) {
  const badges = [];
  const rank = formatPlayerRank(identity?.rank, { confirmedUnranked });
  const points = formatPlayerPoints(identity?.points, { short: true });
  if (rank) badges.push({ id: "rank", label: rank, tone: "champion", icon: "crown" });
  if (points) badges.push({ id: "points", label: points, tone: "energy", icon: "bolt" });
  if (identity?.variant === "admin" && identity.status) {
    badges.push({
      id: "status",
      label: identity.status,
      tone: identity.status === "active" ? "success" : "neutral",
      icon: identity.status === "active" ? "check" : "profile",
    });
  }
  if (identity?.variant === "admin" && identity.role) {
    badges.push({ id: "role", label: identity.role, tone: "neutral", icon: "shield" });
  }
  return badges.slice(0, identity?.badgeLimit || VARIANT_BADGE_LIMITS.compact);
}

function firstText(...values) {
  return values.map(cleanText).find(Boolean) || "";
}

function cleanText(value) {
  if (value == null || value === "undefined" || value === "null") return "";
  return String(value).trim();
}

function optionalPositiveNumber(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function optionalNonNegativeNumber(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
