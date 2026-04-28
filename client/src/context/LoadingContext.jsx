import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

const LoadingContext = createContext(null);

export function LoadingProvider({ children }) {
  const location = useLocation();
  const loadingIdsRef = useRef(new Set());
  const nextIdRef = useRef(0);
  const [activeLoadCount, setActiveLoadCount] = useState(0);
  const [isRouteLoading, setIsRouteLoading] = useState(true);

  useEffect(() => {
    setIsRouteLoading(true);

    const timeoutId = window.setTimeout(() => {
      setIsRouteLoading(false);
    }, 320);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [location.pathname, location.search, location.hash]);

  const startLoading = useCallback(() => {
    const loadingId = `load-${nextIdRef.current++}`;
    loadingIdsRef.current.add(loadingId);
    setActiveLoadCount(loadingIdsRef.current.size);
    return loadingId;
  }, []);

  const stopLoading = useCallback((loadingId) => {
    if (!loadingId) {
      return;
    }

    loadingIdsRef.current.delete(loadingId);
    setActiveLoadCount(loadingIdsRef.current.size);
  }, []);

  const trackLoading = useCallback(async (asyncWork) => {
    const loadingId = startLoading();

    try {
      return await asyncWork();
    } finally {
      stopLoading(loadingId);
    }
  }, [startLoading, stopLoading]);

  const value = useMemo(
    () => ({
      activeLoadCount,
      isGlobalLoading: isRouteLoading || activeLoadCount > 0,
      isRouteLoading,
      startLoading,
      stopLoading,
      trackLoading,
    }),
    [activeLoadCount, isRouteLoading, startLoading, stopLoading, trackLoading]
  );

  return <LoadingContext.Provider value={value}>{children}</LoadingContext.Provider>;
}

export function useLoading() {
  const context = useContext(LoadingContext);

  if (!context) {
    throw new Error("useLoading must be used inside LoadingProvider.");
  }

  return context;
}
