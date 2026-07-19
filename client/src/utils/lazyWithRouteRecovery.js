import { lazy } from "react";

export const ROUTE_RECOVERY_PARAMETER = "bragright_route_recovery";
const ROUTE_RECOVERY_TIME_PARAMETER = "bragright_route_recovery_time";

export function isChunkLoadError(error) {
  const message = String(error?.message || error || "");
  return /(?:failed to fetch dynamically imported module|importing a module script failed|loading chunk|chunkloaderror|dynamically imported module)/i.test(message);
}

export function lazyWithRouteRecovery(importer, routeName) {
  return lazy(async () => {
    try {
      const importedModule = await importer();
      clearRecoveryMarker(routeName);
      return importedModule;
    } catch (error) {
      if (typeof window === "undefined" || !isChunkLoadError(error)) {
        throw error;
      }

      const currentUrl = new URL(window.location.href);
      const attemptedRoute = currentUrl.searchParams.get(ROUTE_RECOVERY_PARAMETER);

      if (attemptedRoute === routeName) {
        clearRecoveryMarker(routeName);
        throw error;
      }

      currentUrl.searchParams.set(ROUTE_RECOVERY_PARAMETER, routeName);
      currentUrl.searchParams.set(ROUTE_RECOVERY_TIME_PARAMETER, String(Date.now()));
      window.location.replace(currentUrl.toString());

      // Keep React Suspense pending while the browser moves to the fresh document.
      return new Promise(() => {});
    }
  });
}

function clearRecoveryMarker(routeName) {
  if (typeof window === "undefined") return;

  const currentUrl = new URL(window.location.href);
  if (currentUrl.searchParams.get(ROUTE_RECOVERY_PARAMETER) !== routeName) return;

  currentUrl.searchParams.delete(ROUTE_RECOVERY_PARAMETER);
  currentUrl.searchParams.delete(ROUTE_RECOVERY_TIME_PARAMETER);
  window.history.replaceState(
    window.history.state,
    "",
    `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`
  );
}
