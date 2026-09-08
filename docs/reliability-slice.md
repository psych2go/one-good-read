# First reliability / content-quality slice

## Status: deployed on 2026-09-08 after independent review

This slice follows the 2026-09-08 audit of **Short Videos, Big Self-Control Problems**. The supplied 131-word page is predominantly a paper abstract plus attribution; its stored 8.25 quality score did not establish that the page was a standalone essay. The audit reported 319 Ready articles, all with embeddings, one public recommendation, and eight simulation feedback records. Post-deployment remote checks confirmed those counts and the original recommendation identity were preserved.

The existing public recommendation, feedback, and simulation history are preserved. Nothing here withdraws or rewrites published recommendations.

## Completed in this slice

### Content eligibility is separate from score

- Blind body analysis supplies versioned `contentEligibility`: `standalone_essay`, `abstract`, `quotation_introduction`, `roundup`, `preview`, `media`, or `uncertain`, plus a reason and literal body evidence.
- Runtime validation checks version, enum, nonempty/bounded reason, bounded evidence array, string types, and evidence membership in the supplied body. JSON-schema instructions alone are not trusted. Invalid or missing model eligibility becomes a rejected, reviewable uncertain result, not legacy eligibility.
- Only `standalone_essay` can pass **new ingestion**. Quality scores cannot override this gate. The existing numerical quality thresholds and ranking/feedback formulas are unchanged.
- There is no blanket minimum word count or quote-ratio ban. A self-contained short essay and an essay developing its own argument around extensive quotations are positive regressions. A title about videos is not by itself evidence of a media-first format.
- The development heuristic cannot establish standalone eligibility and now emits `uncertain`; use local SQL fixtures for offline publication testing rather than treating heuristic output as verified content.
- No paper links are automatically followed. Existing allowlisted extraction paths remain unchanged.

### Legacy coverage is deliberately partial

Migration `0012_content_eligibility.sql` adds nullable `analyses.content_eligibility` and `articles.content_review_reason`. **NULL means `legacy_unknown`, never verified standalone.** The migration has no bulk data rewrite. `ANALYSIS_VERSION` stays `blind-v1-context-v1` so deployment does not strand the prepared pool.

Selection reads stored risks/context and rejects explicit statements that the supplied text is mainly an abstract, a quotation introduction, or incomplete. Short abstract records explicitly missing methods/identification detail are also screened. Merely discussing abstracts/copyright, quoting research, or being brief is not a rejection. The audit's abstract, Capital gains vs. wealth taxes, and Daddy’s Girl examples are negative regressions; the generative-AI/copyright example is a positive control.

Screening happens **before the final candidate limit**. The current modest prepared pool is loaded and filtered locally; no body retrieval, network call, or fresh AI analysis is added to publication. Review reasons are recorded on Ready article metadata without changing public recommendations. The read-only Access-protected admin queue also computes reasons before the first selection run, shows evidence and stored eligibility, excludes published history, and labels remaining unknown Ready counts honestly. New rejected analyses remain in the existing `rejected` status.

Other legacy unknowns remain provisionally selectable after this conservative screen. This is not a comprehensive audit of all 319 bodies and may miss nonstandalone pages whose old analysis did not describe the limitation. Manual approval overrides and broad reanalysis are **not** implemented; any bulk reanalysis or policy change requires a separate decision. The admin list shows at most 100 review items plus the total.

### Publication no longer depends on replenishment

At the existing **00:30 Shanghai** cron, independent `waitUntil` tasks launch:

1. `DAILY_WORKFLOW` when public automation is enabled (otherwise the existing private simulation path).
2. `BACKFILL_WORKFLOW` with `scheduledRefresh=true` when backfill is enabled, even if Ready count exceeds 300.

Daily ignores the legacy `scan` flag and performs no discovery, ingestion, embedding call, or replenishment launch. It waits until **05:30**, selects from the prepared pool, and writes visibility time **06:00**. The admin daily button follows that same timing; after the window it runs immediately. Existing twice-hourly Reservoir and 06:30 health schedules remain unchanged; no new service or cron slot is added.

Refresh processes active sources only, rechecks their status when the step executes, catches individual source-step failures so later sources still run, and replenishes missing embeddings separately. Scheduled refresh uses current discovery rather than prioritizing deferred historical backlog. Historical/manual managed source batches keep their existing article limits and unlock behavior; all-source manual backfill also replenishes embeddings. Source and embedding outages can degrade replenishment without blocking today's prepared-pool publication.

