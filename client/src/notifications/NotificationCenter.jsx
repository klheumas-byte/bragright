import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getDashboardActionCenter } from "../services/api";
import useRealtimeRefresh from "../hooks/useRealtimeRefresh";
import { formatActivityTimestamp } from "../components/activityPresentation";
import SidebarIcon from "../components/SidebarIcon";
import { Badge, Button, Card, EmptyState } from "../components/ui";
import {
  normalizeNotificationEvents,
} from "./notificationEventRegistry";
import {
  canUseBrowserAlerts,
  playNotificationSound,
  readNotificationPreferences,
  requestBrowserAlertPermission,
  showForegroundBrowserAlert,
  unlockNotificationSound,
  writeNotificationPreferences,
} from "./notificationSound";

const NotificationContext = createContext(null);
const VISIBLE_POLL_MS = 60_000;
const HIDDEN_POLL_MS = 300_000;
const LEADER_LEASE_MS = 25_000;
const LEADER_HEARTBEAT_MS = 10_000;
const MAX_HEADS_UP = 3;
const CHANNEL_NAME = "bragright-notifications-v1";
const LEADER_KEY = "bragright_notification_leader_v1";

export function NotificationProvider({ children }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const tabIdRef = useRef(createTabId());
  const channelRef = useRef(null);
  const pollTimerRef = useRef(null);
  const heartbeatRef = useRef(null);
  const requestInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const notificationsRef = useRef([]);
  const [notifications, setNotifications] = useState([]);
  const [headsUp, setHeadsUp] = useState([]);
  const [readIds, setReadIds] = useState(() => readIdSet("read", user?.id));
  const [preferences, setPreferences] = useState(readNotificationPreferences);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState("all");
  const [connectionState, setConnectionState] = useState(navigator.onLine ? "connecting" : "offline");
  const [error, setError] = useState("");
  const [openingId, setOpeningId] = useState("");

  const applySnapshot = useCallback((rawItems, { announce = false } = {}) => {
    const next = normalizeNotificationEvents(rawItems).slice(0, 50);
    notificationsRef.current = next;
    setNotifications(next);
    setConnectionState(navigator.onLine ? "current" : "offline");
    setError("");
    if (announce) announceNewNotifications(next);
  }, [user?.id]);

  const refresh = useCallback(async ({ announce = false, broadcast = true } = {}) => {
    if (!user?.id || requestInFlightRef.current || !navigator.onLine) return notificationsRef.current;
    requestInFlightRef.current = true;
    try {
      const response = await getDashboardActionCenter({ forceRefresh: true });
      const items = response?.data?.items || [];
      if (!mountedRef.current) return [];
      applySnapshot(items, { announce });
      if (broadcast) channelRef.current?.postMessage({ type: "snapshot", items });
      return normalizeNotificationEvents(items);
    } catch (requestError) {
      if (mountedRef.current) {
        setConnectionState(navigator.onLine ? "delayed" : "offline");
        setError("Notification updates are delayed. BragRight will retry automatically.");
      }
      return notificationsRef.current;
    } finally {
      requestInFlightRef.current = false;
    }
  }, [applySnapshot, user?.id]);

  useRealtimeRefresh([
    "notification.created", "notification.updated", "challenge.created", "challenge.accepted",
    "challenge.declined", "match.result_submitted", "match.result_confirmed",
    "match.result_disputed", "match.resolved", "payment.recorded",
    "subscription.activated", "subscription.restricted", "realtime.resync",
    "realtime.connection",
  ], (event) => {
    if (event.type === "realtime.connection") {
      setConnectionState(event.state === "recovering" ? "delayed" : event.state);
      return;
    }
    refresh({ announce: true });
  });

  useEffect(() => {
    mountedRef.current = true;
    setNotifications([]);
    notificationsRef.current = [];
    setHeadsUp([]);
    setReadIds(readIdSet("read", user?.id));
    if (!user?.id) return undefined;

    if (typeof BroadcastChannel === "function") {
      const channel = new BroadcastChannel(CHANNEL_NAME);
      channelRef.current = channel;
      channel.onmessage = (event) => {
        if (event.data?.type === "snapshot") applySnapshot(event.data.items, { announce: false });
        if (event.data?.type === "read") setReadIds(new Set(event.data.ids || []));
        if (event.data?.type === "refresh-request" && isAlertLeader(tabIdRef.current)) refresh({ announce: true });
      };
    }

    function schedulePoll(delay = 0) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = window.setTimeout(async () => {
        if (claimAlertLeadership(tabIdRef.current)) await refresh({ announce: true });
        schedulePoll(document.visibilityState === "visible" ? VISIBLE_POLL_MS : HIDDEN_POLL_MS);
      }, delay);
    }

    function handleVisibilityOrFocus() {
      if (!navigator.onLine) return;
      if (claimAlertLeadership(tabIdRef.current)) schedulePoll(250);
      else channelRef.current?.postMessage({ type: "refresh-request" });
    }

    function handleOnline() { setConnectionState("connecting"); handleVisibilityOrFocus(); }
    function handleOffline() { setConnectionState("offline"); }

    claimAlertLeadership(tabIdRef.current);
    schedulePoll(0);
    heartbeatRef.current = window.setInterval(() => claimAlertLeadership(tabIdRef.current), LEADER_HEARTBEAT_MS);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      mountedRef.current = false;
      window.clearTimeout(pollTimerRef.current);
      window.clearInterval(heartbeatRef.current);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      channelRef.current?.close();
      channelRef.current = null;
      releaseLeadership(tabIdRef.current);
    };
  }, [applySnapshot, refresh, user?.id]);

  function announceNewNotifications(next) {
    if (!isAlertLeader(tabIdRef.current)) return;
    const seen = readIdSet("seen", user?.id);
    const fresh = next.filter((item) => item.headsUpEligible && !seen.has(item.deduplicationKey));
    if (!fresh.length) return;
    fresh.forEach((item) => seen.add(item.deduplicationKey));
    writeIdSet("seen", user?.id, seen);
    setHeadsUp((current) => deduplicate([...fresh, ...current]).slice(0, MAX_HEADS_UP));
    const audible = fresh.find((item) => item.soundEligible);
    if (audible && preferencesRef.current.soundEnabled) {
      playNotificationSound(audible.priority, { strong: preferencesRef.current.strongSound });
    }
    if (preferencesRef.current.browserAlertsEnabled) {
      fresh.find((item) => item.pushEligible && showForegroundBrowserAlert(item));
    }
  }

  function markRead(id) {
    const next = new Set(readIds);
    next.add(id);
    setReadIds(next);
    writeIdSet("read", user?.id, next);
    channelRef.current?.postMessage({ type: "read", ids: [...next] });
  }

  function markAllRead() {
    const next = new Set(notifications.map((item) => item.id));
    setReadIds(next);
    writeIdSet("read", user?.id, next);
    channelRef.current?.postMessage({ type: "read", ids: [...next] });
  }

  async function openNotification(notification) {
    if (openingId) return;
    setOpeningId(notification.id);
    markRead(notification.id);
    try {
      const current = await refresh({ announce: false });
      const stillAvailable = current.some((item) => item.deduplicationKey === notification.deduplicationKey);
      if (notification.actionRequired && !stillAvailable) {
        setError("This action is no longer available. Your Action Center has been refreshed.");
        setHeadsUp((items) => items.filter((item) => item.id !== notification.id));
        return;
      }
      setDrawerOpen(false);
      setHeadsUp((items) => items.filter((item) => item.id !== notification.id));
      navigate(notification.destination);
    } finally {
      setOpeningId("");
    }
  }

  async function updateSoundPreference(enabled) {
    if (enabled) {
      const unlocked = await unlockNotificationSound();
      if (!unlocked) {
        setError("Sound could not be enabled on this device. In-app visual alerts remain active.");
        return;
      }
    }
    setPreferences((current) => writeNotificationPreferences({ ...current, soundEnabled: enabled }));
    if (enabled) playNotificationSound("action_required", { force: true, strong: true });
  }

  async function updateBrowserAlerts(enabled) {
    if (enabled) {
      const permission = await requestBrowserAlertPermission();
      if (permission !== "granted") {
        setError(permission === "unsupported" ? "Browser alerts are unavailable on this device." : "Browser alert permission was not granted. In-app alerts remain active.");
        return;
      }
    }
    setPreferences((current) => writeNotificationPreferences({ ...current, browserAlertsEnabled: enabled }));
  }

  const actionItems = useMemo(() => notifications.filter((item) => item.actionRequired), [notifications]);
  const unreadCount = notifications.filter((item) => !readIds.has(item.id)).length;
  const urgentCount = actionItems.filter((item) => item.priority === "urgent").length;
  const value = {
    notifications, actionItems, readIds, unreadCount, actionCount: actionItems.length, urgentCount,
    drawerOpen, setDrawerOpen, drawerTab, setDrawerTab, connectionState, error,
    preferences, markRead, markAllRead, openNotification, openingId,
    dismissHeadsUp: (id) => setHeadsUp((items) => items.filter((item) => item.id !== id)),
    updateSoundPreference, updateBrowserAlerts,
    testSound: async () => { await unlockNotificationSound(); await playNotificationSound("urgent", { force: true, strong: preferences.strongSound }); },
    browserAlertsSupported: canUseBrowserAlerts(),
  };

  return <NotificationContext.Provider value={value}>
    {children}
    <NotificationViewport items={headsUp} />
    <NotificationDrawer />
  </NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error("useNotifications must be used inside NotificationProvider.");
  return context;
}

