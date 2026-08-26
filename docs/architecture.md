# Architecture

```text
Cron Trigger
  -> DailyReadingWorkflow
      -> source adapters
      -> B2 standalone-content gate
      -> private normalized text in R2
      -> blind + contextual AI analysis
      -> D1 versioned analysis
      -> R2 + Vectorize full embedding
      -> D1 semantic projection
      -> confidence-gated preference model
      -> deterministic, diversified Top 10
      -> AI editorial choice
      -> scheduled recommendation in D1

Worker
  -> public SSR pages
  -> Archive and sitemap
  -> Access-protected admin routes
  -> Workflow triggers and private feedback
```

## Boundaries

- `src/sources`: allowlisted discovery and extraction adapters.
- `src/ai`: provider-neutral analysis/editor interface. The heuristic provider is development-only.
- `src/domain`: quality gate, dynamic ranking, content eligibility, date rules.
- `src/db`: D1 persistence and public queries.
- `src/workflows`: durable ingestion, backfill, ranking, and publication.
- `src/web`: server-rendered public and admin UI.

## Idempotency

- Article IDs are stable hashes of canonical URLs.
- `(article_id, analysis_version)` is unique.
- Recommendation dates are unique.
- Workflow instance IDs include their logical date or a random backfill ID.
- Selection runs and candidate snapshots are immutable audit records.

## Production hardening still planned

- Confirm a compliant free full-text discovery path for Bloomberg Money Stuff; the other allowlisted source groups now have adapters.
- Validate Cloudflare Access JWTs inside the Worker as defense in depth.
- Add email alerts, storage thresholds, and the 90-day R2 lifecycle cleanup.
- Split large analysis artifacts from D1 into R2 before approaching the free D1 per-database limit.
