import { Card } from "./ui";
import SidebarIcon from "./SidebarIcon";

// StatCard is a reusable KPI card.
// It uses props so Dashboard.jsx can pass different metric content into the same design.
export default function StatCard({
  title,
  value,
  subtitle,
  icon,
  tone = "primary",
  emphasis = false,
}) {
  const cardClassName = `stat-card stat-card--${tone}${
    emphasis ? " stat-card-emphasis" : ""
  }`;
  const ariaLabel = `${title}: ${value}${subtitle ? `. ${subtitle}` : ""}`;

  return (
    <Card as="article" variant="dashboard" className={cardClassName} aria-label={ariaLabel}>
      <div className="stat-card-header">
        <p className="stat-card-title">{title}</p>
        {icon ? (
          <span className="stat-card-icon">
            <SidebarIcon name={icon} label={`${title} icon`} />
          </span>
        ) : null}
      </div>

      <h3 className="stat-card-value">{value}</h3>
      <p className="stat-card-subtitle">{subtitle}</p>
    </Card>
  );
}
