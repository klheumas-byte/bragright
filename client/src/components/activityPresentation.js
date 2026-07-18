const DEFINITIONS = Object.freeze({
  login: { title: "Signed in", icon: "profile", tone: "neutral", category: "account" },
  profile_updated: { title: "Profile updated", icon: "profile", tone: "info", category: "profile" },
  proof_uploaded: { title: "Match proof uploaded", icon: "matches", tone: "info", category: "results" },
  match_scheduled: { title: "Challenge created", icon: "submit", tone: "info", category: "challenges" },
  match_request_accepted: { title: "Challenge accepted", icon: "matches", tone: "success", category: "challenges" },
  match_request_declined: { title: "Challenge declined", icon: "matches", tone: "neutral", category: "challenges" },
  result_submitted: { title: "Result submitted", icon: "activity", tone: "info", category: "results" },
  match_confirmed: { title: "Match completed", icon: "leaderboard", tone: "success", category: "results" },
  match_disputed: { title: "Dispute opened", icon: "disputes", tone: "warning", category: "disputes" },
  match_cancelled: { title: "Challenge cancelled", icon: "matches", tone: "neutral", category: "challenges" },
  admin_user_created: { title: "User created", icon: "users", tone: "info", category: "admin" },
  admin_role_changed: { title: "Role changed", icon: "adminProfile", tone: "warning", category: "admin" },
  admin_status_changed: { title: "Account status changed", icon: "users", tone: "warning", category: "admin" },
  admin_password_reset: { title: "Password reset", icon: "settings", tone: "warning", category: "admin" },
  admin_settings_updated: { title: "Settings updated", icon: "settings", tone: "info", category: "admin" },
  admin_dispute_resolved: { title: "Dispute resolved", icon: "disputes", tone: "success", category: "admin" },
  admin_match_resolved: { title: "Dispute resolved", icon: "disputes", tone: "success", category: "admin" },
  admin_match_rejected: { title: "Match result rejected", icon: "disputes", tone: "warning", category: "admin" },
  admin_match_overridden: { title: "Match result corrected", icon: "disputes", tone: "warning", category: "admin" },
});

const FALLBACK = Object.freeze({
  title: "Account activity",
  icon: "activity",
  tone: "neutral",
  category: "account",
});

export const PLAYER_ACTIVITY_FILTERS = Object.freeze([
  { value: "all", label: "All" },
  { value: "account", label: "Account" },
  { value: "profile", label: "Profile" },
  { value: "challenges", label: "Challenges" },
  { value: "results", label: "Results" },
  { value: "disputes", label: "Disputes" },
]);

export const ADMIN_ACTIVITY_TYPES = Object.freeze(
  Object.entries(DEFINITIONS).map(([value, definition]) => ({
    value,
    label: definition.title,
  }))
);

export function presentActivity(log, { admin = false } = {}) {
  const definition = DEFINITIONS[log?.action_type] || FALLBACK;
  const actorName = safeName(log?.actor?.display_name, "Unavailable user");
  const subject = admin ? actorName : "You";
  const opponent = safeName(log?.related?.opponent?.display_name, "the other player");
  const target = safeName(log?.details?.target?.display_name, "a user");
  const scores = formatScore(log?.details);
  const messages = {
    login: `${subject} signed in to BragRight.`,
    profile_updated: log?.details?.profile_image_updated
      ? `${subject} updated ${admin ? "their" : "your"} profile and avatar.`
      : `${subject} updated ${admin ? "their" : "your"} profile.`,
    proof_uploaded: `${subject} uploaded proof for a match.`,
    match_scheduled: `${subject} challenged ${opponent}.`,
    match_request_accepted: `${subject} accepted ${opponent}'s challenge.`,
    match_request_declined: `${subject} declined ${opponent}'s challenge.`,
    result_submitted: `${subject} submitted a result${scores ? ` (${scores})` : ""} against ${opponent}.`,
    match_confirmed: `${subject} confirmed the result against ${opponent}.`,
    match_disputed: `${subject} opened a dispute for the match against ${opponent}.`,
    match_cancelled: `${subject} cancelled the challenge with ${opponent}.`,
    admin_user_created: `${subject} created the account for ${target}.`,
    admin_role_changed: `${subject} changed ${target}'s role${log?.details?.new_role ? ` to ${humanize(log.details.new_role)}` : ""}.`,
    admin_status_changed: `${subject} changed ${target}'s status${log?.details?.new_status ? ` to ${humanize(log.details.new_status)}` : ""}.`,
    admin_password_reset: `${subject} reset ${target}'s password.`,
    admin_settings_updated: `${subject} updated system settings.`,
    admin_dispute_resolved: `${subject} resolved a disputed match.`,
    admin_match_resolved: `${subject} confirmed a disputed match result.`,
    admin_match_rejected: `${subject} rejected a disputed match result.`,
    admin_match_overridden: `${subject} corrected a disputed match result.`,
  };

  return {
    ...definition,
    description: messages[log?.action_type] || `${subject} recorded an account event.`,
    status: formatStatus(log?.related?.status),
    destination: log?.related?.available ? log.related.path || "" : "",
    unavailable: Boolean(log?.related && !log.related.available),
  };
}

export function formatActivityTimestamp(value, now = Date.now()) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) {
    return { relative: "Time unavailable", absolute: "Time unavailable", dateTime: undefined };
  }
  const absolute = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
  const seconds = Math.round((date.getTime() - now) / 1000);
  const ranges = [
    [60, "second"],
    [60, "minute"],
    [24, "hour"],
    [7, "day"],
  ];
  let amount = seconds;
  let unit = "second";
  for (const [boundary, nextUnit] of ranges) {
    unit = nextUnit;
    if (Math.abs(amount) < boundary) break;
    amount = Math.round(amount / boundary);
  }
  const relative = Math.abs(seconds) < 604800
    ? new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(amount, unit)
    : absolute;
  return { relative, absolute, dateTime: date.toISOString() };
}

function formatScore(details) {
  const first = details?.player_one_score;
  const second = details?.player_two_score;
  return Number.isFinite(Number(first)) && Number.isFinite(Number(second))
    ? `${first}-${second}`
    : "";
}

function formatStatus(status) {
  if (!status || status === "unknown") return "";
  return humanize(status);
}

function humanize(value) {
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function safeName(value, fallback) {
  return String(value || "").trim() || fallback;
}

export { DEFINITIONS as ACTIVITY_DEFINITIONS };
