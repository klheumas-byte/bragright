let accessToken = null;
let sessionUser = null;
const listeners = new Set();

export function getAccessToken() {
  return accessToken;
}

export function getSessionUser() {
  return sessionUser;
}

export function setAuthSession(nextSession = {}) {
  accessToken = String(nextSession.accessToken || "").trim() || null;
  sessionUser = nextSession.user || null;
  notifyListeners();
}

export function updateSessionUser(user) {
  sessionUser = user || null;
  notifyListeners();
}

export function clearAuthSession() {
  accessToken = null;
  sessionUser = null;
  notifyListeners();
}

export function subscribeAuthSession(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners() {
  listeners.forEach((listener) => listener(sessionUser));
}
