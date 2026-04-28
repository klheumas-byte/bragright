import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ButtonLoadingText from "../components/ButtonLoadingText";
import ErrorState from "../components/ErrorState";
import SectionLoader from "../components/SectionLoader";
import SuccessAlert from "../components/SuccessAlert";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../context/LoadingContext";
import DashboardLayout from "../layouts/DashboardLayout";
import {
  acceptMatch,
  cancelMatch,
  confirmMatch,
  declineMatch,
  disputeMatch,
  getDashboardActions,
  getMyMatches,
  submitMatchResult,
  uploadMatchProof,
} from "../services/api";

const statusConfig = {
  requested: {
    title: "Match Requests",
    subtitle: "Newly scheduled matches that still need the opponent to accept or decline them.",
  },
  waiting_for_result: {
    title: "Waiting for result",
    subtitle: "Accepted matches that are now ready for one player to submit the score.",
  },
  awaiting_confirmation: {
    title: "Awaiting confirmation",
    subtitle: "Results were submitted and now need the opponent to confirm or dispute them.",
  },
  confirmed: {
    title: "Confirmed",
    subtitle: "These matches are trusted and ready for future rankings and tournaments.",
  },
  disputed: {
    title: "Disputed",
    subtitle: "These matches are blocked until an admin reviews the evidence and closes the case.",
  },
  closed: {
    title: "Cancelled, rejected, or expired",
    subtitle: "These matches are closed and cannot be edited by normal players anymore.",
  },
};

const emptyMatchesByStatus = {
  requested: [],
  waiting_for_result: [],
  awaiting_confirmation: [],
  confirmed: [],
  disputed: [],
  closed: [],
};

const emptyActions = {
  match_requests_count: 0,
  pending_confirmations_count: 0,
  disputed_matches_count: 0,
  total_actions_count: 0,
  items: [],
};

const initialResultDraft = {
  player_score: "",
  opponent_score: "",
};

