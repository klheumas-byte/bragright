# BragRight v1.0 Release Candidate — Sprint 0E

Date: 2026-07-18

Status: **code-complete release candidate**. Automated checks pass. Production
deployment remains gated on the manual browser/accessibility pass, a real MongoDB
`explain()` review with production-like data, and a backup restore drill.

## 1. Performance improvements

- All React pages remain route-level lazy chunks. Large secondary dashboard
  widgets are also lazy loaded.
- Duplicate in-flight GET requests are coalesced by the API client. Short-lived
  client caches prevent repeated leaderboard, directory, dashboard, profile,
  activity, and match requests. Every mutation and logout clears those caches.
- `PlayerDirectoryContext` now memoizes its refresh callback and provider value,
  avoiding context-driven consumer re-renders when no directory state changed.
- JSON responses of at least `RESPONSE_COMPRESSION_MIN_BYTES` are gzip-compressed
  when the client advertises gzip support. Binary proof responses are not
  recompressed.
- Every request is timed. Requests at or above
  `SLOW_REQUEST_THRESHOLD_MS` produce a structured `slow_request` warning.
- Public safe GETs advertise a short configurable cache lifetime. Authenticated,
  health, admin, and other API responses explicitly use `no-store`.
- The production build is split into two shared entry/vendor chunks
  (approximately 181.6 kB / 59.6 kB gzip combined) plus small route chunks. No
  Vite chunk warning is emitted.

## 2. Endpoint and query audit

Counts below are logical collection calls in the route/service, excluding the
common authenticated-user/session lookup and best-effort activity-log write.
Writes commonly perform one guarded update plus one DTO reload. Exact latency and
winning-index verification still require MongoDB Atlas `explain("executionStats")`
against production-like cardinality; mongomock cannot supply execution plans.

| Endpoint(s) | Main database work | Result |
| --- | --- | --- |
| `GET /health`, `GET /api/health` | 0 | Minimal liveness payload |
| `GET /health/ready`, `GET /api/health/ready` | 1 ping | Readiness separated from liveness |
| `POST /api/auth/register` | duplicate lookup, insert, session write | Bounded input; auth rate limit |
| `POST /api/auth/login` | one user lookup, session/activity writes | Auth rate limit; generic credential error |
| `POST /api/auth/refresh` | session lookup/rotation and user lookup | Reuse detection; no-store |
| `GET /api/auth/me` | current-user lookup | Private DTO only |
| `POST /api/auth/logout` | session revocation | Local logout still succeeds on network failure |
| `GET /api/activity/me` | paged find + count | Standard pagination and indexed user/time sort |
| `GET /api/players` | paged projected find + count | Directory DTO only; public cache policy |
| `GET /api/leaderboard` | projected users + projected confirmed matches | Removed unused match fields; paged response |
| `GET /api/players/:id` | player, leaderboard inputs, five recent matches | DTO only; short public cache |
| `GET /api/head-to-head/:a/:b` | one batched user lookup + rivalry matches | Replaced two user lookups with one `$in` query |
| `GET /api/profile/me` | current user + related matches | Private DTO; no-store |
| `POST /api/profile/update`, `PATCH /api/profile/me` | conflict lookup, update, reload, overview | No redundant full user lookup after auth beyond conflict/reload |
| `GET /api/profile/me/matches` | paged find + count | Standard pagination |
| `GET /api/dashboard/summary` | one related-match scan for player | Same in-memory set builds stats and actions |
| `GET /api/dashboard/actions`, `notifications`, `action-center` | one related-match scan each | Client caches/coalesces repeated calls; summary is preferred composite |
| `POST /api/matches`, `/schedule` | opponent/duplicate lookup, insert/reload | Compound duplicate-guard index; mutation rate limit |
| `POST /api/matches/:id/accept`, `decline`, `cancel` | match lookup, guarded update, reload | State-transition and membership checks |
| `POST /api/matches/:id/submit-result` | match/proof lookup, guarded update, reload | Mutation rate limit |
| `POST/PATCH /api/matches/:id/confirm`, `dispute` | match lookup, guarded update, reload | Mutation rate limit on dispute; self-review blocked |
| `GET /api/matches/my` | paged find + count | Standard pagination; indexed participant/time branches |
| `POST /api/matches/upload-proof`, `POST /api/upload` | upload metadata write | Size/type validation and upload rate limit |
| `GET /api/matches/proof/:file` | metadata lookup then storage read | Owner/participant/admin authorization |
| `DELETE /api/matches/proof/:file` | metadata lookup, storage delete, metadata delete | Owner authorization |
| `GET /api/admin/summary`, `/dashboard/summary` | bounded counts/recent lists | Admin only; no-store |
| `GET /api/admin/profile/me` | current admin and bounded activity | Admin DTO only |
| `GET/POST /api/admin/users` | paged find + count or conflict/insert | Standard pagination; DTO only |
| Admin user role/status/password mutations | user lookup/update/session revoke | Last-admin guards; reset rate limit |
| `GET/PATCH /api/admin/settings` | one keyed settings lookup/upsert | Unique settings key; never publicly cached |
| `GET /api/admin/activity`, `/logins` | paged find + count | Standard pagination; compound time indexes |
| `GET /api/admin/matches`, `/disputes` | paged find + count, one batched user lookup | No N+1 user lookup; standard pagination |
| Admin match/dispute detail and resolve aliases | match lookup, one batched user lookup or guarded update | Shared serializer/workflow; no duplicated per-user lookup |

