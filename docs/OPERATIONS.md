# Operations

Live URL: https://flipped-energy-dashboard.flipped-energy-dashboard.workers.dev

The initial operator secret is stored in the working computer’s ignored `private/production-ingest-token` file with owner-only permissions, and as the Cloudflare Worker secret. Transfer it to your password manager before removing this workspace. It has not been included in GitHub or shared with site visitors.

## Initial deployment

The configured Cloudflare Worker is `flipped-energy-dashboard`, with a dedicated D1 database. Use the existing database ID in `wrangler.jsonc`; do not create another database on every deployment.

```bash
npx wrangler login
npm ci
npm test
npm run build
npx wrangler d1 migrations apply DB --remote
npm run deploy
npx wrangler secret put INGEST_TOKEN
```

Use a randomly generated 256-bit ingestion secret. Keep it in a password manager or a local restricted file outside Git. The secret command prompts securely. The admin API fails closed until a strong secret is configured. No database content is embedded in the deployment bundle.

After setting INGEST_TOKEN in the current terminal environment:

```bash
node scripts/publish-snapshot.mjs https://YOUR-WORKER.workers.dev private/snapshot.json
```

Use the exact deployed hostname returned by Wrangler. Do not send real data to a guessed hostname. The import endpoint validates before updating the active pointer. Existing visitors can see the previous cached dataset for up to 60 seconds after a publish or rollback. There is no automatic refresh while a dashboard is open.

## Updating code

Commit changes to GitHub after checks pass. The included GitHub workflow runs tests and a dry build; it does NOT deploy automatically. Deploy reviewed code with `npm run deploy`. Optional Cloudflare Workers Builds can later connect this repository with build command `npm ci && npm test && npm run typecheck` and deploy command `npx wrangler deploy`; grant the repository integration intentionally. No GitHub deployment credentials have been created by this project.

## Updating data

Save a recalculated workbook into ignored `private/`, run the importer, inspect Data quality locally, then publish the validated snapshot with the admin API. Code updates do not automatically import newer spreadsheets.

## Rollback and backup

GET `/api/admin/snapshots` with the bearer token to obtain retained IDs; POST `/api/admin/activate` with a selected ID to roll back. This changes the active pointer, not the source workbook. Keep independent encrypted backups of workbook, snapshots, configuration and recovery credentials. Retention is ten recent versions plus any protected active or referenced version. D1 Time Travel availability depends on the plan; do not treat short-term retention as a permanent backup.

Code rollback: `npx wrangler deployments list`, then `npx wrangler rollback <version-id>` after verifying schema compatibility. Database migrations are not automatically reverted by a Worker rollback.

## Monitor and control costs

As verified against official documentation on 14 September 2026:

- Workers Free: 100,000 dynamic requests per day, 10 ms CPU per invocation; limits apply account-wide.
- Static asset requests are free and unlimited under Workers Static Assets; API requests still invoke the Worker even on cache hits.
- D1 Free: 5 million rows read/day, 100,000 rows written/day, 5 GB total storage. These limits are not the same as HTTP requests. Retention/deletion and index maintenance count toward writes.
- Free limits can reject requests when exhausted. No upgrade or paid product is needed or enabled by this project; confirm your account's existing subscription separately.

At 20 viewers, one initial API request each is about 20 dynamic invocations. Changing page, graph filters or the model slider does not call the backend. Manual refresh makes another request. External provider polling, bots and retries would be additional usage.

In Cloudflare, inspect Workers & Pages → flipped-energy-dashboard → Metrics (requests, CPU, errors), and Storage & Databases → D1 → flipped-energy → Metrics (rows and storage). Review particularly CPU on imports, which perform validation. A dry build or low traffic does not establish unlimited scalability. Worker logs are sampled at 10%; they log failure metadata, not credentials or body contents.

No current scheduled jobs, R containers, AI calls, R2 storage or external APIs incur background usage. Before adding providers, set explicit refresh intervals and error budgets. Free-tier exhaustion can still cause downtime; a production service requiring an SLA needs a separate availability/cost decision.

Official references:

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/reference/time-travel/
