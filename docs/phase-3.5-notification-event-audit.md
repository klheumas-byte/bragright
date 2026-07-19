# Phase 3.5 notification-event audit

Prepared during Phase 3.4. This is an integration map, not a real-time notification implementation. Current delivery is request/response polling; browser push, sound, WebSockets, SSE, and persistent urgent overlays do not exist.

Priority: P0 urgent, P1 action required, P2 informational. Persistence means the event should remain visible while its underlying workflow state still requires attention. All routes below already exist; permission and lifecycle checks remain server-authoritative.

| Event key | Title / description | Recipient | Priority / action | Primary; secondary | Destination | Expiry / dismissal / persistence | Sound / push | Current source / missing capability |
|---|---|---|---|---|---|---|---|---|
| `challenge_received` | New challenge received; opponent requested a match | challenged player | P1 / yes | Review challenge; view match | `/dashboard/matches` | accepted, declined, cancelled, expired; state-driven; persistent | maybe / yes | match request action-center item; needs real-time fan-out |
| `challenge_accepted` | Challenge accepted | challenger | P2 / no | View match; none | `/dashboard/matches` | match cancelled/completed; dismissible; no | no / optional | `match_accepted` activity; needs notification event/delivery |
| `challenge_declined` | Challenge declined | challenger | P2 / no | View matches; challenge another player | `/dashboard/matches` | acknowledged; dismissible; no | no / optional | `match_declined` activity; needs notification event/delivery |
| `result_submission_required` | Submit result for accepted match | permitted participant | P1 / yes | Submit result; view match | `/dashboard/matches` | result submitted/cancelled/expired; state-driven; persistent | maybe / yes | workflow permissions exist; missing dedicated action-center event |
| `result_submitted_by_opponent` | Opponent submitted a result | other participant | P1 / yes | Review result; view match | `/dashboard/matches` | confirmed/rejected/disputed; state-driven; persistent | maybe / yes | pending-confirmation action-center item; needs real-time fan-out |
| `result_confirmation_required` | Confirm or reject submitted result | confirming participant | P1 / yes | Review result; view match | `/dashboard/matches` | confirmed/rejected/disputed; state-driven; persistent | maybe / yes | `result_awaiting_confirmation`; needs real-time fan-out |
| `result_rejected` | Submitted result was rejected | submitter | P1 / yes | Review match; submit corrected result if permitted | `/dashboard/matches` | corrected/resolved/cancelled; state-driven; persistent | maybe / yes | workflow state/activity; missing explicit notification event |
| `evidence_required` | Evidence is required for a disputed match | permitted participant | P0 / yes | Upload evidence; view match | `/dashboard/matches` | evidence uploaded/deadline/resolution; state-driven; persistent | yes / yes | proof upload exists; missing deadline/event model |
| `dispute_opened` | Match result was disputed | participants and permitted reviewer | P0 / role-dependent | Review dispute; view match | `/dashboard/matches` | resolved/cancelled; state-driven; persistent | yes / yes | `match_disputed` activity and dispute action; needs real-time delivery |
| `dispute_response_required` | A dispute requires a response | permitted participant | P0 / yes | Respond; view match | `/dashboard/matches` | response/resolution/deadline; state-driven; persistent | yes / yes | permission workflow exists; missing explicit response-required event/deadline |
| `dispute_resolved` | Dispute resolved | participants | P1 / no | View resolution; view match | `/dashboard/matches` | acknowledged; dismissible; no | maybe / yes | admin resolve/reject/override activities; needs participant notification fan-out |
| `upcoming_match_reminder` | Upcoming match reminder | participants | P1 / maybe | View match; none | `/dashboard/matches` | match starts/cancelled/rescheduled; dismissible; time-bound | maybe / yes | missing reliable scheduled start/reminder scheduler |
| `match_rescheduled` | Match schedule changed | participants | P1 / maybe | View match; none | `/dashboard/matches` | newer schedule/completion/cancellation; dismissible; latest persistent | maybe / yes | missing reschedule event and authoritative scheduling data |
| `match_cancelled` | Match cancelled | participants | P2 / no | View match; challenge another player | `/dashboard/matches` | acknowledged; dismissible; no | no / optional | cancellation workflow/activity exists; needs notification fan-out |
| `match_completed` | Match confirmed and completed | participants | P2 / no | View result; view profile | `/dashboard/matches` | acknowledged; dismissible; no | no / optional | `match_confirmed` activity; needs notification fan-out |
| `verification_update` | Player verification changed | affected player | P1/P2 / maybe | Review profile; none | `/profile` | acknowledged/superseded; dismissible; no | no / optional | verification system not present; requires backend capability and policy |
| `ranking_change` | Official rank changed | affected player | P2 / no | View leaderboard; view profile | `/leaderboard` | superseded/acknowledged; dismissible; no | no / optional | rank history/event not present; requires authoritative rank-change event |

## Integration rules

- Create notifications from authoritative state transitions, never from unread state alone.
- Re-check permissions and current workflow state when opening an action.
- Deduplicate by event key plus match/user transition identifier.
- Do not include private dispute notes in public or lock-screen copy.
- Expire actionable items from workflow state, not a client-only timer.
- Deep links may carry a match identifier, but must land on existing protected routes.
