const MATCH_ROUTE = "/dashboard/matches";

const definitions = {
  match_request: event({
    category: "match",
    priority: "action_required",
    title: "New match challenge",
    icon: "matches",
    actionRequired: true,
    actionLabel: "Review challenge",
    sound: true,
    push: true,
  }),
  result_awaiting_confirmation: event({
    category: "result",
    priority: "action_required",
    title: "Result confirmation required",
    icon: "activity",
    actionRequired: true,
    actionLabel: "Review result",
    sound: true,
    push: true,
  }),
  dispute_requiring_review: event({
    category: "dispute",
    priority: "action_required",
    title: "Dispute review required",
    icon: "disputes",
    actionRequired: true,
    actionLabel: "Review dispute",
    sound: true,
    push: true,
  }),
  dispute_status: event({
    category: "dispute",
    priority: "important",
    title: "Dispute under review",
    icon: "disputes",
    actionRequired: false,
    actionLabel: "View match",
    sound: false,
    push: false,
  }),
  match_resolved: event({
    category: "result",
    priority: "important",
    title: "Match dispute resolved",
    icon: "check",
    actionRequired: false,
    actionLabel: "View result",
    sound: false,
    push: false,
  }),
  match_cancelled: event({
    category: "match",
    priority: "informational",
    title: "Match cancelled",
    icon: "matches",
    actionRequired: false,
    actionLabel: "View match",
    sound: false,
    push: false,
  }),
};

export const notificationEventRegistry = Object.freeze(definitions);

export function normalizeNotificationEvents(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.flatMap((item, index) => {
    const definition = definitions[item?.type];
    if (!definition) return [];
    const id = clean(item.id) || `${item.type}-${index}`;
    const entityId = clean(item.related_match_id || item.match_id);
    const deduplicationKey = `${item.type}:${entityId || id}`;
    if (seen.has(deduplicationKey)) return [];
    seen.add(deduplicationKey);
    return [{
      id,
      deduplicationKey,
      type: item.type,
      category: definition.category,
      priority: definition.priority,
      title: clean(item.title) || definition.title,
      message: clean(item.message) || definition.description,
      icon: definition.icon,
      tone: priorityTone(definition.priority),
      actionRequired: definition.actionRequired,
      actionLabel: clean(item.action_label) || definition.actionLabel,
      destination: buildNotificationDestination(item, definition),
      entityId,
      createdAt: item.created_at || null,
      expiresAt: item.expires_at || null,
      dismissible: definition.dismissible,
      soundEligible: definition.sound,
      pushEligible: definition.push,
      headsUpEligible: definition.headsUp,
    }];
  }).sort(compareNotifications);
}

export function buildNotificationDestination(item, definition = definitions[item?.type]) {
  const raw = clean(item?.action_url || item?.action_path) || definition?.fallbackRoute || MATCH_ROUTE;
  if (!raw.startsWith("/") || raw.startsWith("//")) return MATCH_ROUTE;
  try {
    const parsed = new URL(raw, "https://bragright.local");
    const allowed = ["/dashboard/matches", "/admin/disputes", "/leaderboard", "/profile"];
    if (!allowed.some((path) => parsed.pathname === path || parsed.pathname.startsWith(`${path}/`))) return MATCH_ROUTE;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return MATCH_ROUTE;
  }
}

export function isActionRequiredEvent(item) {
  return Boolean(definitions[item?.type]?.actionRequired);
}

export function compareNotifications(left, right) {
  const weight = { urgent: 0, action_required: 1, important: 2, informational: 3 };
  const priorityDifference = (weight[left.priority] ?? 9) - (weight[right.priority] ?? 9);
  if (priorityDifference) return priorityDifference;
  const leftDeadline = dateValue(left.expiresAt) || Number.MAX_SAFE_INTEGER;
  const rightDeadline = dateValue(right.expiresAt) || Number.MAX_SAFE_INTEGER;
  if (leftDeadline !== rightDeadline) return leftDeadline - rightDeadline;
  return dateValue(right.createdAt) - dateValue(left.createdAt);
}

function event(options) {
  return Object.freeze({
    category: "system",
    priority: "informational",
    title: "Competitive update",
    description: "Your competitive activity changed.",
    icon: "activity",
    actionRequired: false,
    actionLabel: "View details",
    fallbackRoute: MATCH_ROUTE,
    dismissible: true,
    sound: false,
    push: false,
    headsUp: true,
    ...options,
  });
}

function priorityTone(priority) {
  if (priority === "urgent") return "danger";
  if (priority === "action_required") return "warning";
  if (priority === "important") return "info";
  return "neutral";
}

function clean(value) { return value == null || value === "undefined" ? "" : String(value).trim(); }
function dateValue(value) { const parsed = value ? new Date(value) : null; return parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : 0; }

