import { useEffect, useMemo, useState } from "react";
import ButtonLoadingText from "../components/ButtonLoadingText";
import ErrorState from "../components/ErrorState";
import SectionLoader from "../components/SectionLoader";
import SuccessAlert from "../components/SuccessAlert";
import DashboardLayout from "../layouts/DashboardLayout";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../context/LoadingContext";
import { usePlayerDirectory } from "../context/PlayerDirectoryContext";
import {
  getMyMatches,
  scheduleMatch,
  submitMatchResult,
  uploadMatchProof,
} from "../services/api";

const initialScheduleState = {
  opponent_id: "",
};

const initialResultState = {
  match_id: "",
  player_score: "",
  opponent_score: "",
};

export default function SubmitMatch() {
  const { user } = useAuth();
  const { trackLoading } = useLoading();
  const { players, isLoadingPlayers, playersError } = usePlayerDirectory();
  const [scheduleValues, setScheduleValues] = useState(initialScheduleState);
  const [resultValues, setResultValues] = useState(initialResultState);
  const [proofFile, setProofFile] = useState(null);
  const [proofPreviewUrl, setProofPreviewUrl] = useState("");
  const [waitingForResultMatches, setWaitingForResultMatches] = useState([]);
  const [isLoadingMatches, setIsLoadingMatches] = useState(true);
  const [feedback, setFeedback] = useState({ type: "", message: "" });
  const [isScheduling, setIsScheduling] = useState(false);
  const [isSubmittingResult, setIsSubmittingResult] = useState(false);

  const selectablePlayers = useMemo(
    () => players.filter((player) => player.id !== user?.id),
    [players, user?.id]
  );

  useEffect(() => {
    loadWaitingForResultMatches();
  }, []);

  useEffect(() => {
    if (!proofFile) {
      setProofPreviewUrl("");
      return;
    }

    const nextPreviewUrl = URL.createObjectURL(proofFile);
    setProofPreviewUrl(nextPreviewUrl);

    return () => {
      URL.revokeObjectURL(nextPreviewUrl);
    };
  }, [proofFile]);

  async function loadWaitingForResultMatches() {
    try {
      setIsLoadingMatches(true);
      const response = await trackLoading(() => getMyMatches());
      const matches = Array.isArray(response?.data?.waiting_for_result) ? response.data.waiting_for_result : [];
      setWaitingForResultMatches(matches);
      setResultValues((current) => ({
        ...current,
        match_id: current.match_id || matches[0]?.id || "",
      }));
    } catch (error) {
      setWaitingForResultMatches([]);
      setFeedback({
        type: "error",
        message: error.message,
      });
    } finally {
      setIsLoadingMatches(false);
    }
  }

  function handleScheduleChange(event) {
    const { name, value } = event.target;
    setScheduleValues((currentValues) => ({
      ...currentValues,
      [name]: value,
    }));
  }

  function handleResultChange(event) {
    const { name, value } = event.target;
    setResultValues((currentValues) => ({
      ...currentValues,
      [name]: value,
    }));
  }

  function handleProofChange(event) {
    setProofFile(event.target.files?.[0] || null);
  }

  async function handleScheduleSubmit(event) {
    event.preventDefault();
    setFeedback({ type: "", message: "" });
    setIsScheduling(true);

    try {
      const response = await trackLoading(() =>
        scheduleMatch({
          opponent_id: scheduleValues.opponent_id,
        })
      );

      setFeedback({
        type: "success",
        message: response.message,
      });
      setScheduleValues(initialScheduleState);
      await loadWaitingForResultMatches();
    } catch (error) {
      setFeedback({
        type: "error",
        message: error.message,
      });
    } finally {
      setIsScheduling(false);
    }
  }

  async function handleResultSubmit(event) {
    event.preventDefault();
    setFeedback({ type: "", message: "" });
    setIsSubmittingResult(true);

    try {
      let proofImageUrl = null;

      if (proofFile) {
        const uploadResponse = await trackLoading(() => uploadMatchProof(proofFile));
        proofImageUrl = uploadResponse.data.proof_image_url;
      }

      const selectedMatch = waitingForResultMatches.find((match) => match.id === resultValues.match_id);
      const playerOneScore = Number(resultValues.player_score);
      const playerTwoScore = Number(resultValues.opponent_score);
      const isPlayerOne = selectedMatch?.current_user_role === "player_one";

      const response = await trackLoading(() =>
        submitMatchResult(resultValues.match_id, {
          player_one_score: isPlayerOne ? playerOneScore : playerTwoScore,
          player_two_score: isPlayerOne ? playerTwoScore : playerOneScore,
          proof_image_url: proofImageUrl,
        })
      );

      setFeedback({
        type: "success",
        message: response.message,
      });
      setResultValues(initialResultState);
      setProofFile(null);
      await loadWaitingForResultMatches();
    } catch (error) {
      setFeedback({
        type: "error",
        message: error.message,
      });
    } finally {
      setIsSubmittingResult(false);
    }
  }

  return (
    <DashboardLayout
      title="Submit Match"
      description=""
    >
      <section className="feature-hero-card">
        <div>
          <p className="section-label">Match Flow</p>
          <h2 className="feature-hero-title">Schedule and submit matches.</h2>
        </div>

        <div className="feature-callout">
          <p className="feature-callout-label">Status flow</p>
          <p className="feature-callout-value">Request to result to confirmation</p>
        </div>
      </section>

      <SuccessAlert message={feedback.type === "success" ? feedback.message : ""} />
      <ErrorState message={feedback.type === "error" ? feedback.message : ""} onRetry={loadWaitingForResultMatches} />

      <section className="match-form-card">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Step 1</p>
            <h2 className="panel-title">Schedule match</h2>
          </div>
        </div>

        <form className="match-form" onSubmit={handleScheduleSubmit}>
          <label className="form-field">
            Opponent
            <select
              name="opponent_id"
              value={scheduleValues.opponent_id}
              onChange={handleScheduleChange}
              disabled={isScheduling || isLoadingPlayers}
              required
            >
              <option value="">Select an opponent</option>
              {selectablePlayers.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.username}
                </option>
              ))}
            </select>
          </label>

          {isLoadingPlayers ? <p className="match-helper-text">Loading available players...</p> : null}
          {playersError ? <p className="match-helper-text error-text">{playersError}</p> : null}
          {!isLoadingPlayers && !playersError && !selectablePlayers.length ? (
            <p className="match-helper-text">No other players are available yet.</p>
          ) : null}

          <button className="auth-button match-submit-button" type="submit" disabled={isScheduling || isLoadingPlayers}>
            <ButtonLoadingText isLoading={isScheduling} loadingText="Scheduling...">
              Schedule Match
            </ButtonLoadingText>
          </button>
        </form>
      </section>

      <section className="match-form-card">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Step 2</p>
            <h2 className="panel-title">Submit result</h2>
          </div>
        </div>

        {isLoadingMatches ? (
          <SectionLoader as="div" lines={5} message="Loading accepted matches..." className="" />
        ) : waitingForResultMatches.length ? (
          <form className="match-form" onSubmit={handleResultSubmit}>
            <label className="form-field">
              Match
              <select
                name="match_id"
                value={resultValues.match_id}
                onChange={handleResultChange}
                disabled={isSubmittingResult}
                required
              >
                <option value="">Select a match</option>
                {waitingForResultMatches.map((match) => (
                  <option key={match.id} value={match.id}>
                    {match.player_one_name} vs {match.player_two_name}
                  </option>
                ))}
              </select>
            </label>

            <div className="match-score-grid">
              <label className="form-field">
                Your score
                <input
                  type="number"
                  min="0"
                  step="1"
                  name="player_score"
                  placeholder="0"
                  value={resultValues.player_score}
                  onChange={handleResultChange}
                  required
                />
              </label>

              <label className="form-field">
                Opponent score
                <input
                  type="number"
                  min="0"
                  step="1"
                  name="opponent_score"
                  placeholder="0"
                  value={resultValues.opponent_score}
                  onChange={handleResultChange}
                  required
                />
              </label>
            </div>

            <div className="proof-upload-card">
              <label className="form-field">
                Match proof screenshot
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleProofChange}
                  disabled={isSubmittingResult}
                />
              </label>
              <p className="match-helper-text">Proof is optional.</p>

              {proofPreviewUrl ? (
                <div className="proof-preview-panel">
                  <p className="proof-preview-label">Proof preview</p>
                  <img className="proof-preview-image" src={proofPreviewUrl} alt="Proof preview" />
                </div>
              ) : null}
            </div>

            <button className="auth-button match-submit-button" type="submit" disabled={isSubmittingResult}>
              <ButtonLoadingText isLoading={isSubmittingResult} loadingText="Submitting...">
                Submit Result
              </ButtonLoadingText>
            </button>
          </form>
        ) : (
          <div className="match-empty-state">
            <p className="empty-state-copy">No matches are waiting for a result submission yet.</p>
          </div>
        )}
      </section>
    </DashboardLayout>
  );
}
