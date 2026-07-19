import { buildMatchTimeline, formatMatchDate } from "../pages/matchPresentation";
import SidebarIcon from "./SidebarIcon";
import { EmptyState } from "./ui";

export default function MatchTimeline({ match, showEmpty = false }) {
  const events = buildMatchTimeline(match);
  if (!events.length) {
    return showEmpty ? <EmptyState title="No timeline events" description="Lifecycle events will appear here as the match progresses." /> : null;
  }
  return (
    <ol className="match-timeline" aria-label="Match timeline">
      {events.map((item) => (
        <li key={item.id} className="match-timeline-item">
          <span className="match-timeline-marker" aria-hidden="true"><SidebarIcon name={item.icon} decorative /></span>
          <div>
            <strong>{item.label}</strong>
            <time dateTime={item.timestamp}>{formatMatchDate(item.timestamp)}</time>
            <p>{item.description}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
