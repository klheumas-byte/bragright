import { clearClientApiCache, getRealtimeEvents } from "./api.js";

const listeners = new Set();
const seenEventIds = new Set();
const VISIBLE_POLL_MS = 2_500;
const HIDDEN_POLL_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;

let activeUserId = "";
let cursor = "";
let timer = null;
let inFlight = false;
let failureCount = 0;
let generation = 0;

export function startRealtime(userId) {
  const normalizedUserId = String(userId || "");
  if (!normalizedUserId || normalizedUserId === activeUserId) return;
  stopRealtime();
  activeUserId = normalizedUserId;
  generation += 1;
  window.addEventListener("online", resyncNow);
  window.addEventListener("focus", resyncNow);
  document.addEventListener("visibilitychange", resyncNow);
  schedule(0, generation);
}

export function stopRealtime() {
  activeUserId = "";
  cursor = "";
  failureCount = 0;
  generation += 1;
  window.clearTimeout(timer);
  timer = null;
  window.removeEventListener("online", resyncNow);
  window.removeEventListener("focus", resyncNow);
  document.removeEventListener("visibilitychange", resyncNow);
}

export function subscribeRealtime(eventTypes, listener) {
  const subscription = {
    types: new Set(Array.isArray(eventTypes) ? eventTypes : [eventTypes]),
    listener,
  };
  listeners.add(subscription);
  return () => listeners.delete(subscription);
}

export function getRealtimeDebugState() {
  return { activeUserId, cursor, listenerCount: listeners.size, inFlight };
}

async function poll(expectedGeneration) {
  if (!activeUserId || inFlight || expectedGeneration !== generation) return;
  if (!navigator.onLine) {
    emit({ type: "realtime.connection", state: "offline" });
    schedule(MAX_BACKOFF_MS, expectedGeneration);
    return;
  }
  inFlight = true;
  try {
    const response = await getRealtimeEvents({ after: cursor, limit: 100 });
    if (expectedGeneration !== generation) return;
    const events = Array.isArray(response?.data?.events) ? response.data.events : [];
    cursor = response?.data?.cursor || cursor;
    failureCount = 0;
    for (const event of events) {
      if (!event?.id || seenEventIds.has(event.id)) continue;
      seenEventIds.add(event.id);
      if (seenEventIds.size > 500) seenEventIds.delete(seenEventIds.values().next().value);
      clearClientApiCache();
      emit(event);
    }
    emit({ type: "realtime.connection", state: "current" });
    schedule(document.visibilityState === "visible" ? VISIBLE_POLL_MS : HIDDEN_POLL_MS, expectedGeneration);
  } catch (error) {
    if (expectedGeneration !== generation) return;
    failureCount += 1;
    emit({ type: "realtime.connection", state: navigator.onLine ? "recovering" : "offline" });
    const delay = Math.min(VISIBLE_POLL_MS * (2 ** failureCount), MAX_BACKOFF_MS);
    schedule(delay, expectedGeneration);
  } finally {
    inFlight = false;
  }
}

function schedule(delay, expectedGeneration) {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => poll(expectedGeneration), delay);
}

function resyncNow() {
  if (!activeUserId || document.visibilityState === "hidden") return;
  emit({ type: "realtime.resync" });
  schedule(100, generation);
}

function emit(event) {
  for (const subscription of listeners) {
    if (subscription.types.has("*") || subscription.types.has(event.type)) {
      subscription.listener(event);
    }
  }
}
