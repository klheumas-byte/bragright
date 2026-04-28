import { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { useLoading } from "./LoadingContext";
import { getPlayers } from "../services/api";

const PlayerDirectoryContext = createContext(null);

export function PlayerDirectoryProvider({ children }) {
  const { isAuthenticated, isInitializing } = useAuth();
  const { trackLoading } = useLoading();
  const [players, setPlayers] = useState([]);
  const [isLoadingPlayers, setIsLoadingPlayers] = useState(false);
  const [playersError, setPlayersError] = useState("");

  useEffect(() => {
    if (isInitializing) {
      return;
    }

    if (!isAuthenticated) {
      setPlayers([]);
      setPlayersError("");
      setIsLoadingPlayers(false);
      return;
    }

    refreshPlayers();
  }, [isAuthenticated, isInitializing]);

  async function refreshPlayers() {
    try {
      setIsLoadingPlayers(true);
      setPlayersError("");
      const data = await trackLoading(() => getPlayers());
      setPlayers(data.data.players);
      return data.data.players;
    } catch (error) {
      setPlayersError(error.message);
      setPlayers([]);
      return [];
    } finally {
      setIsLoadingPlayers(false);
    }
  }

  const value = {
    players,
    isLoadingPlayers,
    playersError,
    refreshPlayers,
  };

  return <PlayerDirectoryContext.Provider value={value}>{children}</PlayerDirectoryContext.Provider>;
}

export function usePlayerDirectory() {
  const context = useContext(PlayerDirectoryContext);

  if (!context) {
    throw new Error("usePlayerDirectory must be used inside PlayerDirectoryProvider.");
  }

  return context;
}
