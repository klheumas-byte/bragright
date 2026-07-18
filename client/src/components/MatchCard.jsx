import ProfileAvatar from "./ProfileAvatar";
import ProtectedProofImage from "./ProtectedProofImage";
import SidebarIcon from "./SidebarIcon";
import { Badge, Card } from "./ui";
import {
  formatMatchDate,
  getMatchNextStep,
  getMatchStatusPresentation,
} from "../pages/matchPresentation";

export default function MatchCard({ match, currentUserId, isSelected = false, actions }) {
  const status = getMatchStatusPresentation(match.status);
  const isPlayerOne = match.current_user_role === "player_one" || match.player_one_id === currentUserId;
  const currentPlayer = isPlayerOne ? match.player_one || {} : match.player_two || {};
  const opponent = isPlayerOne ? match.player_two || match.opponent || {} : match.player_one || match.opponent || {};
  const currentScore = isPlayerOne ? match.player_one_score : match.player_two_score;
  const opponentScore = isPlayerOne ? match.player_two_score : match.player_one_score;
  const deadline = match.deadline_at || match.expires_at;

  return (
    <Card
      as="article"
      variant="dashboard"
      className={`match-card match-card-shared match-versus-card${isSelected ? " match-card-selected" : ""}`}
      aria-label={`You versus ${opponent.username || "opponent"}. ${status.label}`}
    >
      <header className="match-versus-header">
        <Badge tone={status.tone} icon={<SidebarIcon name={status.tone === "warning" ? "clock" : status.tone === "success" ? "check" : status.tone === "danger" ? "disputes" : "bolt"} decorative />}>
          {status.label}
        </Badge>
        <div className="match-request-meta">
          <span>Requested <time dateTime={match.created_at}>{formatMatchDate(match.created_at)}</time></span>
          {deadline ? <span>Deadline <time dateTime={deadline}>{formatMatchDate(deadline)}</time></span> : null}
        </div>
        <details className="match-more-menu">
          <summary aria-label="More match details" title="More match details"><SidebarIcon name="more" decorative /></summary>
          <div className="match-more-popover">
            <strong>Next step</strong>
            <span>{getMatchNextStep(match, currentUserId)}</span>
          </div>
        </details>
      </header>

      <div className="match-versus-layout">
        <PlayerPanel label="You" player={currentPlayer} score={currentScore} />
        <div className="match-versus-center" aria-label="Versus">
          <strong>VS</strong>
          {currentScore != null || opponentScore != null ? (
            <span aria-label={`Score ${currentScore ?? "not submitted"} to ${opponentScore ?? "not submitted"}`}>
              {currentScore ?? "–"} : {opponentScore ?? "–"}
            </span>
          ) : null}
          {match.match_format ? <small>{match.match_format}</small> : null}
        </div>
        <PlayerPanel label="Opponent" player={opponent} score={opponentScore} />
      </div>

      <div className="match-next-step" role="note">
        <SidebarIcon name="activity" decorative />
        <span><strong>Next step:</strong> {getMatchNextStep(match, currentUserId)}</span>
      </div>

      {match.proof_image_url ? (
        <div className="match-proof-panel">
          <div className="match-proof-copy"><p className="match-score-label">Submitted proof</p><p className="match-card-meta">Protected image attached to this result.</p></div>
          <ProtectedProofImage path={match.proof_image_url} alt={`Proof for ${currentPlayer.username || "player"} versus ${opponent.username || "opponent"}`} />
        </div>
      ) : null}

      {match.dispute_note ? (
        <div className="match-dispute-note-panel" role="note"><p className="match-score-label">Dispute reason</p><p className="match-dispute-note-copy">{match.dispute_note}</p></div>
      ) : null}

      <footer className="match-card-footer"><p className="match-card-timestamp">{status.description}</p>{actions}</footer>
    </Card>
  );
}

function PlayerPanel({ label, player, score }) {
  const name = player.username || (label === "You" ? "Current player" : "Unknown opponent");
  const points = hasMetric(player.points) ? Number(player.points) : null;
  const rank = hasMetric(player.rank) ? Number(player.rank) : null;
  return (
    <section className="match-player-panel" aria-label={`${label}: ${name}`}>
      <p className="match-player-label">{label}</p>
      <ProfileAvatar image={player.profile_image} name={name} className="match-avatar match-versus-avatar" />
      <h3 className="match-player-name" title={name}>{name}</h3>
      <div className="match-player-metrics">
        <span className="match-player-points" aria-label={points == null ? "Points unavailable" : `${points} points`}><SidebarIcon name="bolt" decorative /> {points == null ? "Points unavailable" : `${points} pts`}</span>
        <span className="match-player-rank" aria-label={rank == null ? "Rank unavailable" : `Rank ${rank}`}><SidebarIcon name="crown" decorative /> {rank == null ? "Rank unavailable" : `#${rank}`}</span>
      </div>
      {score != null ? <p className="match-player-score"><span>Score</span><strong>{score}</strong></p> : null}
    </section>
  );
}

function hasMetric(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}
