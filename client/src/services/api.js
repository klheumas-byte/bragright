import { AUTH_STORAGE_KEY } from "../context/AuthContext";

export const AUTH_FAILURE_EVENT = "bragright:auth-failure";
const API_BASE_URL = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
const responseCache = new Map();
const pendingGetRequests = new Map();
const DEFAULT_GET_CACHE_TTL_MS = 15_000;

async function apiRequest(path, options = {}) {
  let response;
  const currentUser = getStoredUser();
  const requestUrl = buildApiUrl(path);
  const isFormDataBody = typeof FormData !== "undefined" && options.body instanceof FormData;
  const requestHeaders = {
    ...(isFormDataBody ? {} : { "Content-Type": "application/json" }),
    ...(currentUser?.id ? { "X-User-Id": currentUser.id } : {}),
    ...(options.headers || {}),
  };

  try {
    response = await fetch(requestUrl, {
      headers: requestHeaders,
      ...options,
    });
  } catch (error) {
    throw new Error(
      "Could not reach the backend API. Check the backend server and VITE_API_BASE_URL."
    );
  }

  const responseText = await response.text();
  const data = parseJsonResponse(responseText, response.headers.get("content-type"), requestUrl);

  if (!response.ok) {
    const error = createApiError(
      response.status,
      data?.message || getDefaultApiErrorMessage(response.status, requestUrl)
    );
    handleAuthFailure(error.status);
    throw error;
  }

  if (!data) {
    throw createApiError(500, "The backend returned an empty response.");
  }

  return data;
}

async function cachedApiRequest(path, options = {}) {
  const {
    cacheKey = path,
    ttlMs = DEFAULT_GET_CACHE_TTL_MS,
    forceRefresh = false,
  } = options;

  const now = Date.now();
  const cachedEntry = responseCache.get(cacheKey);
  if (!forceRefresh && cachedEntry && cachedEntry.expiresAt > now) {
    return cachedEntry.data;
  }

  if (!forceRefresh && pendingGetRequests.has(cacheKey)) {
    return pendingGetRequests.get(cacheKey);
  }

  const requestPromise = apiRequest(path)
    .then((data) => {
      responseCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + ttlMs,
      });
      pendingGetRequests.delete(cacheKey);
      return data;
    })
    .catch((error) => {
      pendingGetRequests.delete(cacheKey);
      throw error;
    });

  pendingGetRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

async function apiRequestWithFallback(primaryPath, primaryOptions, fallbackRequest) {
  try {
    return await apiRequest(primaryPath, primaryOptions);
  } catch (error) {
    if (!shouldRetryWithFallback(error)) {
      throw error;
    }

    return fallbackRequest();
  }
}

function generateTemporaryPassword(length = 12) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let password = "";

  for (let index = 0; index < length; index += 1) {
    password += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return password;
}

function getStoredUser() {
  let storedUser = null;

  try {
    storedUser = localStorage.getItem(AUTH_STORAGE_KEY);
  } catch (error) {
    return null;
  }

  if (!storedUser) {
    return null;
  }

  try {
    return JSON.parse(storedUser);
  } catch (error) {
    safelyRemoveStoredUser();
    return null;
  }
}

function resolveApiBaseUrl(rawBaseUrl) {
  const baseUrl = (rawBaseUrl || "/api").trim();

  if (!baseUrl) {
    return "/api";
  }

  if (baseUrl.endsWith("/api")) {
    return baseUrl;
  }

  if (baseUrl.endsWith("/")) {
    return `${baseUrl}api`;
  }

  if (baseUrl === "/") {
    return "/api";
  }

  return `${baseUrl}/api`;
}

function buildApiUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}

function buildApiAssetUrl(path) {
  const safePath = String(path || "").trim();

  if (!safePath) {
    return "";
  }

  if (safePath.startsWith("data:image/")) {
    return safePath;
  }

  if (/^https?:\/\//i.test(safePath)) {
    return safePath;
  }

  if (safePath.startsWith("/api")) {
    const apiOrigin = new URL(API_BASE_URL, window.location.origin);
    return `${apiOrigin.origin}${safePath}`;
  }

  return buildApiUrl(safePath);
}