export default function MyMatches() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const selectedMatchId = new URLSearchParams(location.search).get("matchId") || "";
  const [matchesByStatus, setMatchesByStatus] = useState(emptyMatchesByStatus);
  const [actionSummary, setActionSummary] = useState(emptyActions);
  const [disputeNotes, setDisputeNotes] = useState({});
  const [resultDrafts, setResultDrafts] = useState({});
  const [proofFiles, setProofFiles] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [activeActionKey, setActiveActionKey] = useState("");
  const { trackLoading } = useLoading();
  const matchRefs = useRef({});

  useEffect(() => {
    loadMatches();
  }, []);

  const allMatches = useMemo(
    () =>
      Object.values(matchesByStatus).flatMap((matches) =>
        Array.isArray(matches) ? matches : []
      ),
    [matchesByStatus]
  );

  const selectedMatch = useMemo(
    () => allMatches.find((match) => match.id === selectedMatchId) || null,
    [allMatches, selectedMatchId]
  );

  useEffect(() => {
    if (isLoading || !selectedMatchId || !selectedMatch) {
      return;
    }

    matchRefs.current[selectedMatchId]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [isLoading, selectedMatch, selectedMatchId]);

  async function loadMatches() {
    try {
      setIsLoading(true);
      const [matchesResponse, actionsResponse] = await trackLoading(() =>
        Promise.all([getMyMatches(), getDashboardActions()])
      );

      setMatchesByStatus(normalizeMatchesByStatus(matchesResponse?.data));
      setActionSummary(actionsResponse?.data || emptyActions);
    } catch (error) {
      setMatchesByStatus(emptyMatchesByStatus);
      setFeedback({
        type: "error",
        message: error.message,
      });
    } finally {
      setIsLoading(false);
    }
  }

  function handleDisputeNoteChange(matchId, value) {
    setDisputeNotes((currentNotes) => ({
      ...currentNotes,
      [matchId]: value,
    }));
  }

  function handleResultDraftChange(matchId, field, value) {
    setResultDrafts((currentDrafts) => ({
      ...currentDrafts,
      [matchId]: {
        ...(currentDrafts[matchId] || initialResultDraft),
        [field]: value,
      },
    }));
  }

  function handleProofFileChange(matchId, file) {
    setProofFiles((currentFiles) => ({
      ...currentFiles,
      [matchId]: file || null,
    }));
  }

  async function handleMatchAction(match, actionType) {
    try {
      setFeedback({ type: "", message: "" });
      setActiveActionKey(`${match.id}:${actionType}`);

      let response;
      if (actionType === "confirm") {
        response = await trackLoading(() => confirmMatch(match.id));
      } else if (actionType === "cancel") {
        response = await trackLoading(() => cancelMatch(match.id));
      } else if (actionType === "accept") {
        response = await trackLoading(() => acceptMatch(match.id));
      } else if (actionType === "decline") {
        response = await trackLoading(() => declineMatch(match.id));
      } else if (actionType === "submit-result") {
        const draft = resultDrafts[match.id] || initialResultDraft;
        let proofImageUrl = null;

        if (!draft.player_score.trim() || !draft.opponent_score.trim()) {
          throw new Error("Both scores are required before you can submit the result.");
        }

        if (proofFiles[match.id]) {
          const uploadResponse = await trackLoading(() => uploadMatchProof(proofFiles[match.id]));
          proofImageUrl = uploadResponse.data.proof_image_url;
        }

        const playerOneScore = Number(draft.player_score);
        const playerTwoScore = Number(draft.opponent_score);
        const isPlayerOne = match.current_user_role === "player_one";

        response = await trackLoading(() =>
          submitMatchResult(match.id, {
            player_one_score: isPlayerOne ? playerOneScore : playerTwoScore,
            player_two_score: isPlayerOne ? playerTwoScore : playerOneScore,
            proof_image_url: proofImageUrl,
          })
        );

        setResultDrafts((currentDrafts) => ({
          ...currentDrafts,
          [match.id]: initialResultDraft,
        }));
        setProofFiles((currentFiles) => ({
          ...currentFiles,
          [match.id]: null,
        }));
      } else {
        response = await trackLoading(() =>
          disputeMatch(match.id, {
            dispute_note: disputeNotes[match.id]?.trim() || "",
          })
        );
      }

      setFeedback({
        type: "success",
        message: response.message,
      });
      await loadMatches();
    } catch (error) {
      setFeedback({
        type: "error",
        message: error.message,
      });
    } finally {
      setActiveActionKey("");
    }
  }

  const summaryCards = [
    { label: "Match Requests", value: actionSummary.match_requests_count },
    { label: "Pending Confirmations", value: actionSummary.pending_confirmations_count },
    { label: "Disputes", value: actionSummary.disputed_matches_count },
  ];

  const selectedMatchMissing = !isLoading && Boolean(selectedMatchId) && !selectedMatch;
  const successMessage = feedback.type === "success" ? feedback.message : "";
  const errorMessage = feedback.type === "error" ? feedback.message : "";

  return (
    <DashboardLayout
      title="My Matches"
      description=""
    >
      <section className="feature-hero-card">
        <div>
          <p className="section-label">Matches</p>
          <h2 className="feature-hero-title">Track match requests and results.</h2>
        </div>

        <div className="status-summary-grid">
          {summaryCards.map((card) => (
            <StatusPill key={card.label} label={card.label} value={card.value} tone={card.value > 0 ? "pending" : "neutral"} />
          ))}
        </div>
      </section>

      <SuccessAlert message={successMessage} />
      <ErrorState message={errorMessage} onRetry={loadMatches} />

      {selectedMatchId ? (
        <section className={`dashboard-panel${selectedMatchMissing ? " match-selection-panel-missing" : ""}`}>
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Selected Match</p>
              <h2 className="panel-title">
                {selectedMatch ? `${selectedMatch.player_one_name} vs ${selectedMatch.player_two_name}` : "Match not found"}
              </h2>
            </div>
            <p className="panel-subtitle">
              {selectedMatch
                ? buildSelectedMatchSummary(selectedMatch)
                : "Match not found or already handled."}
            </p>
          </div>

          {selectedMatch ? (
            <div className="match-selection-detail">
              <div className="match-card-body">
                <div className="match-score-line">
                  <span className="match-score-label">{selectedMatch.player_one_name}</span>
                  <strong>{selectedMatch.player_one_score ?? "-"}</strong>
                </div>
                <div className="match-score-line">
                  <span className="match-score-label">{selectedMatch.player_two_name}</span>
                  <strong>{selectedMatch.player_two_score ?? "-"}</strong>
                </div>
                <div className="match-score-line">
                  <span className="match-score-label">Next step</span>
                  <strong>{buildNextStepLabel(selectedMatch)}</strong>
                </div>
              </div>

              <div className="match-selection-actions">
                <MatchActionArea
                  match={selectedMatch}
                  currentUserId={user?.id || ""}
                  activeActionKey={activeActionKey}
                  disputeNotes={disputeNotes}
                  resultDrafts={resultDrafts}
                  onDisputeNoteChange={handleDisputeNoteChange}
                  onResultDraftChange={handleResultDraftChange}
                  onProofFileChange={handleProofFileChange}
                  onMatchAction={handleMatchAction}
                />
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="dashboard-panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Action Items</p>
            <h2 className="panel-title">In-app notifications</h2>
          </div>
        </div>

        {isLoading ? (
          <SectionLoader as="div" lines={4} message="Loading action items..." />
        ) : actionSummary.items.length ? (
          <div className="dashboard-review-stack">
            {actionSummary.items.map((item) => (
              <article key={item.id} className="review-item-card">
                <div className="review-item-copy">
                  <p className="review-item-type">{formatActionType(item.type)}</p>
                  <h3 className="review-item-title">{item.title}</h3>
                  <p className="match-card-meta">{item.message}</p>
                  <p className="review-item-time">{formatDate(item.created_at)}</p>
                </div>
                <button
                  type="button"
                  className="inline-action-link"
                  onClick={() => navigate(buildActionDestination(item))}
                >
                  Open
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="match-empty-state">
            <p className="empty-state-copy">No actions required</p>
          </div>
        )}
      </section>

      {isLoading ? (
        <SectionLoader lines={6} message="Loading your matches..." />
      ) : (
        <div className="match-status-stack">
          {Object.entries(statusConfig).map(([status, config]) => (
            <section key={status} className="dashboard-panel">
              <div className="panel-header">
                <div>
                  <p className="panel-kicker">{config.title}</p>
                  <h2 className="panel-title">{config.title}</h2>
                </div>
                <p className="panel-subtitle">{config.subtitle}</p>
              </div>

              {matchesByStatus[status]?.length ? (
                <div className="match-list">
                  {matchesByStatus[status].map((match) => {
                    const isSelectedMatch = match.id === selectedMatchId;
                    const resultDraft = resultDrafts[match.id] || initialResultDraft;
                    const isMatchBusy = activeActionKey.startsWith(`${match.id}:`);

                    return (
                      <article
                        key={match.id}
                        ref={(element) => {
                          matchRefs.current[match.id] = element;
                        }}
                        className={`match-card${isSelectedMatch ? " match-card-selected" : ""}`}
                      >
                        <div className="match-card-top">
                          <div>
                            <p className="match-card-player">
                              {match.player_one_name} vs {match.player_two_name}
                            </p>
                            <p className="match-card-meta">Created {formatDate(match.created_at)}</p>
                          </div>
                          <span className={`match-status-badge ${getStatusTone(match.status)}`}>{match.display_status}</span>
                        </div>

                        <div className="match-card-body">
                          <div className="match-score-line">
                            <span className="match-score-label">{match.player_one_name}</span>
                            <strong>{match.player_one_score ?? "-"}</strong>
                          </div>
                          <div className="match-score-line">
                            <span className="match-score-label">{match.player_two_name}</span>
                            <strong>{match.player_two_score ?? "-"}</strong>
                          </div>
                          <div className="match-score-line">
                            <span className="match-score-label">Next step</span>
                            <strong>{buildNextStepLabel(match)}</strong>
                          </div>
                        </div>

                        {match.proof_image_url ? (
                          <div className="match-proof-panel">
                            <div className="match-proof-copy">
                              <p className="match-score-label">Proof image</p>
                              <p className="match-card-meta">Review the uploaded proof before you confirm or dispute.</p>
                            </div>
                            <a className="match-proof-link" href={match.proof_image_url} target="_blank" rel="noreferrer">
                              <img className="match-proof-image" src={match.proof_image_url} alt="Match proof" />
                              <span className="inline-action-link">Open proof</span>
                            </a>
                          </div>
                        ) : null}

                        {match.dispute_note ? (
                          <div className="match-dispute-note-panel">
                            <p className="match-score-label">Dispute note</p>
                            <p className="match-dispute-note-copy">{match.dispute_note}</p>
                          </div>
                        ) : null}

                        <div className="match-card-footer">
                          <div>
                            <p className="match-card-role">Your role: {match.current_user_role.replace("_", " ")}</p>
                            {isSelectedMatch ? (
                              <p className="match-card-meta">Opened from your notification or action center.</p>
                            ) : null}
                          </div>

                          {match.can_accept || match.can_decline || match.can_submit_result || match.can_confirm || match.can_dispute || match.can_cancel ? (
                            <MatchActionArea
                              match={match}
                              currentUserId={user?.id || ""}
                              activeActionKey={activeActionKey}
                              disputeNotes={disputeNotes}
                              resultDrafts={resultDrafts}
                              onDisputeNoteChange={handleDisputeNoteChange}
                              onResultDraftChange={handleResultDraftChange}
                              onProofFileChange={handleProofFileChange}
                              onMatchAction={handleMatchAction}
                            />
                          ) : (
                            <p className="match-card-timestamp">{buildTimelineLabel(match)}</p>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="match-empty-state">
                  <p className="empty-state-copy">No matches in this group yet.</p>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}

function StatusPill({ label, value, tone }) {
  return (
    <div className={`status-pill status-pill-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildActionDestination(item) {
  const rawDestination = item?.action_url || item?.action_path || "/dashboard/matches";
  const destination = new URL(rawDestination, window.location.origin);
  const matchId = item?.related_match_id || item?.match_id;

  if ((destination.pathname === "/dashboard/matches" || destination.pathname.endsWith("/dashboard/matches")) && matchId && !destination.searchParams.get("matchId")) {
    destination.searchParams.set("matchId", matchId);
  }

  destination.searchParams.set("open", String(Date.now()));

  return `${destination.pathname}${destination.search}${destination.hash}`;
}

function MatchActionArea({
  match,
  currentUserId,
  activeActionKey,
  disputeNotes,
  resultDrafts,
  onDisputeNoteChange,
  onResultDraftChange,
  onProofFileChange,
  onMatchAction,
}) {
  const resultDraft = resultDrafts[match.id] || initialResultDraft;
  const isMatchBusy = activeActionKey.startsWith(`${match.id}:`);
  const isMatchRequested = match.status === "match_requested";
  const isPendingResult = match.status === "pending_result";
  const isPendingConfirmation = match.status === "pending_confirmation";
  const isRequestedToUser = currentUserId && match.requested_to === currentUserId;
  const isCreatedByUser = currentUserId && match.created_by === currentUserId;
  const isAwaitingConfirmationForCurrentUser =
    isPendingConfirmation && match.result_submitted_by && match.result_submitted_by !== currentUserId;

  if (isMatchRequested && isRequestedToUser) {
    return (
      <div className="match-action-row">
        <button
          className="match-action-button match-action-confirm"
          type="button"
          disabled={isMatchBusy}
          onClick={() => onMatchAction(match, "accept")}
        >
          <ButtonLoadingText
            isLoading={activeActionKey === `${match.id}:accept`}
            loadingText="Accepting..."
          >
            Accept Match
          </ButtonLoadingText>
        </button>
        <button
          className="match-action-button match-action-dispute"
          type="button"
          disabled={isMatchBusy}
          onClick={() => onMatchAction(match, "decline")}
        >
          <ButtonLoadingText
            isLoading={activeActionKey === `${match.id}:decline`}
            loadingText="Declining..."
          >
            Decline Match
          </ButtonLoadingText>
        </button>
      </div>
    );
  }

  if (isMatchRequested && isCreatedByUser) {
    return <p className="match-card-timestamp">Waiting for opponent acceptance.</p>;
  }

  if (isMatchRequested) {
    return <p className="match-card-timestamp">Match Request</p>;
  }

  if (isPendingResult) {
    return (
      <div className="match-action-stack">
        <div className="match-score-grid">
          <label className="form-field">
            Your score
            <input
              type="number"
              min="0"
              step="1"
              value={resultDraft.player_score}
              onChange={(event) => onResultDraftChange(match.id, "player_score", event.target.value)}
              disabled={isMatchBusy}
              placeholder="0"
            />
          </label>
          <label className="form-field">
            Opponent score
            <input
              type="number"
              min="0"
              step="1"
              value={resultDraft.opponent_score}
              onChange={(event) => onResultDraftChange(match.id, "opponent_score", event.target.value)}
              disabled={isMatchBusy}
              placeholder="0"
            />
          </label>
        </div>

        <label className="form-field">
          Proof image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={isMatchBusy}
            onChange={(event) => onProofFileChange(match.id, event.target.files?.[0] || null)}
          />
        </label>

        <div className="match-action-row">
          <button
            className="match-action-button match-action-confirm"
            type="button"
            disabled={isMatchBusy}
            onClick={() => onMatchAction(match, "submit-result")}
          >
            <ButtonLoadingText
              isLoading={activeActionKey === `${match.id}:submit-result`}
              loadingText="Submitting..."
            >
              Submit Result
            </ButtonLoadingText>
          </button>
        </div>
      </div>
    );
  }

  if (isAwaitingConfirmationForCurrentUser) {
    return (
      <div className="match-action-stack">
        <label className="match-dispute-field">
          <span className="match-score-label">Dispute note</span>
          <textarea
            rows="3"
            placeholder="Explain what looks wrong about this submitted result."
            value={disputeNotes[match.id] || ""}
            onChange={(event) => onDisputeNoteChange(match.id, event.target.value)}
            disabled={isMatchBusy}
          />
        </label>

        <div className="match-action-row">
          <button
            className="match-action-button match-action-confirm"
            type="button"
            disabled={isMatchBusy}
            onClick={() => onMatchAction(match, "confirm")}
          >
            <ButtonLoadingText
              isLoading={activeActionKey === `${match.id}:confirm`}
              loadingText="Confirming..."
            >
              Confirm
            </ButtonLoadingText>
          </button>
          <button
            className="match-action-button match-action-dispute"
            type="button"
            disabled={isMatchBusy}
            onClick={() => onMatchAction(match, "dispute")}
          >
            <ButtonLoadingText
              isLoading={activeActionKey === `${match.id}:dispute`}
              loadingText="Submitting..."
            >
              Dispute
            </ButtonLoadingText>
          </button>
        </div>
      </div>
    );
  }

  if (isPendingConfirmation) {
    return <p className="match-card-timestamp">Result awaiting confirmation.</p>;
  }

  if (match.can_cancel) {
    return (
      <div className="match-action-row">
        <button
          className="match-action-button match-action-dispute"
          type="button"
          disabled={isMatchBusy}
          onClick={() => onMatchAction(match, "cancel")}
        >
          <ButtonLoadingText
            isLoading={activeActionKey === `${match.id}:cancel`}
            loadingText="Cancelling..."
          >
            Cancel
          </ButtonLoadingText>
        </button>
      </div>
    );
  }

  return <p className="match-card-timestamp">{buildTimelineLabel(match)}</p>;
}

function normalizeMatchesByStatus(data) {
  return {
    requested: Array.isArray(data?.requested) ? data.requested : [],
    waiting_for_result: Array.isArray(data?.waiting_for_result) ? data.waiting_for_result : [],
    awaiting_confirmation: Array.isArray(data?.awaiting_confirmation) ? data.awaiting_confirmation : [],
    confirmed: Array.isArray(data?.confirmed) ? data.confirmed : [],
    disputed: Array.isArray(data?.disputed) ? data.disputed : [],
    closed: Array.isArray(data?.closed) ? data.closed : [],
  };
}

function formatDate(value) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatActionType(type) {
  if (type === "match_request") {
    return "Match request";
  }

  if (type === "result_awaiting_confirmation") {
    return "Pending confirmation";
  }

  if (type === "dispute_status") {
    return "Dispute";
  }

  return String(type || "action").replace(/_/g, " ");
}

function getStatusTone(status) {
  if (status === "confirmed") {
    return "match-status-confirmed";
  }
  if (status === "disputed") {
    return "match-status-disputed";
  }
  if (["cancelled", "rejected", "expired"].includes(status)) {
    return "match-status-rejected";
  }
  return "match-status-pending";
}

function buildTimelineLabel(match) {
  if (match.confirmed_at) {
    return `Confirmed ${formatDate(match.confirmed_at)}`;
  }
  if (match.disputed_at) {
    return `Disputed ${formatDate(match.disputed_at)}`;
  }
  if (match.reviewed_at) {
    return `Reviewed ${formatDate(match.reviewed_at)}`;
  }
  if (match.declined_at) {
    return `Declined ${formatDate(match.declined_at)}`;
  }
  if (match.cancelled_at) {
    return `Cancelled ${formatDate(match.cancelled_at)}`;
  }
  if (match.accepted_at) {
    return `Accepted ${formatDate(match.accepted_at)}`;
  }
  if (match.expired_at) {
    return `Expired ${formatDate(match.expired_at)}`;
  }
  if (match.result_submitted_at) {
    return `Result submitted ${formatDate(match.result_submitted_at)}`;
  }
  return `Created ${formatDate(match.created_at)}`;
}

function buildNextStepLabel(match) {
  if (match.status === "match_requested") {
    if (match.current_user_role === "player_one") {
      return "Waiting for opponent acceptance";
    }
    return "Accept or decline";
  }
  if (match.status === "pending_result") {
    return "Accepted - waiting for result";
  }
  if (match.status === "pending_confirmation") {
    return "Result awaiting confirmation";
  }
  if (match.status === "confirmed") {
    return "Complete";
  }
  if (["cancelled", "rejected", "expired"].includes(match.status)) {
    return "Closed";
  }
  if (match.status === "disputed") {
    return "Waiting for admin";
  }
  return "No action required";
}

function buildSelectedMatchSummary(match) {
  if (match.status === "match_requested" && match.current_user_role === "player_two") {
    return "This request is waiting for the opponent to accept or decline it.";
  }
  if (match.status === "match_requested" && match.current_user_role === "player_one") {
    return "This request was sent successfully and is waiting for your opponent to accept.";
  }
  if (match.status === "pending_result") {
    return "This accepted match is ready for result submission.";
  }
  if (match.status === "pending_confirmation") {
    return "A submitted result is waiting for your review.";
  }
  if (match.status === "disputed") {
    return "This match is waiting for admin review.";
  }
  if (["cancelled", "rejected", "expired"].includes(match.status)) {
    return "This match has already been closed.";
  }
  return "This match does not currently require action.";
}
