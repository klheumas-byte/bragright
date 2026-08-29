import { useEffect } from "react";
import { useAuth } from "./AuthContext";
import { startRealtime, stopRealtime } from "../services/realtime";

export default function RealtimeProvider({ children }) {
  const { user, authStatus } = useAuth();

  useEffect(() => {
    if (authStatus === "authenticated" && user?.id) startRealtime(user.id);
    else stopRealtime();
    return () => stopRealtime();
  }, [authStatus, user?.id]);

  return children;
}