function getDefaultApiErrorMessage(status, requestUrl) {
  if (status === 404) {
    return `The backend route for ${requestUrl} was not found. Check the API base URL and Flask route registration.`;
  }

  if (status === 401) {
    return "Your session is no longer valid. Please log in again.";
  }

  return `The API request failed with status ${status}. Check the backend deployment and API base URL for ${requestUrl}.`;
}

function shouldRetryWithFallback(error) {
  return error?.status === 404 || error?.status === 405;
}

function deriveOverviewFromLegacyMatches(matches, currentUserId) {
  const normalizedMatches = matches.map((match) => normalizeLegacyProfileMatch(match, currentUserId));
  const confirmedMatches = normalizedMatches.filter((match) => match.status === "confirmed");

  return {
    total_matches: normalizedMatches.length,
    wins: confirmedMatches.filter((match) => match.result === "win").length,
    losses: confirmedMatches.filter((match) => match.result === "loss").length,
    draws: confirmedMatches.filter((match) => match.result === "draw").length,
    pending_matches: normalizedMatches.filter((match) => ["match_requested", "pending_result", "pending_confirmation"].includes(match.status)).length,
    disputed_matches: normalizedMatches.filter((match) => match.status === "disputed").length,
    recent_summary: normalizedMatches.slice(0, 3),
  };
}

function normalizeLegacyProfileMatch(match, currentUserId) {
  return normalizeMatchRecord(match, currentUserId);
}