export function NotificationBell() {
  const { actionCount, unreadCount, urgentCount, drawerOpen, setDrawerOpen, connectionState } = useNotifications();
  const count = actionCount || unreadCount;
  const label = actionCount
    ? `Open Notification Center. ${actionCount} ${actionCount === 1 ? "action" : "actions"} required${unreadCount ? `, ${unreadCount} unread` : ""}.`
    : `Open Notification Center. ${unreadCount} unread notifications.`;
  return <button type="button" className={`notification-bell notification-bell--${urgentCount ? "urgent" : actionCount ? "action" : "normal"}`} aria-label={label} aria-expanded={drawerOpen} aria-controls="notification-center-drawer" onClick={() => setDrawerOpen(!drawerOpen)}>
    <SidebarIcon name="activity" decorative />
    {count ? <span className="notification-bell__count" aria-hidden="true">{count > 99 ? "99+" : count}</span> : null}
    <span className={`notification-bell__status notification-bell__status--${connectionState}`} aria-hidden="true" />
  </button>;
}

function NotificationViewport({ items }) {
  const { dismissHeadsUp, openNotification, openingId } = useNotifications();
  return <div className="notification-viewport" aria-label="New competitive alerts" aria-live="polite">
    {items.map((item) => <Card as="article" variant="dashboard" className={`heads-up heads-up--${item.priority}`} key={item.deduplicationKey} role={item.priority === "urgent" ? "alert" : "status"}>
      <div className="heads-up__heading"><span><SidebarIcon name={item.icon} decorative /></span><div><Badge tone={item.tone}>{formatPriority(item.priority)}</Badge><h2>{item.title}</h2></div><button type="button" className="heads-up__dismiss" aria-label={`Dismiss ${item.title} alert`} onClick={() => dismissHeadsUp(item.id)}>×</button></div>
      <p>{item.message}</p>
      <NotificationTimestamp value={item.createdAt} />
      <div className="heads-up__actions"><Button isLoading={openingId === item.id} loadingText="Checking action…" onClick={() => openNotification(item)}>{item.actionLabel}</Button><Button variant="ghost" onClick={() => dismissHeadsUp(item.id)}>Not now</Button></div>
    </Card>)}
  </div>;
}

