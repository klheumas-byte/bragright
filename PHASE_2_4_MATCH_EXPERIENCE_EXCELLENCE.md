# BragRight Phase 2.4 — Match Experience Excellence

## Outcome

Phase 2.4 is complete as a compatibility-friendly refinement of the existing match
workflow. The backend remains authoritative for state, action permissions, results,
rankings, and statistics. The existing BragRight brand, routes, authentication model,
and shared Phase 2 design foundation are preserved.

## Initial audit

### Existing backend states

| State | Meaning in the player experience |
| --- | --- |
| `match_requested` | A challenge is waiting for the requested player. |
| `scheduled` | Legacy request value; normalized by the backend to `match_requested`. |
| `pending_result` | An accepted match is ready for result submission. |
| `pending_confirmation` | A result is waiting for the non-submitting player. |
| `confirmed` | The official completed result. |
| `disputed` | A submitted result is under admin review. |
| `rejected` | An administrator rejected a disputed result. |
| `cancelled` | A request or match was closed before confirmation. |
| `expired` | A request or match expired before completion. |

### Existing transition map

- `match_requested` → `pending_result`, `cancelled`, or `expired`
- `pending_result` → `pending_confirmation`, `cancelled`, or `expired`
- `pending_confirmation` → `confirmed` or `disputed`
- `disputed` → `confirmed` or `rejected` through existing admin moderation

No frontend transition table was introduced. React displays backend state and uses
backend-provided `can_*` flags to expose actions.

### Existing action endpoints

- Create request: `POST /api/matches/schedule`
- Accept: `POST /api/matches/:id/accept`
- Decline: `POST /api/matches/:id/decline`
- Cancel: `POST /api/matches/:id/cancel`
- Submit result: `POST /api/matches/:id/submit-result`
- Confirm: `POST|PATCH /api/matches/:id/confirm`
- Dispute: `POST|PATCH /api/matches/:id/dispute`
- Upload/read/delete proof: existing protected proof endpoints
- List the current player's matches: `GET /api/matches/my`
- Admin dispute detail and resolution: existing admin endpoints

### Audit findings addressed

- Status labels and tones were duplicated across My Matches, Dashboard, Profile, and
  Admin Disputes.
- My Matches loaded up to 200 records, mixed urgent work and history, and had no
  server-backed views or pagination controls.
- The client had no participant-safe match detail endpoint.
- Opponent selection loaded a large directory and lacked server search, debounce,
  avatars, stale-response handling, and selected-player context.
- Match cards, action forms, proof UI, and next-step messaging were duplicated.
- Match pages had generic loading or blank transitions rather than stable skeletons.
- Actions lacked consistent confirmation, localized processing states, and stale-state
  recovery.
- Legacy client normalization could infer missing status/result data.
- Decimal JSON scores were silently truncated by backend integer conversion.
- Direct challenges did not reject admin or disabled accounts.
- Reliable timestamp fields existed, but no complete immutable event history existed.
  The timeline therefore uses only real backend timestamps and does not fabricate events.

## Implementation

### Shared components and presentation

- `MatchCard` presents participant identity, official state, score, next action, proof,
  dispute information, and scoped actions.
- `MatchTimeline` presents only backend-provided timestamps in chronological order.
- `MatchSkeletons` provides stable controls, list, detail, and opponent-search skeletons.
- `matchPresentation` is the single match-state label/tone/description mapping. Unknown
  states render as “Status unavailable.”
- `ProtectedProofImage` now has a skeleton, accessible status, protected fetch behavior,
  error handling, and retry.
- The shared `ProfileAvatar` is used throughout and follows image → initials → default
  profile icon fallback behavior.

### My Matches

- Added server-backed views for attention, active, awaiting opponent, completed,
  disputed, and closed matches.
- Added counts, bounded pagination, transition skeletons, view-specific empty states,
  and retry behavior.
- Added direct, refresh-safe detail links using
  `/dashboard/matches?matchId=:id`.
- Added authoritative detail refresh after actions without reloading the app.
- Uses backend `can_accept`, `can_decline`, `can_submit_result`, `can_confirm`,
  `can_dispute`, and `can_cancel` flags.
- Accept and result submission have action-local loading. Decline, cancel, confirm, and
  dispute use the shared accessible modal.
- Recoverable errors preserve score, proof, and dispute drafts.

### Challenge creation

- Added bounded, server-side username search with a 300 ms debounce.
- Only the latest search response is applied.
- Results show shared avatars and accessible selected state.
- The selected opponent remains visible and is retained after recoverable errors.
- Double submission is disabled and backend success is required before confirmation.
- Self-challenge, duplicate challenge, admin target, and disabled target validation is
  enforced by the backend.

### Result and evidence submission

- Both score fields identify their owning player and use whole-number constraints.
- Frontend and backend reject missing, fractional, and negative scores.
- File type, empty-file, selected filename, removal, preview, upload status, error, and
  retry states are present.
- Proof continues to use protected, owner-bound backend storage. No external URL or raw
  filesystem path support was added.
- The configured upload-size limit remains server-controlled; the client does not guess
  a value it cannot retrieve.

### Confirmation and disputes

- Official score, participant identity, proof, state description, and submitted
  timestamp remain visible while a decision is made.
- Confirmation and dispute are distinct actions with explicit consequences.
- Dispute notes are required, limited to 500 characters, preserved after recoverable
  errors, and announced on validation/action failure.
- Successful actions refetch official match, list, and action-center data.

### Responsive and accessibility work

- Match cards, action rows, score fields, proof panels, filter tabs, opponent results,
  and pagination wrap or stack at tablet/mobile breakpoints.
