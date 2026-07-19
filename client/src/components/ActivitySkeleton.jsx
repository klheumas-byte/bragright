import { EngagementActivitySkeleton } from "./EngagementSkeletons";

export default function ActivitySkeleton({ count = 4, message = "Loading activity" }) {
  return <EngagementActivitySkeleton count={count} label={message} />;
}
