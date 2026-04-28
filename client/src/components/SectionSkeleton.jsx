export default function SectionSkeleton({ lines = 3, compact = false }) {
  return (
    <div className={`section-skeleton${compact ? " section-skeleton-compact" : ""}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <span key={`skeleton-line-${index}`} className="section-skeleton-line" />
      ))}
    </div>
  );
}
