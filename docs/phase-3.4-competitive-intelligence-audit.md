# Phase 3.4 competitive intelligence audit

## Existing authoritative data

- Player identity: id, username, profile image, account status, member date.
- Performance: backend totals for wins, losses, draws, recorded matches, pending matches, and disputed matches; public profiles also provide authoritative win rate.
- Standing: current leaderboard rank and points, current-player context, and nearby players.
- Match history: status, viewer-oriented result, opponent identity, score when supplied, created/played/confirmed timestamps, evidence presence, and protected detail route.
- Pending work: permission-filtered action-center items for match requests, result confirmation, and dispute review, with labels, messages, timestamps, match ids, and deep links.
- Head-to-head: player orientation, total confirmed meetings, each player's wins and points, draws, latest result, and recent confirmed meetings.
- Activity: authentication/profile events plus match scheduled, accepted, declined, result submitted, confirmed, disputed, cancelled, proof upload, and permitted administrative resolution events.
- UI infrastructure: Rich Match Card, Match Center, Player Identity, shared cards/badges/buttons, loading skeletons, empty/error states, responsive theme tokens, and reduced-motion rules.

## Safe presentation-only derivations

- Confirmed matches = wins + losses + draws, or records whose status is exactly `confirmed`.
- Derived win rate = wins / confirmed matches × 100, rounded to one decimal; authoritative backend rate takes precedence and zero matches returns zero.
- Recent form = newest five confirmed results only; cancelled, disputed, pending, and result-less records are excluded.
- Rival = most-played opponent with at least three confirmed meetings; ties prefer the closer win/loss record.
- Next best action priority = dispute response/update, result confirmation, result submission, challenge response, then the existing challenge flow.
- Personal goal = clear supported pending actions, complete first match, complete five matches, or reach Top 20 when current rank is worse than 20.
- Milestone acknowledgements are static and deterministic from confirmed results/current rank; they are not official awards.

## Excluded or deferred

- No rank history, rating history, rating field, chart library, seasons, divisions, stored goals, achievements, verification system, tournaments, streak history, reliable upcoming start times, deadlines, rescheduling data, or real-time notification transport was found.
- Therefore rank/rating charts, season progress, upcoming countdowns, verified badges, official achievements, streak claims, ranking-impact predictions, and time-based reminders are hidden rather than simulated.
- No posts, likes, comments, reactions, stories, followers, popularity, views, or generic social activity is present.

## Duplication and privacy findings

- Dashboard summary and profile statistics previously had separate display builders. New analytics rules are centralized in `competitiveIntelligenceViewModel.js`; existing authoritative display builders remain unchanged where they simply present backend values.
- The dashboard reuses the already-loaded summary, action center, activity, and leaderboard response. It adds no per-card or notification request.
- Public profile intelligence uses only public confirmed-match summaries. Pending actions, moderation data, dispute notes, email, and private goals are not rendered publicly.
- Large activity/history views already use bounded pages; dashboard derivations operate on at most five loaded items and are memoized.

## Future backend capabilities

- Authoritative rank/rating history and change events.
- Reliable scheduled match start/reschedule/reminder data.
- Seasons/divisions and season statistics.
- Achievement, milestone-seen, verification, and streak records.
- Full confirmed opponent history or an aggregate rivalry endpoint for rivalries beyond the loaded recent window.
- Real-time, deduplicated, expiring notification delivery described in the Phase 3.5 audit.