- Proof previews are bounded and action controls remain usable on narrow screens.
- Skeletons use `aria-busy` and accessible live loading labels.
- Status is communicated with text as well as tone.
- Score fields, file inputs, errors, dates, participant avatars, and match cards have
  meaningful labels.
- Filter and opponent controls retain native button keyboard behavior.
- Shared modal focus containment, Escape handling, body scroll lock, and focus
  restoration are reused.
- Existing global focus-visible and reduced-motion design-system behavior remains active.

### Performance and API changes

- `GET /api/matches/my` now accepts validated `view`, `page`, and `limit` parameters,
  defaults to 20 records, caps pages at 100 records, and returns standard pagination
  metadata plus view counts.
- Added participant-owned `GET /api/matches/:id` detail DTO.
- Match list/detail participant profiles are loaded in one projected batch query rather
  than per match.
- `GET /api/players` now accepts normalized, bounded username search and returns only
  public player DTO fields.
- Client match reads use short five-second deduplication and force-refresh after
  mutations; authoritative state is not long-lived.
- Opponent search is debounced and ignores stale responses.
- Full-page reloads and whole-directory opponent loads were removed.
- Existing Mongo match indexes support participant, status, and updated-time query
  paths. No speculative index was added.

## Files created

- `client/src/components/MatchCard.jsx`
- `client/src/components/MatchSkeletons.jsx`
- `client/src/components/MatchTimeline.jsx`
- `client/src/pages/matchPresentation.js`
- `client/src/pages/matchPresentation.test.js`
- `server/tests/test_match_experience.py`
- `PHASE_2_4_MATCH_EXPERIENCE_EXCELLENCE.md`

## Files modified

- `client/package.json`
- `client/src/components/ProfileAvatar.jsx`
- `client/src/components/ProtectedProofImage.jsx`
- `client/src/components/SidebarIcon.jsx`
- `client/src/index.css`
- `client/src/pages/AdminDisputes.jsx`
- `client/src/pages/Dashboard.jsx`
- `client/src/pages/MyMatches.jsx`
- `client/src/pages/SubmitMatch.jsx`
- `client/src/pages/dashboardViewModel.js`
- `client/src/pages/profileViewModel.js`
- `client/src/services/api.js`
- `server/app/__init__.py`
- `server/app/routes/matches.py`
- `server/app/routes/players.py`
- `server/app/services/match_workflow.py`
- `server/tests/conftest.py`

## Test and verification results

### Automated

- Backend: **61 passed**
- New focused match experience suite: **5 passed**
- Frontend: **34 passed**
- Backend bytecode compilation: **passed**
- Frontend production build: **passed** with 83 transformed modules
- Git whitespace/error check: **passed**; only the repository's existing Windows line
  ending warnings were reported
- Frontend lint: **not configured**
- Backend lint/formatter: **not configured**

The backend integration tests cover a complete create → accept → submit → confirm
journey, decline, cancel, dispute, duplicate actions, one activity entry for an
idempotent acceptance, ownership, missing detail, self/admin/disabled targets, duplicate
challenge, invalid views, invalid scores, DTO field privacy, avatars, and pagination.

The frontend unit suite covers the shared status presentation, backend action flags,
score and evidence validation, timestamp-only timeline behavior, dashboard/profile
consistency, avatar fallbacks, sidebar icons, directory challenge eligibility, and API
request behavior.

### Repository and regression review

- No `window.location.reload`, `console.log`, placeholder/mock matches, or duplicate
  match-status presentation maps remain in application code.
- The obsolete unreferenced match action-button CSS was removed; functional legacy CSS
  was retained.
- Phase 2.4 did not change `App.jsx` routes or sidebar navigation destinations.
- Authentication, admin moderation, ranking, rating, and statistics formulas were not
  changed.
- No unsupported match type, tournament, messaging, payment, spectator, live-scoring,
  or referee feature was added.

## Remaining risks and future opportunities

- No browser DOM/E2E or visual-regression runner is configured. The code, integration
  tests, responsive CSS, focus behavior, and production bundle were verified, but final
  physical Safari/iOS, Firefox, touch, screen-reader, and network-throttling checks remain
  a release/manual QA responsibility.
- The upload API does not expose byte-level progress callbacks, so the UI reports
  uploading/complete states rather than a percentage.
- The server-controlled maximum proof size is not exposed through a public configuration
  DTO, so the UI safely describes it as the configured limit rather than hardcoding a
  potentially stale value.
- There is no immutable per-match event stream. The timeline should remain timestamp-only
  until reliable actor/event history is designed.
- My Matches view counts currently use one count per supported view. At substantially
  larger scale, benchmark a single aggregation/facet approach before changing it.
- Username substring search is intentionally bounded but cannot fully exploit a normal
  ascending username index. Consider a purpose-built search index only after production
  query measurements justify it.
- If a proof upload succeeds but result submission subsequently fails, retry can leave an
  unattached upload until operational cleanup. A future upload-claim expiry job could
  address this without changing the match workflow.

## Explicit confirmations

- Authentication was not redesigned.
- Authorization and ownership checks were not weakened.
- The backend remains authoritative for match state, action permissions, and results.
- No second match state machine was introduced.
- Ranking and statistics formulas were not changed.
- Duplicate actions remain safely handled and the UI prevents double submission.
- Sidebar navigation icons remain functional.
- Profile avatar, initials, and default icon fallbacks remain functional.
- Match loading, empty, error, retry, and action-processing states are implemented.
- Existing BragRight branding and visual language were preserved.
- No deployment was performed and nothing was pushed to Git.
- The application is ready for Phase 2.5, subject to the normal manual browser/device
  release pass noted above.
