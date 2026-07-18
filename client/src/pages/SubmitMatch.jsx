import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import ErrorState from "../components/ErrorState";
import MatchCard from "../components/MatchCard";
import { OpponentSearchSkeleton, MatchListSkeleton } from "../components/MatchSkeletons";
import ProfileAvatar from "../components/ProfileAvatar";
import SidebarIcon from "../components/SidebarIcon";
import SuccessAlert from "../components/SuccessAlert";
import TrophyWatermark from "../components/TrophyWatermark";
import { Button, Card, EmptyState, Field, PageSection, Select } from "../components/ui";
import DashboardLayout from "../layouts/DashboardLayout";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../context/LoadingContext";
import {
  getMyMatches,
  getPlayers,
  getPublicPlayerProfile,
  scheduleMatch,
  submitMatchResult,
  uploadMatchProof,
} from "../services/api";
import {
  getMatchErrorMessage,
  validateMatchScores,
  validateProofFile,
} from "./matchPresentation";

const SEARCH_DELAY_MS = 300;
const EMPTY_RESULT = { match_id: "", player_score: "", opponent_score: "" };

export default function SubmitMatch() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { trackLoading } = useLoading();
  const requestedOpponentId = searchParams.get("opponentId") || "";
  const opponentRequestRef = useRef(0);
  const [opponentSearch, setOpponentSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [opponents, setOpponents] = useState([]);
  const [selectedOpponent, setSelectedOpponent] = useState(null);
  const [isLoadingOpponents, setIsLoadingOpponents] = useState(true);
  const [opponentError, setOpponentError] = useState("");
  const [waitingMatches, setWaitingMatches] = useState([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(true);
  const [resultValues, setResultValues] = useState(EMPTY_RESULT);
  const [proofFile, setProofFile] = useState(null);
  const [proofError, setProofError] = useState("");
  const [proofPreviewUrl, setProofPreviewUrl] = useState("");
  const [uploadState, setUploadState] = useState("");
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [isScheduling, setIsScheduling] = useState(false);
  const [isSubmittingResult, setIsSubmittingResult] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setDebouncedSearch(opponentSearch.trim().replace(/\s+/g, " ")),
      SEARCH_DELAY_MS
    );
    return () => window.clearTimeout(timeoutId);
  }, [opponentSearch]);

  useEffect(() => {
    loadOpponents();
  }, [debouncedSearch, user?.id]);

  useEffect(() => {
    loadWaitingMatches();
  }, []);

  useEffect(() => {
    if (!requestedOpponentId || selectedOpponent?.id === requestedOpponentId) {
      return;
    }
    const existing = opponents.find((player) => player.id === requestedOpponentId);
    if (existing) {
      setSelectedOpponent(existing);
      return;
    }
    getPublicPlayerProfile(requestedOpponentId)
      .then((response) => {
        if (response?.data?.id && response.data.id !== user?.id) {
          setSelectedOpponent(response.data);
        }
      })
      .catch(() => {
        setOpponentError("The requested opponent is not available.");
      });
  }, [opponents, requestedOpponentId, selectedOpponent?.id, user?.id]);

  useEffect(() => {
    if (!proofFile) {
      setProofPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(proofFile);
    setProofPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [proofFile]);

  async function loadOpponents({ forceRefresh = false } = {}) {
    const requestId = ++opponentRequestRef.current;
    setIsLoadingOpponents(true);
    setOpponentError("");
    try {
      const response = await trackLoading(() =>
        getPlayers({
          page: 1,
          limit: 20,
          search: debouncedSearch,
          forceRefresh,
        })
      );
      if (requestId !== opponentRequestRef.current) {
        return;
      }
      const players = Array.isArray(response?.data?.players)
        ? response.data.players.filter((player) => player.id !== user?.id)
        : [];
      setOpponents(players);
    } catch (error) {
      if (requestId === opponentRequestRef.current) {
        setOpponents([]);
        setOpponentError(getMatchErrorMessage(error, "Opponents could not be loaded."));
      }
    } finally {
      if (requestId === opponentRequestRef.current) {
        setIsLoadingOpponents(false);
      }
    }
  }

  async function loadWaitingMatches({ forceRefresh = false } = {}) {
    setIsLoadingMatches(true);
    try {
      const response = await trackLoading(() =>
        getMyMatches({ page: 1, limit: 20, view: "active", forceRefresh })
      );
      const nextMatches = Array.isArray(response?.data?.matches)
        ? response.data.matches
        : [];
      setWaitingMatches(nextMatches);
      setResultValues((current) => ({
        ...current,
        match_id: nextMatches.some((match) => match.id === current.match_id)
          ? current.match_id
          : nextMatches[0]?.id || "",
      }));
    } catch (error) {
      setWaitingMatches([]);
      setFeedback({
        type: "error",
        message: getMatchErrorMessage(error, "Accepted matches could not be loaded."),
      });
    } finally {
      setIsLoadingMatches(false);
    }
  }

  async function handleChallengeSubmit(event) {
    event.preventDefault();
    if (!selectedOpponent?.id || isScheduling) {
      return;
    }
    setIsScheduling(true);
    setFeedback({ type: "", message: "" });
    try {
      const response = await trackLoading(() =>
        scheduleMatch({ opponent_id: selectedOpponent.id })
      );
      setFeedback({ type: "success", message: response.message });
      setSelectedOpponent(null);
      setOpponentSearch("");
    } catch (error) {
      setFeedback({
        type: "error",
        message: getMatchErrorMessage(error, "The challenge could not be created."),
      });
    } finally {
      setIsScheduling(false);
    }
  }

  function handleProofChange(file) {
    const error = validateProofFile(file);
    setProofError(error);
    setProofFile(error ? null : file || null);
    setUploadState("");
  }

  async function handleResultSubmit(event) {
    event.preventDefault();
    if (isSubmittingResult) {
      return;
    }
    const scoreError = validateMatchScores(
      resultValues.player_score,
      resultValues.opponent_score
    );
    if (scoreError) {
      setFeedback({ type: "error", message: scoreError });
      return;
    }
    const fileError = validateProofFile(proofFile);
    if (fileError) {
      setProofError(fileError);
      return;
    }
    const selectedMatch = waitingMatches.find(
      (match) => match.id === resultValues.match_id
    );
    if (!selectedMatch) {
      setFeedback({ type: "error", message: "Select an accepted match." });
      return;
    }

    setIsSubmittingResult(true);
    setFeedback({ type: "", message: "" });
    try {
      let proofImageUrl = null;
      if (proofFile) {
        setUploadState("Uploading proof…");
        const upload = await trackLoading(() => uploadMatchProof(proofFile));
        proofImageUrl = upload?.data?.proof_image_url || null;
        setUploadState("Proof uploaded");
      }
      const isPlayerOne = selectedMatch.current_user_role === "player_one";
      const playerScore = Number(resultValues.player_score);
      const opponentScore = Number(resultValues.opponent_score);
      const response = await trackLoading(() =>
        submitMatchResult(selectedMatch.id, {
          player_one_score: isPlayerOne ? playerScore : opponentScore,
          player_two_score: isPlayerOne ? opponentScore : playerScore,
          proof_image_url: proofImageUrl,
        })
      );
      setFeedback({ type: "success", message: response.message });
      setResultValues(EMPTY_RESULT);
      setProofFile(null);
      setProofError("");
      setUploadState("");
      await loadWaitingMatches({ forceRefresh: true });
    } catch (error) {
      setFeedback({
        type: "error",
        message: getMatchErrorMessage(error, "The result could not be submitted."),
      });
    } finally {
      setIsSubmittingResult(false);
    }
  }

  const selectedMatch = useMemo(
    () => waitingMatches.find((match) => match.id === resultValues.match_id) || null,
    [resultValues.match_id, waitingMatches]
  );

  return (
    <DashboardLayout title="Challenge Arena" description="Challenge a rival and record the result.">
      <Card as="section" variant="dashboard" className="feature-hero-card match-hero">
        <TrophyWatermark className="arena-hero-watermark" />
        <div>
          <p className="section-label">Match workflow</p>
          <h2 className="feature-hero-title">Challenge, play, and submit clearly.</h2>
          <p className="match-hero-copy">
            A challenge becomes official only after the backend accepts each valid workflow action.
          </p>
        </div>
        <div className="feature-callout">
          <p className="feature-callout-label">Official flow</p>
          <p className="feature-callout-value">Request → acceptance → result → confirmation</p>
        </div>
      </Card>

      <SuccessAlert message={feedback.type === "success" ? feedback.message : ""} />
      <ErrorState
        message={feedback.type === "error" ? feedback.message : ""}
        onRetry={() => loadWaitingMatches({ forceRefresh: true })}
        retryLabel="Refresh match data"
      />

      <PageSection
        title="Challenge a player"
        description="Search eligible player usernames and review the selected opponent before sending."
      >
        <Card variant="information" className="match-form-card match-challenge-card">
          <form className="match-form" onSubmit={handleChallengeSubmit}>
            <Field
              id="opponent-search"
              type="search"
              label="Search eligible opponents"
              value={opponentSearch}
              maxLength={64}
              placeholder="Search by username"
              onChange={(event) => setOpponentSearch(event.target.value)}
              description="Search is debounced and performed by the server."
            />

            {isLoadingOpponents ? (
              <OpponentSearchSkeleton />
            ) : opponentError ? (
              <ErrorState
                message={opponentError}
                onRetry={() => loadOpponents({ forceRefresh: true })}
                retryLabel="Retry opponent search"
              />
            ) : opponents.length ? (
              <div className="opponent-results" role="group" aria-label="Eligible opponents">
                {opponents.map((player) => {
                  const isSelected = selectedOpponent?.id === player.id;
                  const displayName = getOpponentDisplayName(player);
                  const username = getOpponentUsername(player, displayName);
                  return (
                    <button
                      key={player.id}
                      type="button"
                      aria-pressed={isSelected}
                      className={`opponent-option-card${isSelected ? " opponent-option-selected" : ""}`}
                      onClick={() => setSelectedOpponent(player)}
                    >
                      <ProfileAvatar
                        image={player.profile_image}
                        name={displayName}
                        className="match-avatar"
                      />
                      <span className="opponent-option-copy">
                        <span className="opponent-option-name-row">
                          <strong title={displayName}>{displayName}</strong>
                          {isSelected ? (
                            <span className="opponent-selected-check" aria-label="Selected opponent">
                              <SidebarIcon name="check" decorative />
                            </span>
                          ) : null}
                        </span>
                        {username ? <small title={username}>@{username}</small> : null}
                        <OpponentMetadata player={player} />
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <Card variant="empty">
                <EmptyState
                  title="No eligible opponents found"
                  description="Try another username or clear the search."
                />
              </Card>
            )}

            {selectedOpponent ? (
              <Card variant="dashboard" className="selected-opponent-card" aria-live="polite">
                <ProfileAvatar
                  image={selectedOpponent.profile_image}
                  name={getOpponentDisplayName(selectedOpponent)}
                  className="match-avatar match-avatar-selected"
                />
                <div className="selected-opponent-copy">
                  <span>Selected opponent</span>
                  <strong title={getOpponentDisplayName(selectedOpponent)}>
                    {getOpponentDisplayName(selectedOpponent)}
                  </strong>
                  {getOpponentUsername(selectedOpponent, getOpponentDisplayName(selectedOpponent)) ? (
                    <small>@{getOpponentUsername(selectedOpponent, getOpponentDisplayName(selectedOpponent))}</small>
                  ) : null}
                  <OpponentMetadata player={selectedOpponent} />
                </div>
                <span className="selected-opponent-confirmation" aria-label="Opponent selected">
                  <SidebarIcon name="check" decorative />
                </span>
                <Button variant="ghost" size="sm" onClick={() => setSelectedOpponent(null)}>
                  Change
                </Button>
              </Card>
            ) : null}

            <Button
              type="submit"
              disabled={!selectedOpponent}
              isLoading={isScheduling}
              loadingText="Sending challenge…"
            >
              Send match challenge
            </Button>
          </form>
        </Card>
      </PageSection>

      <PageSection
        title="Submit an accepted result"
        description="Scores stay assigned to the named players and are validated again by the backend."
        actions={
          <Button as={Link} to="/dashboard/matches" variant="ghost" size="sm">
            Open match center
          </Button>
        }
      >
        {isLoadingMatches ? (
          <MatchListSkeleton rows={2} label="Loading accepted matches" />
        ) : waitingMatches.length ? (
          <Card variant="information" className="match-form-card">
            <form className="match-form" onSubmit={handleResultSubmit}>
              <Field
                control={Select}
                id="accepted-match"
                label="Accepted match"
                value={resultValues.match_id}
                disabled={isSubmittingResult}
                onChange={(event) =>
                  setResultValues((current) => ({
                    ...current,
                    match_id: event.target.value,
                  }))
                }
              >
                {waitingMatches.map((match) => (
                  <option key={match.id} value={match.id}>
                    {match.player_one_name} vs {match.player_two_name}
                  </option>
                ))}
              </Field>

              {selectedMatch ? (
                <MatchCard match={selectedMatch} currentUserId={user?.id} />
              ) : null}

              <div className="match-score-grid">
                <Field
                  id="result-player-score"
                  type="number"
                  min="0"
                  step="1"
                  required
                  label={`Your score${user?.username ? ` (${user.username})` : ""}`}
                  value={resultValues.player_score}
                  disabled={isSubmittingResult}
                  onChange={(event) =>
                    setResultValues((current) => ({
                      ...current,
                      player_score: event.target.value,
                    }))
                  }
                />
                <Field
                  id="result-opponent-score"
                  type="number"
                  min="0"
                  step="1"
                  required
                  label={`${selectedMatch?.opponent?.username || "Opponent"} score`}
                  value={resultValues.opponent_score}
                  disabled={isSubmittingResult}
                  onChange={(event) =>
                    setResultValues((current) => ({
                      ...current,
                      opponent_score: event.target.value,
                    }))
                  }
                />
              </div>

              <div className="proof-upload-card">
                <label htmlFor="result-proof">Optional proof image</label>
                <input
                  id="result-proof"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={isSubmittingResult}
                  aria-describedby={`result-proof-help${proofError ? " result-proof-error" : ""}`}
                  onChange={(event) => handleProofChange(event.target.files?.[0] || null)}
                />
                <p id="result-proof-help">PNG, JPEG, or WebP. The server enforces its configured size limit.</p>
                {proofError ? <p id="result-proof-error" role="alert">{proofError}</p> : null}
                {proofFile ? (
                  <div className="match-selected-file">
                    <span>{proofFile.name}</span>
                    <Button variant="ghost" size="sm" disabled={isSubmittingResult} onClick={() => handleProofChange(null)}>
                      Remove
                    </Button>
                  </div>
                ) : null}
                {proofPreviewUrl ? (
                  <img
                    className="proof-preview-image"
                    src={proofPreviewUrl}
                    alt={`Selected proof preview: ${proofFile?.name || "image"}`}
                  />
                ) : null}
                {uploadState ? <p role="status">{uploadState}</p> : null}
              </div>

              <Button
                type="submit"
                isLoading={isSubmittingResult}
                loadingText={uploadState || "Submitting result…"}
              >
                Submit result for opponent review
              </Button>
            </form>
          </Card>
        ) : (
          <Card variant="empty">
            <EmptyState
              title="No accepted matches need a result"
              description="Accept a challenge or wait for an opponent to accept your request."
              actionLabel="View my matches"
              onAction={() => navigate("/dashboard/matches")}
            />
          </Card>
        )}
      </PageSection>
    </DashboardLayout>
  );
}

function OpponentMetadata({ player }) {
  const hasRank = player?.rank !== undefined && player?.rank !== null;
  const hasPoints = player?.points !== undefined && player?.points !== null;
  if (!hasRank && !hasPoints) return null;

  return (
    <span className="opponent-option-meta" aria-label="Competitive details">
      {hasRank ? <span>Rank #{player.rank}</span> : null}
      {hasPoints ? <span>{player.points} pts</span> : null}
    </span>
  );
}

function getOpponentDisplayName(player) {
  return String(player?.display_name || player?.name || player?.username || "Player").trim();
}

function getOpponentUsername(player, displayName) {
  const username = String(player?.username || "").trim().replace(/^@/, "");
  return username && username.toLocaleLowerCase() !== String(displayName).toLocaleLowerCase()
    ? username
    : "";
}
