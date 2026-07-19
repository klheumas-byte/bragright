import { PlayerIdentitySkeleton } from "./PlayerIdentity";
import { SkeletonBadge, SkeletonButton, SkeletonCard, SkeletonText } from "./LoadingSkeletons";

export function NotificationListSkeleton({ count = 3, label = "Loading notifications" }) {
  return <div className="engagement-notification-list" role="status" aria-label={label} aria-busy="true">{Array.from({ length: count }, (_, index) => <SkeletonCard className="engagement-notification" key={index}><SkeletonBadge /><SkeletonText lines={2} /><SkeletonButton /></SkeletonCard>)}</div>;
}

export function HighlightGridSkeleton({ count = 3, label = "Loading player highlights" }) {
  return <div className="engagement-highlight-grid" role="status" aria-label={label} aria-busy="true">{Array.from({ length: count }, (_, index) => <SkeletonCard className="engagement-highlight" key={index}><SkeletonBadge /><SkeletonText lines={2} /></SkeletonCard>)}</div>;
}

export function EngagementActivitySkeleton({ count = 4, label = "Loading activity" }) {
  return <div className="activity-list" role="status" aria-label={label} aria-busy="true">{Array.from({ length: count }, (_, index) => <SkeletonCard className="activity-item" key={index}><PlayerIdentitySkeleton variant="inline" /><SkeletonText lines={2} /></SkeletonCard>)}</div>;
}

export function CompetitivePulseSkeleton({ count = 3, label = "Loading competitive activity" }) {
  return <div className="competitive-pulse" role="status" aria-label={label} aria-busy="true">{Array.from({ length: count }, (_, index) => <SkeletonCard className="competitive-pulse__item" key={index}><SkeletonBadge /><SkeletonText lines={1} /></SkeletonCard>)}</div>;
}
