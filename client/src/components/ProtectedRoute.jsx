import { Navigate, useLocation } from "react-router-dom";
import { PLAYER_HOME_PATH, useAuth } from "../context/AuthContext";
import InitialAppLoader from "./InitialAppLoader";

export default function ProtectedRoute({
  children,
  requireAdmin = false,
  allowedRoles,
  requireSubscription = false,
}) {
  const { isAuthenticated, isInitializing, user } = useAuth();
  const location = useLocation();

  if (isInitializing) {
    return <InitialAppLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (user?.must_change_password === true && location.pathname !== "/account/password") {
    return <Navigate to="/account/password" replace state={{ from: location }} />;
  }

  const isSuperAdmin = user?.role === "admin" || user?.role === "super_admin" || user?.is_admin;
  const roles = Array.isArray(allowedRoles) ? allowedRoles : null;
  if ((requireAdmin && !isSuperAdmin) || (roles && !roles.includes(user?.role))) {
    return <Navigate to={getSafeHomePath(user?.role)} replace />;
  }

  if (
    requireSubscription
    && user?.role === "player"
    && user?.subscription_access === false
  ) {
    return <Navigate to="/payments/status" replace />;
  }

  return children;
}

function getSafeHomePath(role) {
  if (role === "admin" || role === "super_admin") return "/admin/dashboard";
  if (role === "payment_officer") return "/payments/dashboard";
  return PLAYER_HOME_PATH;
}
