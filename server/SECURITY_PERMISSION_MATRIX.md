# BragRight API permission matrix

| Area | Endpoint | Access | Ownership rule |
| --- | --- | --- | --- |
| Health | `GET /api/health` | Public | Returns status only |
| Authentication | `POST /api/auth/register` | Public | Creates player accounts only |
| Authentication | `POST /api/auth/login` | Public | Credentials identify the account |
| Authentication | `POST /api/auth/refresh` | Refresh session | Rotates only the presented session |
| Authentication | `GET /api/auth/me` | Authenticated | Current token subject only |
| Authentication | `POST /api/auth/logout` | Authenticated session when present | Revokes the presented session |
| Players | `GET /api/players` | Public | Public player DTO only |
| Competition | `GET /api/leaderboard` | Public | Confirmed aggregate data only |
| Competition | `GET /api/players/<player_id>` | Public | Public player DTO and confirmed results only |
| Competition | `GET /api/head-to-head/<player_a_id>/<player_b_id>` | Public | Confirmed aggregate data only |
| Dashboard | `/api/dashboard/*` | Player | Current player data only |
| Profile | `GET /api/profile/me` | Player | Current player only |
| Profile | `POST /api/profile/update`, `PATCH /api/profile/me` | Player | Current player only; client user IDs rejected |
| Profile | `GET /api/profile/me/matches` | Player | Participant matches only |
| Activity | `GET /api/activity/me` | Player | Current player's activity only |
| Matches | `POST /api/matches`, `POST /api/matches/schedule` | Player | Creator is forced to current player |
| Matches | `GET /api/matches/my` | Player | Participant matches only |
| Match workflow | `/api/matches/<match_id>/*` | Player | Match participant plus transition-specific checks |
| Proofs | `POST /api/matches/upload-proof`, `POST /api/upload` | Player | Owner is forced to current player |
| Proofs | `GET /api/matches/proof/<filename>` | Authenticated | Owner, attached-match participant, or admin |
| Proofs | `DELETE /api/matches/proof/<filename>` | Player | Upload owner only; attached proof cannot be deleted |
| Admin dashboard | `GET /api/admin/summary`, `GET /api/admin/dashboard/summary` | Admin | Admin role from database |
| Admin users | `/api/admin/users*` | Admin | Admin role from database; last-admin guards apply |
| Admin settings | `/api/admin/settings` | Admin | Admin role from database |
| Admin activity | `/api/admin/activity`, `/api/admin/logins` | Admin | Admin role from database; sensitive request metadata omitted |
| Admin matches/disputes | `/api/admin/matches*`, `/api/admin/disputes*` | Admin | Admin role from database |
| Reports | None in current backend | N/A | No report endpoint is registered |

`/api`, `/api/test-db`, and `/test-db` are intentionally not registered.
