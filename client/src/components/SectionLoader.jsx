import SectionSkeleton from "./SectionSkeleton";
import { Card } from "./ui";

export default function SectionLoader({
  lines = 4,
  message = "Loading section",
  compact = false,
  className = "dashboard-panel",
  as = "section",
}) {
  return (
    <Card
      as={as}
      variant="loading"
      className={className}
      aria-busy="true"
      aria-live="polite"
      aria-label={message}
    >
      <div className="section-loader">
        <SectionSkeleton lines={lines} compact={compact} />
        <p className="section-loader-copy">{message}</p>
      </div>
    </Card>
  );
}
