import SectionSkeleton from "./SectionSkeleton";
import { RichMatchCardSkeleton } from "./RichMatchCard";
import { Card } from "./ui";

export function MatchControlsSkeleton() {
  return (
    <Card variant="loading" className="match-view-controls match-controls-skeleton" aria-busy="true">
      <span className="sr-only" role="status">Loading match filters</span>
      <div className="match-tab-skeleton-row" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => <span className="match-tab-skeleton" key={index} />)}
      </div>
    </Card>
  );
}

export function MatchSummarySkeleton() {
  return (
    <div className="status-summary-grid match-summary-skeleton" aria-busy="true">
      <span className="sr-only" role="status">Loading Match Center summary</span>
      {Array.from({ length: 4 }, (_, index) => (
        <div className="status-pill" key={index} aria-hidden="true">
          <SectionSkeleton lines={2} compact />
        </div>
      ))}
    </div>
  );
}

export function MatchListSkeleton({ rows = 4, label = "Loading matches", variant = "full" }) {
  return (
    <div className="match-list" aria-busy="true">
      <span className="sr-only" role="status">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <RichMatchCardSkeleton key={index} variant={variant} />
      ))}
    </div>
  );
}

export function MatchDetailSkeleton() {
  return (
    <div className="match-center match-center--skeleton" aria-busy="true">
      <span className="sr-only" role="status">Loading match details</span>
      <div className="match-center-skeleton__hero" aria-hidden="true">
        <div className="match-center-skeleton__heading" />
        <div className="match-center-skeleton__battle">
          <div className="match-center-skeleton__player"><span /><i /><b /></div>
          <div className="match-center-skeleton__score" />
          <div className="match-center-skeleton__player"><span /><i /><b /></div>
        </div>
      </div>
      <div className="match-center__primary-grid" aria-hidden="true">
        <div className="match-center-skeleton__panel match-center-skeleton__timeline">{Array.from({ length: 4 }, (_, index) => <span key={index} />)}</div>
        <div className="match-center-skeleton__panel match-center-skeleton__comparison"><span /><span /></div>
      </div>
      <div className="match-center-skeleton__panel match-center-skeleton__metadata" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <span key={index} />)}</div>
      <div className="match-center__secondary-grid" aria-hidden="true">
        <div className="match-center-skeleton__panel match-center-skeleton__evidence"><span /></div>
        <div className="match-center-skeleton__panel match-center-skeleton__actions"><span /><span /></div>
      </div>
      <div className="match-center-skeleton__panel match-center-skeleton__statistics" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <span key={index} />)}</div>
    </div>
  );
}

export function OpponentSearchSkeleton() {
  return (
    <div className="opponent-results" aria-busy="true">
      <span className="sr-only" role="status">Loading opponent results</span>
      {Array.from({ length: 3 }, (_, index) => (
        <Card key={index} variant="loading" className="opponent-option-card">
          <SectionSkeleton lines={2} compact />
        </Card>
      ))}
    </div>
  );
}
