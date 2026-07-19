const PREFERENCE_KEY = "bragright_notification_preferences_v1";
const SOUND_RATE_LIMIT_MS = 8_000;
let audioContext = null;
let lastSoundAt = 0;

export const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  soundEnabled: false,
  strongSound: true,
  browserAlertsEnabled: false,
});

export function readNotificationPreferences() {
  try {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES, ...JSON.parse(localStorage.getItem(PREFERENCE_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }
}

export function writeNotificationPreferences(preferences) {
  const normalized = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...preferences };
  try { localStorage.setItem(PREFERENCE_KEY, JSON.stringify(normalized)); } catch { /* Restricted storage keeps in-memory settings. */ }
  return normalized;
}

export async function unlockNotificationSound() {
  const context = getAudioContext();
  if (!context) return false;
  if (context.state === "suspended") await context.resume();
  return context.state === "running";
}

export async function playNotificationSound(priority = "action_required", { force = false, strong = true } = {}) {
  const now = Date.now();
  if (!force && now - lastSoundAt < SOUND_RATE_LIMIT_MS) return false;
  const context = getAudioContext();
  if (!context || context.state !== "running") return false;
  lastSoundAt = now;
  const urgent = priority === "urgent";
  const frequencies = urgent ? [740, 988, 740] : [660, 880];
  const gainValue = strong ? 0.45 : 0.18;
  frequencies.forEach((frequency, index) => scheduleTone(context, frequency, context.currentTime + index * 0.19, gainValue));
  return true;
}

export function canUseBrowserAlerts() {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function requestBrowserAlertPermission() {
  if (!canUseBrowserAlerts()) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return Notification.requestPermission();
}

export function showForegroundBrowserAlert(notification) {
  if (!canUseBrowserAlerts() || Notification.permission !== "granted" || document.visibilityState === "visible") return false;
  const alert = new Notification(notification.title, {
    body: notification.message,
    tag: notification.deduplicationKey,
    renotify: false,
    silent: true,
  });
  alert.onclick = () => { window.focus(); alert.close(); window.location.assign(notification.destination); };
  return true;
}

function getAudioContext() {
  if (typeof window === "undefined") return null;
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return null;
  if (!audioContext) audioContext = new Context();
  return audioContext;
}

function scheduleTone(context, frequency, startsAt, volume) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, startsAt);
  gain.gain.setValueAtTime(0.0001, startsAt);
  gain.gain.exponentialRampToValueAtTime(volume, startsAt + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + 0.16);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startsAt);
  oscillator.stop(startsAt + 0.17);
}
