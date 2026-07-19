import { Children } from "react";
import { Link } from "react-router-dom";
import { createRichMatchViewModel } from "./richMatchViewModel";
import PlayerIdentity, { PlayerIdentitySkeleton } from "./PlayerIdentity";
import ProtectedProofImage from "./ProtectedProofImage";
import SidebarIcon from "./SidebarIcon";
import {
  SkeletonBadge,
  SkeletonButton,
  SkeletonCard,
  SkeletonText,
} from "./LoadingSkeletons";
import { Badge, Button, Card } from "./ui";

export default function RichMatchCard({
  match,
  currentUserId = "",
  currentUserName = "You",
  variant = "full",
  isSelected = false,
  actions = null,
  detailPath = "",
  onSelect,
  showDetails = false,
}) {
  const view = createRichMatchViewModel(match, { currentUserId, currentUserName, variant });
  const classNames = [
    "rich-match-card",
    `rich-match-card--${variant}`,
    isSelected ? "rich-match-card--selected" : "",
    view.isDisputed ? "rich-match-card--disputed" : "",
  ].filter(Boolean).join(" ");
  const selectProps = onSelect ? {
    role: "button",
    tabIndex: 0,
    "aria-pressed": isSelected,
    onClick: () => onSelect(match),
    onKeyDown: (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(match);
      }
    },
  } : {};

  return (
    <Card as="article" variant={variant === "admin" ? "admin" : "dashboard"} className={classNames} aria-label={view.accessibleLabel} {...selectProps}>
      <MatchCardHeader view={view} />
      <div className="rich-match-card__battle">
        <MatchParticipant participant={view.participants.left} side="left" winner={view.winner.side === "left"} variant={variant} />
        <MatchVersus view={view} />
        <MatchParticipant participant={view.participants.right} side="right" winner={view.winner.side === "right"} variant={variant} />
      </div>
      {variant !== "compact" ? <MatchContextMessage view={view} /> : null}
      <MatchMetadata items={view.metadata} />
      {showDetails && view.hasEvidence ? (
        <div className="rich-match-card__evidence">
          <div><strong>Submitted evidence</strong><span>This protected image is attached to the submitted result.</span></div>
          <ProtectedProofImage path={match.proof_image_url} alt={`Evidence for ${view.participants.left.name} versus ${view.participants.right.name}`} />
        </div>
      ) : null}
      {showDetails && match.dispute_note ? (
        <div className="rich-match-card__dispute" role="note"><strong>Dispute reason</strong><span>{match.dispute_note}</span></div>
      ) : null}
      {onSelect && variant === "admin" ? (
        <span className="rich-match-card__select-action" aria-hidden="true"><SidebarIcon name="disputes" decorative />Review case</span>
      ) : null}
      <MatchActionBar>
        {actions}
        {detailPath ? (
          <Button as={Link} to={detailPath} variant={actions ? "ghost" : "secondary"} size="sm">
            <SidebarIcon name="matches" decorative />{variant === "admin" ? "Review case" : "View match"}
          </Button>
        ) : null}
      </MatchActionBar>
    </Card>
  );
}

export function MatchCardHeader({ view }) {
  return (
    <header className="rich-match-card__header">
      <div className="rich-match-card__identity">
        <span className="rich-match-card__game-icon" aria-hidden="true"><SidebarIcon name="matches" decorative /></span>
        <div><span>{view.variant === "admin" && view.id ? `Match ${view.id}` : "Match"}</span><strong>{view.title}</strong></div>
      </div>
      <Badge tone={view.status.tone} icon={<SidebarIcon name={view.status.icon} decorative />}>{view.status.label}</Badge>
    </header>
  );
}

export function MatchParticipant({ participant, side, winner, variant }) {
  return (
    <section className={`rich-match-participant rich-match-participant--${side}${winner ? " rich-match-participant--winner" : ""}`} aria-label={`${participant.perspectiveLabel}: ${participant.name}${winner ? ", winner" : ""}`}>
      <span className="rich-match-participant__label">{participant.perspectiveLabel}{winner ? <Badge tone="success" icon={<SidebarIcon name="crown" decorative />}>Winner</Badge> : null}</span>
      <PlayerIdentity
        player={participant}
        variant={variant === "compact" ? "compact" : "match"}
        className={`rich-match-participant__player-slot rich-match-participant__player-slot--${variant}`}
        isWinner={winner}
      />
    </section>
  );
}

export function MatchVersus({ view }) {
  return (
    <div className={`rich-match-versus rich-match-versus--${view.scoreState.kind}`} aria-label={view.scoreState.kind === "versus" ? "Versus" : `${view.participants.left.name} ${view.scores.left}, ${view.participants.right.name} ${view.scores.right}. ${view.scoreState.label}`}>
      {view.hasScore ? (
        <><div className="rich-match-score" aria-hidden="true"><strong>{view.scores.left}</strong><span>—</span><strong>{view.scores.right}</strong></div><small>{view.winner.isDraw ? "Final draw" : view.scoreState.label}</small></>
      ) : <strong className="rich-match-versus__marker">VS</strong>}
    </div>
  );
}

export function MatchMetadata({ items }) {
  if (!items.length) return null;
  return <div className="rich-match-card__metadata" aria-label="Match information">{items.map((item) => <span key={item.id}><SidebarIcon name={item.icon} decorative />{item.dateTime ? <time dateTime={item.dateTime}>{item.label}</time> : item.label}</span>)}</div>;
}

export function MatchContextMessage({ view }) {
  return <div className={`rich-match-card__context rich-match-card__context--${view.status.tone}`} role="note"><SidebarIcon name={view.status.icon} decorative /><span>{view.contextMessage}</span></div>;
}

export function MatchActionBar({ children }) {
  const content = Children.toArray(children).filter(Boolean);
  if (!content.length) return null;
  return <footer className="rich-match-card__actions">{content}</footer>;
}

export function RichMatchCardSkeleton({ variant = "full" }) {
  return (
    <SkeletonCard className={`rich-match-card rich-match-card--${variant} rich-match-card--skeleton`}>
      <div className="rich-match-card__header"><SkeletonText lines={2} /><SkeletonBadge /></div>
      <div className="rich-match-card__battle"><SkeletonParticipant variant={variant} /><div className="rich-match-versus"><SkeletonBadge /></div><SkeletonParticipant variant={variant} /></div>
      {variant !== "compact" ? <SkeletonText lines={1} /> : null}
      <div className="rich-match-card__metadata"><SkeletonBadge /><SkeletonBadge /></div>
      <div className="rich-match-card__actions"><SkeletonButton /></div>
    </SkeletonCard>
  );
}

function SkeletonParticipant({ variant }) {
  return <div className="rich-match-participant" aria-hidden="true"><PlayerIdentitySkeleton variant={variant === "compact" ? "compact" : "match"} /></div>;
}
