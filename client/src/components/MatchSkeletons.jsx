import SectionSkeleton from "./SectionSkeleton";
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

export function MatchListSkeleton({ rows = 4, label = "Loading matches" }) {
  return (
    <div className="match-list" aria-busy="true">
      <span className="sr-only" role="status">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Card key={index} variant="loading" className="match-card match-card-shared">
          <div className="match-card-skeleton" aria-hidden="true">
            <div className="match-card-skeleton-header"><span /><span /></div>
            <div className="match-card-skeleton-versus">
              <div><span className="match-card-skeleton-avatar" /><SectionSkeleton lines={2} compact /></div>
              <span className="match-card-skeleton-vs" />
              <div><span className="match-card-skeleton-avatar" /><SectionSkeleton lines={2} compact /></div>
            </div>
            <span className="match-card-skeleton-status" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export function MatchDetailSkeleton() {
  return (
    <Card variant="loading" className="match-detail-card" aria-busy="true">
      <span className="sr-only" role="status">Loading match details</span>
      <SectionSkeleton lines={6} />
    </Card>
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
