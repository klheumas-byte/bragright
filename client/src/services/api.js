import {
  clearAuthSession,
  getAccessToken,
  getSessionUser,
  restoreStoredAuthSession,
  setAuthSession,
} from "./authSession.js";

const API_BASE_URL = resolveApiBaseUrl(import.meta.env?.VITE_API_BASE_URL);
const responseCache = new Map();
const pendingGetRequests = new Map();
const DEFAULT_GET_CACHE_TTL_MS = 15_000;
const API_TIMEOUT_MS = parsePositiveInteger(
  import.meta.env?.VITE_API_TIMEOUT_MS,
  15_000
);
let refreshPromise = null;

async function apiRequest(path, options = {}) {
  let response;
  const {
    skipAuthentication = false,
    skipAuthRefresh = false,
    ...fetchOptions
  } = options;
  const requestUrl = buildApiUrl(path);
  const isFormDataBody =
    typeof FormData !== "undefined" && fetchOptions.body instanceof FormData;
  const accessToken = skipAuthentication ? null : getAccessToken();
  const requestHeaders = {
    ...(isFormDataBody ? {} : { "Content-Type": "application/json" }),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(fetchOptions.headers || {}),
  };

  try {
    response = await fetchWithTimeout(requestUrl, {
      ...fetchOptions,
      headers: requestHeaders,
      credentials: "include",
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("The API request timed out. Please try again.");
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new Error("You appear to be offline. Reconnect and try again.");
    }
    throw new Error(
      "The network connection was interrupted. Please try again."
    );
  }

  const responseText = await response.text();
  const data = parseJsonResponse(responseText, response.headers.get("content-type"), requestUrl);

  if (!response.ok) {
    const error = createApiError(
      response.status,
      data?.error?.message ||
        data?.message ||
        getDefaultApiErrorMessage(response.status, requestUrl)
    );
    error.code = data?.error?.code || null;
    error.requestId =
      data?.request_id || response.headers.get("X-Request-ID") || null;
    error.retryAfter = Number.parseInt(
      response.headers.get("Retry-After") || "0",
      10
    );

    if (response.status === 401 && !skipAuthRefresh) {
      try {
        await refreshAuthentication();
        return await apiRequest(path, {
          ...options,
          skipAuthRefresh: true,
        });
      } catch (refreshError) {
        handleAuthFailure(refreshError?.status || 401);
        throw refreshError;
      }
    }

    if (response.status === 423 && !skipAuthentication) {
      handleAuthFailure(response.status);
    }
    throw error;
  }

  if (!data) {
    throw createApiError(500, "The backend returned an empty response.");
  }

  return data;
}

function establishSessionFromResponse(data) {
  if (!data?.access_token || !data?.user) {
    throw createApiError(500, "The backend did not return a complete authenticated session.");
  }

  setAuthSession({
    accessToken: data.access_token,
    user: data.user,
    expiresIn: data.expires_in,
  });
  return data;
}

async function refreshAuthentication() {
  if (refreshPromise) {
    return refreshPromise;
  }

  const currentRefreshPromise = apiRequest("/auth/refresh", {
    method: "POST",
    skipAuthentication: true,
    skipAuthRefresh: true,
  })
    .then(establishSessionFromResponse)
    .catch((error) => {
      clearAuthSession();
      clearApiCache();
      throw error;
    })
    .finally(() => {
      if (refreshPromise === currentRefreshPromise) {
        refreshPromise = null;
      }
    });

  refreshPromise = currentRefreshPromise;
  return currentRefreshPromise;
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
  const randomValues = new Uint32Array(length);
  globalThis.crypto.getRandomValues(randomValues);
  let password = "";

  for (let index = 0; index < length; index += 1) {
    password += alphabet[randomValues[index] % alphabet.length];
  }

  return password;
}

function getCurrentSessionUser() {
  return getSessionUser();
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

function parsePositiveInteger(rawValue, fallback) {
  const parsedValue = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const upstreamSignal = options.signal;
  const abortFromUpstream = () => controller.abort();
  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort();
    } else {
      upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
    }
  }
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } finally {
    clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
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
  const messages = {
    401: "Your session is no longer valid. Please log in again.",
    403: "You do not have permission to perform this action.",
    404: "The requested service route was not found.",
    409: "This action conflicts with a newer change. Refresh and try again.",
    422: "Some submitted information is invalid. Review it and try again.",
    429: "Too many requests. Please wait and try again.",
    500: "The service hit an unexpected error. Please try again.",
  };
  return (
    messages[status] ||
    `The service request failed with status ${status}. Please try again.`
  );
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
  const playerOneProfile = match?.player_one || {};
  const playerTwoProfile = match?.player_two || {};
  const opponentProfile = isPlayerOne
    ? playerTwoProfile
    : isPlayerTwo
      ? playerOneProfile
      : match?.opponent || {};
  const status = match?.status || "unknown";
  const result = match?.result || "pending";
  const resultLabel =
    match?.result_label ||
    ({ win: "W", loss: "L", draw: "D" }[result] || "-");

  return {
    ...match,
    id: match?.id || "",
    opponent: {
      id: opponentId || "",
      username: opponentUsername || "Unknown opponent",
      profile_image:
        match?.opponent?.profile_image ||
        opponentProfile?.profile_image ||
        "",
    },
    player_one: {
      id: playerOneId,
      username: playerOneName,
      profile_image: playerOneProfile?.profile_image || "",
    },
    player_two: {
      id: playerTwoId,
      username: playerTwoName,
      profile_image: playerTwoProfile?.profile_image || "",
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
    display_status: match?.display_status || "Status unavailable",
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
        "The service returned an unexpected response. Please try again."
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
  if (status !== 401 && status !== 423) {
    return;
  }

  clearApiCache();
  clearAuthSession();
}

function clearApiCache() {
  responseCache.clear();
  pendingGetRequests.clear();
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
    skipAuthentication: true,
    skipAuthRefresh: true,
  }).then(establishSessionFromResponse);
}

