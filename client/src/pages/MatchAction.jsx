import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import ErrorState from "../components/ErrorState";
import ProtectedProofImage from "../components/ProtectedProofImage";
import SectionLoader from "../components/SectionLoader";
import { Button, Card, Field, Radio, Select, Textarea } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import MatchActionLayout, { ActionTime } from "../layouts/MatchActionLayout";
import {
  acceptMatch,
  confirmMatch,
  declineMatch,
  disputeMatch,
  getMatchDetail,
  submitMatchResult,
  uploadMatchProof,
} from "../services/api";
import { validateMatchScores, validateProofFile } from "./matchPresentation";

const DECLINE_REASONS = [
  ["unavailable", "Unavailable"], ["incorrect_details", "Incorrect details"],
  ["wrong_opponent", "Wrong opponent"], ["duplicate", "Duplicate"],
  ["already_played", "Already played"], ["created_by_mistake", "Created by mistake"],
  ["other", "Other"],
];
const REJECTION_REASONS = [
  ["my_score_wrong", "My score is wrong"], ["opponent_score_wrong", "Opponent's score is wrong"],
  ["wrong_winner", "Wrong winner"], ["match_not_played", "Match was not played"],
  ["duplicate_result", "Duplicate result"], ["wrong_match", "Wrong match"], ["other", "Other"],
];

