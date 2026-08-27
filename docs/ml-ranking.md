# Semantic ranking and preference learning

## Embeddings

Each quality-qualified article receives a versioned embedding after full-text analysis.

- Production provider: Cloudflare Workers AI `@cf/baai/bge-small-en-v1.5` by default; configurable OpenAI-compatible embeddings remain available as an alternative.
- Local provider: deterministic feature hashing, used only for development and tests.
- Full vector: 384 dimensions, private JSON object in R2 and upserted into Vectorize.
- Daily projection: fixed 64-dimensional signed feature-hash projection in D1.

The projection keeps daily ranking deterministic and avoids loading hundreds of R2 objects. Vectorize retains the full vector for semantic search, index rebuilds, and future retrieval features. Changing provider, model, dimensions, or projection logic requires a new `EMBEDDING_VERSION`.

Long articles are split into overlapping chunks. Every chunk is embedded, weighted by length, averaged, and normalized; no section is silently discarded.

## Semantic signals

The daily ranker compares a candidate projection with the seven most recent recommendation projections.

- Moderate similarity can add up to `0.35` connection points.
- Low similarity adds up to `0.30` exploration points.
- Theme and author fatigue remain independent guardrails.
- The editorial Top 10 is capped at two articles per author and three per primary theme.

These values are dynamic ranking signals, never intrinsic-quality changes.

## Preference model

The system trains a regularized ridge model after at least ten effective feedback samples.

Labels:

| Feedback | Label |
|---|---:|
| Valuable | 1.00 |
| Good | 0.35 |
| Not for me | -1.00 |
| Unfinished | -0.45 |
| Later | excluded |

Features include intrinsic score dimensions, log reading length, the 64-dimensional semantic projection, and hashed author/theme categories. Training uses only the latest feedback for each recommendation.

Influence is confidence-gated:

| Effective samples | Maximum share |
|---:|---:|
| 0–9 | 0% |
| 10–29 | 5% |
| 30–59 | 10% |
| 60–99 | 15% |
| 100–199 | 20% |
| 200+ | 30% |

The predicted value is bounded and converted to at most `0.9` additive rank points. It cannot bypass quality, access, duplication, author cooldown, or theme-diversity rules.

Every trained model stores its feature version, embedding version, sample count, weights, mean squared error, training cutoff, and active status. Each selection run records the embedding version and preference-model ID it used.

The configured Workers AI model was verified against the Cloudflare API on August 27, 2026: one input returned shape `[1, 384]` with `cls` pooling, matching the existing Vectorize index.
