import { useEffect, useState } from "react";
import { Alert, EmptyState } from "../components/ui/Feedback";
import Button from "../components/ui/Button";
import { FormField, Input, Select } from "../components/ui/FormControls";
import Modal from "../components/ui/Modal";
import { useAuth } from "../context/AuthContext";
import DashboardLayout from "../layouts/DashboardLayout";
import {
  assignPhysicalFootballCoordinator,
  configurePhysicalFootballLive,
  correctPhysicalFootballScore,
  confirmPhysicalFootballTeams,
  createPhysicalFootballSession,
  endPhysicalFootballLive,
  getCurrentPhysicalFootballSession,
  getPhysicalFootballSessions,
  recordPhysicalFootballWinnerStaysResult,
  recordPhysicalFootballGoal,
  renamePhysicalFootballTeam,
  reviewPhysicalFootballGoal,
  savePhysicalFootballTeams,
  shufflePhysicalFootballTeams,
  startPhysicalFootballLive,
  updatePhysicalFootballHeadToHeadScore,
  updatePhysicalFootballWinnerStaysQueue,
  updatePhysicalFootballAvailability,
  updatePhysicalFootballPlayerPool,
  updatePhysicalFootballSessionStatus,
} from "../services/api";

const ORGANIZER_ROLES = new Set(["admin", "super_admin"]);

