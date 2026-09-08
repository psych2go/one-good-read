# Architecture

```text
00:30 Shanghai Cron Trigger
  -> independent BackfillWorkflow (when BACKFILL_ENABLED)
      -> active source adapters / current discovery (also above reservoir target)
      -> deterministic content gate
      -> private normalized text in R2
      -> blind body eligibility + quality / contextual analysis
      -> D1 versioned analysis + eligibility / rejected review queue
      -> R2 + Vectorize full embedding / D1 projection
  -> independent DailyReadingWorkflow (when AUTOMATION_ENABLED)
      -> wait until 05:30
      -> stored eligibility + conservative legacy screen (no fresh body/AI gating)
      -> confidence-gated preference model
      -> deterministic, diversified Top 10
      -> link verification / AI editorial choice and copy with fallback
      -> validated copy / transactional winner-only recommendation in D1
      -> public queries hide the row until 06:00

06:30 Shanghai Cron Trigger (AUTOMATION_ENABLED, independent of BACKFILL_ENABLED)
  -> BackfillWorkflow {healthCheck:true}, before all ingestion/storage guards
      -> durable operational-health-check step / persisted started and terminal heartbeat
      -> publication / bounded R2 cleanup / tracked-storage diagnosis
      -> persisted alert episodes / current-attempt guarded recovery

Worker
  -> read-only business /health and D1 /health/live
  -> public SSR pages
  -> Archive and sitemap
  -> Access-protected admin routes
  -> Workflow triggers and private feedback
  -> Access JWT verification
  -> storage lifecycle and operational alerts
```

The first reliability slice above was deployed on 2026-09-08 after migration 0012, independent review, and 130 passing tests. See [reliability-slice.md](reliability-slice.md) for transitional legacy coverage, rollout evidence, and remaining runtime validation.

The second monitoring slice was deployed and manually bootstrapped on 2026-09-08 after additive migration 0013, independent review and 177 passing tests. Attempt IDs atomically guard both heartbeat timestamps and health-managed incident transitions against stale overlapping checks. See [monitoring-slice.md](monitoring-slice.md) for Shanghai deadlines, alert episodes, public privacy, production evidence and remaining scheduled-run verification.

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
- Recommendation dates are unique; only the actual inserted winner changes article/retention state, and losing runs return the stored publication result. Withdrawn dates are not automatically republished.
- Workflow instance IDs include their logical date or a random backfill ID.
- Selection runs and candidate snapshots are immutable audit records.

## Production hardening still planned

- Confirm a compliant free full-text discovery path for Bloomberg Money Stuff; the other allowlisted source groups now have adapters.
- Access is configured; external Email Sending/domain onboarding and actual alert delivery remain deferred.
- AI circuit breaker/quota coordination, broad legacy body review, and further diversity/preference-model work remain deferred.
- Split large analysis artifacts from D1 into R2 before approaching the free D1 per-database limit.
