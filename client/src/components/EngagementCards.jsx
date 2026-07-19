import { formatActivityTimestamp } from "./activityPresentation";
import SidebarIcon from "./SidebarIcon";
import { Badge, Button, Card, EmptyState } from "./ui";

export function EngagementNotificationCard({ notification, onAction }) {
  const timestamp = formatActivityTimestamp(notification?.timestamp);
  return (
    <Card as="article" variant="dashboard" className={`engagement-notification engagement-notification--${notification.tone}`} aria-label={`${notification.title}. ${notification.priority}`}>
      <span className="engagement-notification__icon" aria-hidden="true"><SidebarIcon name={notification.icon} decorative /></span>
      <div className="engagement-notification__content">
        <div className="engagement-notification__heading">
          <div><Badge tone={notification.tone}>{notification.priority}</Badge><h3>{notification.title}</h3></div>
          <time dateTime={timestamp.dateTime} title={timestamp.absolute} aria-label={timestamp.absolute}>{timestamp.relative}</time>
        </div>
        <p>{notification.description}</p>
      </div>
      <Button variant="secondary" size="sm" onClick={() => onAction?.(notification)}>{notification.actionLabel}</Button>
    </Card>
  );
}

export function PlayerHighlightGrid({ highlights = [] }) {
  if (!highlights.length) return null;
  return (
    <div className="engagement-highlight-grid" aria-label="Player highlights">
      {highlights.map((highlight) => (
        <Card as="article" variant="information" className={`engagement-highlight engagement-highlight--${highlight.tone}`} key={highlight.id}>
          <span className="engagement-highlight__icon" aria-hidden="true"><SidebarIcon name={highlight.icon} decorative /></span>
          <div><span>{highlight.label}</span><strong>{highlight.value}</strong><p>{highlight.description}</p></div>
        </Card>
      ))}
    </div>
  );
}

export function CompetitiveMoments({ moments = [] }) {
  if (!moments.length) return null;
  return (
    <div className="competitive-moments" aria-label="Competitive moments" aria-live="polite">
      {moments.map((moment) => (
        <Card as="article" variant="information" className={`competitive-moment competitive-moment--${moment.tone}`} key={moment.id}>
          <span aria-hidden="true"><SidebarIcon name={moment.icon} decorative /></span>
          <div><strong>{moment.title}</strong><p>{moment.description}</p></div>
        </Card>
      ))}
    </div>
  );
}

export function CompetitivePulse({ items = [] }) {
  if (!items.length) {
    return <Card variant="empty"><EmptyState title="The arena is quiet" description="Recent matches and competitive events will appear here." /></Card>;
  }
  return (
    <div className="competitive-pulse" aria-label="Recent competitive activity">
      {items.map((item) => (
        <Card as="article" variant="information" className={`competitive-pulse__item competitive-pulse__item--${item.tone}`} key={item.id}>
          <span aria-hidden="true"><SidebarIcon name={item.icon} decorative /></span>
          <div><strong>{item.value}</strong><small>{item.label}</small></div>
        </Card>
      ))}
    </div>
  );
}
