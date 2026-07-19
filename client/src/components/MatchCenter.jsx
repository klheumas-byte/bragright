import { Link } from "react-router-dom";
import { formatMatchDate } from "../pages/matchPresentation";
import PlayerIdentity from "./PlayerIdentity";
import ProtectedProofImage from "./ProtectedProofImage";
import SidebarIcon from "./SidebarIcon";
import MatchTimeline from "./MatchTimeline";
import SectionSkeleton from "./SectionSkeleton";
import { Badge, Button, Card, EmptyState } from "./ui";
import { createMatchCenterViewModel, createRivalryView } from "./matchCenterViewModel";
import { HeadToHeadSummary } from "./CompetitiveIntelligence";

export default function MatchCenter({
  match,
  currentUserId,
  currentUserName,
  actions,
  comparison,
  comparisonLoading = false,
  comparisonError = "",
  onRetryComparison,
}) {
  const view = createMatchCenterViewModel(match, { currentUserId, currentUserName, variant: "full" });
  const rivalry = createRivalryView(comparison, [view.participants.left, view.participants.right]);
  const relatedMatches = rivalry.recentMatches.filter((item) => item.match_id !== match.id).slice(0, 4);

  return (
    <div className="match-center" aria-label="Premium Match Center">
      <MatchCenterHero view={view} />

      <div className="match-center__primary-grid">
        <MatchCenterSection title="Match timeline" icon="activity" className="match-center__timeline">
          <MatchTimeline match={match} showEmpty />
        </MatchCenterSection>

        <MatchCenterSection title="Player comparison" icon="compare" className="match-center__comparison">
          {comparisonLoading ? (
            <div className="match-center__comparison-loading" aria-busy="true">
              <span className="sr-only" role="status">Loading player comparison</span>
              <SectionSkeleton lines={3} />
            </div>
          ) : comparisonError ? (
            <div className="match-center__compact-error" role="alert">
              <SidebarIcon name="disputes" decorative />
              <div><strong>Comparison unavailable</strong><p>{comparisonError}</p></div>
              {onRetryComparison ? <Button variant="secondary" size="sm" onClick={onRetryComparison}>Retry</Button> : null}
            </div>
          ) : (
            <HeadToHeadSummary comparison={comparison} />
          )}
        </MatchCenterSection>
      </div>

      <MatchCenterSection title="Match information" icon="matches">
        <div className="match-center__info-grid">
          {view.information.map((item) => <InformationCard key={item.id} item={item} />)}
        </div>
      </MatchCenterSection>

      <div className="match-center__secondary-grid">
        <MatchCenterSection title="Evidence" icon="matches" className="match-center__evidence-section">
          {match.proof_image_url ? (
            <div className="match-center__evidence-gallery" aria-label="Match evidence gallery">
              <article className="match-center__evidence-item">
                <div className="match-center__evidence-heading">
                  <span><SidebarIcon name="matches" decorative /></span>
                  <div><strong>Result evidence</strong><small>Protected image</small></div>
                </div>
                <ProtectedProofImage
                  path={match.proof_image_url}
                  alt={`Evidence for ${view.participants.left.name} versus ${view.participants.right.name}`}
                  showDownload
                />
              </article>
            </div>
          ) : (
            <EmptyState title="No evidence attached" description="This match does not currently include an evidence image." />
          )}
        </MatchCenterSection>

        <MatchCenterSection title="Action Center" icon="bolt" className="match-center__actions-section">
          <p className="match-center__section-copy">Only actions currently permitted for your role are shown.</p>
          {actions ? <div className="match-center__actions">{actions}</div> : (
            <EmptyState title="No action required" description="This match has no available actions for your account." />
          )}
          {view.disputeNote ? (
            <div className="match-center__review-note" role="note">
              <strong>Dispute reason</strong><p>{view.disputeNote}</p>
            </div>
          ) : null}
          {view.resolutionNote ? (
            <div className="match-center__review-note" role="note">
              <strong>Resolution note</strong><p>{view.resolutionNote}</p>
            </div>
          ) : null}
        </MatchCenterSection>
      </div>

      <MatchCenterSection title="Match statistics" icon="trophy">
        {view.statistics.length ? (
          <div className="match-center__stats-grid">
            {view.statistics.map((item) => <InformationCard key={item.id} item={item} />)}
          </div>
        ) : (
          <EmptyState title="No statistics available" description="Statistics will appear as this match progresses." />
        )}
      </MatchCenterSection>

      {!comparisonLoading && !comparisonError && relatedMatches.length ? (
        <MatchCenterSection title="Previous meetings" icon="compare">
          <div className="match-center__related-list">
            {relatedMatches.map((item) => (
              <Link className="match-center__related-match" to={`/dashboard/matches?matchId=${encodeURIComponent(item.match_id)}`} key={item.match_id}>
                <span><SidebarIcon name="trophy" decorative />{item.result_label || "Completed match"}</span>
                <strong>{item.player_a_score} – {item.player_b_score}</strong>
                <time dateTime={item.confirmed_at || undefined}>{formatMatchDate(item.confirmed_at)}</time>
              </Link>
            ))}
          </div>
        </MatchCenterSection>
      ) : null}
    </div>
  );
}