function NotificationDrawer() {
  const context = useNotifications();
  const closeRef = useRef(null);
  const drawerRef = useRef(null);
  const previousFocusRef = useRef(null);
  const { drawerOpen, setDrawerOpen, drawerTab, setDrawerTab, notifications, actionItems, unreadCount, actionCount, readIds, markAllRead, openNotification, openingId, connectionState, error, preferences, updateSoundPreference, updateBrowserAlerts, testSound, browserAlertsSupported } = context;
  useEffect(() => {
    if (!drawerOpen) return undefined;
    previousFocusRef.current = document.activeElement;
    closeRef.current?.focus();
    function handleKeyDown(event) {
      if (event.key === "Escape") setDrawerOpen(false);
      if (event.key !== "Tab") return;
      const focusable = drawerRef.current?.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [drawerOpen, setDrawerOpen]);
  if (!drawerOpen) return null;
  const visibleItems = drawerTab === "actions" ? actionItems : drawerTab === "unread" ? notifications.filter((item) => !readIds.has(item.id)) : notifications;
  return <><button type="button" className="notification-drawer-backdrop" aria-label="Close Notification Center" onClick={() => setDrawerOpen(false)} />
    <aside ref={drawerRef} id="notification-center-drawer" className="notification-drawer" role="dialog" aria-modal="true" aria-labelledby="notification-center-title">
      <header className="notification-drawer__header"><div><p className="panel-kicker">Competitive alerts</p><h2 id="notification-center-title">Notification Center</h2><p className={`notification-connection notification-connection--${connectionState}`}>{connectionLabel(connectionState)}</p></div><button ref={closeRef} type="button" className="heads-up__dismiss" aria-label="Close Notification Center" onClick={() => setDrawerOpen(false)}>×</button></header>
      {error ? <div className="notification-drawer__error" role="status">{error}</div> : null}
      <div className="notification-drawer__counts"><Badge tone={actionCount ? "warning" : "success"}>{actionCount} actions</Badge><Badge tone="neutral">{unreadCount} unread</Badge>{unreadCount ? <Button variant="ghost" size="sm" onClick={markAllRead}>Mark all read</Button> : null}</div>
      <div className="notification-drawer__tabs" role="tablist" aria-label="Notification filters">{[["all", "All"], ["actions", "Action Required"], ["unread", "Unread"]].map(([id, label]) => <button type="button" role="tab" aria-selected={drawerTab === id} className={drawerTab === id ? "active" : ""} onClick={() => setDrawerTab(id)} key={id}>{label}</button>)}</div>
      <div className="notification-drawer__list">{visibleItems.length ? visibleItems.map((item) => <NotificationDrawerItem key={item.deduplicationKey} item={item} isUnread={!readIds.has(item.id)} isLoading={openingId === item.id} onOpen={openNotification} />) : <EmptyState title={drawerTab === "actions" ? "You are all caught up" : "No notifications yet"} description={drawerTab === "actions" ? "There are no competitive actions waiting for you." : "Important match updates will appear here."} />}</div>
      <section className="notification-preferences" aria-labelledby="notification-preferences-title"><h3 id="notification-preferences-title">Alert preferences</h3><label><input type="checkbox" checked={preferences.soundEnabled} onChange={(event) => updateSoundPreference(event.target.checked)} /><span><strong>Strong notification sound</strong><small>Plays once for new action-required events. Your phone volume and silent mode still apply.</small></span></label>{preferences.soundEnabled ? <Button variant="ghost" size="sm" onClick={testSound}>Test sound</Button> : null}<label><input type="checkbox" checked={preferences.browserAlertsEnabled} disabled={!browserAlertsSupported} onChange={(event) => updateBrowserAlerts(event.target.checked)} /><span><strong>Browser alerts</strong><small>{browserAlertsSupported ? "Foreground browser alerts when BragRight is open in the background." : "Unavailable on this device; in-app alerts remain active."}</small></span></label></section>
    </aside></>;
}

function NotificationDrawerItem({ item, isUnread, isLoading, onOpen }) {
  return <Card as="article" variant="information" className={`notification-drawer-item notification-drawer-item--${item.priority}${isUnread ? " notification-drawer-item--unread" : ""}`}>
    <span className="notification-drawer-item__icon" aria-hidden="true"><SidebarIcon name={item.icon} decorative /></span><div><div className="notification-drawer-item__title"><Badge tone={item.tone}>{formatPriority(item.priority)}</Badge>{isUnread ? <span className="sr-only">Unread. </span> : null}<strong>{item.title}</strong></div><p>{item.message}</p><NotificationTimestamp value={item.createdAt} /></div><Button variant={item.actionRequired ? "primary" : "secondary"} size="sm" isLoading={isLoading} loadingText="Checking…" onClick={() => onOpen(item)}>{item.actionLabel}</Button>
  </Card>;
}

function NotificationTimestamp({ value }) { const timestamp = formatActivityTimestamp(value); return <time className="notification-event-time" dateTime={timestamp.dateTime} title={timestamp.absolute}>{timestamp.relative}</time>; }
function formatPriority(value) { return value === "action_required" ? "Action required" : value.charAt(0).toUpperCase() + value.slice(1); }
function connectionLabel(value) { return value === "current" ? "Updates current" : value === "offline" ? "Offline — updates paused" : value === "delayed" ? "Updates delayed" : "Checking for updates"; }
function deduplicate(items) { const seen = new Set(); return items.filter((item) => !seen.has(item.deduplicationKey) && seen.add(item.deduplicationKey)); }
function createTabId() { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function storageKey(kind, userId) { return `bragright_notifications_${kind}_${String(userId || "anonymous")}`; }
function readIdSet(kind, userId) { try { return new Set(JSON.parse(localStorage.getItem(storageKey(kind, userId)) || "[]")); } catch { return new Set(); } }
function writeIdSet(kind, userId, ids) { try { localStorage.setItem(storageKey(kind, userId), JSON.stringify([...ids].slice(-500))); } catch { /* Storage is optional. */ } }
function readLeader() { try { return JSON.parse(localStorage.getItem(LEADER_KEY) || "null"); } catch { return null; } }
function isAlertLeader(tabId) { const leader = readLeader(); return leader?.id === tabId && Number(leader.expiresAt) > Date.now(); }
function claimAlertLeadership(tabId) { const leader = readLeader(); if (leader && leader.id !== tabId && Number(leader.expiresAt) > Date.now()) return false; try { localStorage.setItem(LEADER_KEY, JSON.stringify({ id: tabId, expiresAt: Date.now() + LEADER_LEASE_MS })); return true; } catch { return true; } }
function releaseLeadership(tabId) { if (!isAlertLeader(tabId)) return; try { localStorage.removeItem(LEADER_KEY); } catch { /* No-op. */ } }
