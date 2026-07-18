import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ActivityList from "../components/ActivityList";
import ActivitySkeleton from "../components/ActivitySkeleton";
import ErrorState from "../components/ErrorState";
import SidebarIcon from "../components/SidebarIcon";
import { PLAYER_ACTIVITY_FILTERS } from "../components/activityPresentation";
import { Button, Card, EmptyState, PageSection, Select } from "../components/ui";
import { useLoading } from "../context/LoadingContext";
import DashboardLayout from "../layouts/DashboardLayout";
import { getMyActivity } from "../services/api";

const PAGE_SIZE = 12;
const EMPTY_PAGINATION = { page: 1, limit: PAGE_SIZE, total: 0, pages: 0, has_next: false, has_previous: false };

export default function MyActivity() {
  const { trackLoading } = useLoading();
  const requestIdRef = useRef(0);
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(1);
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState(EMPTY_PAGINATION);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadMyActivity();
  }, [category, page]);

  async function loadMyActivity({ forceRefresh = false } = {}) {
    const requestId = ++requestIdRef.current;
    try {
      setIsLoading(true);
      setError("");
      const response = await trackLoading(() => getMyActivity({ page, limit: PAGE_SIZE, category, forceRefresh }));
      if (requestId !== requestIdRef.current) return;
      const data = response?.data || {};
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setPagination({ ...EMPTY_PAGINATION, ...data });
    } catch (requestError) {
      if (requestId !== requestIdRef.current) return;
      setError(requestError.message || "Could not load your activity.");
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }

  function changeCategory(event) {
    setCategory(event.target.value);
    setPage(1);
  }

  return (
    <DashboardLayout title="My Activity" description="Follow every move in your private competitive journey.">
      <section className="feature-hero-card">
        <SidebarIcon name="activity" className="arena-hero-icon" decorative />
        <div>
          <p className="section-label">Activity</p>
          <h2 className="feature-hero-title">Understand what happened at a glance.</h2>
        </div>
        <div className="feature-callout">
          <p className="feature-callout-label">Recorded events</p>
          <p className="feature-callout-value">{pagination.total}</p>
        </div>
      </section>

      <PageSection
        title="Your timeline"
        description="Newest events appear first. Match links open the authoritative record."
        actions={<Button variant="ghost" size="sm" onClick={() => loadMyActivity({ forceRefresh: true })} disabled={isLoading}><SidebarIcon name="activity" decorative /> Refresh</Button>}
      >
        <Card className="activity-controls">
          <label className="form-field activity-filter-field">
            Activity category
            <Select value={category} onChange={changeCategory}>
              {PLAYER_ACTIVITY_FILTERS.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
            </Select>
          </label>
          {category !== "all" ? <Button variant="ghost" size="sm" onClick={() => { setCategory("all"); setPage(1); }}>Clear filter</Button> : null}
        </Card>

        <ErrorState message={error} onRetry={() => loadMyActivity({ forceRefresh: true })} retryLabel="Retry activity" />
        {isLoading ? (
          <ActivitySkeleton count={5} message="Loading your activity" />
        ) : error ? null : logs.length ? (
          <>
            <ActivityList activities={logs} />
            <nav className="activity-pagination" aria-label="Activity pagination">
              <Button variant="secondary" size="sm" disabled={!pagination.has_previous} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
              <span aria-live="polite">Page {pagination.page} of {Math.max(pagination.pages, 1)}</span>
              <Button variant="secondary" size="sm" disabled={!pagination.has_next} onClick={() => setPage((current) => current + 1)}>Next</Button>
            </nav>
          </>
        ) : (
          <Card variant="empty" className="dashboard-panel">
            <EmptyState
              title={category === "all" ? "Your competitive story starts here" : "No activity in this category"}
              description={category === "all" ? "Challenge a player or update your profile to get started." : "Try another category or clear the current filter."}
            />
            <div className="activity-empty-actions">
              {category !== "all" ? <Button variant="secondary" onClick={() => setCategory("all")}>Clear filters</Button> : <Button as={Link} to="/dashboard/submit-match" variant="challenge"><SidebarIcon name="matches" decorative /> Challenge a player</Button>}
              <Button as={Link} to="/dashboard/matches" variant="ghost">View my matches</Button>
            </div>
          </Card>
        )}
      </PageSection>
    </DashboardLayout>
  );
}