export function loginUser(credentials) {
  return apiMutation("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
    skipAuthentication: true,
    skipAuthRefresh: true,
  }).then(establishSessionFromResponse);
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
    skipAuthRefresh: true,
  }).finally(() => {
    clearAuthSession();
    clearApiCache();
  });
}

export function changeCurrentUserPassword(payload) {
  return apiMutation("/auth/password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function restoreSession() {
  const storedSession = restoreStoredAuthSession();
  if (!storedSession) return refreshAuthentication();

  return apiRequest("/auth/me", { skipAuthRefresh: true })
    .then((data) => {
      setAuthSession({
        accessToken: storedSession.accessToken,
        user: data.user,
        expiresAt: storedSession.expiresAt,
      });
      return data;
    })
    .catch((error) => {
      if (error?.status === 401 || error?.status === 423) {
        return refreshAuthentication();
      }

      // A valid, unexpired access token can keep the shell available during a
      // temporary network interruption; protected API calls still enforce it.
      return { success: true, user: storedSession.user, restored_offline: true };
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
  const page = parsePositiveInteger(options.page, 1);
  const limit = Math.min(parsePositiveInteger(options.limit, 25), 100);
  const cacheKey = `my-profile-matches:${page}:${limit}`;

  if (!options.forceRefresh) {
    const cachedEntry = responseCache.get(cacheKey);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      return Promise.resolve(cachedEntry.data);
    }
  }

  return apiRequestWithFallback(
    `/profile/me/matches?page=${page}&limit=${limit}`,
    {},
    async () => {
      const currentUser = getCurrentSessionUser() || {};
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
      responseCache.set(cacheKey, {
        data,
        expiresAt: Date.now() + 20_000,
      });
    }
    return data;
  });
}

export function updateMyProfile({ username, image } = {}) {
  return apiMutation("/profile/update", {
    method: "POST",
    body: JSON.stringify({
      username,
      image,
    }),
  });
}

export function getPlayers(options = {}) {
  const page = parsePositiveInteger(options.page, 1);
  const limit = Math.min(parsePositiveInteger(options.limit, 100), 200);
  const search = String(options.search || "").trim().replace(/\s+/g, " ").slice(0, 64);
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  });
  if (search) {
    params.set("search", search);
  }
  return cachedApiRequest(`/players?${params.toString()}`, {
    cacheKey: `players:${page}:${limit}:${search.toLocaleLowerCase()}`,
    ttlMs: 300_000,
    forceRefresh: options.forceRefresh,
  });
}

