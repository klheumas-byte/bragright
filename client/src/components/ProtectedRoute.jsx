import { Navigate, useLocation } from "react-router-dom";
import { PLAYER_HOME_PATH, useAuth } from "../context/AuthContext";
import InitialAppLoader from "./InitialAppLoader";

export default function ProtectedRoute({ children, requireAdmin = false }) {
  const { isAuthenticated, isInitializing, user } = useAuth();
  const location = useLocation();

  if (isInitializing) {
    return <InitialAppLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (requireAdmin && user?.role !== "admin" && !user?.is_admin) {
    return <Navigate to={PLAYER_HOME_PATH} replace />;
  }

  return children;
}
