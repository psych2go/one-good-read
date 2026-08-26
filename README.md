# One Good Read

One Good Read is an open-source, Cloudflare-native daily reading system. It reads articles from a human-curated source allowlist, analyzes their intrinsic quality, applies freshness and diversity guardrails, and publishes exactly one original recommendation card each day. It never republishes source articles.

## Current milestone

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

The local default uses a deterministic heuristic analyzer so the system can run without paid credentials. Production should set `AI_PROVIDER=openai` and store `OPENAI_API_KEY` as a Wrangler secret.

## Cloudflare services

- Workers + Static Assets: public site and admin routes
- D1: metadata, analyses, recommendations, feedback, audit snapshots
- R2: private normalized article text
- Vectorize: reserved for semantic features in the next milestone
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

## Production setup

1. Create D1, R2, Vectorize, and Workflow resources and replace the placeholder D1 ID in `wrangler.jsonc`.
2. Set `APP_ORIGIN`, `ADMIN_EMAIL`, `AI_PROVIDER`, and `AI_MODEL` for production.
3. Store the API key without committing it:

   ```bash
   npx wrangler secret put OPENAI_API_KEY
   ```

4. Apply D1 migrations.
5. Configure Cloudflare Access to protect `/admin/*` for the administrator account.
6. Run `npm run check`, then deploy.

The cron expression `30 16 * * *` runs at 00:30 Asia/Shanghai. The workflow publishes for the current Shanghai calendar date.

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