export default function PhysicalFootball() {
  const { user } = useAuth();
  const isOrganizer = ORGANIZER_ROLES.has(user?.role);
  const [session, setSession] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [feedback, setFeedback] = useState({ tone: "", message: "" });
  const [selectedPlayers, setSelectedPlayers] = useState(new Set());
  const [teamCount, setTeamCount] = useState(2);
  const [draftTeams, setDraftTeams] = useState([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [createForm, setCreateForm] = useState(newSessionForm([]));
  const canAssignCoordinator = session?.capabilities?.can_assign_coordinator
    ?? (isOrganizer && session?.status !== "completed");
  const canManageLive = session?.capabilities?.can_manage_live
    ?? (["admin", "match_coordinator"].includes(session?.session_role) && session?.status === "teams_confirmed");

  useEffect(() => { void loadSession(); }, []);
  useEffect(() => {
    setSelectedPlayers(new Set(session?.selected_player_ids || []));
    setDraftTeams((session?.teams || []).map((team) => ({ ...team, player_ids: [...(team.player_ids || [])] })));
    if (session?.team_count) {
      setTeamCount(session.team_count);
    } else {
      setTeamCount((current) => session?.selected_player_count >= 2
        ? Math.min(Math.max(current, 2), session.selected_player_count)
        : 2);
    }
  }, [session]);
  useEffect(() => {
    if (session?.live_state?.status !== "live") return undefined;
    const interval = window.setInterval(async () => {
      try {
        const response = await getCurrentPhysicalFootballSession();
        setSession(response.data?.session || null);
      } catch { /* Keep the current match centre usable through a transient refresh failure. */ }
    }, 15000);
    return () => window.clearInterval(interval);
  }, [session?.id, session?.live_state?.status]);

  async function loadSession() {
    return refreshSessionData(true);
  }

  async function refreshSessionData(clearFeedback = false) {
    setLoading(true);
    if (clearFeedback) setFeedback({ tone: "", message: "" });
    try {
      const [response, sessionsResponse] = await Promise.all([
        getCurrentPhysicalFootballSession(),
        isOrganizer ? getPhysicalFootballSessions() : Promise.resolve({ data: { sessions: [] } }),
      ]);
      const listedSessions = sessionsResponse.data?.sessions || [];
      setSession(response.data?.session || null);
      setSessions(listedSessions);
      if (isOrganizer) setCreateForm(newSessionForm(listedSessions.map((item) => item.date)));
    } catch (error) {
      setFeedback({ tone: "danger", message: error.message });
    } finally {
      setLoading(false);
    }
  }

  async function runAction(key, action, successMessage) {
    setWorking(key);
    setFeedback({ tone: "", message: "" });
    try {
      const response = await action();
      setSession(response.data?.session || null);
      setFeedback({ tone: "success", message: successMessage });
      return response;
    } catch (error) {
      setFeedback({ tone: "danger", message: error.message });
      return false;
    } finally {
      setWorking("");
    }
  }

  async function createSession(event) {
    event.preventDefault();
    const created = await runAction(
      "create",
      () => createPhysicalFootballSession(createForm),
      "Sunday session created in draft.",
    );
    if (created) await refreshSessionData(false);
  }

  async function setStatus(status) {
    const changed = await runAction(
      `status-${status}`,
      () => updatePhysicalFootballSessionStatus(session.id, status),
      status === "registration_open" ? "Availability is open." : status === "registration_closed" ? "Availability closed. The eligible pool is ready." : "Session marked completed.",
    );
    if (changed && status === "completed") await refreshSessionData(false);
  }

  async function savePool() {
    await runAction(
      "pool",
      () => updatePhysicalFootballPlayerPool(session.id, [...selectedPlayers]),
      "Eligible player pool updated.",
    );
  }

  async function shuffleTeams() {
    await runAction(
      "shuffle",
      () => shufflePhysicalFootballTeams(session.id, teamCount),
      session?.shuffle_version ? "Teams shuffled again." : "Teams shuffled.",
    );
  }

  async function saveTeams() {
    await runAction("teams", () => savePhysicalFootballTeams(session.id, draftTeams), "Manual team changes saved.");
  }

  const assignCoordinator = (playerId) => runAction(
    "coordinator", () => assignPhysicalFootballCoordinator(session.id, playerId),
    playerId ? "Match Coordinator assigned." : "Match Coordinator removed.",
  );
  const renameTeam = (teamId, name) => runAction(
    `rename-${teamId}`, () => renamePhysicalFootballTeam(session.id, teamId, name), "Team name saved.",
  );
  const configureLive = (payload) => runAction(
    "live-config", () => configurePhysicalFootballLive(session.id, payload), "Live format configured.",
  );
  const startLive = () => runAction(
    "live-start", () => startPhysicalFootballLive(session.id), "Live session started.",
  );
  const recordWinnerResult = (matchId, payload) => runAction(
    "live-result", () => recordPhysicalFootballWinnerStaysResult(session.id, matchId, payload), "Result confirmed. Queue rotated.",
  );
  const updateHeadToHead = (payload) => runAction(
    "live-score", () => updatePhysicalFootballHeadToHeadScore(session.id, payload), "Cumulative score saved.",
  );
  const updateWinnerQueue = (teamIds) => runAction(
    "live-queue", () => updatePhysicalFootballWinnerStaysQueue(session.id, teamIds), "Waiting queue updated.",
  );
  const recordGoal = (payload) => runAction(
    "live-goal", () => recordPhysicalFootballGoal(session.id, payload),
    payload.direct ? "Goal recorded and added to the official score." : "Goal reported for coordinator review.",
  );
  const reviewGoal = (eventId, payload) => runAction(
    `goal-${eventId}`, () => reviewPhysicalFootballGoal(session.id, eventId, payload),
    payload.action === "confirm" ? "Goal confirmed." : payload.action === "reject" ? "Goal rejected safely." : "Goal details updated.",
  );
  const correctScore = (payload) => runAction(
    "score-correction", () => correctPhysicalFootballScore(session.id, payload), "Official score corrected.",
  );
  const endLive = () => runAction(
    "live-end", () => endPhysicalFootballLive(session.id), "Physical Football session ended.",
  );

  async function confirmTeams() {
    setWorking("confirm");
    setFeedback({ tone: "", message: "" });
    try {
      await savePhysicalFootballTeams(session.id, draftTeams);
      const response = await confirmPhysicalFootballTeams(session.id);
      setSession(response.data?.session || null);
      setFeedback({ tone: "success", message: "Teams confirmed and visible to players." });
      setConfirmOpen(false);
    } catch (error) {
      setFeedback({ tone: "danger", message: error.message });
    } finally {
      setWorking("");
    }
  }

  function movePlayer(playerId, targetTeamId) {
    setDraftTeams((current) => {
      const movedPlayer = current.flatMap((team) => team.players || []).find((player) => player.id === playerId);
      return current.map((team) => ({
        ...team,
        player_ids: team.id === targetTeamId
          ? [...team.player_ids.filter((id) => id !== playerId), playerId]
          : team.player_ids.filter((id) => id !== playerId),
        players: team.id === targetTeamId
          ? [...(team.players || []).filter((player) => player.id !== playerId), ...(movedPlayer ? [movedPlayer] : [])]
          : (team.players || []).filter((player) => player.id !== playerId),
      }));
    });
  }

  return (
    <DashboardLayout
      title="Physical Football"
      description="Sunday football sessions and one-off teams, separate from your EA FC record."
      showBackButton={false}
    >
      <section className="feature-hero-card physical-football-hero">
        <div>
          <p className="section-label">⚽ Physical Football</p>
          <h2 className="feature-hero-title">Sunday sessions with the BragRight crew.</h2>
          <p>This module does not change your 🎮 EA FC matches, statistics, or leaderboard.</p>
        </div>
        {session ? <span className={`ui-badge ui-badge--${statusTone(session.status)}`}>{formatStatus(session.status)}</span> : null}
      </section>

      {feedback.message ? <Alert className="physical-football-alert" tone={feedback.tone} title={feedback.tone === "success" ? "Success" : "Something went wrong"}>{feedback.message}</Alert> : null}

      {loading ? <PhysicalFootballSkeleton /> : !session ? (
        <div className="physical-football-layout">
          <EmptyState
            title="No Sunday session scheduled"
            description={isOrganizer ? "Create the next Sunday session now." : "An organizer has not published the next session yet."}
            actionLabel="Refresh"
            onAction={loadSession}
          />
          {isOrganizer ? <CreateSessionForm form={createForm} setForm={setCreateForm} onSubmit={createSession} loading={working === "create"} initiallyOpen /> : null}
        </div>
      ) : (
        <div className="physical-football-layout">
          <SessionSummary session={session} />
          {canAssignCoordinator ? <CoordinatorAssignment session={session} working={working} onAssign={assignCoordinator} /> : null}
          {isOrganizer || (session.session_role === "match_coordinator" && session.status !== "registration_open") ? (
            <OrganizerControls
              session={session}
              working={working}
              selectedPlayers={selectedPlayers}
              setSelectedPlayers={setSelectedPlayers}
              savePool={savePool}
              setStatus={setStatus}
              teamCount={teamCount}
              setTeamCount={setTeamCount}
              shuffleTeams={shuffleTeams}
              draftTeams={draftTeams}
              movePlayer={movePlayer}
              saveTeams={saveTeams}
              setConfirmOpen={setConfirmOpen}
              isAdmin={isOrganizer}
            />
          ) : <PlayerControls session={session} working={working} runAction={runAction} />}
          {session.status === "teams_confirmed" ? <>
            {canManageLive ? <TeamNameManager teams={session.teams} working={working} onRename={renameTeam} /> : null}
            <LiveFootballPanel
              session={session}
              working={working}
              canManage={Boolean(canManageLive)}
              onConfigure={configureLive}
              onStart={startLive}
              onWinnerResult={recordWinnerResult}
              onHeadToHeadScore={updateHeadToHead}
              onQueue={updateWinnerQueue}
              onGoal={recordGoal}
              onReviewGoal={reviewGoal}
              onCorrectScore={correctScore}
              onEnd={endLive}
            />
          </> : null}
        </div>
      )}

      {isOrganizer ? <SessionHistory sessions={sessions.filter((item) => item.status === "completed")} /> : null}

      {isOrganizer && session ? <CreateSessionForm form={createForm} setForm={setCreateForm} onSubmit={createSession} loading={working === "create"} /> : null}

      <Modal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        className="physical-football-modal"
        eyebrow="Physical Football"
        title="Confirm these teams?"
        description="Players will see their confirmed session team. Team editing will close for this session."
        actions={<><Button variant="secondary" onClick={() => setConfirmOpen(false)}>Keep editing</Button><Button variant="success" isLoading={working === "confirm"} onClick={confirmTeams}>Confirm Teams</Button></>}
      />
    </DashboardLayout>
  );
}

function SessionSummary({ session }) {
  return <section className="dashboard-panel">
    <div className="panel-header"><div><p className="panel-kicker">Current session</p><h2 className="panel-title">{formatDate(session.date)}</h2></div></div>
    <dl className="financial-detail-grid">
      <div><dt>Location</dt><dd>{session.location}</dd></div>
      <div><dt>Start time</dt><dd>{session.start_time || "To be announced"}</dd></div>
      <div><dt>End time</dt><dd>{session.end_time || "To be announced"}</dd></div>
      <div><dt>Availability cutoff</dt><dd>{formatDateTime(session.availability_cutoff)}</dd></div>
      <div><dt>Available</dt><dd>{session.available_player_count}</dd></div>
      <div><dt>Selected for teams</dt><dd>{session.selected_player_count}</dd></div>
      <div><dt>Match Coordinator</dt><dd>{session.coordinator_name || "Not assigned"}</dd></div>
    </dl>
  </section>;
}

function SessionHistory({ sessions }) {
  return <section className="dashboard-panel physical-session-history">
    <div className="panel-header"><div><p className="panel-kicker">History</p><h2 className="panel-title">Completed Sunday Sessions</h2></div></div>
    {sessions.length ? <div className="physical-history-list">{sessions.map((item) => <details key={item.id} className="physical-history-card">
      <summary><span><strong>{formatDate(item.date)}</strong><small>{item.location}</small></span><span className="ui-badge ui-badge--success">Completed</span></summary>
      <ConfirmedTeams teams={item.teams || []} />
      {item.live_state ? <LiveResult state={item.live_state} teamMap={Object.fromEntries((item.teams || []).map((team) => [team.id, team]))} /> : null}
    </details>)}</div> : <p className="section-copy">Completed sessions will appear here with their teams and results.</p>}
  </section>;
}

function PlayerControls({ session, working, runAction }) {
  const availabilityOpen = session.status === "registration_open";
  const setAvailability = (status) => runAction(
    `availability-${status}`,
    () => updatePhysicalFootballAvailability(session.id, status),
    status === "available" ? "You are marked available." : "You are marked not available.",
  );
  return <>
    <section className="dashboard-panel">
      <div className="panel-header"><div><p className="panel-kicker">Your response</p><h2 className="panel-title">Availability</h2></div></div>
      <p className="section-copy">{availabilityOpen ? "You can change this response until availability closes." : "Availability is closed. Your response is locked."}</p>
      <div className="physical-football-actions">
        <Button variant={session.my_availability === "available" ? "success" : "secondary"} disabled={!availabilityOpen} isLoading={working === "availability-available"} onClick={() => setAvailability("available")}>Available</Button>
        <Button variant={session.my_availability === "not_available" ? "danger" : "secondary"} disabled={!availabilityOpen} isLoading={working === "availability-not_available"} onClick={() => setAvailability("not_available")}>Not Available</Button>
      </div>
    </section>
    {session.status === "teams_confirmed" ? <ConfirmedTeams teams={session.teams} /> : null}
  </>;
}

function OrganizerControls({ session, working, selectedPlayers, setSelectedPlayers, savePool, setStatus, teamCount, setTeamCount, shuffleTeams, draftTeams, movePlayer, saveTeams, setConfirmOpen, isAdmin }) {
  const poolOpen = session.status === "registration_closed";
  const distribution = teamDistribution(session.selected_player_count, teamCount);
  return <>
    {isAdmin ? <section className="dashboard-panel">
      <div className="panel-header"><div><p className="panel-kicker">Organizer controls</p><h2 className="panel-title">Availability</h2></div></div>
      <div className="physical-football-actions">
        {["draft", "registration_closed"].includes(session.status) ? <Button isLoading={working === "status-registration_open"} onClick={() => setStatus("registration_open")}>Open Availability</Button> : null}
        {session.status === "registration_open" ? <Button variant="danger" isLoading={working === "status-registration_closed"} onClick={() => setStatus("registration_closed")}>Close Availability</Button> : null}
        {session.status === "teams_confirmed" ? <Button variant="secondary" isLoading={working === "status-completed"} onClick={() => setStatus("completed")}>Mark Completed</Button> : null}
      </div>
    </section> : null}
    {poolOpen ? <section className="dashboard-panel">
      <div className="panel-header"><div><p className="panel-kicker">Eligible pool</p><h2 className="panel-title">Select players ({selectedPlayers.size})</h2></div></div>
      <div className="physical-player-pool">{session.players.map((player) => <label key={player.id} className="physical-player-option"><input type="checkbox" checked={selectedPlayers.has(player.id)} onChange={(event) => setSelectedPlayers((current) => { const next = new Set(current); if (event.target.checked) next.add(player.id); else next.delete(player.id); return next; })}/><span><strong>{player.name}</strong><small>{formatStatus(player.availability)}</small></span></label>)}</div>
      <Button variant="secondary" isLoading={working === "pool"} onClick={savePool}>Save Player Pool</Button>
    </section> : null}
    {poolOpen ? <section className="dashboard-panel">
      <div className="panel-header"><div><p className="panel-kicker">Team builder</p><h2 className="panel-title">Session-specific teams</h2></div></div>
      <div className="physical-team-toolbar"><FormField label="Number of teams" htmlFor="physical-team-count"><Select id="physical-team-count" value={teamCount} disabled={session.selected_player_count < 2} onChange={(event) => setTeamCount(Number(event.target.value))}>{Array.from({ length: Math.max(session.selected_player_count - 1, 0) }, (_, index) => index + 2).map((value) => <option key={value} value={value}>{value}</option>)}</Select></FormField><Button disabled={session.selected_player_count < 2} isLoading={working === "shuffle"} onClick={shuffleTeams}>{session.shuffle_version ? "Shuffle Again" : "Random Shuffle"}</Button></div>
      {distribution.length ? <p className="section-copy"><strong>Planned distribution:</strong> {distribution.map((count, index) => `Team ${index + 1}: ${count} player${count === 1 ? "" : "s"}`).join(" • ")}</p> : null}
      {draftTeams.length ? <><h3>Manual Adjust</h3><p className="section-copy">Move any player to another team before confirmation.</p><TeamEditor teams={draftTeams} onMove={movePlayer}/><div className="physical-football-actions"><Button variant="secondary" isLoading={working === "teams"} onClick={saveTeams}>Save Manual Changes</Button><Button variant="success" onClick={() => setConfirmOpen(true)}>Confirm Teams</Button></div></> : <EmptyState title="Teams have not been shuffled" description="Choose the team count and run Random Shuffle." />}
    </section> : null}
    {session.status === "teams_confirmed" ? <ConfirmedTeams teams={session.teams} /> : null}
  </>;
}

function CoordinatorAssignment({ session, working, onAssign }) {
  return <section className="dashboard-panel physical-phase-two-panel">
    <div className="panel-header"><div><p className="panel-kicker">Session access</p><h2 className="panel-title">Match Coordinator</h2></div></div>
    <p className="section-copy">Assign one active player to manage teams and live play for this session.</p>
    <div className="physical-select-grid" role="group" aria-label="Select Match Coordinator">
      {(session.players || []).map((player) => {
        const selected = session.coordinator_id === player.id;
        return <button key={player.id} type="button" className={`physical-select-card${selected ? " is-selected" : ""}`} aria-pressed={selected} onClick={() => onAssign(player.id)} disabled={working === "coordinator"}><span className="physical-select-check" aria-hidden="true">{selected ? "✓" : ""}</span><strong title={player.name}>{player.name}</strong><small>{selected ? "Selected" : "Player"}</small></button>;
      })}
    </div>
    {session.coordinator_id ? <Button variant="secondary" isLoading={working === "coordinator"} onClick={() => onAssign(null)}>Remove Coordinator</Button> : null}
  </section>;
}

function TeamNameManager({ teams, working, onRename }) {
  const [names, setNames] = useState(() => Object.fromEntries(teams.map((team) => [team.id, team.name])));
  useEffect(() => { setNames(Object.fromEntries(teams.map((team) => [team.id, team.name]))); }, [teams]);
  return <section className="dashboard-panel physical-phase-two-panel">
    <div className="panel-header"><div><p className="panel-kicker">Persistent identity</p><h2 className="panel-title">Team Names</h2></div></div>
    <div className="physical-compact-grid">
      {teams.map((team) => <div className="physical-name-card" key={team.id}><FormField label={team.name} htmlFor={`team-name-${team.id}`}><Input id={`team-name-${team.id}`} maxLength={60} value={names[team.id] || ""} onChange={(event) => setNames((current) => ({ ...current, [team.id]: event.target.value }))}/></FormField><Button size="sm" variant="secondary" disabled={!names[team.id]?.trim() || names[team.id].trim() === team.name} isLoading={working === `rename-${team.id}`} onClick={() => onRename(team.id, names[team.id])}>Save Name</Button></div>)}
    </div>
  </section>;
}

function LiveFootballPanel({ session, working, canManage, onConfigure, onStart, onWinnerResult, onHeadToHeadScore, onQueue, onGoal, onReviewGoal, onCorrectScore, onEnd }) {
  const state = session.live_state;
  const teamMap = Object.fromEntries((session.teams || []).map((team) => [team.id, team]));
  if (!state) {
    return canManage ? <LiveSetup teams={session.teams} working={working} onConfigure={onConfigure} /> : <section className="dashboard-panel"><EmptyState title="Live play is not configured" description="The Match Coordinator will choose the session format." /></section>;
  }
  return <section className="dashboard-panel physical-live-panel">
    <div className="panel-header"><div><p className="panel-kicker">{formatStatus(state.status)}</p><h2 className="panel-title">{state.format === "winner_stays" ? "Winner Stays" : "Head-to-Head"}</h2></div><span className={`ui-badge ui-badge--${state.status === "live" ? "success" : "neutral"}`}>{state.session_duration_minutes} min session</span></div>
    {state.status === "configured" ? <div className="physical-live-ready"><p className="section-copy">{state.format === "winner_stays" ? `${state.match_duration_minutes} minute matches • winner stays on.` : "Continuous cumulative scoring with no rotation."}</p>{canManage ? <Button isLoading={working === "live-start"} onClick={onStart}>Start Session</Button> : <p>Waiting for the Match Coordinator to start.</p>}</div> : null}
    {state.format === "winner_stays" && state.status === "live" ? <WinnerStaysLive session={session} state={state} teamMap={teamMap} canManage={canManage} working={working} onResult={onWinnerResult} onQueue={onQueue} onGoal={onGoal} onReviewGoal={onReviewGoal} onCorrectScore={onCorrectScore} onEnd={onEnd} /> : null}
    {state.format === "head_to_head" && state.status === "live" ? <HeadToHeadLive session={session} state={state} teamMap={teamMap} canManage={canManage} working={working} onScore={onHeadToHeadScore} onGoal={onGoal} onReviewGoal={onReviewGoal} onCorrectScore={onCorrectScore} onEnd={onEnd} /> : null}
    {state.status === "ended" ? <LiveResult state={state} teamMap={teamMap} /> : null}
  </section>;
}

function LiveSetup({ teams, working, onConfigure }) {
  const eligibleFormat = teams.length >= 3 ? "winner_stays" : "head_to_head";
  const [format, setFormat] = useState(eligibleFormat);
  const [matchDuration, setMatchDuration] = useState(7);
  const [sessionDuration, setSessionDuration] = useState(60);
  const winnerStays = format === "winner_stays";
  return <section className="dashboard-panel physical-phase-two-panel">
    <div className="panel-header"><div><p className="panel-kicker">Phase 2 live play</p><h2 className="panel-title">Match Control</h2></div></div>
    <div className="physical-format-summary"><strong>{teams.length} confirmed teams</strong><span>{winnerStays ? "Rotation enabled" : "Continuous match"}</span></div>
    <p className="physical-control-label">Session format</p>
    <div className="physical-select-grid" role="group" aria-label="Session format">
      {[{ id: "winner_stays", label: "Winner Stays", eligible: teams.length >= 3 }, { id: "head_to_head", label: "Head-to-Head", eligible: teams.length === 2 }].map((option) => <button key={option.id} type="button" className={`physical-select-card${format === option.id ? " is-selected" : ""}`} aria-pressed={format === option.id} disabled={!option.eligible} onClick={() => setFormat(option.id)}><span className="physical-select-check" aria-hidden="true">{format === option.id ? "✓" : ""}</span><strong>{option.label}</strong><small>{option.eligible ? "Available" : option.id === "winner_stays" ? "Needs 3+ teams" : "Needs 2 teams"}</small></button>)}
    </div>
    {winnerStays ? <><p className="physical-control-label">Match duration</p><div className="physical-select-grid physical-duration-grid" role="group" aria-label="Match duration">{[5, 7, 10].map((minutes) => <button key={minutes} type="button" className={`physical-select-card${matchDuration === minutes ? " is-selected" : ""}`} aria-pressed={matchDuration === minutes} onClick={() => setMatchDuration(minutes)}><span className="physical-select-check" aria-hidden="true">{matchDuration === minutes ? "✓" : ""}</span><strong>{minutes} min</strong><small>Preset</small></button>)}</div><FormField label="Custom match minutes" htmlFor="physical-custom-match"><Input id="physical-custom-match" type="number" min="1" max="120" value={matchDuration} onChange={(event) => setMatchDuration(Number(event.target.value))}/></FormField></> : null}
    <FormField label="Session duration (minutes)" htmlFor="physical-session-duration"><Input id="physical-session-duration" type="number" min="5" max="480" value={sessionDuration} onChange={(event) => setSessionDuration(Number(event.target.value))}/></FormField>
    <div className="physical-sticky-action"><Button isLoading={working === "live-config"} onClick={() => onConfigure({ format, match_duration_minutes: winnerStays ? matchDuration : undefined, session_duration_minutes: sessionDuration })}>Save Live Format</Button></div>
  </section>;
}

function WinnerStaysLive({ session, state, teamMap, canManage, working, onResult, onQueue, onGoal, onReviewGoal, onCorrectScore, onEnd }) {
  return <>
    <MatchCentre session={session} state={state} teamMap={teamMap} canManage={canManage} working={working} onGoal={onGoal} onReviewGoal={onReviewGoal} onCorrectScore={onCorrectScore} />
    {canManage ? <div className="physical-match-actions"><Button variant="success" isLoading={working === "live-result"} disabled={isDraw(state)} onClick={() => onResult(state.current_match.id, {})}>Confirm Result</Button><small>{isDraw(state) ? "A winner is required before rotation." : "Winner stays; loser joins the back of the queue."}</small></div> : null}
    <QueueCards queue={state.waiting_queue} teamMap={teamMap} canManage={canManage} working={working} onQueue={onQueue} />
    <Standings standings={state.standings} teamMap={teamMap} />
    {canManage ? <div className="physical-sticky-action"><Button variant="danger" isLoading={working === "live-end"} onClick={onEnd}>End Winner Stays</Button></div> : null}
  </>;
}

function HeadToHeadLive({ session, state, teamMap, canManage, working, onScore, onGoal, onReviewGoal, onCorrectScore, onEnd }) {
  return <><MatchCentre session={session} state={state} teamMap={teamMap} canManage={canManage} working={working} onGoal={onGoal} onReviewGoal={onReviewGoal} onCorrectScore={onCorrectScore || onScore} />{canManage ? <div className="physical-sticky-action"><Button variant="danger" isLoading={working === "live-end"} disabled={isDraw(state)} onClick={onEnd}>End Head-to-Head</Button></div> : null}</>;
}

function MatchCentre({ session, state, teamMap, canManage, working, onGoal, onReviewGoal, onCorrectScore }) {
  const [modal, setModal] = useState("");
  const match = state.current_match || {};
  const ids = match.team_ids || state.team_ids || [];
  const score = match.score || state.cumulative_score || {};
  const elapsed = useLiveElapsed(match.started_at || state.started_at);
  const sessionElapsed = useLiveElapsed(state.started_at);
  const durationSeconds = (state.format === "winner_stays" ? state.match_duration_minutes : state.session_duration_minutes) * 60;
  const events = [...(state.goal_events || [])].filter((item) => item.match_id === match.id).sort((a, b) => a.elapsed_seconds - b.elapsed_seconds || String(a.created_at).localeCompare(String(b.created_at)));
  const currentTeams = ids.map((id) => teamMap[id]).filter(Boolean);
  const players = currentTeams.flatMap((team) => (team.players || []).map((player) => ({ ...player, team_id: team.id })));
  return <div className="physical-match-centre">
    <div className="physical-live-score" aria-live="polite">
      <p className="panel-kicker">Live match</p>
      <div className="physical-scoreboard physical-scoreboard--live"><strong title={teamName(teamMap, ids[0])}>{teamName(teamMap, ids[0])}</strong><b aria-label={`Score ${score[ids[0]] || 0} to ${score[ids[1]] || 0}`}>{score[ids[0]] || 0}<span>–</span>{score[ids[1]] || 0}</b><strong title={teamName(teamMap, ids[1])}>{teamName(teamMap, ids[1])}</strong></div>
      <div className="physical-live-timer"><strong>{formatMatchTime(elapsed)}</strong><span>/ {formatMatchTime(durationSeconds)}</span></div>
      {state.format === "winner_stays" ? <small>Session {formatMatchTime(sessionElapsed)} / {formatMatchTime(state.session_duration_minutes * 60)}</small> : null}
    </div>
    <div className="physical-live-actions">
      {session.capabilities?.can_submit_reports ? <Button size="lg" onClick={() => setModal("report")}>Report Goal</Button> : null}
      {canManage ? <Button size="lg" variant="success" onClick={() => setModal("direct")}>Record Goal</Button> : null}
      <Button size="lg" variant="secondary" disabled={!events.length} onClick={() => setModal("review")}>Review Events</Button>
    </div>
    <GoalTimeline events={events} players={players} />
    {canManage ? <ScoreCorrection state={state} teamMap={teamMap} working={working} onSave={onCorrectScore} /> : null}
    <GoalModal mode={modal} onClose={() => setModal("")} players={players} events={events} canManage={canManage} working={working} onGoal={async (payload) => { const saved = await onGoal({ ...payload, direct: modal === "direct" }); if (saved) setModal(""); }} onReview={onReviewGoal} />
  </div>;
}

function GoalTimeline({ events, players }) {
  const names = Object.fromEntries(players.map((player) => [player.id, player.name]));
  if (!events.length) return <div className="physical-goal-empty">No goal events yet. The timeline will update as reports arrive.</div>;
  return <ol className="physical-goal-timeline" aria-label="Goal timeline">{events.map((event) => <li key={event.id} className={`physical-goal-event is-${event.status}`}><time>{formatMatchTime(event.elapsed_seconds)}</time><span className="physical-goal-copy"><strong title={names[event.scorer_id]}><span aria-hidden="true">⚽</span> {names[event.scorer_id] || "Player"}</strong><small>{event.assist_id ? <><span aria-hidden="true">🎯</span> {names[event.assist_id] || "Player"}</> : "No Assist"}</small></span><span className={`physical-event-status is-${event.status}`}>{formatStatus(event.status)}</span></li>)}</ol>;
}

function GoalModal({ mode, onClose, players, events, canManage, working, onGoal, onReview }) {
  const [scorerId, setScorerId] = useState("");
  const [assistId, setAssistId] = useState("");
  useEffect(() => { setScorerId(""); setAssistId(""); }, [mode]);
  const scorer = players.find((player) => player.id === scorerId);
  const assists = players.filter((player) => player.team_id === scorer?.team_id && player.id !== scorerId);
  if (!mode) return null;
  const reporting = mode === "report" || mode === "direct";
  return <Modal isOpen onClose={onClose} className="physical-football-modal physical-goal-modal" eyebrow="Live match" title={mode === "report" ? "Report a goal" : mode === "direct" ? "Record confirmed goal" : "Review goal events"} description={mode === "report" ? "Your report stays pending until the Match Coordinator confirms it." : undefined} scrollable actions={reporting ? <><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant={mode === "direct" ? "success" : "primary"} disabled={!scorerId} isLoading={working === "live-goal"} onClick={() => onGoal({ scorer_id: scorerId, assist_id: assistId || null })}>{mode === "direct" ? "Record Goal" : "Submit Report"}</Button></> : <Button variant="secondary" onClick={onClose}>Close</Button>}>
    {reporting ? <div className="physical-goal-form"><p className="physical-control-label">Who scored?</p><PlayerCardSelector players={players} selectedId={scorerId} onSelect={(id) => { setScorerId(id); setAssistId(""); }} /><p className="physical-control-label">Assist <span>(optional)</span></p><button type="button" className={`physical-no-assist${!assistId ? " is-selected" : ""}`} onClick={() => setAssistId("")}>No Assist</button>{scorerId ? <PlayerCardSelector players={assists} selectedId={assistId} onSelect={setAssistId} /> : <p className="section-copy">Choose the scorer to see eligible teammates.</p>}</div> : <EventReview events={events} players={players} canManage={canManage} working={working} onReview={onReview} />}
  </Modal>;
}

function PlayerCardSelector({ players, selectedId, onSelect }) {
  return <div className="physical-player-selector" role="group">{players.map((player) => <button type="button" key={player.id} className={`physical-player-card${selectedId === player.id ? " is-selected" : ""}`} aria-pressed={selectedId === player.id} onClick={() => onSelect(player.id)}><strong title={player.name}>{player.name}</strong></button>)}</div>;
}

function EventReview({ events, players, canManage, working, onReview }) {
  const names = Object.fromEntries(players.map((player) => [player.id, player.name]));
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState({ scorer_id: "", assist_id: "", elapsed_seconds: 0 });
  if (!events.length) return <EmptyState title="No goal events" description="Player reports and coordinator goals will appear here." />;
  const beginEdit = (event) => { setEditing(event.id); setDraft({ scorer_id: event.scorer_id, assist_id: event.assist_id || "", elapsed_seconds: event.elapsed_seconds }); };
  return <div className="physical-review-list">{events.map((event) => <article key={event.id} className={`physical-review-card is-${event.status}`}><div><strong>{formatMatchTime(event.elapsed_seconds)} · {names[event.scorer_id] || "Player"}</strong><small>{event.assist_id ? `Assist: ${names[event.assist_id] || "Player"}` : "No Assist"}</small></div><span className={`physical-event-status is-${event.status}`}>{formatStatus(event.status)}</span>{editing === event.id ? <div className="physical-event-edit"><FormField label="Scorer" htmlFor={`edit-scorer-${event.id}`}><Select id={`edit-scorer-${event.id}`} value={draft.scorer_id} onChange={(e) => setDraft({ ...draft, scorer_id: e.target.value, assist_id: "" })}>{players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</Select></FormField><FormField label="Assist" htmlFor={`edit-assist-${event.id}`}><Select id={`edit-assist-${event.id}`} value={draft.assist_id} onChange={(e) => setDraft({ ...draft, assist_id: e.target.value })}><option value="">No Assist</option>{players.filter((player) => player.id !== draft.scorer_id && player.team_id === players.find((item) => item.id === draft.scorer_id)?.team_id).map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</Select></FormField><FormField label="Time (seconds)" htmlFor={`edit-time-${event.id}`}><Input id={`edit-time-${event.id}`} type="number" min="0" value={draft.elapsed_seconds} onChange={(e) => setDraft({ ...draft, elapsed_seconds: Number(e.target.value) })}/></FormField><Button size="sm" isLoading={working === `goal-${event.id}`} onClick={async () => { const saved = await onReview(event.id, { action: "edit", ...draft, assist_id: draft.assist_id || null }); if (saved) setEditing(""); }}>Save Edit</Button></div> : null}{canManage && editing !== event.id ? <div className="physical-review-actions"><Button size="sm" variant="secondary" onClick={() => beginEdit(event)}>Edit</Button>{event.status === "pending" ? <Button size="sm" variant="success" isLoading={working === `goal-${event.id}`} onClick={() => onReview(event.id, { action: "confirm" })}>Confirm</Button> : null}{event.status !== "rejected" ? <Button size="sm" variant="danger" isLoading={working === `goal-${event.id}`} onClick={() => onReview(event.id, { action: "reject" })}>Reject</Button> : null}</div> : null}</article>)}</div>;
}

function ScoreCorrection({ state, teamMap, working, onSave }) {
  const ids = state.current_match?.team_ids || [];
  const score = state.current_match?.score || state.cumulative_score || {};
  const [values, setValues] = useState({ one: score[ids[0]] || 0, two: score[ids[1]] || 0 });
  useEffect(() => { setValues({ one: score[ids[0]] || 0, two: score[ids[1]] || 0 }); }, [score[ids[0]], score[ids[1]], ids[0], ids[1]]);
  return <details className="physical-score-correction"><summary>Correct official score</summary><div className="physical-score-controls"><FormField label={teamName(teamMap, ids[0])} htmlFor="correction-score-one"><Input id="correction-score-one" type="number" min="0" max="99" value={values.one} onChange={(event) => setValues({ ...values, one: Number(event.target.value) })}/></FormField><FormField label={teamName(teamMap, ids[1])} htmlFor="correction-score-two"><Input id="correction-score-two" type="number" min="0" max="99" value={values.two} onChange={(event) => setValues({ ...values, two: Number(event.target.value) })}/></FormField><Button isLoading={working === "score-correction"} onClick={() => onSave({ team_one_score: values.one, team_two_score: values.two })}>Save Score</Button></div><small>Coordinator correction only. Confirmed goal events remain in the audit timeline.</small></details>;
}

function useLiveElapsed(startedAt) {
  const calculate = () => startedAt ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)) : 0;
  const [elapsed, setElapsed] = useState(calculate);
  useEffect(() => { setElapsed(calculate()); const timer = window.setInterval(() => setElapsed(calculate()), 1000); return () => window.clearInterval(timer); }, [startedAt]);
  return elapsed;
}

function formatMatchTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(Math.floor(safe % 60)).padStart(2, "0")}`;
}

function isDraw(state) {
  const ids = state.current_match?.team_ids || [];
  const score = state.current_match?.score || state.cumulative_score || {};
  return (score[ids[0]] || 0) === (score[ids[1]] || 0);
}

function QueueCards({ queue, teamMap, canManage, working, onQueue }) {
  const move = (index, offset) => {
    const target = index + offset;
    if (target < 0 || target >= queue.length) return;
    const next = [...queue];
    [next[index], next[target]] = [next[target], next[index]];
    onQueue(next);
  };
  return <div><p className="physical-control-label">Waiting queue</p><div className="physical-queue" aria-label="Waiting queue">{queue.map((teamId, index) => <div className="physical-queue-card" key={teamId}><span>{index + 1}</span><strong title={teamName(teamMap, teamId)}>{teamName(teamMap, teamId)}</strong>{canManage && queue.length > 1 ? <div className="physical-queue-actions"><button type="button" aria-label={`Move ${teamName(teamMap, teamId)} earlier`} disabled={index === 0 || working === "live-queue"} onClick={() => move(index, -1)}>↑</button><button type="button" aria-label={`Move ${teamName(teamMap, teamId)} later`} disabled={index === queue.length - 1 || working === "live-queue"} onClick={() => move(index, 1)}>↓</button></div> : null}</div>)}</div></div>;
}

function Standings({ standings, teamMap }) {
  const ordered = [...(standings || [])].sort((a, b) => b.points - a.points || b.goal_difference - a.goal_difference || b.goals_for - a.goals_for);
  return <div><p className="physical-control-label">Standings</p><div className="physical-standings"><div className="physical-standing-row physical-standing-row--head"><span>Team</span><span>P</span><span>W</span><span>L</span><span>GF</span><span>GA</span><span>GD</span><span>Pts</span></div>{ordered.map((row) => <div className="physical-standing-row" key={row.team_id}><strong title={teamName(teamMap, row.team_id)}>{teamName(teamMap, row.team_id)}</strong><span>{row.played}</span><span>{row.won}</span><span>{row.lost}</span><span>{row.goals_for}</span><span>{row.goals_against}</span><span>{row.goal_difference}</span><b>{row.points}</b></div>)}</div></div>;
}

function LiveResult({ state, teamMap }) {
  return <div className="physical-live-result" role="status"><p className="panel-kicker">Final result</p><h3>{state.winner_id ? `${teamName(teamMap, state.winner_id)} wins` : "Session complete"}</h3>{state.format === "head_to_head" ? <p>{state.cumulative_score?.[state.team_ids[0]] || 0}–{state.cumulative_score?.[state.team_ids[1]] || 0}</p> : <Standings standings={state.standings} teamMap={teamMap} />}</div>;
}

function teamName(teamMap, teamId) {
  return teamMap[teamId]?.name || "Team";
}

function TeamEditor({ teams, onMove }) {
  return <div className="physical-team-grid">{teams.map((team) => <article key={team.id} className="physical-team-card"><h3>{team.name}</h3><p>{team.player_ids.length} players</p><ul>{team.player_ids.map((playerId) => { const player = teams.flatMap((item) => item.players || []).find((item) => item.id === playerId); return <li key={playerId}><span>{player?.name || "Player"}</span><Select aria-label={`Move ${player?.name || "player"}`} value={team.id} onChange={(event) => onMove(playerId, event.target.value)}>{teams.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}</Select></li>; })}</ul></article>)}</div>;
}

function ConfirmedTeams({ teams }) {
  return <section className="dashboard-panel"><div className="panel-header"><div><p className="panel-kicker">Confirmed</p><h2 className="panel-title">Sunday Teams</h2></div></div><div className="physical-team-grid">{teams.map((team) => <article key={team.id} className="physical-team-card"><h3>{team.name}</h3><ul>{team.players.map((player) => <li key={player.id}>{player.name}</li>)}</ul></article>)}</div></section>;
}

function teamDistribution(playerCount, teamCount) {
  if (!Number.isInteger(playerCount) || !Number.isInteger(teamCount) || teamCount < 2 || teamCount > playerCount) return [];
  const baseSize = Math.floor(playerCount / teamCount);
  const extraPlayers = playerCount % teamCount;
  return Array.from({ length: teamCount }, (_, index) => baseSize + (index < extraPlayers ? 1 : 0));
}

function CreateSessionForm({ form, setForm, onSubmit, loading, initiallyOpen = false }) {
  return <details className="dashboard-panel physical-create-session" open={initiallyOpen || undefined}><summary>{initiallyOpen ? "Create Sunday Session" : "Create another Sunday session"}</summary><form className="physical-session-form" onSubmit={onSubmit}><FormField label="Sunday date" htmlFor="physical-date" required><Input id="physical-date" type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })}/></FormField><FormField label="Location" htmlFor="physical-location" required><Input id="physical-location" required maxLength={160} value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })}/></FormField><FormField label="Start time" htmlFor="physical-start-time" required><Input id="physical-start-time" type="time" required value={form.start_time} onChange={(event) => setForm({ ...form, start_time: event.target.value })}/></FormField><FormField label="End time" htmlFor="physical-end-time" required><Input id="physical-end-time" type="time" required value={form.end_time} onChange={(event) => setForm({ ...form, end_time: event.target.value })}/></FormField><FormField label="Availability cutoff (optional)" htmlFor="physical-availability-cutoff"><Input id="physical-availability-cutoff" type="datetime-local" value={form.availability_cutoff} onChange={(event) => setForm({ ...form, availability_cutoff: event.target.value })}/></FormField><Button type="submit" isLoading={loading}>Create Session</Button></form></details>;
}

function PhysicalFootballSkeleton() {
  return <div className="physical-football-layout" role="status" aria-label="Loading Physical Football session"><div className="dashboard-panel skeleton">Loading Sunday session...</div><div className="dashboard-panel skeleton">Loading availability...</div></div>;
}

function nextSunday(weekOffset = 0) {
  const current = new Date();
  const days = (7 - current.getDay()) % 7 + weekOffset * 7;
  const sunday = new Date(current.getFullYear(), current.getMonth(), current.getDate() + days);
  return `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, "0")}-${String(sunday.getDate()).padStart(2, "0")}`;
}

function nextAvailableSunday(existingDates) {
  const occupied = new Set(existingDates || []);
  let weekOffset = 0;
  let candidate = nextSunday(weekOffset);
  while (occupied.has(candidate)) {
    weekOffset += 1;
    candidate = nextSunday(weekOffset);
  }
  return candidate;
}

function newSessionForm(existingDates) {
  const date = nextAvailableSunday(existingDates);
  const cutoff = new Date(`${date}T16:00:00`);
  cutoff.setDate(cutoff.getDate() - 1);
  return {
    date,
    location: "",
    start_time: "16:00",
    end_time: "18:00",
    availability_cutoff: `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}T18:00`,
  };
}

function formatDate(value) {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GH", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function formatDateTime(value) {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat("en-GH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatStatus(value) {
  if (value === "registration_open") return "Availability Open";
  if (value === "registration_closed") return "Availability Closed";
  return String(value || "not_set").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status) {
  if (["teams_confirmed", "completed", "available"].includes(status)) return "success";
  if (["registration_open"].includes(status)) return "info";
  if (["registration_closed", "not_available"].includes(status)) return "warning";
  return "neutral";
}
