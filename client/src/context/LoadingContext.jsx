import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

const LoadingContext = createContext(null);

export function LoadingProvider({ children }) {
  const location = useLocation();
  const loadingIdsRef = useRef(new Set());
  const nextIdRef = useRef(0);
  const routeRenderedRef = useRef(false);
  const routeEpochRef = useRef(0);
  const routeSafetyTimerRef = useRef(null);
  const routeCompletionTimerRef = useRef(null);
  const progressTimerRef = useRef(null);
  const [activeLoadCount, setActiveLoadCount] = useState(0);
  const [isRouteLoading, setIsRouteLoading] = useState(true);
  const [routeProgress, setRouteProgress] = useState(0.08);

  useEffect(() => {
    routeEpochRef.current += 1;
    routeRenderedRef.current = false;
    setIsRouteLoading(true);
    setRouteProgress(0.08);
    window.clearTimeout(routeSafetyTimerRef.current);
    window.clearTimeout(routeCompletionTimerRef.current);
    window.clearInterval(progressTimerRef.current);

    progressTimerRef.current = window.setInterval(() => {
      setRouteProgress((current) => Math.min(current + Math.max((0.9 - current) * 0.12, 0.015), 0.9));
    }, 180);

    routeSafetyTimerRef.current = window.setTimeout(() => {
      setIsRouteLoading(false);
      setRouteProgress(1);
      window.clearInterval(progressTimerRef.current);
    }, 10000);

    return () => {
      window.clearTimeout(routeSafetyTimerRef.current);
      window.clearTimeout(routeCompletionTimerRef.current);
      window.clearInterval(progressTimerRef.current);
    };
  }, [location.pathname, location.search]);

  const completeRouteIfReady = useCallback(() => {
    if (!routeRenderedRef.current || loadingIdsRef.current.size > 0) {
      return;
    }

    window.clearTimeout(routeCompletionTimerRef.current);
    const routeEpoch = routeEpochRef.current;
    routeCompletionTimerRef.current = window.setTimeout(() => {
      if (
        routeEpoch !== routeEpochRef.current ||
        !routeRenderedRef.current ||
        loadingIdsRef.current.size > 0
      ) {
        return;
      }
      setRouteProgress(1);
      window.clearInterval(progressTimerRef.current);
      window.setTimeout(() => {
        if (routeEpoch === routeEpochRef.current) setIsRouteLoading(false);
      }, 140);
    }, 100);
  }, []);

  const markRouteRendered = useCallback(() => {
    routeRenderedRef.current = true;
    completeRouteIfReady();
  }, [completeRouteIfReady]);

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
    completeRouteIfReady();
  }, [completeRouteIfReady]);

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
      isRouteLoading,
      routeProgress,
      markRouteRendered,
      startLoading,
      stopLoading,
      trackLoading,
    }),
    [activeLoadCount, isRouteLoading, markRouteRendered, routeProgress, startLoading, stopLoading, trackLoading]
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