function formatLegacyMatchStatus(status) {
  return String(status || "unknown")
    .replace("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeMatchRecord(match, currentUserId) {
  const playerOneId = match?.player_one_id || match?.submitted_by || "";
  const playerTwoId = match?.player_two_id || match?.opponent_id || "";
  const playerOneName = match?.player_one_name || match?.submitted_by_name || "Unknown player";
  const playerTwoName = match?.player_two_name || match?.opponent_name || "Unknown opponent";
  const playerOneScore = match?.player_one_score ?? match?.player_score ?? null;
  const playerTwoScore = match?.player_two_score ?? match?.opponent_score ?? null;
  const isPlayerOne = currentUserId === playerOneId;
  const isPlayerTwo = currentUserId === playerTwoId;
  const currentUserScore = isPlayerOne ? playerOneScore : isPlayerTwo ? playerTwoScore : playerOneScore;
  const opponentScore = isPlayerOne ? playerTwoScore : isPlayerTwo ? playerOneScore : playerTwoScore;
  const opponentId = isPlayerOne ? playerTwoId : playerOneId;
  const opponentUsername = isPlayerOne ? playerTwoName : playerOneName;
  const status = match?.status === "scheduled" ? "match_requested" : match?.status || "pending_result";
  const winnerId = match?.winner_id || null;
  const isConfirmed = status === "confirmed";

  let result = "pending";
  let resultLabel = "-";
  if (isConfirmed && winnerId && winnerId === currentUserId) {
    result = "win";
    resultLabel = "W";
  } else if (isConfirmed && winnerId && winnerId !== currentUserId) {
    result = "loss";
    resultLabel = "L";
  } else if (isConfirmed && currentUserScore != null && opponentScore != null && currentUserScore === opponentScore) {
    result = "draw";
    resultLabel = "D";
  }

  return {
    ...match,
    id: match?.id || "",
    opponent: {
      id: opponentId || "",
      username: opponentUsername || "Unknown opponent",
    },
    player_one_id: playerOneId,
    player_two_id: playerTwoId,
    player_one_name: playerOneName,
    player_two_name: playerTwoName,
    player_one_score: playerOneScore,
    player_two_score: playerTwoScore,
    player_score: currentUserScore,
    opponent_score: opponentScore,
    score_line:
      currentUserScore == null && opponentScore == null
        ? "No result submitted"
        : `${currentUserScore ?? "-"} - ${opponentScore ?? "-"}`,
    status,
    display_status: match?.display_status || formatLegacyMatchStatus(status),
    result,
    result_label: resultLabel,
    created_at: match?.created_at || null,
    played_at:
      match?.confirmed_at || match?.reviewed_at || match?.disputed_at || match?.result_submitted_at || match?.created_at || null,
  };
}

function parseJsonResponse(responseText, contentType = "", requestUrl = "") {
  if (!responseText) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch (error) {
    const normalizedContentType = String(contentType || "").toLowerCase();
    const likelyHtmlResponse =
      normalizedContentType.includes("text/html") ||
      /^\s*<!doctype html/i.test(responseText) ||
      /^\s*<html/i.test(responseText);

    if (likelyHtmlResponse) {
      throw createApiError(
        500,
        `The API request for ${requestUrl} returned HTML instead of JSON. Check the Render API host and VITE_API_BASE_URL.`
      );
    }

    throw createApiError(500, "The backend returned a response that was not valid JSON.");
  }
}

function createApiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function handleAuthFailure(status) {
  if (status !== 401) {
    return;
  }

  clearApiCache();
  safelyRemoveStoredUser();
  window.dispatchEvent(new Event(AUTH_FAILURE_EVENT));
}

function clearApiCache() {
  responseCache.clear();
  pendingGetRequests.clear();
}

function safelyRemoveStoredUser() {
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (error) {
    return null;
  }
  return null;
}

async function apiMutation(path, options) {
  const data = await apiRequest(path, options);
  clearApiCache();
  return data;
}

export function getHealthStatus() {
  return cachedApiRequest("/health", {
    cacheKey: "health",
    ttlMs: 60_000,
  });
}

export function registerUser(credentials) {
  return apiMutation("/auth/register", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

export function loginUser(credentials) {
  return apiMutation("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

export function getCurrentUser(options = {}) {
  return cachedApiRequest("/auth/me", {
    cacheKey: "current-user",
    ttlMs: 60_000,
    forceRefresh: options.forceRefresh,
  });
}

export function logoutUser() {
  return apiMutation("/auth/logout", {
    method: "POST",
  });
}

export function getMyProfile(options = {}) {
  if (!options.forceRefresh) {
    const cachedEntry = responseCache.get("my-profile");
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return Promise.resolve(cachedEntry.data);
    }
  }

  return apiRequestWithFallback(
    "/profile/me",
    {},
    async () => {
      const [currentUserResponse, matchesResponse] = await Promise.all([
        getCurrentUser(options),
        getMyMatches(options),
      ]);
      const currentUser = currentUserResponse?.user || {};
      const matches = Array.isArray(matchesResponse?.data?.matches) ? matchesResponse.data.matches : [];

      return {
        success: true,
        message: "Your profile loaded successfully.",
        data: {
          id: currentUser.id || "",
          username: currentUser.username || "",
          email: currentUser.email || "",
          role: currentUser.role || "player",
          status: currentUser.status || (currentUser.is_active === false ? "disabled" : "active"),
          created_at: currentUser.created_at || null,
          last_login: currentUser.last_login || currentUser.last_login_at || null,
          last_login_at: currentUser.last_login || currentUser.last_login_at || null,
          profile_image: currentUser.profile_image || null,
          overview: deriveOverviewFromLegacyMatches(matches, currentUser.id),
        },
      };
    }
  ).then((data) => {
    const forceRefresh = options.forceRefresh === true;
    if (!forceRefresh) {
      responseCache.set("my-profile", {
        data,
        expiresAt: Date.now() + 30_000,
      });
    }
    return data;
  });
}

export function getMyProfileMatches(options = {}) {
  if (!options.forceRefresh) {
    const cachedEntry = responseCache.get("my-profile-matches");
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return Promise.resolve(cachedEntry.data);
    }
  }

  return apiRequestWithFallback(
    "/profile/me/matches",
    {},
    async () => {
      const currentUser = getStoredUser() || {};
      const response = await getMyMatches(options);
      const matches = Array.isArray(response?.data?.matches) ? response.data.matches : [];

      return {
        success: true,
        message: "Your profile matches loaded successfully.",
        data: {
          matches: matches.map((match) => normalizeLegacyProfileMatch(match, currentUser.id)),
        },
      };
    }
  ).then((data) => {
    if (!options.forceRefresh) {
      responseCache.set("my-profile-matches", {
        data,
        expiresAt: Date.now() + 20_000,
      });
    }
    return data;
  });
}

export function updateMyProfile({ userId, username, image } = {}) {
  return apiMutation("/profile/update", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      username,
      image,
    }),
  });
}

