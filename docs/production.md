# Production deployment

## Current deployment

Public automation was enabled on 2026-09-07. The first reliability/content-quality slice was deployed on **2026-09-08**, after additive migration **0012**, independent review, and 130 passing tests. Worker version: `cf7b3323-d03e-486b-8353-9a30966fb0d0`. Post-deployment checks confirmed 319 Ready articles, the unchanged public recommendation, eight simulation rows and eight simulation feedback entries. See [reliability-slice.md](reliability-slice.md) for legacy eligibility treatment, independent 00:30 refresh, concurrency safety, tests, and rollout precautions for in-flight workflows. No published history is automatically withdrawn or rewritten.

The production site is deployed at `https://read.zhuying.fun`. The public home page is available over HTTPS. `/admin` redirects to `/admin/`, which is protected by the configured Cloudflare Access application. Public daily and health handlers are controlled by `AUTOMATION_ENABLED`; backfill has its own switch. The historical records below describe prior stages and are superseded by the launch record and current reliability-slice notes where they differ.

## Provisioned resources

The Cloudflare account currently has dedicated One Good Read resources:

- D1: `one-good-read` (`4ea72c4b-ded9-4c87-86ac-8bb849546acd`)
- R2: `one-good-read-content`
- Vectorize: `one-good-read-articles`, 384 dimensions, cosine metric

All D1 migrations through `0012_content_eligibility.sql` have been applied remotely. Migration 0012 was applied at 2026-09-08 03:44:18 UTC, after a private database backup and before Worker deployment.

## Remaining activation inputs

The production OpenAI-compatible relay secret, Cloudflare Access, and the seven-day simulation gate are all complete. Public automation was enabled on 2026-09-07: `AUTOMATION_ENABLED=true`, `SIMULATION_ENABLED=false`, deployed after the preflight check passed. The first scheduled public run is the 00:30 Asia/Shanghai trigger, with publication at 06:00 Shanghai.

## Deployment safety gate

`npm run deploy` runs `scripts/check-production-config.mjs` before Wrangler. Deployment fails closed until all of the following are configured:

- `APP_ORIGIN`: final HTTPS domain
- `ADMIN_EMAIL`: administrator address
- `ACCESS_TEAM_DOMAIN`: `https://aaron-bjtu.cloudflareaccess.com`
- `ACCESS_AUD`: Access application audience tag
- production AI provider
- production embedding provider
- real D1 resource ID

This prevents accidentally publishing `/admin/*` without Access protection or deploying the local heuristic AI configuration.

## Cloudflare Access

Create a self-hosted Access application for the final hostname and protect `/admin/*`. Allow only the administrator identity. Copy the application audience tag into `ACCESS_AUD` and the Zero Trust team domain into `ACCESS_TEAM_DOMAIN`.

The Worker validates `Cf-Access-Jwt-Assertion` against the team JWKS endpoint, expected issuer, audience, and configured administrator email. Non-local requests fail closed when Access is missing or invalid. The email header alone is not trusted.

## AI secrets

Set the production variables to the selected provider, then add the secret interactively:

```bash
npx wrangler secret put AI_API_KEY
```

For an OpenAI-compatible relay, configure:

```jsonc
"AI_PROVIDER": "openai-compatible",
"AI_BASE_URL": "https://wangzixiang.eu.org",
"AI_MODEL": "gpt-5.6-luna",
"EMBEDDING_PROVIDER": "openai-compatible",
"EMBEDDING_BASE_URL": "",
"EMBEDDING_MODEL": "relay-embedding-model"
```

`AI_BASE_URL` is the API prefix, not the full `/responses` URL. The configured relay exposes `/responses` directly from its root URL. The application appends `/responses` and `/embeddings`. Leave `EMBEDDING_BASE_URL` empty when both APIs share the same prefix. The relay must accept OpenAI Responses structured-output payloads. Embeddings default to Cloudflare Workers AI and therefore do not require the relay to expose `/embeddings`. If an OpenAI-compatible embedding provider is selected instead, the same `AI_API_KEY` is used for both calls. `OPENAI_API_KEY` remains a temporary backward-compatible fallback.

