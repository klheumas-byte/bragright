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
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeAuthSession((nextUser) => {
      setUser(normalizeUserRole(nextUser));
    });

    initializeAuth();
    return unsubscribe;
  }, []);

  async function register(credentials) {
    const data = await trackLoading(() => registerUser(credentials));
    const normalizedUser = normalizeUserRole(data.user);
    updateSessionUser(normalizedUser);
    return normalizedUser;
  }

  async function login(credentials) {
    const data = await trackLoading(() => loginUser(credentials));
    const normalizedUser = normalizeUserRole(data.user);
    updateSessionUser(normalizedUser);
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
    }
  }

  async function changePassword(payload) {
    const data = await trackLoading(() => changeCurrentUserPassword(payload));
    const normalizedUser = normalizeUserRole(data.user);
    updateSessionUser(normalizedUser);
    return { ...data, user: normalizedUser };
  }

  async function initializeAuth() {
    removeLegacyStoredAuthentication();
    try {
      const data = await trackLoading(() => restoreSession());
      updateSessionUser(normalizeUserRole(data.user));
    } catch (error) {
      clearAuthSession();
    } finally {
      setIsInitializing(false);
    }
  }

  const value = {
    user,
    isAuthenticated: Boolean(user),
    isInitializing,
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
