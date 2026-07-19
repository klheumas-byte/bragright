import { useLoading } from "../context/LoadingContext";

export default function RouteProgress() {
  const { isRouteLoading, routeProgress } = useLoading();

  return (
    <div
      className={`route-progress${isRouteLoading ? " route-progress--active" : ""}`}
      aria-hidden="true"
    >
      <span style={{ transform: `scaleX(${routeProgress})` }} />
    </div>
  );
}
