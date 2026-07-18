import SectionSkeleton from "./SectionSkeleton";
import { Card } from "./ui";

export function LeaderboardHeaderSkeleton() {
  return (
    <Card
      variant="loading"
      className="feature-hero-card leaderboard-header-skeleton"
      aria-busy="true"
    >
      <span className="sr-only" role="status">Loading leaderboard summary</span>
      <SectionSkeleton lines={4} />
      <div className="status-summary-grid">
        {Array.from({ length: 3 }, (_, index) => (
          <div className="status-pill leaderboard-skeleton-pill" key={index}>
            <SectionSkeleton lines={2} compact />
          </div>
        ))}
      </div>
    </Card>
  );
}

export function LeaderboardControlsSkeleton() {
  return (
    <Card
      variant="loading"
      className="leaderboard-controls leaderboard-controls-skeleton"
      aria-busy="true"
    >
      <span className="sr-only" role="status">Loading leaderboard search and filters</span>
      <SectionSkeleton lines={2} />
      <SectionSkeleton lines={2} compact />
    </Card>
  );
}

export function CurrentPlayerSkeleton() {
  return (
    <Card variant="loading" className="leaderboard-current-card" aria-label="Loading your leaderboard position">
      <span className="sr-only" role="status">Loading your leaderboard position</span>
      <SectionSkeleton lines={4} />
    </Card>
  );
}

export function TopPlayersSkeleton() {
  return (
    <div className="competitive-podium-grid" aria-busy="true">
      <span className="sr-only" role="status">Loading top ranked players</span>
      {Array.from({ length: 3 }, (_, index) => (
        <Card variant="loading" className="podium-card" key={index}>
          <SectionSkeleton lines={4} />
        </Card>
      ))}
    </div>
  );
}

export function LeaderboardListSkeleton({ rows = 8, label = "Loading leaderboard results" }) {
  return (
    <div className="leaderboard-list leaderboard-list-loading" aria-label={label} aria-busy="true">
      <span className="sr-only" role="status">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Card variant="loading" className="leaderboard-entry-card" key={index}>
          <SectionSkeleton lines={3} compact />
        </Card>
      ))}
    </div>
  );
}

export function LeaderboardPaginationSkeleton() {
  return (
    <div className="leaderboard-pagination leaderboard-pagination-skeleton" aria-busy="true">
      <span className="sr-only" role="status">Loading leaderboard page controls</span>
      <SectionSkeleton lines={1} compact />
      <SectionSkeleton lines={1} compact />
      <SectionSkeleton lines={1} compact />
    </div>
  );
}