Workflow launches use singleton `createBatch`, whose [current official documentation](https://developers.cloudflare.com/workflows/build/rules-of-workflows/) says it skips existing IDs within retention. The installed generated type comment differs; duplicate skipping follows the official contract but was not separately exercised against production. Duplicate skips are logged separately from operational failures; operational errors are logged and propagated, not mislabeled as “existing.” Daily checks `AUTOMATION_ENABLED` at entry and the pipeline checks it before preparation and again immediately before publication. The scheduler's health/recovery path remains disabled when public automation is off.

### Transactional publication and safe failures

The recommendation insert, winner article state, body retention, run outcome, and actual-result read are one D1 batch transaction. Only the row inserted by that transaction can change an article or its retention. A same-date losing run is `degraded` with `publication_date_already_claimed`, has no winner assigned, and returns the actual stored winner/run. Retrying does not reset feedback eligibility or extend retention. A withdrawn date stays withdrawn.

AI editor/copywriter 429 and timeout errors retain deterministic fallbacks. Fallback keywords are trimmed, bounded, deduplicated, and padded with neutral reading labels when necessary so repeated analysis keywords cannot break publication during an outage. Returned copy is validated before persistence; malformed model-generated copy fails the selection rather than publishing blanks or non-string keywords. If all link checks fail, the run fails and records an operational alert; no fake publication is created. Homepage, dated page, archive, archive facets, and sitemap retain time-based visibility (archive facets now use it too). Simulation still writes only private simulation records and does not mark articles recommended or alter body retention.

## Local validation

- `npm run typecheck` and `npm test`: 130 tests in 24 files after fixing the independently reviewed fallback-keyword edge case.
- New `node:sqlite` repository/pipeline integration tests apply **all migrations** to an in-memory SQLite database. The D1 test adapter executes actual SQL and uses transactions for `batch`; it is not a mock of expected SQL strings.
- Tests cover transaction rollback; different simultaneous same-date winners; idempotent retry; withdrawn dates; public visibility immediately before/at 06:00; simulation privacy; legacy pre-limit exclusion and review visibility; new abstract rejection despite high scores; true short and quote-heavy positives; malformed eligibility/copy; all links failing; source outage; missing embeddings; independent workflow-create failure; refresh above 300; paused sources; disabled automation before and after sleep/preparation; AI fallback faults.
- `cloudflare:workers` entrypoint and step execution are local test stand-ins. Providers, fetch, and R2 writes are mocked. No production database, external provider, source network, or secrets are used by tests.
- The final `npm run check` after the review fix exited 0: type generation, typecheck, all 130 tests, and deployment dry-run passed. It ran in a secret-free temporary copy with isolated HOME/config and environment; `.dev.vars` and `.env` files were excluded. `git diff --check` also passed.

## Rollout checklist

1. Independently review the diff and local test evidence. This document does not authorize deployment.
2. Apply additive migration **0012** before deploying code that selects the new columns. Before this rollout, production was migrated through **0011**. The old Worker tolerates the extra nullable columns; the new Worker requires them.
3. Keep analysis/embedding/selection model versions and existing active/paused source policy unchanged. Review the new admin queue and the remaining legacy-unknown count; do not bulk reclassify or withdraw history automatically.
4. Inspect in-flight Daily/Backfill instances before rollout. Workflows can retain old code/environment or durable steps; an old Daily may still have the blocking scan sequence. Drain/terminate/recover those deliberately, not by assuming a deployment upgrades them. When disabling automation, also handle already-running old-version instances and already-stored future-visible recommendations according to operator policy; no automatic withdrawal is added here.
5. After an approved deployment, verify independent `daily-DATE` / `refresh-DATE` launches, source errors, review reasons, one winner/run per date, and 06:00 visibility. Confirm operational launch failures are logged distinctly. The same-day smoke check below does not replace observation of the next scheduled refresh and full selection.

## Deployment evidence

- A private D1 export was taken before migration; no backup or credentials are committed.
- Preflight found the old Daily complete and no running Backfill instances; no active workflow needed termination.
- Applied migration `0012_content_eligibility.sql` at 2026-09-08 03:44:18 UTC, then deployed Worker `cf7b3323-d03e-486b-8353-9a30966fb0d0`. Four cron schedules and four workflow bindings remain; configuration/model versions were not changed.
- `/health` reported `ok=true` and `automationEnabled=true`. Home, archive, today's dated page and sitemap returned 200; `/admin/` redirected to Access login (302). The authenticated admin UI was not exercised remotely.
- A controlled same-date Daily instance `verify-reliability-2026-09-08` completed at 03:45:43 UTC, returning the existing article and original selection run. It created no second recommendation and did not rewrite the public article. Post-check SQL confirmed one recommendation, eight simulations, eight simulation feedback entries, 319 Ready rows, and no orphan recommended articles.
- Offline screening of the production backup excluded two legacy abstract/introduction candidates (Daddy’s Girl and Capital gains vs. wealth taxes), leaving 317 provisionally eligible legacy-unknown candidates. This was an offline screen, not a bulk production status change or a claim of full body verification.
- The first independent refresh/full-selection cycle under the new code is expected on 2026-09-09: 00:30 refresh, 05:30 selection, 06:00 visibility (Asia/Shanghai). New provider eligibility compliance, independent scheduled launches, and that publication remain to be observed; the same-day smoke check deliberately reused an existing recommendation.

## Deferred / residual limitations

- External alert delivery/domain onboarding; alerts currently persist to D1 and may still have disabled email delivery.
- AI-wide circuit breaker, cross-run quota budgeting, and sustained-outage recovery. Existing bounded retries and deterministic selection/copy fallback remain; they do not repair bad analyses.
- Broader body reanalysis, richer editorial policy or manual approval controls, diversity/ranking changes, preference-model experiments, model/provider changes.
- Link checks still depend on network availability and the existing challenge allowlist; D1/storage failures and an exhausted eligible pool can still prevent publication.
- Prepared-pool screening currently loads the pool before slicing (appropriate for hundreds, not an unbounded corpus). Source refresh and historical Reservoir jobs can overlap as before; eliminating duplicate ingestion/AI work needs separate coordination work.
- SQLite tests validate SQL semantics and transactions, not Cloudflare's distributed runtime, retry replay, or production provider compliance. Fresh structured-output behavior must be observed during approved rollout.
