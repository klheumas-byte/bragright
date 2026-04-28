import { useLoading } from "../context/LoadingContext";

export default function GlobalLoadingBar() {
  const { isGlobalLoading } = useLoading();

  return (
    <div
      className={`global-loading-bar${isGlobalLoading ? " global-loading-bar-active" : ""}`}
      aria-hidden="true"
    />
  );
}
