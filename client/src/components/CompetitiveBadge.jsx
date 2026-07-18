import SidebarIcon from "./SidebarIcon";
import { Badge } from "./ui";

export default function CompetitiveBadge({ kind, value, className = "" }) {
  const isRank = kind === "rank";
  const numericValue = Number(value);
  const hasValue = Number.isFinite(numericValue);
  const label = isRank
    ? hasValue
      ? `Current rank: ${numericValue}`
      : "Rank not available"
    : hasValue
      ? `${numericValue} points`
      : "Points not available";

  return (
    <Badge
      tone={isRank ? "champion" : "energy"}
      className={`competitive-badge competitive-badge--${isRank ? "rank" : "points"} ${className}`.trim()}
      aria-label={label}
      icon={<SidebarIcon name={isRank ? "crown" : "bolt"} decorative />}
    >
      {isRank ? (hasValue ? `Rank #${numericValue}` : "Unranked") : (hasValue ? `${numericValue} points` : "No points")}
    </Badge>
  );
}