function MatchCenterHero({ view }) {
  const createdInformation = view.information.find((item) => item.id === "created");
  return (
    <Card as="section" variant="dashboard" className={`match-center__hero match-center__hero--${view.status.tone}`} aria-labelledby="match-center-title">
      <div className="match-center__hero-heading">
        <div>
          <p className="section-label">Premium Match Center</p>
          <h2 id="match-center-title">Competitive match</h2>
        </div>
        <Badge tone={view.status.tone} className="match-center__status" aria-label={`Match status: ${view.status.label}`}>
          {view.status.label}
        </Badge>
      </div>

      <div className="match-center__battle" aria-label={view.accessibleLabel}>
        <HeroParticipant participant={view.participants.left} winner={view.winner.side === "left"} />
        <div className={`match-center__score match-center__score--${view.scoreState.kind}`}>
          {view.scoreState.kind === "versus" ? (
            <strong>VS</strong>
          ) : (
            <div className="match-center__score-line" aria-label={`${view.scores.left} to ${view.scores.right}`}>
              <strong>{view.scores.left}</strong><span>–</span><strong>{view.scores.right}</strong>
            </div>
          )}
          <small>{view.scoreState.label}</small>
          {view.scoreState.isFinal ? <Badge tone="success">Completed</Badge> : null}
          {view.winner.isDraw ? <Badge tone="info">Draw</Badge> : null}
          {view.isDisputed ? <Badge tone="danger">Under review</Badge> : null}
        </div>
        <HeroParticipant participant={view.participants.right} winner={view.winner.side === "right"} />
      </div>

      <div className="match-center__hero-footer">
        <span><SidebarIcon name={view.status.icon} decorative />{view.status.description}</span>
        {createdInformation ? <time dateTime={createdInformation.dateTime}>Created {createdInformation.value}</time> : null}
      </div>
    </Card>
  );
}

function HeroParticipant({ participant, winner }) {
  return (
    <section className={`match-center__hero-player${winner ? " match-center__hero-player--winner" : ""}`} aria-label={`${participant.perspectiveLabel}: ${participant.name}${winner ? ", winner" : ""}`}>
      <PlayerIdentity
        player={participant}
        variant="match"
        label={participant.perspectiveLabel}
        isWinner={winner}
        className="match-center__shared-identity"
      />
      {winner ? <Badge tone="success"><SidebarIcon name="crown" decorative /> Winner</Badge> : null}
    </section>
  );
}

function PlayerComparisonCard({ participant, totalMatches }) {
  const metrics = [
    participant.rivalryWins != null ? ["Rivalry wins", participant.rivalryWins] : null,
    participant.rivalryPoints != null ? ["Rivalry points", participant.rivalryPoints] : null,
    totalMatches != null ? ["Previous meetings", totalMatches] : null,
  ].filter(Boolean);
  return (
    <article className="match-center__comparison-card">
      <div className="match-center__comparison-player">
        <PlayerIdentity player={participant} variant="compact" label={participant.perspectiveLabel} showBadges={false} />
      </div>
      {metrics.length ? (
        <dl>{metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      ) : (
        <p className="match-center__muted">No comparison statistics are available yet.</p>
      )}
    </article>
  );
}

function MatchCenterSection({ title, icon, className = "", children }) {
  const id = `match-center-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <Card as="section" variant="information" className={`match-center__section ${className}`.trim()} aria-labelledby={id}>
      <header className="match-center__section-heading">
        <span><SidebarIcon name={icon} decorative /></span><h3 id={id}>{title}</h3>
      </header>
      {children}
    </Card>
  );
}

function InformationCard({ item }) {
  return (
    <article className="match-center__information-card">
      <span><SidebarIcon name={item.icon} decorative /></span>
      <div><small>{item.label}</small><strong>{item.value}</strong></div>
    </article>
  );
}
