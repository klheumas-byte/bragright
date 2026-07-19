import { formatMatchDate, getMatchStatusPresentation } from "../pages/matchPresentation.js";

const SCORE_VISIBLE_STATUSES = new Set([
  "pending_confirmation",
  "confirmed",
  "disputed",
  "rejected",
]);

export function createRichMatchViewModel(
  match = {},
  { currentUserId = "", currentUserName = "You", variant = "full" } = {}
) {
  const statusKey = normalizeText(match.status) || "unknown";
  const status = getMatchStatusPresentation(statusKey);
  const participants = resolveParticipants(match, currentUserId, currentUserName, variant);
  const rawScores = resolveScores(match);
  const scores = participants.swapped
    ? { left: rawScores.right, right: rawScores.left }
    : rawScores;
  const hasScore = SCORE_VISIBLE_STATUSES.has(statusKey) && scores.left != null && scores.right != null;
  const scoreState = resolveScoreState(statusKey, hasScore);
  const winner = resolveWinner(match, participants, scores, statusKey);
  const actions = resolveAvailableActions(match);
  const metadata = resolveMetadata(match, statusKey, variant);

  return {
    id: normalizeText(match.id || match.match_id),
    variant,
    statusKey,
    status,
    title: resolveTitle(match, statusKey),
    participants,
    scores,
    hasScore,
    scoreState,
    winner,
    metadata,
    actions,
    contextMessage: resolveContextMessage(match, currentUserId, statusKey),
    hasEvidence: Boolean(match.proof_image_url),
    isDisputed: statusKey === "disputed",
    accessibleLabel: buildAccessibleLabel(participants, status.label, scores, scoreState),
  };
}

export function resolveAvailableActions(match = {}) {
  return [
    match.can_accept ? "accept" : null,
    match.can_decline ? "decline" : null,
    match.can_submit_result ? "submit-result" : null,
    match.can_confirm ? "confirm" : null,
    match.can_dispute ? "dispute" : null,
    match.can_cancel ? "cancel" : null,
  ].filter(Boolean);
}

function resolveParticipants(match, currentUserId, currentUserName, variant) {
  const adminPlayers = match.players || {};
  const profileShape = !match.player_one && !match.player_one_name && match.opponentName;
  const first = normalizeParticipant(
    match.player_one || adminPlayers.submitted_by || (profileShape ? { username: currentUserName } : null),
    match.player_one_id || adminPlayers.submitted_by?.id,
    match.player_one_name || adminPlayers.submitted_by?.username || (profileShape ? currentUserName : "Player one")
  );
  const second = normalizeParticipant(
    match.player_two || adminPlayers.opponent || match.opponent,
    match.player_two_id || adminPlayers.opponent?.id || match.opponent?.id,
    match.player_two_name || adminPlayers.opponent?.username || match.opponentName || match.opponent?.username || "Player two"
  );
  const viewerIsFirst = profileShape || Boolean(currentUserId && first.id === currentUserId);
  const viewerIsSecond = Boolean(currentUserId && second.id === currentUserId);
  const swapped = variant !== "admin" && viewerIsSecond;
  const left = swapped ? second : first;
  const right = swapped ? first : second;

  return {
    left: { ...left, perspectiveLabel: profileShape ? "Profile player" : viewerIsFirst || viewerIsSecond ? (left.id === currentUserId ? "You" : "Opponent") : "Player one" },
    right: { ...right, perspectiveLabel: viewerIsFirst || viewerIsSecond ? (profileShape ? "Opponent" : right.id === currentUserId ? "You" : "Opponent") : "Player two" },
    swapped,
    viewerIsParticipant: viewerIsFirst || viewerIsSecond,
  };
}

function normalizeParticipant(player, fallbackId, fallbackName) {
  const source = player || {};
  return {
    id: normalizeText(source.id || fallbackId),
    name: normalizeText(source.display_name || source.username || fallbackName) || "Unknown player",
    username: normalizeText(source.username),
    image: normalizeText(source.profile_image),
    rank: optionalNumber(source.rank),
    points: optionalNumber(source.points),
  };
}

function resolveScores(match) {
  return {
    left: optionalNumber(match.player_one_score ?? match.player_score ?? match.playerScore),
    right: optionalNumber(match.player_two_score ?? match.opponent_score ?? match.opponentScore),
  };
}

