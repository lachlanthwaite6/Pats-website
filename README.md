# Flipped Energy dashboard

[Open the live dashboard](https://flipped-energy-dashboard.flipped-energy-dashboard.workers.dev) · [Source repository](https://github.com/lachlanthwaite6/Pats-website)

A small password-protected dashboard for workbook-based energy pricing analysis, hosted on Cloudflare Workers and D1. Signed-in visitors can filter graphs and tables without per-user R processes. Five analysis views are accompanied by explicit source-quality notes.

The whole website and read API require the shared viewing login (default username `dashboard`, configurable through `DASHBOARD_USERNAME`). The workbook, exported snapshot, original R source and credentials are excluded from Git and static hosting. The source repository contains application code, not the published dataset. Authenticated viewers can still copy the data they can see. Password protection cannot revoke copies downloaded while the site was previously public.

## Architecture

```text
Excel workbook → offline Python import/validation → authenticated snapshot API → D1
                                                                              ↓
Browser ← authenticated HTML/CSS/JS + private read API ← Cloudflare Worker

Future provider adapter → validated snapshot → same publication path
Optional local R/Shiny companion ← exported snapshot
```

- Every request, including static assets, invokes the Worker and passes authentication before content is served. Production preview URLs are disabled.
- `/api/v1/dashboard` returns one compact snapshot; filters operate in the browser.
- Password-protected responses use `private, no-store`, never consult the public API cache and do not emit ETags. Read credentials are stored as a Cloudflare secret, never in frontend code.
- Snapshot publication validates a strict schema, stores a content hash and updates the active pointer in a D1 transaction. Repeated identical submissions are idempotent.
- Up to ten recent snapshots plus an older active/referenced snapshot are retained. Export snapshots separately for long-term recovery.
- Admin endpoints require a strong bearer secret; there is no browser admin/code editor.
- Provider integration contracts are present, but no live services, polling or cron jobs are enabled.

## Local development

Requires Node 24 and Python 3.14 for the pinned importer dependencies.

```bash
npm ci
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
mkdir -p private
# Place your recalculated workbook in private/FLIPPEDupdated.xlsx.
.venv/bin/python scripts/import_workbook.py private/FLIPPEDupdated.xlsx
```

Create `.dev.vars` with separate randomly generated local `INGEST_TOKEN` (at least 32 characters) and `DASHBOARD_PASSWORD` (at least 24 characters); keep them out of Git. Then:

```bash
npm run db:local
npm run dev
```

In a second terminal:

```bash
node scripts/seed-local.mjs
```

Open `http://127.0.0.1:8787` and use username `dashboard` with the local password. The development database is separate from Cloudflare production. The workbook import is not automatically run on page visits or code deployment.

## Checks

```bash
npm test
npm run build
node scripts/verify-local.mjs  # requires local server and seeded dataset
```

See [Operations](docs/OPERATIONS.md) for deploy, publish, rollback and quota monitoring; [Data definitions](docs/DATA.md) for differences from the supplied R app; [API contract](docs/API.md) for integrations.

To change the live viewing login, edit and save `private/dashboard-login.txt`, then run `node scripts/apply-login.mjs`. Editing the file alone does not update Cloudflare. Passwords must be 24–256 characters; the command validates the file, updates both credentials securely, and verifies live access without printing either credential. Use `--check` for local validation without uploading.

## R/Shiny

`shiny/app.R` is a small optional LOCAL companion requiring only `shiny` and `jsonlite`. It reads the same prepared JSON; it does not run on Cloudflare. The original provided R app remains in the ignored `private/` directory on the working computer. R was not installed during this build, so this optional companion has not been runtime-tested.

## Hosting costs

Designed for Workers Free and D1 Free. No paid plan, containers, R2, queue, live provider or paid database is required for this version. Free-tier limits still apply account-wide; this is not a promise of unlimited API usage. See Operations for current limits and a review checklist before connecting providers.
