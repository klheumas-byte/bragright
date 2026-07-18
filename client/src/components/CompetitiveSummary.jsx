import StatCard from "./StatCard";

export default function CompetitiveSummary({
  stats = [],
  label = "Competitive statistics",
  className = "",
}) {
  return (
    <section
      className={`stat-grid profile-competitive-summary ${className}`.trim()}
      aria-label={label}
    >
      {stats.map((stat) => (
        <StatCard
          key={stat.id}
          title={stat.title}
          value={String(stat.value)}
          subtitle={stat.subtitle}
          icon={stat.icon}
          tone={stat.tone}
          emphasis={Boolean(stat.emphasis)}
        />
      ))}
    </section>
  );
}
