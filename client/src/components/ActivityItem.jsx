import { Link } from "react-router-dom";
import ProfileAvatar from "./ProfileAvatar";
import SidebarIcon from "./SidebarIcon";
import { Badge, Button, Card } from "./ui";
import { formatActivityTimestamp, presentActivity } from "./activityPresentation";

export default function ActivityItem({ activity, admin = false, compact = false }) {
  const presentation = presentActivity(activity, { admin });
  const timestamp = formatActivityTimestamp(activity?.created_at);
  const actorName = String(activity?.actor?.display_name || "Unavailable user");

  return (
    <Card as="article" variant="dashboard" className={`activity-item ${compact ? "activity-item--compact" : ""}`.trim()}>
      <div className="activity-item__identity">
        <ProfileAvatar image={activity?.actor?.profile_image} name={actorName} className="activity-item__avatar" />
        <span className={`activity-item__icon activity-item__icon--${presentation.tone}`} aria-hidden="true">
          <SidebarIcon name={presentation.icon} decorative />
        </span>
      </div>
      <div className="activity-item__content">
        <div className="activity-item__heading">
          <div>
            <h3>{presentation.title}</h3>
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
