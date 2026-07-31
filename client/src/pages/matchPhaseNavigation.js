export function getMatchPhaseDestination(match, currentMode) {
  const matchId = String(match?.id || "").trim();
  if (!matchId) {
    return "";
  }

  const status = String(match?.status || "").trim().toLowerCase();
  const isAccepted = status === "pending_result" || match?.can_submit_result === true;

  if (isAccepted && (currentMode === "respond" || currentMode === "sent")) {
    return `/matches/${encodeURIComponent(matchId)}/result/submit`;
  }

  return "";
}