No Mongo `populate` operation is used. Related user names in admin match lists are
loaded in one `$in` query, so the list endpoints do not have an N+1 pattern.

## 3. Database optimizations

Existing indexes were retained because each serves a current route. Index
initialization is idempotent and happens through the deployment initialization
step, not per request.

Added:

- `users_public_directory`: `(role, status, username)` supports the filtered,
  alphabetically sorted player directory.
- `matches_rivalry_confirmed`:
  `(submitted_by, opponent_id, status, confirmed_at desc)` supports rivalry
  history and its sort.

Confirmed existing coverage:

- Unique email, session ID, session token hash, upload filename, and settings key.
- TTL cleanup for expired auth sessions.
- Participant + updated time branches for each legacy/current match participant
  field.
- Status + updated/confirmed/disputed time for workflow, leaderboard, and admin
  queues.
- User/role/action + time for activity.
- Upload owner/time and match linkage.

Safe query changes:

- Leaderboard match reads now project only participant IDs, winner, and
  confirmation time.
- Public directory/user reads use DTO projections.
- Head-to-head player lookup changed from two `find_one` calls to one `$in` find.
- Admin match name hydration remains one batched lookup.
- Paged routes use `skip/limit` with deterministic indexed sorts and bounded
  limits (maximum 100–250 depending on route).

No duplicate index was removed without live index-usage telemetry.

## 4. API optimizations

- Collection responses now expose `page`, `limit`, `total`, and `pages` for
  players, leaderboard, activity, profile matches, player matches, and all admin
  list endpoints. Existing item keys were preserved for client compatibility.
- Unsupported query parameters and malformed/out-of-range pagination return 422.
- User responses continue through public/private/admin DTOs and the final
  sensitive-field scrubber.
- Public player, leaderboard, and rivalry responses can be cached briefly.
  Authenticated responses are never marked public and use `no-store`.
- Errors consistently contain a stable code and request ID. Rate limits return
  `429 TOO_MANY_REQUESTS` and `Retry-After`.
- Response compression is configurable and content-negotiated.

## 5. React, loading, and recovery

- All page routes use `React.lazy` + `Suspense`; the existing UI is unchanged.
- Request coalescing prevents Strict Mode/concurrent consumers from producing
  duplicate GET calls.
- The player-directory provider is memoized.
- Every reviewed page has an explicit loading/skeleton state, loaded state,
  empty state, and error message. Retriable list/page failures use the shared
  `ErrorState`; the application error boundary offers a full page reload.
- API errors gracefully distinguish 401, 403, 404, 409, 422, 429, 500, offline,
  timeout, and interrupted network conditions. A failed 401 performs one
  coalesced refresh; failure clears the session.
- Protected proof images expose loading/error states and revoke object URLs.
- Admin temporary passwords now use Web Crypto randomness instead of
  `Math.random`.

## 6. Accessibility and browser review

Implemented:

- Error feedback is an assertive live alert.
- Skeleton loaders expose polite status and `aria-busy`.
- Proof loading exposes a status role.
- The admin confirmation dialog receives focus, has label/description
  relationships, and closes with Escape.
- The match dispute textarea retains a visible keyboard focus outline.
- Existing navigation labels, expanded states, dialog semantics, table/card
  labels, and meaningful image alt text were retained.

Static compatibility review found only standard features supported by current
Chrome, Edge, Firefox, and Safari: ES modules, `fetch`, `AbortController`,
`URL.createObjectURL`, Web Crypto, CSS grid/flex, and dynamic imports. Vite
handles bundling. Responsive breakpoints for desktop/tablet/mobile are present.

Manual gates still required: keyboard-only traversal, screen-reader smoke test,
automated contrast scan, zoom to 200%, and real-device/current-browser testing.

## 7. Security findings

Resolved:

- Configurable rate limits protect register/login, admin password reset, proof
  upload, match schedule/submission, and dispute creation. Identifiers are hashed
  before being stored in limiter memory.
- Dependency advisories in Flask, Werkzeug, Flask-CORS, python-dotenv, Vite,
  esbuild/PostCSS/Babel transitive packages, and React Router were remediated.
- Client-generated administrative temporary passwords now use Web Crypto.
- No application use of `eval`, `innerHTML`, or `dangerouslySetInnerHTML` exists.
- No active temporary/debug routes were found. Development debug snapshots are
  removed by the response sanitizer and are disabled in production.
- Production refuses missing/placeholder secrets, wildcard credentialed CORS,
  insecure `SameSite=None` cookies, and unsupported storage providers.

Reviewed and accepted:

- `localhost` occurs only in development defaults, examples, tests, and the Vite
  development proxy.
- `print()` occurs only in explicit operator CLI scripts.
- Password/secret strings occur in validation, hashing, test fixtures, and
  example placeholders; no production credential is committed.
- Comments that describe temporary passwords are part of the current admin
  reset workflow, not temporary code.

## 8. Dependency review

- `npm audit`: **0 vulnerabilities** after targeted upgrades.
- `pip-audit -r requirements.txt`: **0 known vulnerabilities** after targeted
  upgrades.
- `pip check`: **no broken requirements**.
- Upgraded Vite/plugin-react together to 8.1.5/6.0.3 and pinned Render/CI to a
  compatible Node 22.12 runtime.
- Upgraded React Router within 6.x to 6.30.4; React 18 was deliberately retained
  to avoid an unrelated React 19 migration.
- Upgraded Flask 3.1.3, Werkzeug 3.1.6, Flask-CORS 6.0.0, and python-dotenv 1.2.2
  to their audited fix versions.
- No unused direct frontend dependency was found. The backend list maps directly
  to runtime imports/deployment.

## 9. Observability

- UTC JSON logs include level, logger, message, request ID, method, path,
  endpoint, status, duration, and response length without request bodies,
  tokens, IP addresses, or user agents.
- Startup, database connection/index initialization, request completion, rate
  limiting, slow requests, readiness failure, and unhandled errors are logged.
- Incoming safe request IDs are propagated; otherwise a UUID is generated.
- `app.extensions["error_tracker"]` is a vendor-neutral error tracking hook.
  Hook failure is contained and logged.

## 10. Backup and recovery runbook

### MongoDB

1. Enable Atlas continuous backups/PITR for the production cluster before launch.
2. Retain daily snapshots for at least 30 days and monthly snapshots according
   to business retention requirements.
3. Restore into a separate recovery cluster first; never overwrite production
   during a drill.
4. Point a staging API at the restored database, run readiness, authentication,
   leaderboard, match-history, and admin-dispute checks, then compare collection
   counts and a sample of confirmed matches.
5. Record recovery point objective, recovery time, operator, snapshot ID, and
   verification results. Drill quarterly.

For a manual export, use `mongodump` with a short-lived least-privilege backup
credential and encrypted destination. Restore with `mongorestore` into a new
database name and verify before cutover.

### Environment recovery

Keep Render environment variable names and secret ownership in the password
manager; do not store values in this repository. Recreate services from
`render.yaml`, attach a restored database/media disk, set secrets, initialize
indexes, verify `/health/ready`, then enable traffic.

### Deployment rollback

Render deploys should reference an immutable Git commit. If health or smoke tests
fail, roll back both services to the last known-good deploy. Database changes in
this sprint are additive indexes and backward-compatible fields, so application
rollback does not require destructive schema rollback.

### Media recovery

The current provider is a persistent Render disk. Take scheduled disk snapshots
or encrypted file-level backups of `/var/data/bragright-uploads`. Restore to a
new disk, verify uploaded-file hashes against `proof_uploads` metadata, attach it
at the same mount path, and smoke-test authorized proof reads. Orphaned metadata
and files should be reported, not automatically deleted during recovery.

## 11. CI/CD and deployment review

- Added read-only GitHub Actions jobs for Python 3.12 and Node 22.12.
- CI installs from pinned manifests, runs `pip check`, `pip-audit`, backend tests,
  Python compilation, `npm audit --audit-level=high`, frontend tests, and the
  production build.
- Render roots, build commands, static publish directory, SPA rewrite, API
  non-rewrite, startup command, health path, runtime versions, persistent upload
  disk, and required environment variables are explicit.
- Index creation runs as an idempotent pre-start step.
- Liveness and database readiness endpoints are separate.
- This sprint did not deploy or push.

## 12. Regression results

Automated:

- Backend: **48 passed** after the final run.
- Frontend: **1 passed** (simultaneous protected requests share one refresh).
- Frontend production build: **passed**, no build warning.
- Python bytecode compilation: **passed**.
- Player API journey: login → profile → challenge → accept → submit → confirm →
  leaderboard → notifications → logout: **passed**.
- Admin API read journey: login → dashboard → users → disputes → match report →
  settings → activity: **passed**.
- Security/authorization coverage includes refresh rotation/reuse, logout
  revocation, disabled accounts, role forgery, ownership, proof access, state
  transition membership, response scrubbing, headers, CORS, and error safety.

The repository does not contain a browser end-to-end harness. UI-level journey
execution in Chrome/Edge/Firefox/Safari is therefore a manual release gate, not
represented as an automated pass. There is no distinct Admin Reports route/page;
the existing admin match/activity views serve the current reporting workflow and
no new product feature was added.

## 13. Release candidate checklist

### Security

- [x] Production secret/CORS/cookie validation
- [x] Authorization and DTO scrubbing tests
- [x] Sensitive-route throttling and 429 contract
- [x] npm and Python vulnerability audits clean
- [ ] Configure a shared rate-limit backend before horizontal scaling beyond one instance

### Performance

- [x] Endpoint/query static audit
- [x] Pagination and bounded limits
- [x] Query projection, batched lookups, supporting indexes
- [x] Compression, client request coalescing, code splitting
- [ ] Run Atlas `explain("executionStats")` and load test with production-like volume

### Infrastructure and deployment

- [x] Render build/start/runtime/health configuration
- [x] Persistent upload disk
- [x] CI release checks
- [x] No deploy or push performed
- [ ] Set production secrets/origins and execute staging smoke test

### UX and accessibility

- [x] Loading/success/empty/error/retry patterns reviewed
- [x] HTTP/offline/timeout recovery
- [x] Major static keyboard/ARIA/focus fixes
- [ ] Manual keyboard, screen-reader, contrast, zoom, and real-device sign-off

### Testing

- [x] Backend suite
- [x] Frontend configured suite
- [x] Production build
- [x] API player/admin release journeys
- [ ] Browser UI end-to-end journey

### Monitoring and backups

- [x] Structured request/startup/error/slow logs
- [x] Request IDs and vendor-neutral error hook
- [x] Backup/restore/rollback/media runbook
- [ ] Connect production error tracker and alert policy
- [ ] Enable Atlas/disk backups and complete a timed restore drill

## 14. Remaining technical debt

1. The dependency-free limiter is per application process. With two Gunicorn
   workers the effective allowance can be up to twice the configured value. Use
   Redis or another shared atomic store before adding more instances.
2. Leaderboard/profile statistics still derive from confirmed match records at
   read time. At high volume, replace this with a tested Mongo aggregation or
   transactionally maintained projection; do not add that complexity without
   measurements.
3. Offset pagination becomes inefficient at very deep pages. Cursor pagination
   is the next step if collections reach hundreds of thousands of rows.
4. Full Atlas execution plans and slow-query telemetry are unavailable in the
   mongomock test environment.
5. Frontend automated coverage is narrow and has no browser E2E/accessibility
   harness.
6. A concrete error tracking vendor, alert routing, dashboard, and retention
   policy must be configured operationally.
7. Backup capability exists only as a runbook until Atlas/disk schedules and a
   restore drill are completed.
8. A distinct Admin Reports product surface does not exist; adding one would be
   a product feature and was intentionally outside Sprint 0E.
