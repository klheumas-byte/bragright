import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

const EDGE_TOLERANCE = 24;

export default function MobileFastScroll() {
  const location = useLocation();
  const frameRef = useRef(0);
  const [position, setPosition] = useState({ canGoUp: false, canGoDown: false });

  useEffect(() => {
    function updatePosition() {
      frameRef.current = 0;
      const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
      const pageHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      setPosition({
        canGoUp: scrollTop > EDGE_TOLERANCE,
        canGoDown: scrollTop + viewportHeight < pageHeight - EDGE_TOLERANCE,
      });
    }

    function scheduleUpdate() {
      if (!frameRef.current) {
        frameRef.current = window.requestAnimationFrame(updatePosition);
      }
    }

    updatePosition();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    const resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(scheduleUpdate)
      : null;
    resizeObserver?.observe(document.body);
    const routeFrame = window.requestAnimationFrame(updatePosition);

    return () => {
      window.cancelAnimationFrame(routeFrame);
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver?.disconnect();
    };
  }, [location.pathname, location.search]);

  if (!position.canGoUp && !position.canGoDown) return null;

  return (
    <nav className="mobile-fast-scroll" aria-label="Fast page scrolling">
      {position.canGoUp ? (
        <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "auto" })} aria-label="Jump to top of page" title="Jump to top">
          <ArrowIcon direction="up" />
        </button>
      ) : null}
      {position.canGoDown ? (
        <button type="button" onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" })} aria-label="Jump to bottom of page" title="Jump to bottom">
          <ArrowIcon direction="down" />
        </button>
      ) : null}
    </nav>
  );
}

function ArrowIcon({ direction }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={direction === "up" ? "m5 15 7-7 7 7" : "m5 9 7 7 7-7"} />
      <path d={direction === "up" ? "M12 8v12" : "M12 4v12"} />
    </svg>
  );
}
