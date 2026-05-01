import { createContext, useContext, useEffect, useState } from "react";
import { useLoading } from "./LoadingContext";
import { getCurrentUser, loginUser, logoutUser, registerUser } from "../services/api";

const AuthContext = createContext(null);
export const AUTH_STORAGE_KEY = "bragright_user";
export const PLAYER_HOME_PATH = "/dashboard";
export const ADMIN_HOME_PATH = "/admin/dashboard";

export function AuthProvider({ children }) {
  const { trackLoading } = useLoading();
  const [user, setUser] = useState(null);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    initializeAuth();
  }, []);

  async function register(credentials) {
    const data = await trackLoading(() => registerUser(credentials));
    persistUser(data.user);
    return data.user;
  }

  async function login(credentials) {
    const data = await trackLoading(() => loginUser(credentials));
    persistUser(data.user);
    return data.user;
  }

  async function refreshCurrentUser() {
    const data = await trackLoading(() => getCurrentUser());
    persistUser(data.user);
    return data.user;
  }

  function logout() {
    if (user?.id) {
      logoutUser().catch(() => null);
    }

    setUser(null);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }

  async function initializeAuth() {
    const storedUser = readStoredUser();

    if (!storedUser?.id) {
      setIsInitializing(false);
      return;
    }

    try {
      const data = await trackLoading(() => getCurrentUser());
      persistUser(data.user);
    } catch (error) {
      logout();
    } finally {
      setIsInitializing(false);
    }
  }

  function persistUser(nextUser) {
    const normalizedUser = normalizeUserRole(nextUser);
    setUser(normalizedUser);
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(normalizedUser));
  }

  const value = {
    user,
    isAuthenticated: Boolean(user),
    isInitializing,
    register,
    login,
    refreshCurrentUser,
    logout,
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

function readStoredUser() {
  const storedUser = localStorage.getItem(AUTH_STORAGE_KEY);

  if (!storedUser) {
    return null;
  }

  try {
    return normalizeUserRole(JSON.parse(storedUser));
  } catch (error) {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return null;
  }
}

function getHomePathForRole(role) {
  return role === "admin" ? ADMIN_HOME_PATH : PLAYER_HOME_PATH;
}

function normalizeUserRole(user) {
  if (!user) {
    return user;
  }

  const normalizedRole = user.role || (user.is_admin ? "admin" : "player");
  return {
    ...user,
    role: normalizedRole,
    is_admin: normalizedRole === "admin",
  };
}
