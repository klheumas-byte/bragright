import { AUTH_STORAGE_KEY } from "../context/AuthContext";

const API_BASE_URL = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

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
    throw new Error("Could not reach the backend API. Make sure Flask is running on port 5000.");
  }

  const responseText = await response.text();
  const data = parseJsonResponse(responseText);

  if (!response.ok) {
    throw new Error(
      data?.message ||
        getDefaultApiErrorMessage(response.status, requestUrl)
    );
  }

  if (!data) {
    throw new Error("The backend returned an empty response.");
  }

  return data;
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
  const storedUser = localStorage.getItem(AUTH_STORAGE_KEY);

  if (!storedUser) {
    return null;
  }

  try {
    return JSON.parse(storedUser);
  } catch (error) {
    localStorage.removeItem(AUTH_STORAGE_KEY);
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

  return `The API request failed with status ${status}. Make sure Flask is running on port 5000.`;
}

function shouldRetryWithFallback(error) {
  const message = String(error?.message || "");
  return (
    message.includes("was not found") ||
    message.includes("status 404") ||
    message.includes("status 405")
  );
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

function parseJsonResponse(responseText) {
  if (!responseText) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch (error) {
    throw new Error("The backend returned a response that was not valid JSON.");
  }
}

export function getHealthStatus() {
  return apiRequest("/health");
}

export function registerUser(credentials) {
  return apiRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

export function loginUser(credentials) {
  return apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

export function getCurrentUser() {
  return apiRequest("/auth/me");
}

export function getMyProfile() {
  return apiRequestWithFallback(
    "/profile/me",
    {},
    async () => {
      const [currentUserResponse, matchesResponse] = await Promise.all([
        getCurrentUser(),
        getMyMatches(),
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
  );
}

export function getMyProfileMatches() {
  return apiRequestWithFallback(
    "/profile/me/matches",
    {},
    async () => {
      const currentUser = getStoredUser() || {};
      const response = await getMyMatches();
      const matches = Array.isArray(response?.data?.matches) ? response.data.matches : [];

      return {
        success: true,
        message: "Your profile matches loaded successfully.",
        data: {
          matches: matches.map((match) => normalizeLegacyProfileMatch(match, currentUser.id)),
        },
      };
    }
  );
}

export function updateMyProfile({ userId, username, image } = {}) {
  return apiRequest("/profile/update", {
    method: "POST",
    body: JSON.stringify({
      user_id: userId,
      username,
      image,
    }),
  });
}

export function getPlayers() {
  return apiRequest("/players");
}

export function getLeaderboard() {
  return apiRequest("/leaderboard");
}

export function getPublicPlayerProfile(playerId) {
  return apiRequest(`/players/${playerId}`);
}

export function getHeadToHead(playerAId, playerBId) {
  return apiRequest(`/head-to-head/${playerAId}/${playerBId}`);
}

export function getDashboardNotifications() {
  return apiRequest("/dashboard/notifications");
}

export function getDashboardActions() {
  return apiRequest("/dashboard/actions");
}

export function getDashboardSummary() {
  return apiRequest("/dashboard/summary");
}

export function getDashboardActionCenter() {
  return apiRequest("/dashboard/action-center");
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
  return apiRequest("/admin/users", {
    method: "POST",
    body: JSON.stringify(userPayload),
  });
}

export function updateAdminUserRole(userId, role) {
  return apiRequest(`/admin/users/${userId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export function updateAdminUserStatus(userId, status) {
  return apiRequest(`/admin/users/${userId}/status`, {
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
      apiRequest(`/admin/users/${userId}/password`, {
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
  );
}

export function getAdminSettings() {
  return apiRequest("/admin/settings");
}

export function updateAdminSettings(settingsPayload) {
  return apiRequest("/admin/settings", {
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

export function getMyActivity() {
  return apiRequest("/activity/me");
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
  return apiRequest(`/admin/disputes/${matchId}`);
}

export function resolveAdminDispute(matchId, resolutionPayload) {
  return apiRequest(`/admin/matches/${matchId}/resolve`, {
    method: "PATCH",
    body: JSON.stringify(resolutionPayload),
  });
}

export function scheduleMatch(matchPayload) {
  return apiRequest("/matches/schedule", {
    method: "POST",
    body: JSON.stringify(matchPayload),
  });
}

export function submitMatchResult(matchId, matchPayload) {
  return apiRequest(`/matches/${matchId}/submit-result`, {
    method: "POST",
    body: JSON.stringify(matchPayload),
  });
}

export function acceptMatch(matchId) {
  return apiRequest(`/matches/${matchId}/accept`, {
    method: "POST",
  });
}

export function declineMatch(matchId) {
  return apiRequest(`/matches/${matchId}/decline`, {
    method: "POST",
  });
}

export function submitMatch(matchPayload) {
  return scheduleMatch(matchPayload);
}

export function uploadMatchProof(file) {
  const formData = new FormData();
  formData.append("proof_image", file);

  return apiRequest("/matches/upload-proof", {
    method: "POST",
    body: formData,
  });
}

export function getMyMatches() {
  return apiRequest("/matches/my").then((response) => ({
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
  return apiRequest(`/matches/${matchId}/confirm`, {
    method: "POST",
  });
}

export function disputeMatch(matchId, disputePayload = {}) {
  return apiRequest(`/matches/${matchId}/dispute`, {
    method: "POST",
    body: JSON.stringify(disputePayload),
  });
}

export function cancelMatch(matchId) {
  return apiRequest(`/matches/${matchId}/cancel`, {
    method: "POST",
  });
}

export function getApiAssetUrl(path) {
  return buildApiAssetUrl(path);
}