export default function MatchAction({ mode }) {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [match, setMatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [alreadyPlayed, setAlreadyPlayed] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [decline, setDecline] = useState({ reason: "", note: "" });
  const [scores, setScores] = useState({ mine: "", opponent: "" });
  const [playedAt, setPlayedAt] = useState(toLocalInput(new Date()));
  const [proof, setProof] = useState(null);
  const [proofPreview, setProofPreview] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejection, setRejection] = useState({
    reason: "", explanation: "", mine: "", opponent: "", proof: null,
  });

  useEffect(() => { loadMatch(); }, [matchId]);
  useEffect(() => {
    if (!proof) { setProofPreview(""); return undefined; }
    const url = URL.createObjectURL(proof);
    setProofPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [proof]);

  async function loadMatch() {
    setLoading(true); setError("");
    try {
      const response = await getMatchDetail(matchId, { forceRefresh: true });
      setMatch(response.data);
    } catch (loadError) {
      setError(loadError.message || "This match could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  const orientation = useMemo(() => {
    const isOne = match?.current_user_role === "player_one";
    return {
      isOne,
      mine: isOne ? match?.player_one_name : match?.player_two_name,
      opponent: isOne ? match?.player_two_name : match?.player_one_name,
    };
  }, [match]);

  async function runMutation(operation, completedMessage) {
    if (busy) return null;
    setBusy(true); setError("");
    try {
      const response = await operation();
      setMatch(response.data || response.match || match);
      setSuccess(completedMessage || response.message);
      return response;
    } catch (mutationError) {
      setError(mutationError.message || "This action could not be completed.");
      await loadMatch();
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    const response = await runMutation(() => acceptMatch(matchId), "Match accepted");
    if (response && alreadyPlayed) navigate(`/matches/${matchId}/result/submit`, { replace: true });
  }

  async function declineRequest() {
    if (!decline.reason) { setError("Choose a decline reason."); return; }
    await runMutation(
      () => declineMatch(matchId, decline),
      `${user?.username || "You"} declined the match request`
    );
  }

  function reviewResult(event) {
    event.preventDefault();
    const scoreError = validateMatchScores(scores.mine, scores.opponent);
    const proofError = validateProofFile(proof);
    if (scoreError || proofError) { setError(scoreError || proofError); return; }
    setError(""); setReviewing(true);
  }

  async function submitResult() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      let proofUrl = null;
      if (proof) {
        const upload = await uploadMatchProof(proof);
        proofUrl = upload?.data?.proof_image_url || null;
      }
      const mine = Number(scores.mine);
      const opponent = Number(scores.opponent);
      const response = await submitMatchResult(matchId, {
        player_one_score: orientation.isOne ? mine : opponent,
        player_two_score: orientation.isOne ? opponent : mine,
        played_at: new Date(playedAt).toISOString(),
        proof_image_url: proofUrl,
      });
      setMatch(response.data || response.match || match);
      setSuccess(`Result submitted. Awaiting ${orientation.opponent}'s confirmation`);
    } catch (submitError) {
      setError(submitError.message || "The result could not be submitted.");
      await loadMatch();
    } finally {
      setBusy(false);
    }
  }

  async function rejectResult() {
    if (!rejection.reason || !rejection.explanation.trim()) {
      setError("Choose a rejection reason and explain what is incorrect.");
      return;
    }
    const proofError = validateProofFile(rejection.proof);
    if (proofError) { setError(proofError); return; }
    const proposed = rejection.mine !== "" || rejection.opponent !== "";
    if (proposed) {
      const scoreError = validateMatchScores(rejection.mine, rejection.opponent);
      if (scoreError) { setError(scoreError); return; }
    }
    if (busy) return;
    setBusy(true); setError("");
    try {
      let proofUrl = null;
      if (rejection.proof) {
        const upload = await uploadMatchProof(rejection.proof);
        proofUrl = upload?.data?.proof_image_url || null;
      }
      const response = await disputeMatch(matchId, {
        rejection_reason: rejection.reason,
        explanation: rejection.explanation,
        dispute_note: rejection.explanation,
        proposed_player_one_score: proposed ? (orientation.isOne ? Number(rejection.mine) : Number(rejection.opponent)) : null,
        proposed_player_two_score: proposed ? (orientation.isOne ? Number(rejection.opponent) : Number(rejection.mine)) : null,
        proof_image_url: proofUrl,
      });
      setMatch(response.data || response.match || match);
      setSuccess("Result rejected and sent for review");
    } catch (rejectError) {
      setError(rejectError.message || "The result could not be rejected.");
      await loadMatch();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <MatchActionLayout title="Loading match" instruction="Checking the latest authoritative match state." fullMatch={false}><SectionLoader lines={6} message="Loading match action..." /></MatchActionLayout>;
  if (!match) return <MatchActionLayout title="Match unavailable" instruction="The requested match could not be opened." fullMatch={false}><ErrorState message={error} onRetry={loadMatch} retryLabel="Retry match" /></MatchActionLayout>;

  const title = {
    sent: "Match request sent",
    respond: "Respond to match request",
    submit: reviewing ? "Review result" : "Enter match result",
    confirm: confirming ? "Confirm this result?" : rejecting ? "Reject result" : "Confirm result",
  }[mode];

  let content;
  let actions;
  if (success) {
    content = <Completion message={success} match={match} />;
    actions = <><Button as={Link} to={`/dashboard/matches?matchId=${matchId}`} variant="primary">Open match</Button><Button as={Link} to="/dashboard/matches" variant="secondary">Return to matches</Button></>;
  } else if (mode === "sent") {
    content = <Card variant="dashboard" className="match-action-decision"><h2>{match.status_message}</h2><p>The opponent must respond before a result can be entered.</p></Card>;
    actions = <Button as={Link} to="/dashboard/matches" variant="primary">Return to matches</Button>;
  } else if (mode === "respond") {
    const stale = !match.can_accept;
    content = stale ? <StaleState match={match} /> : declining ? (
      <DeclineForm value={decline} onChange={setDecline} />
    ) : <Card variant="dashboard" className="match-action-decision"><h2>Has this match already been played?</h2><Radio name="played" label="No, it is upcoming" checked={!alreadyPlayed} onChange={() => setAlreadyPlayed(false)} /><Radio name="played" label="Yes, we already played" checked={alreadyPlayed} onChange={() => setAlreadyPlayed(true)} /></Card>;
    actions = stale ? <Button as={Link} to="/dashboard/matches" variant="primary">Return to matches</Button> : declining ? <><Button variant="ghost" disabled={busy} onClick={() => setDeclining(false)}>Back</Button><Button variant="danger" isLoading={busy} loadingText="Declining…" onClick={declineRequest}>Decline match</Button></> : <><Button variant="ghost" disabled={busy} onClick={() => setDeclining(true)}>Decline</Button><Button variant="primary" isLoading={busy} loadingText="Accepting…" onClick={accept}>{alreadyPlayed ? "Accept and Enter Result" : "Accept Match"}</Button></>;
  } else if (mode === "submit") {
    const stale = !match.can_submit_result;
    content = stale ? <StaleState match={match} /> : reviewing ? <ResultReview match={match} scores={scores} orientation={orientation} playedAt={playedAt} proofPreview={proofPreview} /> : <ResultForm scores={scores} setScores={setScores} playedAt={playedAt} setPlayedAt={setPlayedAt} proof={proof} setProof={setProof} proofPreview={proofPreview} onSubmit={reviewResult} orientation={orientation} busy={busy} />;
    actions = stale ? <Button as={Link} to="/dashboard/matches" variant="primary">Return to matches</Button> : reviewing ? <><Button variant="ghost" disabled={busy} onClick={() => setReviewing(false)}>Edit Result</Button><Button variant="primary" isLoading={busy} loadingText="Submitting…" onClick={submitResult}>Submit Result</Button></> : <Button type="submit" form="focused-result-form" variant="primary">Review Result</Button>;
  } else {
    const stale = !match.can_confirm;
    content = stale ? <StaleState match={match} /> : rejecting ? <RejectionForm value={rejection} onChange={setRejection} orientation={orientation} /> : <ConfirmationView match={match} confirming={confirming} />;
    actions = stale ? <Button as={Link} to="/dashboard/matches" variant="primary">Return to matches</Button> : rejecting ? <><Button variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>Back</Button><Button variant="danger" isLoading={busy} loadingText="Rejecting…" onClick={rejectResult}>Reject Result</Button></> : confirming ? <><Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>Back</Button><Button variant="success" isLoading={busy} loadingText="Confirming…" onClick={() => runMutation(() => confirmMatch(matchId), "Result confirmed. Statistics updated")}>Confirm Result</Button></> : <><Button variant="danger" disabled={busy} onClick={() => setRejecting(true)}>Reject Result</Button><Button variant="success" disabled={busy} onClick={() => setConfirming(true)}>Confirm Result</Button></>;
  }

  return <MatchActionLayout title={title} instruction={instructionFor(mode, reviewing, confirming)} match={match} actions={actions}><ErrorState message={error} onRetry={loadMatch} retryLabel="Refresh match" />{content}</MatchActionLayout>;
}

function ResultForm({ scores, setScores, playedAt, setPlayedAt, proof, setProof, proofPreview, onSubmit, orientation, busy }) {
  return <Card variant="dashboard"><form id="focused-result-form" className="match-action-form" onSubmit={onSubmit}><div className="match-action-score-inputs"><Field label={`${orientation.mine} score`} type="number" inputMode="numeric" min="0" step="1" required value={scores.mine} disabled={busy} onChange={(e) => setScores({ ...scores, mine: e.target.value })} /><Field label={`${orientation.opponent} score`} type="number" inputMode="numeric" min="0" step="1" required value={scores.opponent} disabled={busy} onChange={(e) => setScores({ ...scores, opponent: e.target.value })} /></div><Field label="Played date and time" type="datetime-local" required value={playedAt} onChange={(e) => setPlayedAt(e.target.value)} /><Field label="Optional evidence" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setProof(e.target.files?.[0] || null)} />{proof ? <p>{proof.name}</p> : null}{proofPreview ? <img className="match-action-evidence-preview" src={proofPreview} alt="Evidence preview" /> : null}</form></Card>;
}

function ResultReview({ match, scores, orientation, playedAt, proofPreview }) {
  const mine = Number(scores.mine), opponent = Number(scores.opponent);
  const outcome = mine === opponent ? "Draw" : `${mine > opponent ? orientation.mine : orientation.opponent} wins`;
  return <Card variant="dashboard" className="match-action-result"><p className="panel-kicker">Exact submitted score</p><div className="match-action-score" aria-label={`${orientation.mine} ${mine}, ${orientation.opponent} ${opponent}`}>{orientation.mine} <strong>{mine}–{opponent}</strong> {orientation.opponent}</div><h2>{outcome}</h2><p>Played <ActionTime value={new Date(playedAt).toISOString()} /></p><p>Awaiting {orientation.opponent}'s confirmation after submission.</p>{proofPreview ? <img className="match-action-evidence-preview" src={proofPreview} alt="Evidence preview" /> : null}</Card>;
}

function ConfirmationView({ match, confirming }) {
  const score = `${match.player_one_score}–${match.player_two_score}`;
  const winner = match.player_one_score === match.player_two_score ? "Draw" : `${match.winner_id === match.player_one_id ? match.player_one_name : match.player_two_name} wins`;
  return <Card variant="dashboard" className="match-action-result"><p className="panel-kicker">{confirming ? "Confirm this result?" : "Is this result correct?"}</p><div className="match-action-score" aria-label={`${match.player_one_name} ${match.player_one_score}, ${match.player_two_name} ${match.player_two_score}`}>{match.player_one_name} <strong>{score}</strong> {match.player_two_name}</div><h2>{winner}</h2><dl><div><dt>Played</dt><dd><ActionTime value={match.played_at} /></dd></div><div><dt>Submitted</dt><dd><ActionTime value={match.result_submitted_at} /></dd></div><div><dt>Submitted by</dt><dd>{submitterName(match)}</dd></div></dl>{match.proof_image_url ? <ProtectedProofImage path={match.proof_image_url} alt="Submitted result evidence" /> : <p>No evidence attached.</p>}{confirming ? <p className="match-action-warning">Once confirmed, this result may affect rankings and statistics.</p> : null}</Card>;
}

function DeclineForm({ value, onChange }) {
  return <Card variant="dashboard" className="match-action-form"><Field control={Select} label="Reason" required value={value.reason} onChange={(e) => onChange({ ...value, reason: e.target.value })}><option value="">Choose a reason</option>{DECLINE_REASONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Field><Field control={Textarea} label="Optional note" rows="4" maxLength="500" value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} /></Card>;
}

function RejectionForm({ value, onChange, orientation }) {
  return <Card variant="dashboard" className="match-action-form"><Field control={Select} label="What is incorrect?" required value={value.reason} onChange={(e) => onChange({ ...value, reason: e.target.value })}><option value="">Choose a reason</option>{REJECTION_REASONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</Field><Field control={Textarea} label="Explanation" required rows="4" maxLength="500" value={value.explanation} onChange={(e) => onChange({ ...value, explanation: e.target.value })} /><p className="panel-kicker">Optional proposed score</p><div className="match-action-score-inputs"><Field label={orientation.mine} type="number" min="0" step="1" value={value.mine} onChange={(e) => onChange({ ...value, mine: e.target.value })} /><Field label={orientation.opponent} type="number" min="0" step="1" value={value.opponent} onChange={(e) => onChange({ ...value, opponent: e.target.value })} /></div><Field label="Optional evidence" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onChange({ ...value, proof: e.target.files?.[0] || null })} />{value.proof ? <p>{value.proof.name}</p> : null}</Card>;
}

function Completion({ message, match }) { return <Card variant="dashboard" className="match-action-complete" role="status"><span aria-hidden="true">✓</span><h2>{message}</h2><p>{match.status_message}</p></Card>; }
function StaleState({ match }) { return <Card variant="empty" className="match-action-stale"><h2>This action is no longer available</h2><p>{match.status_message || "The match changed after this page was opened."}</p></Card>; }
function submitterName(match) { return match.result_submitted_by === match.player_one_id ? match.player_one_name : match.player_two_name; }
function instructionFor(mode, reviewing, confirming) { if (mode === "sent") return "Your request has been delivered."; if (mode === "respond") return "Review the request and make one decision."; if (mode === "submit") return reviewing ? "Check every detail before sending it to your opponent." : "Enter the final score and optional evidence."; return confirming ? "Review the exact score once more before final confirmation." : "Review the submitted result before accepting or rejecting it."; }
function toLocalInput(date) { const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }
