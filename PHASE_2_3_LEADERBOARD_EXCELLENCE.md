# BragRight Phase 2.3 — Leaderboard Excellence

## Initial audit

- Route: the existing React route is `/leaderboard`; no client route was added or changed.
- Data source: `GET /api/leaderboard`, backed by MongoDB `users` and `matches`.
- Authority: `server/app/services/competitive_service.py::build_leaderboard`.
- Formula: confirmed win = 3 points, confirmed draw = 1 point. Final order is points descending, wins descending, then lowercase username ascending.
- Eligibility: player-role accounts whose current account status is not `disabled`. This is the existing account-status rule; active and disabled are the only supported user statuses.
- Match integrity: only `status == "confirmed"` contributes. Pending, disputed, cancelled, and other states do not.
- Storage: ranks are calculated on request and are not persisted.
- Cache before Phase 2.3: public API responses use the configured short public cache (15 seconds by default); the frontend leaderboard read cache is 30 seconds and is cleared by client mutations.
- Previous pagination: API inputs existed, but the page loaded the default 100 rows and had no controls.
- Previous search/filter/sort: no search or filter UI. Official sorting was backend-only.
- Previous player context: no current-player highlight or authoritative lookup outside the loaded page.
- Previous states: one generic skeleton, a basic empty state, and a recoverable error.
- Previous sidebar: two-letter abbreviations, no profile avatar, and no signed-in user block.
- Relevant indexes already present: `users(role,status,username)` and `matches(status,confirmed_at)`. No duplicate index was added.
- Phase 2.0 reuse: `Card`, `Button`, `Badge`, `Field`, `EmptyState`, `PageSection`, and `SectionSkeleton`.

## Existing and additive API contract

`GET /api/leaderboard`

Accepted query parameters:

- `page`: positive integer
- `limit`: positive integer, maximum 200
- `search`: normalized username search, maximum 64 characters
- `player_id`: optional valid Mongo ObjectId for authoritative current-player context

Response data:

- `leaderboard`: the requested page, retaining absolute backend ranks
- `top_players`: up to the first three official entries
- `current_player`: exact backend entry or `null`
- `nearby_players`: at most one entry above/current/one below, calculated from the backend list
- `ranked_total`: total official ranked-player count before search
- `search`, `count`
- `page`, `limit`, `total`, `pages`, `has_next`, `has_previous`

The existing endpoint remains public. Changes are additive and use the existing response envelope. Unsupported query parameters return standardized 422 responses. No arbitrary filter or sort key is accepted.

## Implementation

### Files created

- `client/src/components/avatarViewModel.js`
- `client/src/components/LeaderboardSkeletons.jsx`
- `client/src/components/SidebarIcon.jsx`
- `client/src/components/sidebarNavigation.js`
- `client/src/components/sidebarViewModel.js`
- `client/src/components/sidebarViewModel.test.js`
- `client/src/pages/leaderboardViewModel.js`
- `client/src/pages/leaderboardViewModel.test.js`
- `server/tests/test_leaderboard.py`
- `PHASE_2_3_LEADERBOARD_EXCELLENCE.md`

### Files modified

- `client/package.json`
- `client/src/components/DashboardHeader.jsx`
- `client/src/components/ProfileAvatar.jsx`
- `client/src/components/Sidebar.jsx`
- `client/src/index.css`
- `client/src/layouts/DashboardLayout.jsx`
- `client/src/pages/Dashboard.jsx`
- `client/src/pages/Profile.jsx`
- `client/src/pages/Leaderboard.jsx`
- `client/src/pages/dashboardViewModel.js`
- `client/src/pages/dashboardViewModel.test.js`
- `client/src/services/api.js`
- `client/src/services/api.auth.test.js`
- `server/app/__init__.py`
- `server/app/routes/competitive.py`
- `server/app/services/api_security.py`
- `server/app/services/competitive_service.py`

### Leaderboard experience

- Added an official-standing header with current position, points, ranked-player total, and valid Profile/Matches links.
- Added real top-three cards with avatars/fallbacks, rank, confirmed record, points, and public-profile links.
- Added a responsive official list with absolute rank, avatar, record, matches, win rate, points, profile action, and valid challenge action.
- Current-player context is always explicit. The row uses text (“Your rank”) in addition to styling, and the separate position card does not insert or duplicate an entry in the paginated array.
- The backend returns exact current and nearby context, so Dashboard, own Profile, and Leaderboard remain accurate beyond the first page.
- Added debounced, trimmed, bounded, server-side username search. Search preserves absolute ranks and pagination and never fetches the entire leaderboard into the browser.
- Added page controls using a page size of 20. Search persists between page requests.
- No filters were invented. The UI explicitly presents the immutable “Official order.”
- No movement indicators were added because historical rank snapshots do not exist.
- Added clear states for no players, no search results, unavailable current position, recoverable errors, and retry.

### Loading states

Shared skeleton-based loading is present for:

- leaderboard header
- current-player position
- top ranked players
- search/filter controls
- main list and search results
- pagination transitions

Skeleton containers reserve the same card/grid structure, use `aria-busy`, and provide screen-reader status announcements. Stale request IDs prevent out-of-order search or pagination responses from replacing current data.

### Sidebar

