# BragRight Phase 2.1 — Dashboard Excellence

## Initial dashboard audit

The original dashboard presented five equal-weight statistics before any
actionable content. It then rendered a hardcoded weekly momentum chart and
hardcoded top-performer list, followed by the real action center.

Data sources before implementation:

- `GET /api/dashboard/summary` supplied real overview, recent-match, and action
  data. The page discarded `recent_summary`.
- The shared sidebar independently called `GET /api/dashboard/actions` for its
  navigation badge.
- No real leaderboard or account activity data appeared on the dashboard.

Findings:

- The fake momentum and performer content could contradict real records.
- Player identity, a contextual primary action, recent matches, ranking context,
  and recent activity were absent.
- Summary loading and failure were page-wide rather than section-oriented.
- The action center had retry support but a minimal empty state.
- The page had no meaningful error/empty presentation for ranking or activity.
- Action cards and links were keyboard reachable, but the dashboard lacked
  consistent focus treatment and screen-reader context for its future compact
  records.
- Existing responsive rules stacked grids, but long player names and trailing
  action/status columns needed explicit wrapping and reflow rules.
- Phase 2.0 `PageSection`, `Card`, `StatCard`, `Button`, `Badge`, `EmptyState`,
  `SectionLoader`, and `ErrorState` were suitable for the work.

## Files created

- `client/src/pages/dashboardViewModel.js`
- `client/src/pages/dashboardViewModel.test.js`
- `PHASE_2_1_DASHBOARD_EXCELLENCE.md`

## Files modified

- `client/src/pages/Dashboard.jsx`
- `client/src/index.css`
- `client/src/services/api.js`
- `client/src/components/StatCard.jsx`
- `client/package.json`

## Files removed

- `client/src/components/MomentumChart.jsx`
- `client/src/components/TopPerformers.jsx`

Both removed files were unreferenced placeholder-only components. Their legacy
CSS remains intentionally retained to avoid unrelated cleanup risk.

## Dashboard sections improved

1. Player welcome and identity, including avatar fallback and profile prompt.
2. Contextual primary action using existing match/profile routes.
3. Keyboard-accessible quick actions.
4. “Needs your attention” responsibilities and notification summary.
5. Backend-sourced performance statistics.
6. Three most recent backend-sourced match records.
7. Current rank, points, and adjacent leaderboard competitors.
8. Five recent human-readable account activities.

The action center represents the supported dashboard notification summary.
BragRight has no full notification-page route or unread-state contract, so no
unsupported route or read-state behavior was added.

## Data-fetching improvements

- Dashboard summary, ranking, and activity requests start concurrently and
  settle independently.
- Each request has a stable effect dependency and ignores stale or unmounted
  responses with request sequence checks.
- Existing client GET caching continues to deduplicate identical in-flight
  requests, including React development remount behavior.
- Dashboard activity is limited to five records.
- Leaderboard payloads remain bounded by the existing pagination contract.
- Action-center data from the summary response is reused as the notification
  summary; the notification endpoint is not called again.
- The sidebar's separate action-count request remains. It is layout-owned and
  serves navigation badges across all dashboard pages; merging it would require
  broader shared-state work outside this phase.

No backend endpoint, DTO, API contract, authorization rule, match calculation,
or leaderboard calculation changed. The existing client leaderboard and
activity functions only gained backward-compatible pagination options.

## Loading, empty, error, and retry behavior

- Responsibilities, statistics, recent matches, ranking, and activity display
  bounded skeleton loaders.
- Summary, ranking, and activity failures have useful error messages and scoped
  retry controls.
- Error states no longer fall through to misleading “empty” messages.
- New-player, no-action, no-ranking, no-match, and no-activity states include
  descriptive guidance.
- The primary action is disabled and announces loading until the action center
  resolves.

## Responsive and accessibility improvements

- Four-column quick actions become two columns on tablet and one on mobile.
- Five KPI cards become two columns on tablet and one on mobile.
- Recent matches and ranking stack into one column at tablet width.
- Compact row statuses, points, and times move below primary content on phones.
- Long usernames, opponent names, and activity summaries wrap without widening
  the page.
- Interactive cards have visible `:focus-visible` treatment and remain native
  links or buttons.
- Sections use semantic headings and labelled regions.
- KPI cards provide complete accessible labels; badges include visible text, so
  color is not the sole status signal.
- Loading and error primitives retain live-region behavior.
- The Phase 2.0 reduced-motion rule remains active for all new transitions.
- Touch targets use the shared 44-pixel button baseline.

## Validation

- Frontend tests: **10 passed, 0 failed**. Coverage includes backend-provided
  summary values, primary/pending actions, empty ranking, match status tones,
  long names, authentication refresh deduplication, equivalent leaderboard
  request deduplication, bounded activity fetching, and forced retry behavior.
- Backend tests: **48 passed, 0 failed**. The 301 warnings are existing
  `mongomock` UTC deprecation warnings.
- Frontend lint: **not configured**; `client/package.json` contains no lint
  script or linter dependency.
- Frontend production build: **passed** with Vite 8.1.5; 69 modules transformed.
- `git diff --check`: **passed**; only Windows line-ending notices were emitted.
- Full route-map review confirmed every visible dashboard action resolves to an
  existing protected route.
- The full working-tree diff was reviewed. It also contains the previously
  completed Sprint 0E and Phase 2.0 work; Phase 2.1 did not alter backend,
  authentication, authorization, match workflow, routing, or branding files.

## Remaining risks and follow-up

- A live multi-account browser matrix was not available in this environment.
  New-player, pending-action, confirmed-match, dispute, incomplete-profile,
  error, and long-name behavior is represented by the normalized view states,
  focused tests, static route review, responsive CSS review, and production
  build, but visual browser automation remains a recommended Phase 2.2 task.
- The layout sidebar and dashboard summary use separate action endpoints. They
  are not duplicate client requests, but they repeat some backend match
  aggregation. A future shared dashboard-data provider could remove that work
  if profiling shows it is material.
- Leaderboard construction remains an existing server-wide aggregation. The
  dashboard reuses it and does not duplicate its calculation, but a dedicated
  server-side “ranking context” DTO could reduce backend and payload work in a
  future performance phase.
- Legacy momentum/performer CSS is intentionally retained until a separate,
  verified CSS-usage cleanup.
- Recommended next tests are browser-level keyboard traversal, viewport
  screenshots at 1440/1024/768/375 pixels, and seeded-account scenario tests.

## Explicit confirmations

- Authentication was not redesigned.
- Authorization was not weakened.
- Match calculations were not changed.
- Leaderboard logic was not duplicated.
- Unsupported features were not added.
- Current branding and visual language were preserved.
- Dashboard actions use valid existing routes.
- No deployment was performed and nothing was pushed to Git.
- Based on the passing automated validation and bounded remaining visual-test
  risk, the application is ready for Phase 2.2.
