import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  clearClientApiCache,
  getAdminProfile,
  getDashboardActions,
  getLeaderboard,
  getMyActivity,
  getMyProfileMatches,
  getPublicPlayerProfile,
  restoreSession,
} from "./api.js";
import { clearAuthSession, getAccessToken } from "./authSession.js";


const originalFetch = globalThis.fetch;
const originalSessionStorage = globalThis.sessionStorage;

function createSessionStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}


function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}


beforeEach(() => {
  globalThis.sessionStorage = createSessionStorage();
  clearAuthSession();
  clearClientApiCache();
});


afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.sessionStorage = originalSessionStorage;
});

test("page refresh restores an unexpired per-tab access session without rotating the cookie", async () => {
  const user = { id: "player-id", username: "Player", role: "player" };
  globalThis.sessionStorage.setItem("bragright_session_v1", JSON.stringify({
    accessToken: "stored-access-token",
    user,
    expiresAt: Date.now() + 60_000,
  }));
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), authorization: options.headers?.Authorization });
    return jsonResponse({ success: true, user });
  };

  const session = await restoreSession();

  assert.equal(session.user.id, user.id);
  assert.equal(getAccessToken(), "stored-access-token");
  assert.equal(requests.length, 1);
  assert.ok(requests[0].url.endsWith("/auth/me"));
  assert.equal(requests[0].authorization, "Bearer stored-access-token");
});

test("expired per-tab sessions are discarded and fall back to the HttpOnly refresh session", async () => {
  const user = { id: "player-id", username: "Player", role: "player" };
  globalThis.sessionStorage.setItem("bragright_session_v1", JSON.stringify({
    accessToken: "expired-access-token",
    user,
    expiresAt: Date.now() - 1,
  }));
  globalThis.fetch = async (url) => {
    assert.ok(String(url).endsWith("/auth/refresh"));
    return jsonResponse({
      success: true,
      access_token: "new-access-token",
      expires_in: 900,
      user,
    });
  };

  await restoreSession();

  assert.equal(getAccessToken(), "new-access-token");
});


test("simultaneous protected requests use one refresh operation", async () => {
  let refreshCalls = 0;
  const protectedCalls = new Map();

  globalThis.fetch = async (url, options = {}) => {
    const requestUrl = String(url);

    if (requestUrl.endsWith("/auth/refresh")) {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return jsonResponse({
        success: true,
        access_token: "refreshed-access-token",
        user: {
          id: "507f1f77bcf86cd799439011",
          username: "player",
          email: "player@example.com",
          role: "player",
          status: "active",
        },
      });
    }

    const callCount = (protectedCalls.get(requestUrl) || 0) + 1;
    protectedCalls.set(requestUrl, callCount);
    if (options.headers?.Authorization !== "Bearer refreshed-access-token") {
      return jsonResponse(
        {
          success: false,
          message: "Access token has expired.",
          auth_error: "token_expired",
        },
        401
      );
    }

    if (requestUrl.endsWith("/admin/profile/me")) {
      return jsonResponse({ success: true, data: {} });
    }
    return jsonResponse({ success: true, data: { items: [] } });
  };

  await Promise.all([getAdminProfile(), getDashboardActions()]);

  assert.equal(refreshCalls, 1);
  assert.deepEqual([...protectedCalls.values()], [2, 2]);
});


test("equivalent leaderboard requests share one in-flight request", async () => {
  let leaderboardCalls = 0;

  globalThis.fetch = async (url) => {
    if (String(url).includes("/leaderboard")) {
      leaderboardCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return jsonResponse({
        success: true,
        data: { leaderboard: [], page: 1, limit: 100, total: 0, pages: 0 },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  await Promise.all([
    getLeaderboard(),
    getLeaderboard({ page: 1, limit: 100 }),
  ]);

  assert.equal(leaderboardCalls, 1);
});

test("leaderboard search and current-player context stay server-side and preserve pagination", async () => {
  const requestedUrls = [];
  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return jsonResponse({
      success: true,
      data: { leaderboard: [], page: 3, limit: 20, total: 0, pages: 0 },
    });
  };

  await getLeaderboard({
    page: 3,
    limit: 20,
    search: "  Maya Chen  ",
    playerId: "player-id",
  });

  assert.equal(requestedUrls.length, 1);
  const requestUrl = new URL(requestedUrls[0], "http://localhost");
  assert.equal(requestUrl.pathname.endsWith("/leaderboard"), true);
  assert.equal(requestUrl.searchParams.get("page"), "3");
  assert.equal(requestUrl.searchParams.get("limit"), "20");
  assert.equal(requestUrl.searchParams.get("search"), "Maya Chen");
  assert.equal(requestUrl.searchParams.get("player_id"), "player-id");
});


test("dashboard activity uses a small page and force refresh supports retry", async () => {
  const requestedUrls = [];

  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return jsonResponse({
      success: true,
      data: { logs: [], page: 1, limit: 5, total: 0, pages: 0 },
    });
  };

  await getMyActivity({ page: 1, limit: 5 });
  await getMyActivity({ page: 1, limit: 5 });
  await getMyActivity({ page: 1, limit: 5, forceRefresh: true });

  assert.equal(requestedUrls.length, 2);
  assert.ok(requestedUrls.every((url) => url.endsWith("/activity/me?page=1&limit=5&category=all")));
});


test("profile history requests bounded pages and caches identical reads", async () => {
  const requestedUrls = [];

  globalThis.fetch = async (url) => {
    requestedUrls.push(String(url));
    return jsonResponse({
      success: true,
      data: { matches: [], page: 2, limit: 8, total: 0, pages: 0 },
    });
  };

  await getMyProfileMatches({ page: 2, limit: 8 });
  await getMyProfileMatches({ page: 2, limit: 8 });

  assert.equal(requestedUrls.length, 1);
  assert.ok(requestedUrls[0].endsWith("/profile/me/matches?page=2&limit=8"));
});


test("public player profiles deduplicate reads and support forced retry", async () => {
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse({
      success: true,
      data: { id: "player", username: "Player" },
    });
  };

  await getPublicPlayerProfile("player");
  await getPublicPlayerProfile("player");
  await getPublicPlayerProfile("player", { forceRefresh: true });

  assert.equal(calls, 2);
});
