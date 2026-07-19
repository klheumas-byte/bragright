import { Link } from "react-router-dom";
import PlayerIdentity from "./PlayerIdentity";
import SidebarIcon from "./SidebarIcon";
import { Badge, Button, Card } from "./ui";
import { formatActivityTimestamp, presentActivity } from "./activityPresentation";

export default function ActivityItem({ activity, admin = false, compact = false }) {
  const presentation = presentActivity(activity, { admin });
  const timestamp = formatActivityTimestamp(activity?.created_at);
  const actorName = String(activity?.actor?.display_name || "Unavailable user");

  return (
    <Card as="article" variant="dashboard" className={`activity-item activity-item--${presentation.category} ${compact ? "activity-item--compact" : ""}`.trim()} aria-label={`${presentation.title}. ${presentation.description}`}>
      <div className="activity-item__identity">
        <PlayerIdentity
          player={{ ...activity?.actor, name: actorName }}
          variant="inline"
          className="activity-item__player"
          showUsername={false}
          showBadges={false}
        />
        <span className={`activity-item__icon activity-item__icon--${presentation.tone}`} aria-hidden="true">
          <SidebarIcon name={presentation.icon} decorative />
        </span>
      </div>
      <div className="activity-item__content">
        <div className="activity-item__heading">
          <div>
            <div className="activity-item__title-row"><h3>{presentation.title}</h3><Badge tone="neutral">{presentation.category}</Badge></div>
            <p>{presentation.description}</p>
          </div>
          {presentation.status ? <Badge tone={presentation.tone}>{presentation.status}</Badge> : null}
        </div>
        <div className="activity-item__footer">
          <time dateTime={timestamp.dateTime} title={timestamp.absolute} aria-label={timestamp.absolute}>
            {timestamp.relative}
          </time>
          {presentation.unavailable ? <span className="activity-item__unavailable">Related record unavailable</span> : null}
          {presentation.destination ? (
            <Button as={Link} to={presentation.destination} variant="ghost" size="sm">
              View match
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
