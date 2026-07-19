import { useEffect, useRef, useState } from "react";
import ActivityList from "../components/ActivityList";
import ActivitySkeleton from "../components/ActivitySkeleton";
import ErrorState from "../components/ErrorState";
import { ADMIN_ACTIVITY_TYPES } from "../components/activityPresentation";
import { Button, Card, EmptyState, PageSection, Select } from "../components/ui";
import { useLoading } from "../context/LoadingContext";
import DashboardLayout from "../layouts/DashboardLayout";
import { getAdminActivity } from "../services/api";

const PAGE_SIZE = 20;
const initialFilters = { role: "", action_type: "", start_date: "", end_date: "" };
const emptyPagination = { page: 1, limit: PAGE_SIZE, total: 0, pages: 0, has_next: false, has_previous: false };

export default function AdminActivity() {
  const { trackLoading } = useLoading();
  const requestIdRef = useRef(0);
  const [draftFilters, setDraftFilters] = useState(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState(emptyPagination);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const isInitialLoading = isLoading && logs.length === 0;

  useEffect(() => { loadActivityLogs(); }, [appliedFilters, page]);

  async function loadActivityLogs() {
    const requestId = ++requestIdRef.current;
    try {
      setIsLoading(true);
      setError("");
      const response = await trackLoading(() => getAdminActivity({ ...appliedFilters, page, limit: PAGE_SIZE }));
      if (requestId !== requestIdRef.current) return;
      const data = response?.data || {};
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      setPagination({ ...emptyPagination, ...data });
    } catch (requestError) {
      if (requestId !== requestIdRef.current) return;
      setError(requestError.message || "Could not load admin activity.");
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }

  function handleFilterChange(event) {
    const { name, value } = event.target;
    setDraftFilters((current) => ({ ...current, [name]: value }));
  }

  function applyFilters(event) {
    event.preventDefault();
    setPage(1);
    setAppliedFilters({ ...draftFilters });
  }

  function clearFilters() {
    setDraftFilters(initialFilters);
    setAppliedFilters(initialFilters);
    setPage(1);
  }

  const hasFilters = Object.values(appliedFilters).some(Boolean);

  return (
    <DashboardLayout title="Admin Activity" description="Protected operational events with safe actor and related-record context.">
      <section className="feature-hero-card">
        <div><p className="section-label">Administration</p><h2 className="feature-hero-title">Review system activity without exposing sensitive metadata.</h2></div>
        <div className="feature-callout"><p className="feature-callout-label">Matching events</p><p className="feature-callout-value">{pagination.total}</p></div>
      </section>

      <PageSection title="Activity log" description="Filter supported event types and dates. Newest events appear first.">
        <Card>
          <form className="admin-activity-filters" onSubmit={applyFilters}>
            <label className="form-field">Role<Select name="role" value={draftFilters.role} onChange={handleFilterChange}><option value="">All roles</option><option value="player">Player</option><option value="admin">Admin</option></Select></label>
            <label className="form-field">Event<Select name="action_type" value={draftFilters.action_type} onChange={handleFilterChange}><option value="">All supported events</option>{ADMIN_ACTIVITY_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</Select></label>
            <label className="form-field">Start date<input type="date" name="start_date" value={draftFilters.start_date} onChange={handleFilterChange} /></label>
            <label className="form-field">End date<input type="date" name="end_date" value={draftFilters.end_date} onChange={handleFilterChange} /></label>
            <div className="activity-filter-actions"><Button type="submit" isLoading={isLoading} loadingText="Applying filters">Apply filters</Button><Button type="button" variant="ghost" onClick={clearFilters} disabled={!hasFilters && !Object.values(draftFilters).some(Boolean)}>Clear</Button></div>
          </form>
        </Card>

        <ErrorState message={error} onRetry={loadActivityLogs} retryLabel="Retry admin activity" />
        {isInitialLoading ? <ActivitySkeleton count={6} message="Loading admin activity" /> : logs.length ? (
          <div className={isLoading ? "loading-region--refreshing" : ""} aria-busy={isLoading || undefined}>
            {isLoading ? <span className="inline-loading-status" role="status">Refreshing admin activity…</span> : null}
            <ActivityList activities={logs} admin label="Admin activity timeline" />
            <nav className="activity-pagination" aria-label="Admin activity pagination">
              <Button variant="secondary" size="sm" disabled={!pagination.has_previous} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
              <span aria-live="polite">Page {pagination.page} of {Math.max(pagination.pages, 1)}</span>
              <Button variant="secondary" size="sm" disabled={!pagination.has_next} onClick={() => setPage((current) => current + 1)}>Next</Button>
            </nav>
          </div>
        ) : error ? null : (
          <Card variant="empty"><EmptyState title={hasFilters ? "No matching admin activity" : "No admin activity yet"} description={hasFilters ? "Clear or change the current filters." : "Administrative actions will appear here when they are recorded."} />{hasFilters ? <div className="activity-empty-actions"><Button variant="secondary" onClick={clearFilters}>Clear filters</Button></div> : null}</Card>
        )}
      </PageSection>
    </DashboardLayout>
  );
}
