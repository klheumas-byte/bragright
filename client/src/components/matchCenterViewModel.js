import { buildMatchTimeline, formatMatchDate, getMatchStatusPresentation } from "../pages/matchPresentation.js";
import { createRichMatchViewModel } from "./richMatchViewModel.js";

export function createMatchCenterViewModel(match = {}, options = {}) {
  const richView = createRichMatchViewModel(match, options);
  const timeline = buildMatchTimeline(match);
  const information = [
    informationItem("created", "Created", match.created_at, "clock"),
    informationItem("accepted", "Accepted", match.accepted_at, "check"),
    informationItem("submitted", "Result submitted", match.result_submitted_at, "submit"),
    informationItem("completed", "Completed", match.confirmed_at || match.reviewed_at, "trophy"),
    match.proof_image_url
      ? { id: "evidence", label: "Evidence", value: "Image attached", icon: "matches" }
      : { id: "evidence", label: "Evidence", value: "Not attached", icon: "matches" },
  ].filter(Boolean);
  const statistics = [
    match.created_at ? { id: "created", label: "Created", value: formatMatchDate(match.created_at), icon: "clock" } : null,
    match.updated_at ? { id: "updated", label: "Last updated", value: formatMatchDate(match.updated_at), icon: "activity" } : null,
    timeline.length ? { id: "events", label: "Recorded events", value: String(timeline.length), icon: "activity" } : null,
    { id: "evidence", label: "Evidence files", value: match.proof_image_url ? "1" : "0", icon: "matches" },
    match.result_submitted_at
      ? {
          id: "confirmation",
          label: "Confirmation",
          value: match.status === "confirmed" ? "Confirmed" : match.status === "disputed" ? "Under review" : "Pending",
          icon: match.status === "confirmed" ? "check" : "clock",
        }
      : null,
  ].filter(Boolean);

  return {
    ...richView,
    status: getMatchStatusPresentation(match.status),
    timeline,
    information,
    statistics,
    disputeNote: cleanText(match.dispute_note),
    resolutionNote: cleanText(match.resolution_note),
  };
}

export function createRivalryView(comparison, participants = []) {
  const recentMatches = Array.isArray(comparison?.recent_matches)
    ? comparison.recent_matches.filter((match) => match?.match_id)
    : [];
  const playerA = comparison?.player_a || {};
  const playerB = comparison?.player_b || {};

  return {
    totalMatches: finiteNumber(comparison?.total_matches),
    recentMatches,
    participants: participants.map((participant) => {
      const isPlayerA = participant?.id === playerA.id;
      const isPlayerB = participant?.id === playerB.id;
      return {
        ...participant,
        rivalryWins: isPlayerA
          ? finiteNumber(comparison?.player_a_wins)
          : isPlayerB
            ? finiteNumber(comparison?.player_b_wins)
            : null,
        rivalryPoints: isPlayerA
          ? finiteNumber(comparison?.player_a_points)
          : isPlayerB
            ? finiteNumber(comparison?.player_b_points)
            : null,
      };
    }),
  };
}

function informationItem(id, label, value, icon) {
  return value ? { id, label, value: formatMatchDate(value), dateTime: value, icon } : null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function cleanText(value) {
  return String(value || "").trim();
}
