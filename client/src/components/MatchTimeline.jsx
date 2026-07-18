import { buildMatchTimeline, formatMatchDate } from "../pages/matchPresentation";

export default function MatchTimeline({ match }) {
  const events = buildMatchTimeline(match);
  if (!events.length) {
    return null;
  }
  return (
    <ol className="match-timeline" aria-label="Match timeline">
      {events.map((item) => (
        <li key={item.id} className="match-timeline-item">
          <span className="match-timeline-marker" aria-hidden="true" />
          <div>
            <strong>{item.label}</strong>
            <time dateTime={item.timestamp}>{formatMatchDate(item.timestamp)}</time>
          </div>
        </li>
      ))}
    </ol>
  );
}
