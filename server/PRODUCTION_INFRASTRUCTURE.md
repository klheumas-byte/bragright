# BragRight production infrastructure

## Database initialization

Run `python init_database.py` once before starting application workers. The
command validates connectivity and idempotently creates only indexes used by
current application queries:

- `users`: unique email, username lookup, role/status administration filter.
- `matches`: participant/update-time lookups for both current and legacy field
  names; status/update-time, status/confirmed-time, status/disputed-time; and
  participant/status/created-time duplicate detection.
- `settings`: unique settings key.
- `login_activity`: user/login-time.
- `activity_logs`: user/time, role/time, and action/time.
- `auth_sessions`: unique session ID, unique token hash, token family,
  user/revocation state, and expiry TTL.
- `proof_uploads`: unique server filename, owner/time, and match.

No notification, standalone dispute, leaderboard, rating, or audit collection
exists in the current schema, so no speculative indexes are created for them.

## Upload providers

`UploadStorage` is the provider interface. `LocalUploadStorage` is the current
implementation and is suitable for development or a mounted persistent disk.
An S3-compatible, R2, Cloudinary, or other adapter must implement `save`,
`read`, `delete`, and `exists`, then be selected in `get_upload_storage`.
Unsupported provider names fail startup validation; there is no simulated cloud
integration.

In Render, the configured `/var/data` persistent disk protects local uploads
across service restarts. Horizontal scaling requires replacing the local
adapter with shared object storage.

## Reverse proxy

Production enables `ProxyFix` for exactly one forwarding proxy and trusts one
value each for client address, scheme, host, and port. Do not increase these
counts unless the actual proxy chain is verified.

## Deployment smoke checks

Local:

1. Copy both `.env.example` files and start MongoDB.
2. Run `python init_database.py`, then `python run.py` in `server`.
3. Run `npm run dev` in `client`.
4. Register and log in; refresh an authenticated route.
5. Upload a valid image, reject an invalid file, and delete an unattached owned
   proof.
6. directly open and refresh a nested route, then verify an unknown route shows
   the React 404 page.
7. Confirm API calls return JSON and `/health/ready` returns 200.

Staging/production:

1. Set every required Render environment variable before the first deploy.
2. Verify `/health` is 200 and `/health/ready` reaches MongoDB.
3. Test a nested-route refresh and an unknown frontend route.
4. Verify refresh cookies are `Secure`, `HttpOnly`, and accepted only from the
   configured frontend origin.
5. Verify disallowed CORS origins receive no allow-origin header.
6. Upload and retrieve a proof, restart the service, and confirm persistence.
7. Trigger controlled 404/413 errors and confirm responses contain no debug
   data, infrastructure identifiers, or stack traces.
