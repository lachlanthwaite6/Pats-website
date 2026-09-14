# API v1

All responses are JSON. HTTPS is required in production. The API has no cross-origin browser write permission. Consumers should send `Accept: application/json`.

| Route                     | Access               | Result                                                    |
| ------------------------- | -------------------- | --------------------------------------------------------- |
| GET /api/health           | Shared viewing login | Liveness and release version; not a D1 readiness check    |
| GET /api/v1/dashboard     | Shared viewing login | Full validated aggregate snapshot, private and not cached |
| GET /api/v1/integrations  | Same as dashboard    | Adapter catalogue; currently empty                        |
| POST /api/admin/snapshots | Bearer INGEST_TOKEN  | Validate and publish a complete schema-v1 snapshot        |
| GET /api/admin/snapshots  | Bearer INGEST_TOKEN  | Last ten retained versions                                |
| POST /api/admin/activate  | Bearer INGEST_TOKEN  | Activate an existing `{ "id": "sha256" }`                 |

Snapshot shape is defined by `src/schema.ts`. Body size is capped at 900,000 bytes, independent of Content-Length. Unknown fields and non-finite numbers are rejected. Invalid input returns 400/413/415/422; missing credentials 401; unsupported read-route writes 405; missing datasets 503. Internal failures reveal a request ID, not SQL, secrets or workbook content.

Viewing uses HTTP Basic authentication over HTTPS: username from the `DASHBOARD_USERNAME` Worker secret (defaults to `dashboard` only when absent), password from the `DASHBOARD_PASSWORD` secret. All assets and read routes are gated before any asset/database/cache lookup. Missing, malformed, incorrect or weakly configured credentials deny access. `HEAD` and conditional requests are protected too. Protected responses use `private, no-store` plus CDN no-store headers and no cache validators. The viewing password cannot authorize admin actions. Admin clients continue using their separate Bearer token; they do not combine the two authentication schemes.

Admin endpoints use a separately generated 256-bit secret stored via Wrangler secrets. Never embed this credential in frontend JavaScript, a URL, an issue or Git. Rotate it if exposed. A future multi-admin UI should use identity-based roles and audit attribution; sharing this service credential is not that UI.

## Adding providers

`src/integrations.ts` defines the reviewed adapter interface and a bounded HTTPS JSON fetch helper. No generic URL-forwarding endpoint exists. The adapter registry is empty; there are no implied live CRM/EME integrations and no requests to links found inside the supplied R file.

For each provider:

1. Confirm documented endpoints, permission to use the data, terms, quota and credentials.
2. Register a fixed HTTPS origin in source; never accept origins supplied by a visitor. Pin paths, parameter allowlists and pagination limits in the adapter.
3. Store credentials in Worker secrets or the offline ingestion environment. Use request headers, not query-string keys when supported.
4. Map and validate provider data into a complete snapshot; preserve timestamps, provenance and explicit missing-data states.
5. Test with fixtures, timeout/error responses, schema drift, duplicates and quota exhaustion. Never replace the current snapshot on failure.
6. Choose a low-frequency refresh schedule based on actual freshness needs. Add bounded retries respecting Retry-After, a job lock, provider-specific quotas and run-history retention before enabling scheduled jobs. `integration_runs` is reserved for that work and is not currently populated.

The current helper limits response bytes to 900 KB, uses an 8-second timeout, rejects redirects and permits only reviewed HTTPS origins. Larger source imports or CPU-heavy analysis should run offline, then publish summaries; do not put Excel parsing into a 10 ms request handler.

## Optional individual sign-in

As an alternative to the active shared password, set DATA_ACCESS=access, ACCESS_TEAM_DOMAIN=https://your-team.cloudflareaccess.com and ACCESS_AUD to the Access application's audience, then configure Cloudflare Access policy for the whole hostname. JWT verification checks signature, issuer, audience and expiry; missing configuration denies reads and assets. Private data never enters the shared API cache. Previously published public data cannot be made secret retroactively. Access mode is implemented but not enabled or account-integration-tested. Do not change DATA_ACCESS to public unless intentionally publishing the data again.