function resolveScoreState(status, hasScore) {
  if (!hasScore) return { kind: "versus", label: "Versus", isFinal: false };
  if (status === "confirmed") return { kind: "final", label: "Final score", isFinal: true };
  if (status === "disputed") return { kind: "disputed", label: "Submitted score · disputed", isFinal: false };
  if (status === "rejected") return { kind: "rejected", label: "Rejected submitted score", isFinal: false };
  return { kind: "submitted", label: "Submitted score · not final", isFinal: false };
}

function resolveWinner(match, participants, scores, status) {
  if (status !== "confirmed" || scores.left == null || scores.right == null) return { side: "", isDraw: false };
  if (scores.left === scores.right) return { side: "", isDraw: true };
  if (match.winner_id) {
    if (participants.left.id === match.winner_id) return { side: "left", isDraw: false };
    if (participants.right.id === match.winner_id) return { side: "right", isDraw: false };
  }
  return { side: scores.left > scores.right ? "left" : "right", isDraw: false };
}

function resolveMetadata(match, status, variant) {
  const items = [];
  addMetadata(items, "created", "Created", match.created_at || match.playedAt, "clock");
  if (status === "pending_result") addMetadata(items, "accepted", "Accepted", match.accepted_at, "check");
  if (["pending_confirmation", "disputed", "rejected"].includes(status)) {
    addMetadata(items, "submitted", "Result submitted", match.result_submitted_at, "submit");
  }
  if (status === "confirmed") addMetadata(items, "completed", "Completed", match.confirmed_at || match.reviewed_at || match.playedAt, "check");
  if (match.proof_image_url) items.push({ id: "evidence", label: "Evidence attached", icon: "matches" });
  if (status === "disputed") items.push({ id: "dispute", label: "Dispute open", icon: "disputes" });
  if (variant === "admin" && match.result_submitted_at && !items.some((item) => item.id === "submitted")) {
    addMetadata(items, "submission", "Result submitted", match.result_submitted_at, "submit");
  }
  return uniqueMetadata(items).slice(0, variant === "compact" ? 2 : 4);
}

function addMetadata(items, id, label, value, icon) {
  if (!value) return;
  items.push({ id, label: `${label} ${formatMatchDate(value)}`, icon, dateTime: value });
}

function uniqueMetadata(items) {
  return items.filter((item, index) => items.findIndex((candidate) => candidate.id === item.id) === index);
}

function resolveTitle(match, status) {
  return normalizeText(match.game_name || match.game || match.category || match.match_format) ||
    (status === "match_requested" ? "Match challenge" : "Competitive match");
}

function resolveContextMessage(match, currentUserId, status) {
  if (match.can_accept) return "This challenge needs your response. Accept or decline when you are ready.";
  if (match.can_confirm) return "Your opponent submitted this score. Confirm it or open a dispute.";
  if (match.can_submit_result) return "The accepted match is ready for a result submission.";
  if (status === "match_requested" && match.created_by === currentUserId) return "Your challenge is waiting for the opponent's response.";
  if (status === "pending_confirmation" && match.result_submitted_by === currentUserId) return "Your submitted result is waiting for the opponent's confirmation.";
  if (status === "pending_confirmation") return "The submitted score is awaiting participant confirmation and is not final.";
  if (status === "disputed") return "The submitted score is disputed and under administrator review.";
  if (status === "confirmed") return "The result is confirmed and included in official competitive statistics.";
  if (status === "rejected") return "The submitted result was rejected during administrator review.";
  if (status === "cancelled") return "This challenge was cancelled and no longer accepts player actions.";
  if (status === "expired") return "This challenge expired before the match workflow was completed.";
  if (status === "scheduled") return "This challenge is scheduled within the existing match workflow.";
  return getMatchStatusPresentation(status).description;
}

function buildAccessibleLabel(participants, statusLabel, scores, scoreState) {
  const score = scoreState.kind === "versus" ? "" : `, score ${scores.left} to ${scores.right}, ${scoreState.label.toLowerCase()}`;
  return `Match between ${participants.left.name} and ${participants.right.name}, ${statusLabel.toLowerCase()}${score}.`;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
