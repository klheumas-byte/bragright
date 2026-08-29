import { createContext, useContext, useEffect, useState } from "react";
import { useLoading } from "./LoadingContext";
import {
  clearClientApiCache,
  changeCurrentUserPassword,
  getCurrentUser,
  loginUser,
  logoutUser,
  registerUser,
  restoreSession,
} from "../services/api";
import {
  clearAuthSession,
  subscribeAuthSession,
  updateSessionUser,
} from "../services/authSession";

const AuthContext = createContext(null);
const LEGACY_AUTH_STORAGE_KEY = "bragright_user";
export const PLAYER_HOME_PATH = "/dashboard";
export const ADMIN_HOME_PATH = "/admin/dashboard";
export const PAYMENT_HOME_PATH = "/payments/dashboard";

export function AuthProvider({ children }) {
  const { trackLoading } = useLoading();
  const [user, setUser] = useState(null);
  const [authStatus, setAuthStatus] = useState("checking");

  useEffect(() => {
    let retryTimer = null;
    let restoreInFlight = false;
    let disposed = false;
    const unsubscribe = subscribeAuthSession((nextUser) => {
      setUser(normalizeUserRole(nextUser));
      if (nextUser) {
        setAuthStatus("authenticated");
      } else {
        setAuthStatus((current) => current === "checking" ? current : "unauthenticated");
      }
    });

    async function attemptRestore() {
      if (restoreInFlight || disposed) return;
      restoreInFlight = true;
      removeLegacyStoredAuthentication();
      try {
        const data = await trackLoading(() => restoreSession());
        if (disposed) return;
        updateSessionUser(normalizeUserRole(data.user));
        setAuthStatus("authenticated");
      } catch (error) {
        if (disposed) return;
        if (error?.status === 401 || error?.status === 423) {
          clearAuthSession();
          setAuthStatus("unauthenticated");
        } else {
          setAuthStatus("checking");
          retryTimer = window.setTimeout(attemptRestore, 5_000);
        }
      } finally {
        restoreInFlight = false;
      }
    }

    const retryNow = () => {
      window.clearTimeout(retryTimer);
      attemptRestore();
    };
    window.addEventListener("online", retryNow);
    window.addEventListener("focus", retryNow);
    attemptRestore();
    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      window.removeEventListener("online", retryNow);
      window.removeEventListener("focus", retryNow);
      unsubscribe();
    };
  }, []);

  async function register(credentials) {
    const data = await trackLoading(() => registerUser(credentials));
    const normalizedUser = normalizeUserRole(data.user);
    updateSessionUser(normalizedUser);
    setAuthStatus("authenticated");
    return normalizedUser;
  }

  async function login(credentials) {
    const data = await trackLoading(() => loginUser(credentials));
    const normalizedUser = normalizeUserRole(data.user);
    updateSessionUser(normalizedUser);
    setAuthStatus("authenticated");
    return normalizedUser;
  }

  async function refreshCurrentUser() {
    const data = await trackLoading(() => getCurrentUser({ forceRefresh: true }));
    const normalizedUser = normalizeUserRole(data.user);
    updateSessionUser(normalizedUser);
    return normalizedUser;
  }

  async function logout() {
    try {
      await logoutUser();
    } catch (error) {
      // Local session removal must still complete when the network is unavailable.
    } finally {
      clearAuthSession();
      clearClientApiCache();
      setAuthStatus("unauthenticated");
    }
  }

  async function changePassword(payload) {
    const data = await trackLoading(() => changeCurrentUserPassword(payload));
    const normalizedUser = normalizeUserRole(data.user);
    updateSessionUser(normalizedUser);
    return { ...data, user: normalizedUser };
  }

  const value = {
    user,
    authStatus,
    isAuthenticated: authStatus === "authenticated" && Boolean(user),
    isInitializing: authStatus === "checking",
    register,
    login,
    refreshCurrentUser,
    logout,
    changePassword,
    getHomePathForRole,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}

function removeLegacyStoredAuthentication() {
  try {
    localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
  } catch (error) {
    return;
  }
}

function getHomePathForRole(role) {
  if (role === "admin" || role === "super_admin") return ADMIN_HOME_PATH;
  if (role === "payment_officer") return PAYMENT_HOME_PATH;
  return PLAYER_HOME_PATH;
}

function normalizeUserRole(user) {
  if (!user) {
    return user;
  }

  const normalizedRole = user.role || (user.is_admin ? "admin" : "player");
  return {
    ...user,
    role: normalizedRole,
    is_admin: normalizedRole === "admin" || normalizedRole === "super_admin",
  };
}
