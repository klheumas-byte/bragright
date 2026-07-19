import SectionSkeleton from "./SectionSkeleton";
import { Card } from "./ui";

export default function CompetitiveIntelligenceSkeleton({ variant = "form", count = 1 }) {
  return <div className={`competitive-intelligence-skeleton competitive-intelligence-skeleton--${variant}`} aria-busy="true" aria-label={`Loading ${variant}`}>
    {Array.from({ length: count }, (_, index) => <Card variant="loading" key={index}><SectionSkeleton lines={variant === "actions" ? 3 : 2} /></Card>)}
  </div>;
}