Secrets must never be stored in `wrangler.jsonc`, `.dev.vars.example`, or GitHub.

## Operational email

Cloudflare Email Sending is not enabled on the account yet: the current API call returns `Unauthorized (2036)`. The application therefore logs alerts to D1 and keeps email delivery disabled by default.

After a final domain is onboarded for Email Sending:

1. Enable Email Sending for that domain.
2. Add the Worker binding:

   ```jsonc
   "send_email": [{ "name": "EMAIL" }]
   ```

3. Set `ALERTS_ENABLED=true`, `ALERT_TO_EMAIL`, and a verified-domain `ALERT_FROM_EMAIL`.
4. Send a real transactional test alert to an address you control.

Alerts always remain recorded in D1 even when email delivery is disabled or fails.

## Scheduled tasks

- `30 16 * * *`: 00:30 Asia/Shanghai. The scheduler launches daily selection and source/embedding refresh independently; refresh also runs above the 300-Ready reservoir target.
- `30 22 * * *`: 06:30 Asia/Shanghai publication health check, R2 lifecycle cleanup, and storage-pressure alerting.

## R2 lifecycle

The application tracks private object sizes in D1.

- Recommended article bodies expire 90 days after publication.
- Rejected below-threshold bodies expire after 7 days.
- Replaced body versions expire immediately.
- Full embedding vectors remain versioned in R2.
- At 70% of the configured storage limit, the system warns.
- At 85%, non-essential source and embedding backfills stop.
- Daily publication remains operational.

The configured free-plan safety limit is `10,000,000,000` bytes.

## Historical production AI validation

On August 27, 2026, the configured relay and model passed the remote production probe:

- `gpt-5.6-luna` Responses structured output: passed
- Cloudflare Workers AI 384-dimensional embedding: passed
- Vectorize upsert and cleanup: passed

Three initial articles were processed end to end. A subsequent controlled backfill produced 37 quality-qualified candidates across eight source groups. Long articles are now evaluated in overlapping full-text chunks, followed by a whole-article synthesis; 429, 5xx, network, and timeout failures receive up to three bounded attempts. Automation remains disabled until the 300-candidate and seven-day simulation gates are reached.

## Historical discovery pagination

Production source discovery now supports WordPress feed pages, Blogger `start-index`, Squarespace RSS pages, and Substack archive metadata. Substack remains RSS-first: if the archive API returns 403/429 from a Worker egress IP, history expansion stops gracefully without blocking recent articles or leaving a Workflow in a long retry wait. Historical free posts fall back from the Substack post API to the public `.available-content` HTML body when needed.

## Historical Reservoir coordinator rollout

A dedicated `one-good-read-reservoir` Workflow runs at minute 15 of every hour while `BACKFILL_ENABLED=true`.

- Target: 300 quality-qualified candidates.
- Per hourly run: at most four sources.
- Per selected source: one article.
- Source lock: two hours, cleared by the managed child Workflow on completion.
- Source rotation: prioritizes pending articles and least-recently scanned unlocked sources.
- Historical depth expands by two pages only when a source has fewer than ten pending articles.
- At 300 ready articles, the coordinator creates no more child Workflows.
- Public recommendation automation remains separately controlled by `AUTOMATION_ENABLED` and is still disabled.

The first production coordinator run planned four sources in two seconds, created four child Workflows, and increased the candidate pool while preventing duplicate analysis through D1 source locks.

## Hourly backfill monitor

A second hourly Cron runs at minute 45 while backfill is enabled. It records `backfill_monitor` in D1, automatically clears expired source locks, and checks:

- Reservoir has produced a status update within two hours.
- The ready-candidate count has grown within six hours.
- `analysis_failed` remains below 10% once at least ten failures exist.
- Backfill remains below the configured target.

Stale coordination, six-hour stalls, or excessive failures create deduplicated D1 alerts. The initial production monitor completed in one second with 42 ready candidates, one failed article, no alerts, and no residual locks.

## Reservoir acceptance prioritization

