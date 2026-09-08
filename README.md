# One Good Read

One Good Read is an open-source, Cloudflare-native daily reading system. It reads articles from a human-curated source allowlist, analyzes their intrinsic quality, applies freshness and diversity guardrails, and publishes exactly one original recommendation card each day. It never republishes source articles.

## Current milestone

The first reliability/content-quality slice was **deployed on 2026-09-08**: body-based standalone eligibility, transitional legacy screening with admin review visibility, independent daily replenishment, and transactional winner-only publication. See [the slice and rollout notes](docs/reliability-slice.md) for completed work, local test evidence, migration 0012, and deferred work.

The repository now includes source adapters for:

- Paul Graham Essays
- Morgan Housel and Ted Lamade at Collaborative Fund
- Nassim Nicholas Taleb
- Farnam Street
- Howard Marks Memos
- Astral Codex Ten
- Stratechery free Articles
- Marginal Revolution (Tyler Cowen and Alex Tabarrok)
- Aswath Damodaran
- Benedict Evans

Bloomberg Money Stuff remains deferred until a compliant, stable, free full-text discovery path is confirmed.

The development heuristic analyzer runs without paid credentials but now marks standalone eligibility uncertain; use the local SQL test fixtures to exercise offline publication. It is not a substitute for verified body analysis. Production can use OpenAI or an OpenAI-compatible relay. Set `AI_PROVIDER=openai-compatible`, configure the exact API prefix in `AI_BASE_URL`, and store `AI_API_KEY` as a Wrangler secret.

## Cloudflare services

- Workers + Static Assets: public site and admin routes
- D1: metadata, analyses, recommendations, feedback, audit snapshots
- R2: private normalized article text
- Vectorize: full 384-dimensional article embeddings
- D1 projections: deterministic 64-dimensional semantic ranking features
- Ridge preference model: versioned learning-to-rank after 10 effective feedback samples
- Source probes: administrator-only discovery/extraction diagnostics
- Workflows: durable daily and backfill pipelines
- Access: protect `/admin/*` in production

## Local setup

```bash
npm install
npm run types
npx wrangler d1 migrations apply one-good-read --local
npm run dev
```

Open `http://localhost:8787/admin`, run a source-specific or full backfill, then run the daily workflow. `GET /admin/probe/:sourceId?extract=1` verifies discovery and the first extraction without persisting it. Local admin access is intentionally allowed only when `APP_ORIGIN` points to `localhost`.

## Production

The production site is live at `https://read.zhuying.fun`. Dedicated D1, R2, and Vectorize resources are provisioned, Cloudflare Access protects `/admin/*`, and the production relay AI and Workers AI embeddings passed remote probes. After eight consecutive simulation days with daily feedback, public daily automation was enabled on 2026-09-07: one recommendation publishes every day at 06:00 Asia/Shanghai. See `docs/production.md` for the full deployment, simulation, and launch record.


1. Create D1, R2, Workflow resources, and a 384-dimensional cosine Vectorize index; then replace the placeholder D1 ID in `wrangler.jsonc`.

   ```bash
   npx wrangler vectorize create one-good-read-articles --dimensions=384 --metric=cosine
   ```
2. Set `APP_ORIGIN`, `ADMIN_EMAIL`, `AI_PROVIDER`, `AI_MODEL`, `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, and version variables for production.
3. Store the API key without committing it:

   ```bash
   npx wrangler secret put AI_API_KEY
   ```

4. Apply D1 migrations if new migrations have been added.
5. Configure Cloudflare Access to protect `/admin/*` for the administrator account.
6. Run `npm run check`, then deploy.

The cron expression `30 16 * * *` runs at 00:30 Asia/Shanghai. The new scheduler independently launches source/embedding refresh in the Backfill Workflow, including when the historical reservoir is above target. Daily consumes the prepared pool, waits until 05:30 for selection, and sets 06:00 visibility for the current Shanghai calendar date. It never waits for source scanning, embeddings, or refresh creation. The admin can also run a dedicated 10-article embedding batch.

## Retry, retention, and operations

An hourly Reservoir coordinator safely grows the private candidate pool toward 300 articles; once reached, a seven-day private simulation automatically exercises the real selection path without publishing using four locked source batches per run. “Later” schedules the article after a 14-day cooldown and may be consumed by at most two distinct recommendation exposures. Recommendation bodies expire 90 days after publication. An hourly minute-45 monitor checks Reservoir progress and clears expired locks. A 06:30 Asia/Shanghai health check records missing-publication, cleanup, and storage-pressure alerts; email is optional and disabled until a sending domain is onboarded.

## Semantic preference learning

Full vectors are stored privately in R2 and Vectorize. Daily ranking uses compact D1 projections to compute recent-reading connections, knowledge-distance exploration, and a confidence-gated ridge preference model. See `docs/ml-ranking.md`.

## Data policy

- No public visitor accounts, cookies, or behavioral analytics.
- Full article text is private and never served publicly.
- Raw HTML is not retained.
- Recommendation means “worth reading,” not endorsement.
- Paywalled, registration-only, incomplete, or non-standalone pages are excluded.

## License

MIT

## Local network note

In this development environment, Workerd requests routed through the configured proxy time out for the Taleb Substack and Blogger/Damodaran feed hosts even though direct command-line requests succeed. The adapters use official feeds and are covered by parser tests; production deployment must run the administrator source probes before enabling them. Source fetches have a 30-second timeout and surface failures instead of hanging indefinitely.
