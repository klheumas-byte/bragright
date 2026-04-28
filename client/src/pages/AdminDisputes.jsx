import { useEffect, useMemo, useState } from "react";
import ButtonLoadingText from "../components/ButtonLoadingText";
import ErrorState from "../components/ErrorState";
import SectionLoader from "../components/SectionLoader";
import SuccessAlert from "../components/SuccessAlert";
import { useLoading } from "../context/LoadingContext";
import DashboardLayout from "../layouts/DashboardLayout";
import { getAdminDispute, getAdminMatches, resolveAdminDispute } from "../services/api";

const resolutionActionOptions = [
  {
    value: "confirm_result",
    label: "Confirm result",
    helper: "Approve the submitted result and close the dispute.",
  },
  {
    value: "reject_result",
    label: "Reject result",
    helper: "Cancel the result and close the dispute without awarding the match.",
  },
  {
    value: "override_result",
    label: "Override result",
    helper: "Set the final score and winner as the trusted outcome.",
  },
];

const initialResolutionState = {
  resolutionAction: "confirm_result",
  resolutionNote: "",
  overridePlayerScore: "",
  overrideOpponentScore: "",
  overrideWinnerId: "auto",
};

export default function AdminDisputes() {
  const { trackLoading } = useLoading();
  const [disputes, setDisputes] = useState([]);
  const [statusFilter, setStatusFilter] = useState("disputed");
  const [selectedMatchId, setSelectedMatchId] = useState("");
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [resolutionForm, setResolutionForm] = useState(initialResolutionState);
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [isListLoading, setIsListLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadDisputes();
  }, [statusFilter]);

  useEffect(() => {
    if (!selectedMatchId) {
      setSelectedMatch(null);
      return;
    }

    loadDisputeDetail(selectedMatchId);
  }, [selectedMatchId]);

  const selectedActionConfig = useMemo(
    () =>
      resolutionActionOptions.find((option) => option.value === resolutionForm.resolutionAction) ||
      resolutionActionOptions[0],
    [resolutionForm.resolutionAction]
  );

  const selectedWinnerLabel = getWinnerLabel(selectedMatch);

  async function loadDisputes(preferredMatchId = "") {
    try {
      setIsListLoading(true);
      const response = await trackLoading(() => getAdminMatches({ status: statusFilter }));
      const nextDisputes = Array.isArray(response?.data?.matches)
        ? response.data.matches.map(normalizeAdminDisputeMatch)
        : [];

      setDisputes(nextDisputes);

      if (!nextDisputes.length) {
        setSelectedMatchId("");
        setSelectedMatch(null);
        return;
      }

      const nextSelectedMatchId =
        nextDisputes.find((match) => match.id === preferredMatchId)?.id ||
        nextDisputes.find((match) => match.id === selectedMatchId)?.id ||
        nextDisputes[0].id;

      setSelectedMatchId(nextSelectedMatchId);
    } catch (error) {
      setFeedback({
        type: "error",
        message: error.message,
      });
    } finally {
      setIsListLoading(false);
    }
  }

  async function loadDisputeDetail(matchId) {
    try {
      setIsDetailLoading(true);
      const response = await trackLoading(() => getAdminDispute(matchId));
      const detail = normalizeAdminDisputeMatch(response?.data);

      setSelectedMatch(detail);
      setResolutionForm({
        resolutionAction: "confirm_result",
        resolutionNote: "",
        overridePlayerScore: String(detail.player_score ?? ""),
        overrideOpponentScore: String(detail.opponent_score ?? ""),
        overrideWinnerId: "auto",
      });
    } catch (error) {
      setSelectedMatch(null);
      setFeedback({
        type: "error",
        message: error.message,
      });
    } finally {
      setIsDetailLoading(false);
    }
  }

  function handleResolutionChange(event) {
    const { name, value } = event.target;
    setResolutionForm((currentValues) => ({
      ...currentValues,
      [name]: value,
    }));
  }

  async function handleResolveSubmit(event) {
    event.preventDefault();

    if (!selectedMatch) {
      return;
    }

    const validationMessage = validateResolutionForm(selectedMatch, resolutionForm);
    if (validationMessage) {
      setFeedback({
        type: "error",
        message: validationMessage,
      });
      return;
    }

    try {
      setIsSubmitting(true);
      setFeedback({ type: "", message: "" });

      const payload = {
        resolution_action: resolutionForm.resolutionAction,
        resolution_note: resolutionForm.resolutionNote.trim(),
      };

      if (resolutionForm.resolutionAction === "override_result") {
        payload.override_player_score = Number(resolutionForm.overridePlayerScore);
        payload.override_opponent_score = Number(resolutionForm.overrideOpponentScore);

        if (resolutionForm.overrideWinnerId !== "auto") {
          payload.override_winner_id = resolutionForm.overrideWinnerId;
        }
      }

      const response = await trackLoading(() => resolveAdminDispute(selectedMatch.id, payload));
      const resolvedMatch = normalizeAdminDisputeMatch(response?.data);

      setSelectedMatch(resolvedMatch);
      setFeedback({
        type: "success",
        message: response.message,
      });

      await loadDisputes(selectedMatch.id);
    } catch (error) {
      setFeedback({
        type: "error",
        message: error.message,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <DashboardLayout
      title="Admin Disputes"
      description=""
    >
      <section className="feature-hero-card">
        <div>
          <p className="section-label">Disputes</p>
          <h2 className="feature-hero-title">Review disputed matches.</h2>
        </div>

        <div className="feature-callout">
          <p className="feature-callout-label">Open disputes</p>
          <p className="feature-callout-value">{disputes.length}</p>
        </div>
      </section>

      <SuccessAlert message={feedback.type === "success" ? feedback.message : ""} />
      <ErrorState
        message={feedback.type === "error" ? feedback.message : ""}
        onRetry={() => {
          if (selectedMatchId) {
            loadDisputeDetail(selectedMatchId);
            return loadDisputes(selectedMatchId);
          }

          return loadDisputes();
        }}
      />

      <section className="admin-disputes-layout">
        <div className="dashboard-panel admin-disputes-list-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Review Queue</p>
              <h2 className="panel-title">Disputed matches</h2>
            </div>
            <div className="form-field admin-users-action-field">
              <span>Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="disputed">Disputed</option>
                <option value="confirmed">Confirmed</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>

          {isListLoading ? (
            <SectionLoader as="div" lines={6} message="Loading dispute queue..." />
          ) : disputes.length ? (
            <div className="admin-dispute-list">
              {disputes.map((match) => (
                <button
                  key={match.id}
                  type="button"
                  className={`admin-dispute-list-item${selectedMatchId === match.id ? " admin-dispute-list-item-active" : ""}`}
                  onClick={() => setSelectedMatchId(match.id)}
                >
                  <div className="admin-dispute-list-top">
                    <p className="admin-dispute-list-title">
                      {match.players.submitted_by.username} vs {match.players.opponent.username}
                    </p>
                    <span className={`match-status-badge ${match.status === "confirmed" ? "match-status-confirmed" : match.status === "rejected" ? "match-status-rejected" : "match-status-disputed"}`}>
                      {formatStatusLabel(match.status)}
                    </span>
                  </div>

                  <div className="admin-dispute-list-metrics">
                    <span>Submitted score</span>
                    <strong>
                      {match.player_score} - {match.opponent_score}
                    </strong>
                  </div>

                  <p className="admin-dispute-snippet">{match.dispute_note || "No dispute note was provided."}</p>

                  <div className="admin-dispute-list-footer">
                    <span>{match.proof_image_url ? "Proof attached" : "No proof image"}</span>
                  <span>{formatDate(match.disputed_at || match.reviewed_at || match.confirmed_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="match-empty-state">
              <p className="empty-state-copy">There are no disputed matches waiting for admin review.</p>
            </div>
          )}
        </div>

        <div className="dashboard-panel admin-dispute-detail-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Resolution Workspace</p>
              <h2 className="panel-title">Selected dispute</h2>
            </div>
          </div>

          {isDetailLoading ? (
            <SectionLoader as="div" lines={10} message="Loading dispute details..." />
          ) : selectedMatch ? (
            <div className="admin-dispute-detail">
              <div className="admin-dispute-summary-grid">
                <div className="match-score-line">
                  <span className="match-score-label">Submitted by</span>
                  <strong>{selectedMatch.players.submitted_by.username}</strong>
                </div>
                <div className="match-score-line">
                  <span className="match-score-label">Opponent</span>
                  <strong>{selectedMatch.players.opponent.username}</strong>
                </div>
                <div className="match-score-line">
                  <span className="match-score-label">Submitted score</span>
                  <strong>
                    {selectedMatch.player_score} - {selectedMatch.opponent_score}
                  </strong>
                </div>
                <div className="match-score-line">
                  <span className="match-score-label">Submitted winner</span>
                  <strong>{selectedWinnerLabel}</strong>
                </div>
              </div>

              <div className="admin-detail-grid">
                <div className="match-dispute-note-panel">
                  <p className="match-score-label">Dispute note</p>
                  <p className="match-dispute-note-copy">
                    {selectedMatch.dispute_note || "No dispute note was provided for this challenge."}
                  </p>
                </div>

                <div className="admin-moderation-card">
                  <p className="match-score-label">Case timeline</p>
                  <div className="admin-dispute-metadata">
                    <p className="match-card-meta">Created: {formatDate(selectedMatch.created_at)}</p>
                    <p className="match-card-meta">Disputed: {formatDate(selectedMatch.disputed_at)}</p>
                    <p className="match-card-meta">Status: {formatStatusLabel(selectedMatch.status)}</p>
                    <p className="match-card-meta">
                      Disputed by: {selectedMatch.players.disputed_by.username || selectedMatch.players.opponent.username}
                    </p>
                    <p className="match-card-meta">
                      Current reviewer: {selectedMatch.moderation.reviewed_by_name || "Not reviewed yet"}
                    </p>
                  </div>
                </div>
              </div>

              {selectedMatch.proof_image_url ? (
                <div className="match-proof-panel">
                  <div className="match-proof-copy">
                    <p className="match-score-label">Proof image</p>
                    <p className="match-card-meta">
                      Review the attached image before making the final moderation decision.
                    </p>
                  </div>

                  <a className="match-proof-link" href={selectedMatch.proof_image_url} target="_blank" rel="noreferrer">
                    <img className="match-proof-image" src={selectedMatch.proof_image_url} alt="Match proof" />
                    <span className="inline-action-link">Open proof</span>
                  </a>
                </div>
              ) : (
                <div className="match-empty-state">
                  <p className="empty-state-copy">No proof image was attached to this disputed match.</p>
                </div>
              )}

              <form className="admin-resolution-card" onSubmit={handleResolveSubmit}>
                <div className="admin-resolution-header">
                  <div>
                    <p className="match-score-label">Moderation controls</p>
                    <p className="admin-resolution-copy">{selectedActionConfig.helper}</p>
                  </div>
                  <span className="match-status-badge match-status-disputed">Awaiting admin decision</span>
                </div>

                <label className="form-field">
                  Resolution action
                  <select
                    name="resolutionAction"
                    value={resolutionForm.resolutionAction}
                    onChange={handleResolutionChange}
                    disabled={isSubmitting}
                  >
                    {resolutionActionOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="match-dispute-field">
                  <span className="match-score-label">Admin resolution note</span>
                  <textarea
                    name="resolutionNote"
                    rows="5"
                    value={resolutionForm.resolutionNote}
                    onChange={handleResolutionChange}
                    placeholder="Explain the final decision so players understand why this case was closed the way it was."
                    disabled={isSubmitting}
                  />
                </label>

                {resolutionForm.resolutionAction === "override_result" ? (
                  <div className="admin-override-grid">
                    <label className="form-field">
                      Final submitter score
                      <input
                        type="number"
                        min="0"
                        step="1"
                        name="overridePlayerScore"
                        value={resolutionForm.overridePlayerScore}
                        onChange={handleResolutionChange}
                        disabled={isSubmitting}
                      />
                    </label>

                    <label className="form-field">
                      Final opponent score
                      <input
                        type="number"
                        min="0"
                        step="1"
                        name="overrideOpponentScore"
                        value={resolutionForm.overrideOpponentScore}
                        onChange={handleResolutionChange}
                        disabled={isSubmitting}
                      />
                    </label>

                    <label className="form-field admin-override-winner-field">
                      Final winner
                      <select
                        name="overrideWinnerId"
                        value={resolutionForm.overrideWinnerId}
                        onChange={handleResolutionChange}
                        disabled={isSubmitting}
                      >
                        <option value="auto">Auto from final score</option>
                        <option value={selectedMatch.players.submitted_by.id}>
                          {selectedMatch.players.submitted_by.username}
                        </option>
                        <option value={selectedMatch.players.opponent.id}>{selectedMatch.players.opponent.username}</option>
                      </select>
                    </label>
                  </div>
                ) : null}

                <div className="admin-resolution-actions">
                  <button type="submit" className="auth-button" disabled={isSubmitting}>
                    <ButtonLoadingText
                      isLoading={isSubmitting}
                      loadingText="Saving..."
                    >
                      {`Submit ${selectedActionConfig.label.toLowerCase()}`}
                    </ButtonLoadingText>
                  </button>

                  <button
                    type="button"
                    className="inline-action-button"
                    disabled={isSubmitting}
                    onClick={() => loadDisputeDetail(selectedMatch.id)}
                  >
                    Reset form
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="match-empty-state">
              <p className="empty-state-copy">Select a disputed match to inspect the note, timestamps, proof, and moderation controls.</p>
            </div>
          )}
        </div>
      </section>
    </DashboardLayout>
  );
}

function validateResolutionForm(selectedMatch, resolutionForm) {
  if (!resolutionForm.resolutionAction) {
    return "Choose a resolution action before submitting the final decision.";
  }

  if (!resolutionForm.resolutionNote.trim()) {
    return "Add an admin resolution note so the final decision is documented clearly.";
  }

  if (resolutionForm.resolutionAction !== "override_result") {
    return "";
  }

  const overridePlayerScore = Number(resolutionForm.overridePlayerScore);
  const overrideOpponentScore = Number(resolutionForm.overrideOpponentScore);

  if (!Number.isInteger(overridePlayerScore) || !Number.isInteger(overrideOpponentScore)) {
    return "Override scores must be whole numbers.";
  }

  if (overridePlayerScore < 0 || overrideOpponentScore < 0) {
    return "Override scores cannot be negative.";
  }

  if (
    resolutionForm.overrideWinnerId !== "auto" &&
    ![
      selectedMatch.players.submitted_by.id,
      selectedMatch.players.opponent.id,
    ].includes(resolutionForm.overrideWinnerId)
  ) {
    return "Choose a valid player as the final winner.";
  }

  return "";
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

function formatStatusLabel(value) {
  if (!value) {
    return "Unknown";
  }

  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getWinnerLabel(match) {
  if (!match?.winner_id) {
    return "Draw or undecided";
  }

  if (match.winner_id === match.players.submitted_by.id) {
    return match.players.submitted_by.username;
  }

  if (match.winner_id === match.players.opponent.id) {
    return match.players.opponent.username;
  }

  return "Unknown player";
}

function normalizeAdminDisputeMatch(match) {
  return {
    id: match?.id || "",
    status: match?.status || "disputed",
    winner_id: match?.winner_id || null,
    submitted_by: match?.submitted_by || match?.players?.submitted_by?.id || "",
    opponent_id: match?.opponent_id || match?.players?.opponent?.id || "",
    disputed_by: match?.disputed_by || match?.players?.disputed_by?.id || "",
    reviewed_by: match?.reviewed_by || match?.players?.reviewed_by?.id || "",
    player_score: match?.player_score ?? 0,
    opponent_score: match?.opponent_score ?? 0,
    proof_image_url: match?.proof_image_url || "",
    dispute_note: match?.dispute_note || "",
    created_at: match?.created_at || match?.timestamps?.created_at || null,
    confirmed_at: match?.confirmed_at || match?.timestamps?.confirmed_at || null,
    disputed_at: match?.disputed_at || match?.timestamps?.disputed_at || null,
    reviewed_at: match?.reviewed_at || match?.timestamps?.reviewed_at || null,
    resolution_action: match?.resolution_action || null,
    resolution_note: match?.resolution_note || "",
    action_required_by: match?.action_required_by || null,
    players: {
      submitted_by: {
        id: match?.players?.submitted_by?.id || "",
        username: match?.players?.submitted_by?.username || "Unknown player",
      },
      opponent: {
        id: match?.players?.opponent?.id || "",
        username: match?.players?.opponent?.username || "Unknown opponent",
      },
      disputed_by: {
        id: match?.players?.disputed_by?.id || "",
        username: match?.players?.disputed_by?.username || "",
      },
      reviewed_by: {
        id: match?.players?.reviewed_by?.id || "",
        username: match?.players?.reviewed_by?.username || "",
      },
    },
    moderation: {
      reviewed_by: match?.moderation?.reviewed_by || match?.players?.reviewed_by?.id || "",
      reviewed_by_name: match?.moderation?.reviewed_by_name || match?.players?.reviewed_by?.username || "",
      reviewed_at: match?.moderation?.reviewed_at || match?.timestamps?.reviewed_at || null,
      resolution_action: match?.moderation?.resolution_action || match?.resolution_action || null,
      resolution_note: match?.moderation?.resolution_note || match?.resolution_note || "",
    },
  };
}
