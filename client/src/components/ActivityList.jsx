import ActivityItem from "./ActivityItem";

export default function ActivityList({ activities = [], admin = false, compact = false, label = "Activity timeline" }) {
  return (
    <ol className="activity-list" aria-label={label}>
      {activities.map((activity) => (
        <li key={activity?.id || `${activity?.action_type}-${activity?.created_at}`}>
          <ActivityItem activity={activity} admin={admin} compact={compact} />
        </li>
      ))}
    </ol>
  );
}
