export const MATCH_STATUS_PRESENTATION = Object.freeze({
  match_requested: {
    label: "Match request",
    tone: "warning",
    description: "Waiting for the requested player to accept or decline.",
  },
  pending_result: {
    label: "Ready for result",
    tone: "info",
    description: "The accepted match is ready for score submission.",
  },
  pending_confirmation: {
    label: "Awaiting confirmation",
    tone: "warning",
    description: "A submitted result is waiting for opponent review.",
  },
  confirmed: {
    label: "Confirmed",
    tone: "success",
    description: "The result is confirmed and included in official statistics.",
  },
  disputed: {
    label: "Under admin review",
    tone: "danger",
    description: "The submitted result was disputed and awaits an admin decision.",
  },
  rejected: {
    label: "Result rejected",
    tone: "neutral",
    description: "The disputed result was rejected by an administrator.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "neutral",
    description: "This match was cancelled and no longer accepts player actions.",
  },
  expired: {
    label: "Expired",
    tone: "neutral",
    description: "This match expired before completion.",
  },
});

export const MATCH_VIEWS = Object.freeze([
  {
    id: "all",
    label: "All Matches",
    description: "Every match in your competitive history.",
  },
  {
    id: "attention",
    label: "Needs Attention",
    description: "Requests and submitted results that require your response.",
  },
  {
    id: "active",
    label: "Active",
    description: "Accepted matches ready for result submission.",
  },
  {
    id: "completed",
    label: "Completed",
    description: "Confirmed match history.",
  },
  {
    id: "disputed",
    label: "Disputed",
    description: "Matches currently waiting for admin review.",
  },
]);

const UNKNOWN_PRESENTATION = Object.freeze({
  label: "Status unavailable",
  tone: "neutral",
  description: "The current match status could not be identified. Refresh before taking action.",
});

export function getMatchStatusPresentation(status) {
  const normalized = String(status || "").trim().toLowerCase();
  return MATCH_STATUS_PRESENTATION[normalized] || UNKNOWN_PRESENTATION;
}

export function getMatchNextStep(match, currentUserId = "") {
  if (match?.can_accept) {
    return "Accept or decline this request";
  }
  if (match?.can_confirm) {
    return "Confirm or dispute the submitted result";
  }
  if (match?.can_submit_result) {
    return "Submit the match result";
  }
  if (match?.status === "match_requested" && match?.created_by === currentUserId) {
    return "Waiting for opponent response";
  }
  if (
    match?.status === "pending_confirmation" &&
    match?.result_submitted_by === currentUserId
  ) {
    return "Waiting for opponent confirmation";
  }
  if (match?.status === "disputed") {
    return "Waiting for admin review";
  }
  if (match?.status === "confirmed") {
    return "Match complete";
  }
  if (["cancelled", "rejected", "expired"].includes(match?.status)) {
    return "No further player action";
  }
  return "Refresh for the latest action";
}

export function buildMatchTimeline(match) {
  const events = [
    event("created", "Challenge created", match?.created_at),
    event("accepted", "Challenge accepted", match?.accepted_at),
    event("submitted", "Result submitted", match?.result_submitted_at),
    event("disputed", "Dispute opened", match?.disputed_at),
    event("confirmed", "Result confirmed", match?.confirmed_at),
    event("reviewed", "Admin review completed", match?.reviewed_at),
    event("declined", "Challenge declined", match?.declined_at),
    !match?.declined_at
      ? event("cancelled", "Match cancelled", match?.cancelled_at)
      : null,
    event("expired", "Match expired", match?.expired_at),
  ].filter(Boolean);

  return events.sort(
    (left, right) =>
      new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime()
  );
}

export function validateMatchScores(playerScore, opponentScore) {
  if (String(playerScore).trim() === "" || String(opponentScore).trim() === "") {
    return "Both scores are required.";
  }
  const scores = [Number(playerScore), Number(opponentScore)];
  if (scores.some((score) => !Number.isInteger(score))) {
    return "Scores must be whole numbers.";
  }
  if (scores.some((score) => score < 0)) {
    return "Scores cannot be negative.";
  }
  return "";
}

export function validateProofFile(file) {
  if (!file) {
    return "";
  }
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!allowedTypes.has(file.type)) {
    return "Proof must be a PNG, JPEG, or WebP image.";
  }
  if (!file.size) {
    return "Proof image cannot be empty.";
  }
  return "";
}

export function formatMatchDate(value, fallback = "Not available") {
  if (!value) {
    return fallback;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function getMatchErrorMessage(error, fallback = "The match could not be updated.") {
  if (error?.status === 409) {
    return error.message || "This action is already in progress or the match has changed. Refresh and try again.";
  }
  if (error?.status === 403) {
    return error.message || "You are not allowed to perform this match action.";
  }
  if (error?.status === 404) {
    return error.message || "This match is no longer available.";
  }
  return error?.message || fallback;
}

function event(id, label, timestamp) {
  return timestamp ? { id, label, timestamp } : null;
}
