# Product specification

## Promise

One Good Read publishes one public recommendation every day at 06:00 Asia/Shanghai. The recommendation links to a freely readable original article from a strict, administrator-controlled source allowlist. It does not republish the article.

## Public experience

- Chinese interface and editorial copy; original English title and author name.
- Home page shows exactly one reading sheet.
- Archive supports author, canonical theme, and year filters with pagination.
- No visitor accounts, cookies, behavioral analytics, popularity ranking, infinite scroll, or “related articles.”
- Recommendation means “worth serious reading,” not endorsement.

## Eligibility

A candidate must be freely readable without login, have a complete standalone text, pass extraction confidence, and receive a full-text analysis. Link roundups, pure audio/video pages, announcements, previews, and paywalled or registration-only content are excluded.

## Intrinsic quality

Blind analysis hides author/source identity and scores:

- Long-term value: 30%
- Idea density: 25%
- Argument quality: 20%
- Originality: 15%
- Clarity and structure: 10%

Context analysis restores author, source, date, themes, and connections. Author reputation never adds intrinsic quality.

Initial gate: intrinsic >= 7.5, long-term value >= 7, idea density >= 7, every dimension >= 5, extraction confidence >= .90, analysis confidence >= .70.

## Daily ranking

The deterministic algorithm combines intrinsic quality, decaying freshness, exploration uncertainty, personal fit, connections, author fatigue, and theme fatigue. It creates a stable Top 10. An AI editor may reorder only within that Top 10; failure falls back to the deterministic first result.

The 60/25/15 classic/new/explore split is a rolling guardrail, not a daily lottery. Newness decays over 30 days. The same author may not appear on consecutive days.

## Feedback

Private administrator-only labels:

- Valuable
- Good
- Not for me
- Unfinished
- Later

Only “Later” permits automatic reappearance, after at least 14 days and at most twice. Public visitors never influence the ranking.

## Operations

- 00:30 Asia/Shanghai: discover new articles.
- 05:30: freeze candidates and select.
- 06:00: make the scheduled recommendation visible.
- Publication failure falls back through precomputed candidates; total failure leaves the last successful dated recommendation visible and raises an operational alert.

## Privacy and retention

Normalized full text is private. Raw HTML is not retained. Recommended article text is deleted after 90 days; metadata, hashes, versioned analyses, and immutable selection snapshots remain. No saved full text is ever served as a replacement for an unavailable source page.

## Implemented semantic layer

Qualified articles receive versioned full-text embeddings. Recent-reading similarity contributes connection and exploration signals without changing intrinsic quality. After ten effective administrator feedback samples, a regularized model begins influencing ranking at 5%; its influence grows gradually and remains bounded by the agreed confidence schedule.