export function getLeaderboard(options = {}) {
  const page = parsePositiveInteger(options.page, 1);
  const limit = Math.min(parsePositiveInteger(options.limit, 100), 200);
  const search = String(options.search || "").trim().replace(/\s+/g, " ").slice(0, 64);
  const playerId = String(options.playerId || "").trim();
  const category = String(options.category || "").trim();
  const scope = String(options.scope || "").trim();
  const params = new URLSearchParams();
  if (options.page || options.limit || search || playerId) {
    params.set("page", String(page));
    params.set("limit", String(limit));
  }
  if (search) {
    params.set("search", search);
  }
  if (playerId) {
    params.set("player_id", playerId);
  }
  if (category) params.set("category", category);
  if (scope) params.set("scope", scope);
  const queryString = params.toString();
  const path = `/leaderboard${queryString ? `?${queryString}` : ""}`;
  const cacheKey = `leaderboard:${page}:${limit}:${search.toLocaleLowerCase()}:${playerId}:${category}:${scope}`;

  return cachedApiRequest(path, {
    cacheKey,
    ttlMs: 30_000,
    forceRefresh: options.forceRefresh,
  });
}

export function getPublicPlayerProfile(playerId, options = {}) {
  return cachedApiRequest(`/players/${playerId}`, {
    cacheKey: `public-player-profile:${playerId}`,
    ttlMs: 30_000,
    forceRefresh: options.forceRefresh,
  });
}

export function getPlayerStatistics(playerId, options = {}) {
  const scope = String(options.scope || "all_time").trim();
  return cachedApiRequest(
    `/players/${encodeURIComponent(playerId)}/statistics?scope=${encodeURIComponent(scope)}`,
    {
      cacheKey: `player-statistics:${playerId}:${scope}`,
      ttlMs: 30_000,
      forceRefresh: options.forceRefresh,
    }
  );
}

export function getHeadToHead(playerAId, playerBId) {
  return apiRequest(`/head-to-head/${playerAId}/${playerBId}`);
}

export function getDashboardNotifications() {
  const currentUser = getCurrentSessionUser();
  const usePaymentNotifications = currentUser?.role === "payment_officer"
    || currentUser?.subscription_access === false;
  const path = usePaymentNotifications ? "/payments/notifications" : "/dashboard/notifications";
  return cachedApiRequest(path, {
    cacheKey: usePaymentNotifications ? "payment-notifications" : "dashboard-notifications",
    ttlMs: 10_000,
  });
}

export function getDashboardActions(options = {}) {
  return cachedApiRequest("/dashboard/actions", {
    cacheKey: "dashboard-actions",
    ttlMs: 10_000,
    forceRefresh: options.forceRefresh,
  });
}

export function getDashboardSummary(options = {}) {
  return cachedApiRequest("/dashboard/summary", {
    cacheKey: "dashboard-summary",
    ttlMs: 10_000,
    forceRefresh: options.forceRefresh,
  });
}

