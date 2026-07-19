let accessToken = null;
let sessionUser = null;
let accessTokenExpiresAt = 0;
const listeners = new Set();
const SESSION_STORAGE_KEY = "bragright_session_v1";
const EXPIRY_SAFETY_WINDOW_MS = 5_000;

export function getAccessToken() {
  return accessToken;
}

export function getSessionUser() {
  return sessionUser;
}

export function setAuthSession(nextSession = {}) {
  accessToken = String(nextSession.accessToken || "").trim() || null;
  sessionUser = nextSession.user || null;
  accessTokenExpiresAt = resolveAccessTokenExpiry(nextSession, accessToken);
  persistSession();
  notifyListeners();
}

export function updateSessionUser(user) {
  sessionUser = user || null;
  persistSession();
  notifyListeners();
}

export function clearAuthSession() {
  accessToken = null;
  sessionUser = null;
  accessTokenExpiresAt = 0;
  removePersistedSession();
  notifyListeners();
}

export function restoreStoredAuthSession() {
  const storedSession = readPersistedSession();
  if (!storedSession) return null;

  accessToken = storedSession.accessToken;
  sessionUser = storedSession.user;
  accessTokenExpiresAt = storedSession.expiresAt;
  notifyListeners();
  return { ...storedSession };
}

export function subscribeAuthSession(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners() {
  listeners.forEach((listener) => listener(sessionUser));
}

function resolveAccessTokenExpiry(nextSession, token) {
  const explicitExpiry = Number(nextSession.expiresAt);
  if (Number.isFinite(explicitExpiry) && explicitExpiry > Date.now()) {
    return explicitExpiry;
  }

  const expiresInSeconds = Number(nextSession.expiresIn);
  if (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0) {
    return Date.now() + expiresInSeconds * 1000;
  }

  return readJwtExpiry(token);
}

function readJwtExpiry(token) {
  try {
    const payload = String(token || "").split(".")[1];
    if (!payload || typeof atob !== "function") return 0;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
    return Number(decoded.exp) * 1000 || 0;
  } catch (error) {
    return 0;
  }
}

function persistSession() {
  if (!accessToken || !sessionUser || accessTokenExpiresAt <= Date.now() + EXPIRY_SAFETY_WINDOW_MS) {
    removePersistedSession();
    return;
  }

  try {
    sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ accessToken, user: sessionUser, expiresAt: accessTokenExpiresAt })
    );
  } catch (error) {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

function readPersistedSession() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_STORAGE_KEY) || "null");
    const storedToken = String(parsed?.accessToken || "").trim();
    const expiresAt = Number(parsed?.expiresAt);
    if (!storedToken || !parsed?.user || !Number.isFinite(expiresAt) || expiresAt <= Date.now() + EXPIRY_SAFETY_WINDOW_MS) {
      removePersistedSession();
      return null;
    }
    return { accessToken: storedToken, user: parsed.user, expiresAt };
  } catch (error) {
    removePersistedSession();
    return null;
  }
}

function removePersistedSession() {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch (error) {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}