- Replaced letter abbreviations with one local SVG icon system: profile, dashboard, leaderboard, compare, submit, matches, activity, admin profile, admin dashboard, users, settings, and disputes.
- Every player and admin navigation item has a consistent icon, size, spacing, label, hover/focus state, and existing route.
- Profile navigation and the user block use the current avatar, initials fallback, then default profile icon fallback.
- Avatar changes flow from the existing AuthContext/session update; failed images fall back without breaking layout.
- Added display name, username, available official rank, active-session indicator, and truncation.
- Memoized navigation items, identity derivation, and user block components.
- Preserved scroll position through session storage.
- Collapsed desktop mode keeps icons visible. Mobile mode uses a focus-trapped dialog drawer, Escape close, inert hidden state, and focus restoration to the menu toggle.
- Existing global reduced-motion behavior disables collapse/expand motion for users who request it.

### Responsive and accessibility work

- Desktop list uses a scan-friendly four-column card row.
- Tablet collapses metrics/actions below identity without dropping absolute rank.
- Mobile uses a single-column card, full-width actions, wrapped controls, and stacked pagination.
- Long names truncate in fixed navigation/list areas and wrap where context is more important.
- Added semantic headings, current-player accessible labels, explicit search description, live result counts, loading announcements, avatar alt/fallback labels, named actions, and visible focus preservation.
- Rank and current-player state are not communicated by color alone.

## Ranking and data integrity

- Official order remains backend-owned. React maps the returned entries and never sorts or derives final rank.
- Absolute ranks are assigned before search and pagination.
- Ties remain deterministic: points, wins, username.
- Confirmed matches affect both players once; duplicate confirmation remains rejected by the existing match state machine.
- Pending and disputed matches are ignored.
- Disabled accounts and non-player roles are excluded under the existing business rule.
- Dashboard and own Profile now request the authoritative `current_player` entry instead of assuming the player is among the first 100.
- Public profile and leaderboard fields are tested for rank, points, record, match count, and win-rate consistency.

## Performance and query findings

- Removed an unnecessary `confirmed_at` sort from the aggregation input; match order does not affect totals.
- User and match reads project only ranking fields. No emails, password hashes, tokens, or raw match payloads are returned.
- The calculation uses two collection reads and an in-memory player map; there is no per-row populate and no N+1 lookup.
- Search is performed on the server and input is debounced at 300 ms.
- Equivalent frontend reads share in-flight work and use the existing 30-second read cache.
- Client mutation paths clear cached API reads; server public caching remains short and configurable (15 seconds by default).
- Existing compound indexes support player eligibility and confirmed-match selection.

Remaining scalability debt: the authoritative service still scans all eligible players and confirmed matches to calculate a complete, deterministic rank set on each cache miss. Replacing this safely requires a backend materialized-statistics/snapshot design with transactional invalidation; it was not introduced in this UI-focused phase. Inline base64 profile images can also enlarge list responses. Moving avatars to versioned object-storage URLs should be addressed with the media-storage architecture rather than a routing change in Phase 2.3.

## Repository search findings

- The only final rank assignment is the backend `enumerate(..., start=1)` in `competitive_service.py`.
- No leaderboard React code uses array index plus one, `.sort()`, hardcoded rank, placeholder player, or mock ranking data.
- The shared `DataTable` has optional client sorting, but the leaderboard does not use it.
- Landing-page `index + 1` is presentation numbering only.
- Profile and Dashboard consume backend ranking context.
- No season, division, movement, reward, streak, active-status filter, or simulated nearby-player logic exists.

## Validation

- Frontend tests: 29 passed.
- Backend tests: 56 passed.
- Python compile check: passed.
- Frontend production build: passed with Vite; 80 modules transformed.
- Frontend lint: not configured.
- Backend lint/formatter: not configured.
- `git diff --check`: passed. Git reported only the repository's existing LF-to-CRLF checkout notices.
- No deployment or Git push was performed.

Test coverage includes official order, tie order, absolute page ranks, server search, current player outside the loaded page, backend nearby context, unsupported parameters, invalid pagination/search/player IDs, disabled players, pending/disputed exclusion, one-time confirmation effects, duplicate confirmation rejection, DTO privacy, profile consistency, fewer than three players, current-user challenge exclusion, long names, API request deduplication, avatar/initial/default sidebar fallbacks, and icon coverage for every navigation item.

## Remaining risks and future opportunities

- A live cross-browser visual-regression harness is not configured; responsive behavior was reviewed through CSS breakpoints, build output, and component/state tests rather than screenshot baselines.
- Materialized player statistics or ranking snapshots are the next safe scalability step once invalidation rules are designed.
- Versioned external avatar URLs would reduce JSON payload size and improve browser caching.
- Historical rank snapshots are required before movement indicators can be trustworthy.
- Search is username-only because no separate display-name field exists in the current public leaderboard model.
- Cursor pagination may be preferable at very large scale, but rank changes require an explicit snapshot/version contract first.

## Explicit confirmations

- Authentication was not redesigned.
- Authorization was not weakened.
- Official ranking logic remains backend-owned.
- No second ranking system was introduced.
- Match calculations and match rules were not changed.
- Dashboard, own Profile, public Profile, and Leaderboard values use the same authoritative service.
- No fake seasons, filters, divisions, rewards, or ranking movement were introduced.
- Existing branding and visual language were preserved.
- Existing client routing was not changed.
- Leaderboard actions use the existing `/profile`, `/dashboard/matches`, `/players/:playerId`, and `/dashboard/submit-match?opponentId=...` routes.
- BragRight is ready to proceed to Phase 2.4, with the documented scalability and visual-baseline work retained as technical debt.
