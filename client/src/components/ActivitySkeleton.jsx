import SectionSkeleton from "./SectionSkeleton";
import { Card } from "./ui";

export default function ActivitySkeleton({ count = 4, message = "Loading activity" }) {
  return (
    <div className="activity-list" role="status" aria-live="polite" aria-label={message} aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <Card key={index} variant="loading" className="activity-item activity-item--skeleton">
          <SectionSkeleton lines={2} compact />
        </Card>
      ))}
    </div>
  );
}
