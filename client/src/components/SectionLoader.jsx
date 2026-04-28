import SectionSkeleton from "./SectionSkeleton";

export default function SectionLoader({
  lines = 4,
  message = "Loading...",
  compact = false,
  className = "dashboard-panel",
  as: Component = "section",
}) {
  return (
    <Component className={className}>
      <div className="section-loader">
        <SectionSkeleton lines={lines} compact={compact} />
        <p className="section-loader-copy">{message}</p>
      </div>
    </Component>
  );
}