export function getPlayers() {
  return cachedApiRequest("/players", {
    cacheKey: "players",
    ttlMs: 300_000,
  });
}

export function getLeaderboard() {
  return cachedApiRequest("/leaderboard", {
    cacheKey: "leaderboard",
    ttlMs: 30_000,
  });
}

export function getPublicPlayerProfile(playerId) {
  return apiRequest(`/players/${playerId}`);
}

export function getHeadToHead(playerAId, playerBId) {
  return apiRequest(`/head-to-head/${playerAId}/${playerBId}`);
}

export function getDashboardNotifications() {
  return cachedApiRequest("/dashboard/notifications", {
    cacheKey: "dashboard-notifications",
    ttlMs: 10_000,
  });
}

export function getDashboardActions() {
  return cachedApiRequest("/dashboard/actions", {
    cacheKey: "dashboard-actions",
    ttlMs: 10_000,
  });
}

export function getDashboardSummary(options = {}) {
  return cachedApiRequest("/dashboard/summary", {
    cacheKey: "dashboard-summary",
    ttlMs: 10_000,
    forceRefresh: options.forceRefresh,
  });
}

export function getDashboardActionCenter() {
  return cachedApiRequest("/dashboard/action-center", {
    cacheKey: "dashboard-action-center",
    ttlMs: 10_000,
  });
}

export function getAdminSummary() {
  return apiRequestWithFallback(
    "/admin/dashboard/summary",
    {},
    () => apiRequest("/admin/summary")
  );
}

export function getAdminProfile() {
  return apiRequest("/admin/profile/me");
}

export function getAdminUsers(filters = {}) {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "" && value !== "all") {
      params.set(key, value);
    }
  });

  const queryString = params.toString();
  return apiRequest(`/admin/users${queryString ? `?${queryString}` : ""}`);
}

export function createAdminUser(userPayload) {
  return apiMutation("/admin/users", {
    method: "POST",
    body: JSON.stringify(userPayload),
  });
}

export function updateAdminUserRole(userId, role) {
  return apiMutation(`/admin/users/${userId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export function updateAdminUserStatus(userId, status) {
  return apiMutation(`/admin/users/${userId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function resetAdminUserPassword(userId) {
  const fallbackTemporaryPassword = generateTemporaryPassword();

  return apiRequestWithFallback(
    `/admin/users/${userId}/reset-password`,
    {
      method: "POST",
      body: JSON.stringify({}),
    },
    () =>
      apiMutation(`/admin/users/${userId}/password`, {
        method: "PATCH",
        body: JSON.stringify({ new_password: fallbackTemporaryPassword }),
      })
        .then((data) => ({
          ...data,
          message: data?.message || "Temporary password generated successfully.",
          data: {
            ...(data?.data || {}),
            user_id: userId,
            temporary_password: fallbackTemporaryPassword,
          },
        }))
  ).then((data) => {
    clearApiCache();
    return data;
  });
}

export function getAdminSettings() {
  return apiRequest("/admin/settings");
}

export function updateAdminSettings(settingsPayload) {
  return apiMutation("/admin/settings", {
    method: "PATCH",
    body: JSON.stringify(settingsPayload),
  });
}

export function getAdminActivity(filters = {}) {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  });

  const queryString = params.toString();
  return apiRequest(`/admin/activity${queryString ? `?${queryString}` : ""}`);
}

export function getAdminLogins(filters = {}) {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  });

  const queryString = params.toString();
  return apiRequest(`/admin/logins${queryString ? `?${queryString}` : ""}`);
}

export function getMyActivity(options = {}) {
  return cachedApiRequest("/activity/me?limit=20", {
    cacheKey: "my-activity:20",
    ttlMs: 20_000,
    forceRefresh: options.forceRefresh,
  });
}

