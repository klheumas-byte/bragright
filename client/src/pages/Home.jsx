import { useEffect, useState } from "react";
import { getHealthStatus } from "../services/api";

const initialHealthState = {
  loading: true,
  message: "",
  error: "",
};

export default function Home() {
  const [health, setHealth] = useState(initialHealthState);

  useEffect(() => {
    async function loadHealth() {
      try {
        const data = await getHealthStatus();

        setHealth({
          loading: false,
          message: data.message,
          error: "",
        });
      } catch (error) {
        setHealth({
          loading: false,
          message: "",
          error: error.message,
        });
      }
    }

    loadHealth();
  }, []);

  return (
    <section className="page-stack">
      <section className="card hero-card">
        <p className="section-label">Phase 2</p>
        <h2 className="section-title">Clean frontend structure for BragRight</h2>
        <p className="section-copy">
          This page now uses a shared API service file instead of calling{" "}
          <code>fetch</code> directly inside the component. That makes the page
          easier to read and prepares the app for more API calls later.
        </p>
      </section>

      <section className="card">
        <p className="section-label">Backend status</p>
        <h3 className="section-title">Flask API health check</h3>
        <p className="section-copy">
          When this page first appears, React runs an effect that asks Flask for
          the current API status. The component then re-renders based on loading,
          success, or error state.
        </p>

        <div className="feedback-panel">
          <p>
            <strong>Status:</strong>{" "}
            {health.loading ? "Loading API status..." : "Request finished"}
          </p>

          {!health.loading && health.message ? (
            <p className="success-text">
              <strong>Success:</strong> {health.message}
            </p>
          ) : null}

          {health.error ? (
            <p className="error-text">
              <strong>Error:</strong> {health.error}
            </p>
          ) : null}
        </div>
      </section>
    </section>
  );
}