export function getDashboardActionCenter(options = {}) {
  return cachedApiRequest("/dashboard/action-center", {
    cacheKey: "dashboard-action-center",
    ttlMs: 10_000,
    forceRefresh: options.forceRefresh,
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
  const temporaryPassword = generateTemporaryPassword();
  return apiMutation("/admin/users", {
    method: "POST",
    body: JSON.stringify({
      ...userPayload,
      temporary_password: temporaryPassword,
    }),
  }).then((data) => ({
    ...data,
    data: {
      ...(data?.data || {}),
      temporary_password: temporaryPassword,
    },
  }));
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

  return apiMutation(`/admin/users/${userId}/password`, {
    method: "PATCH",
    body: JSON.stringify({ new_password: fallbackTemporaryPassword }),
  }).then((data) => ({
    ...data,
    message: data?.message || "Temporary password generated successfully.",
    data: {
      ...(data?.data || {}),
      user_id: userId,
      temporary_password: fallbackTemporaryPassword,
    },
  }));
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
  const page = parsePositiveInteger(options.page, 1);
  const limit = Math.min(parsePositiveInteger(options.limit, 20), 100);
  const category = String(options.category || "all").trim().toLowerCase();

  return cachedApiRequest(`/activity/me?page=${page}&limit=${limit}&category=${encodeURIComponent(category)}`, {
    cacheKey: `my-activity:${page}:${limit}:${category}`,
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

export function declineMatch(matchId, payload = {}) {
  return apiMutation(`/matches/${matchId}/decline`, {
    method: "POST",
    body: JSON.stringify(payload),
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
  const page = parsePositiveInteger(options.page, 1);
  const limit = Math.min(parsePositiveInteger(options.limit, 20), 100);
  const view = String(options.view || "all").trim().toLowerCase();
  const path = `/matches/my?page=${page}&limit=${limit}&view=${encodeURIComponent(view)}`;
  return cachedApiRequest(path, {
    cacheKey: `my-matches:${page}:${limit}:${view}`,
    ttlMs: 5_000,
    forceRefresh: options.forceRefresh,
  }).then((response) => ({
    ...response,
    data: {
      ...(response?.data || {}),
      requested: Array.isArray(response?.data?.requested)
        ? response.data.requested.map((match) => normalizeMatchRecord(match, getCurrentSessionUser()?.id))
        : [],
      matches: Array.isArray(response?.data?.matches)
        ? response.data.matches.map((match) => normalizeMatchRecord(match, getCurrentSessionUser()?.id))
        : [],
      waiting_for_result: Array.isArray(response?.data?.waiting_for_result)
        ? response.data.waiting_for_result.map((match) => normalizeMatchRecord(match, getCurrentSessionUser()?.id))
        : [],
      awaiting_confirmation: Array.isArray(response?.data?.awaiting_confirmation)
        ? response.data.awaiting_confirmation.map((match) => normalizeMatchRecord(match, getCurrentSessionUser()?.id))
        : [],
      confirmed: Array.isArray(response?.data?.confirmed)
        ? response.data.confirmed.map((match) => normalizeMatchRecord(match, getCurrentSessionUser()?.id))
        : [],
      disputed: Array.isArray(response?.data?.disputed)
        ? response.data.disputed.map((match) => normalizeMatchRecord(match, getCurrentSessionUser()?.id))
        : [],
      closed: Array.isArray(response?.data?.closed)
        ? response.data.closed.map((match) => normalizeMatchRecord(match, getCurrentSessionUser()?.id))
        : [],
    },
  }));
}

export function getMatchDetail(matchId, options = {}) {
  return cachedApiRequest(`/matches/${matchId}`, {
    cacheKey: `match-detail:${matchId}`,
    ttlMs: 5_000,
    forceRefresh: options.forceRefresh,
  }).then((response) => ({
    ...response,
    data: normalizeMatchRecord(
      response?.data || response?.match,
      getCurrentSessionUser()?.id
    ),
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

export async function fetchProtectedAsset(path, { skipAuthRefresh = false } = {}) {
  const accessToken = getAccessToken();
  const response = await fetchWithTimeout(buildApiAssetUrl(path), {
    method: "GET",
    credentials: "include",
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });

  if (response.status === 401 && !skipAuthRefresh) {
    await refreshAuthentication();
    return fetchProtectedAsset(path, { skipAuthRefresh: true });
  }
  if (!response.ok) {
    let message = "Could not load the protected asset.";
    try {
      const payload = await response.json();
      message = payload?.error?.message || payload?.message || message;
    } catch (error) {
      // Asset errors are allowed to fall back to the safe generic message.
    }
    throw createApiError(response.status, message);
  }
  return response.blob();
}

export function clearClientApiCache() {
  clearApiCache();
}

function financialQuery(path, filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "" && value !== "all") {
      params.set(key, value);
    }
  });
  const query = params.toString();
  return apiRequest(`${path}${query ? `?${query}` : ""}`);
}

export function getSubscriptionStatus(billingMonth) {
  return financialQuery("/payments/subscription/me", { billing_month: billingMonth });
}

export function getPaymentSettings() {
  return apiRequest("/payments/settings");
}

export function getPaymentDashboard(filters = {}) {
  return financialQuery("/payments/dashboard", filters);
}

export function searchSubscriptionPlayers(filters = {}) {
  return financialQuery("/payments/players", filters);
}

export function getPayments(filters = {}) {
  return financialQuery("/payments/payments", filters);
}

export function recordManualPayment(payload) {
  return apiMutation("/payments/payments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function submitPlayerPayment(payload) {
  return apiMutation("/payments/submissions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function uploadPaymentProof(file) {
  const formData = new FormData();
  formData.append("proof_image", file);
  return apiMutation("/payments/upload-proof", {
    method: "POST",
    body: formData,
  });
}

export function getRemittances(filters = {}) {
  return financialQuery("/payments/remittances", filters);
}

export function submitRemittance(payload) {
  return apiMutation("/payments/remittances", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function reviewRemittance(remittanceId, payload) {
  return apiMutation(`/payments/remittances/${remittanceId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function grantSubscriptionExemption(payload) {
  return apiMutation("/payments/exemptions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function reverseManualPayment(paymentId, payload) {
  return apiMutation(`/payments/payments/${paymentId}/reverse`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function verifyManualPayment(paymentId) {
  return apiMutation(`/payments/payments/${paymentId}/verify`, {
    method: "POST",
  });
}

export function rejectPlayerPayment(paymentId, reason) {
  return apiMutation(`/payments/payments/${paymentId}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function runMonthlyBilling(payload) {
  return apiMutation("/payments/billing/run", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getFinancialAudit() {
  return apiRequest("/payments/audit");
}