export function getAdminLoginActivity() {
  return getAdminLogins();
}

export function getAdminDisputes() {
  return apiRequest("/admin/disputes");
}

export function getAdminMatches(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "" && value !== "all") {
      params.set(key, value);
    }
  });
  const queryString = params.toString();
  return apiRequest(`/admin/matches${queryString ? `?${queryString}` : ""}`);
}

export function getAdminDispute(matchId) {
  return apiRequestWithFallback(
    `/admin/disputes/${matchId}`,
    {},
    () => apiRequest(`/admin/matches/${matchId}`)
  );
}

export function resolveAdminDispute(matchId, resolutionPayload) {
  return apiMutation(`/admin/matches/${matchId}/resolve`, {
    method: "PATCH",
    body: JSON.stringify(resolutionPayload),
  });
}

export function scheduleMatch(matchPayload) {
  return apiMutation("/matches/schedule", {
    method: "POST",
    body: JSON.stringify(matchPayload),
  });
}

export function submitMatchResult(matchId, matchPayload) {
  return apiMutation(`/matches/${matchId}/submit-result`, {
    method: "POST",
    body: JSON.stringify(matchPayload),
  });
}

export function acceptMatch(matchId) {
  return apiMutation(`/matches/${matchId}/accept`, {
    method: "POST",
  });
}

export function declineMatch(matchId) {
  return apiMutation(`/matches/${matchId}/decline`, {
    method: "POST",
  });
}

export function submitMatch(matchPayload) {
  return scheduleMatch(matchPayload);
}

export function uploadMatchProof(file) {
  const formData = new FormData();
  formData.append("proof_image", file);

  return apiMutation("/matches/upload-proof", {
    method: "POST",
    body: formData,
  });
}

export function getMyMatches(options = {}) {
  const limit = options.limit ?? 200;
  const path = `/matches/my?limit=${limit}`;
  return cachedApiRequest(path, {
    cacheKey: `my-matches:${limit}`,
    ttlMs: 15_000,
    forceRefresh: options.forceRefresh,
  }).then((response) => ({
    ...response,
    data: {
      ...(response?.data || {}),
      requested: Array.isArray(response?.data?.requested)
        ? response.data.requested.map((match) => normalizeMatchRecord(match, getStoredUser()?.id))
        : [],
      matches: Array.isArray(response?.data?.matches)
        ? response.data.matches.map((match) => normalizeMatchRecord(match, getStoredUser()?.id))
        : [],
      waiting_for_result: Array.isArray(response?.data?.waiting_for_result)
        ? response.data.waiting_for_result.map((match) => normalizeMatchRecord(match, getStoredUser()?.id))
        : [],
      awaiting_confirmation: Array.isArray(response?.data?.awaiting_confirmation)
        ? response.data.awaiting_confirmation.map((match) => normalizeMatchRecord(match, getStoredUser()?.id))
        : [],
      confirmed: Array.isArray(response?.data?.confirmed)
        ? response.data.confirmed.map((match) => normalizeMatchRecord(match, getStoredUser()?.id))
        : [],
      disputed: Array.isArray(response?.data?.disputed)
        ? response.data.disputed.map((match) => normalizeMatchRecord(match, getStoredUser()?.id))
        : [],
      closed: Array.isArray(response?.data?.closed)
        ? response.data.closed.map((match) => normalizeMatchRecord(match, getStoredUser()?.id))
        : [],
    },
  }));
}

export function confirmMatch(matchId) {
  return apiMutation(`/matches/${matchId}/confirm`, {
    method: "POST",
  });
}

export function disputeMatch(matchId, disputePayload = {}) {
  return apiMutation(`/matches/${matchId}/dispute`, {
    method: "POST",
    body: JSON.stringify(disputePayload),
  });
}

export function cancelMatch(matchId) {
  return apiMutation(`/matches/${matchId}/cancel`, {
    method: "POST",
  });
}

export function getApiAssetUrl(path) {
  return buildApiAssetUrl(path);
}

export function clearClientApiCache() {
  clearApiCache();
}