Reservoir source planning uses three exploitation slots and one exploration slot. Exploitation is ranked by a Bayesian-smoothed historical acceptance rate plus a small recency bonus; exploration selects the least-recently scanned source that still has pending work. Empty sources are considered only after all pending queues are exhausted.

Every successful paginated scan persists its actual `history_pages` depth. This prevents a source from discovering page-two/page-three articles once and later scanning only page one, which previously caused a high-priority historical source to produce `analyzed=0`. The production fix was verified with Benedict Evans: page depth persisted at three, 60 items were rediscovered, one historical pending article was analyzed, and one new Ready candidate was produced.

## Seven-day private simulation

`one-good-read-simulation` is deployed but cannot create a simulated recommendation until the private Ready pool reaches `RESERVOIR_TARGET=300`.

- `SIMULATION_ENABLED=true`
- Required consecutive days: 7
- Scheduled from the normal 00:30 Asia/Shanghai daily trigger while public automation is disabled.
- Below 300 Ready articles, the Workflow exits at the gate without creating a selection run, simulation row, or public recommendation.
- At or above 300, it waits until 05:30, runs the full Top-10/AI/editorial/link-check path, stores the winner only in `simulation_recommendations`, and leaves the article Ready and the public site unchanged.
- Prior simulation winners are excluded from later simulation days and included in author/theme fatigue history.
- A gap resets the consecutive-day streak.
- Seven consecutive days set `simulation_status.ready=true` and create a private operational alert for final launch auditing.

The production gate was verified with 52 Ready articles: the Workflow completed in one second with `status=skipped`; simulation rows and published recommendations both remained zero.

The real simulation then ran for eight consecutive days from 2026-08-29 to 2026-09-05 with one administrator feedback label per day (three valuable, four good, one unfinished) and no negative labels. `simulation_status.ready=true` and the private `simulation_ready` alert fired on 2026-09-04.

Two later runs (2026-09-06 and 2026-09-07) failed with relay-wide `429 model_cooldown` errors: the shared relay credentials had exhausted their usage limit before the 05:30 selection window. The retry ladder (21:30, 21:45, 22:15 UTC) behaved correctly but could not outlast a multi-hour cooldown. The logs do not identify which workloads exhausted the relay quota. `provider.writeRecommendation` now falls back to deterministic copy on request failure (`copywriting_fallback` event); the AI editor choice already had this fallback. The 2026-09-08 reliability slice also decouples replenishment and validates fallback keywords. These measures reduce AI-outage publication failures, but unavailable links, database failures, invalid returned copy, or an exhausted eligible pool can still prevent publication.

## Launch

2026-09-07: final launch audit passed (305 Ready candidates, 8/8 simulation days with daily feedback, preference model still below the 10-sample training threshold by design, Access enforced, no public recommendations yet), the copywriting fallback was added and tested, and `AUTOMATION_ENABLED` was switched to `true` with `SIMULATION_ENABLED=false`. Reservoir maintenance stays enabled to keep the pool at target.

## Reservoir throughput tuning

After multiple stable hourly cycles with zero analysis failures and no residual locks, the per-source batch size was increased from one to two while keeping source concurrency at four. A production validation processed eight articles across Benedict Evans, Paul Graham, Damodaran, and Astral Codex Ten: all child Workflows completed, the longest took two minutes, all locks cleared, no relay 5xx/timeouts occurred, and one article passed the quality gate.

## Free-plan Cron consolidation

The Cloudflare Free account permits five Cron triggers account-wide. An attempted six-trigger configuration was rejected with code `10072`; the existing schedules remained intact. The final Worker uses only four Cron schedules:

- minute 15: Reservoir batch plus integrated backfill health monitor
- minute 45: Reservoir batch plus integrated backfill health monitor
- 16:30 UTC: daily publication or gated private simulation
- 22:30 UTC: operational health/cleanup when public automation is enabled

The integrated monitor runs as the first durable step of every Reservoir Workflow, preserving twice-hourly health checks without consuming additional Cron slots. The production validation batch processed eight articles, added six Ready candidates, completed all child Workflows, and released all locks.
