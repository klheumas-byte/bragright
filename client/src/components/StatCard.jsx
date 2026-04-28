// StatCard is a reusable KPI card.
// It uses props so Dashboard.jsx can pass different metric content into the same design.
export default function StatCard({ title, value, subtitle, icon, emphasis = false }) {
  const cardClassName = emphasis ? "stat-card stat-card-emphasis" : "stat-card";
  const ariaLabel = `${title}: ${value}${subtitle ? `. ${subtitle}` : ""}`;

  return (
    <article className={cardClassName} aria-label={ariaLabel}>
      <div className="stat-card-header">
        <p className="stat-card-title">{title}</p>
        {icon ? (
          <span className="stat-card-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </div>

      <h3 className="stat-card-value">{value}</h3>
      <p className="stat-card-subtitle">{subtitle}</p>
    </article>
  );
}
