# Phase 3.6 statistics audit

## Source of truth and lifecycle

- MongoDB `matches` documents contain both the workflow and result. There is no
  separate result collection.
- `confirmed` is the only final statistical status. Player confirmation and
  admin dispute resolution both produce it. `disputed`, `rejected`,
  `cancelled`, `expired`, requests, and pending states are excluded.
- Modern scores use `player_one_score`/`player_two_score`; legacy records use
  `player_score`/`opponent_score`. The service supports both without changing
  history.
- Winner identity is derived from the scores and must agree with `winner_id`.
  A draw has no winner.
- Modern confirmed results cannot be edited through the player workflow.
  Admin overrides occur only while resolving a dispute and become a new
  authoritative confirmed result on that same match.
- Participant identity has modern and legacy field pairs and is normalized in
  one place. MongoDB `_id` is the primary result identity.

## Eligibility rule

`is_match_eligible_for_statistics` requires:

1. normalized status exactly `confirmed`;
2. two present, distinct participant IDs;
3. two non-negative whole-number scores;
4. `winner_id` consistent with those scores (or absent for a draw);
5. a valid completion timestamp when one is present;
6. no `superseded_by`, `duplicate_of`, or `is_duplicate` marker.

A confirmed record is implicitly accepted because application transitions can
only reach it after result submission or admin resolution. This permits valid
legacy confirmed records that predate `accepted_at`. De-duplication by match
identity is applied during aggregation.

## Data quality and feature availability

- Previous leaderboard aggregation counted every `confirmed` document without
  score validation. The centralized rule now protects every new statistic.
- Existing counters are not stored and therefore cannot drift, but the old
  profile `total_matches` field means all workflow records. New
  `matches_played` is explicitly confirmed/eligible.
- No season entity or authoritative season field exists.
- No competition, tournament, or game field is written by match creation.
  Competition/game endpoints are therefore not fabricated.
- No walkover or administrative-forfeit representation exists.
- Duplicate logical fixtures cannot safely be inferred; only explicit duplicate
  markers and repeated result identities are excluded.
- Historical completeness and production-only corruption require the supplied
  dry-run audit against the deployed database.

## Architecture

Match history remains authoritative and statistics use live, server-side
aggregation. This is the safest choice at current scale, makes corrections and
resolved disputes immediately consistent, and needs no cache invalidation or
counter migration. Compound participant/status/time indexes support player and
head-to-head reads. `rebuild_player_statistics.py` is a batched, rerunnable,
non-mutating reconciliation and data-quality report.

Ranking points and ordering remain three points per win, one per draw, then
wins and stable player identity. Statistics category ordering is deterministic.
Rate and average leaderboards require five eligible matches by default.
The head-to-head response also exposes an advisory compatibility label derived
only from the existing official rank. It does not create a rating, restrict
challenges, or alter matchmaking.

All date scopes use UTC boundaries. Current week begins Monday at 00:00 UTC.
