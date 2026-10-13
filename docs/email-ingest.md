# Money Stuff email ingest

Bloomberg Money Stuff is a push-only source. The agent inbox subscribes to the free newsletter and POSTs each message into One Good Read. The Worker never talks to `mail.grokbot.com`.

## Auth

Set a Wrangler secret (do not commit it):

```bash
npx wrangler secret put INGEST_EMAIL_SECRET
```

Call either:

- `POST /api/ingest/email` with `Authorization: Bearer <INGEST_EMAIL_SECRET>` (recommended for machines; path is outside the Access UI app if Access only covers `/admin/*`)
- `POST /admin/ingest/email` with the same Bearer secret **or** a Cloudflare Access JWT / service token for the admin application

## Request body

```json
{
  "sourceId": "money-stuff",
  "messageId": "<stable email Message-ID>",
  "subject": "Money Stuff: ...",
  "author": "Matt Levine",
  "publishedAt": "2026-10-13T14:00:00Z",
  "htmlBody": "<p>...newsletter html...</p>",
  "textBody": "optional plain text",
  "canonicalUrl": "https://www.bloomberg.com/opinion/articles/...",
  "fromAddress": "optional",
  "toAddress": "optional"
}
```

- `messageId` (or `externalId`) is required and should be stable for idempotency.
- Provide `htmlBody` and/or `textBody` (at least one).
- Prefer `canonicalUrl` when the newsletter includes a Bloomberg link; otherwise the parser extracts the first Bloomberg URL from the body, or falls back to a synthetic `.../newsletters/money-stuff/email/<messageId>` identity URL.
- Re-posting the same identity URL skips re-analysis when the article is already past `discovered` (unless it is a retryable `empty_body` rejection or `analysis_failed` under the retry limit).

## curl example

```bash
curl -sS -X POST "https://read.zhuying.fun/api/ingest/email" \
  -H "Authorization: Bearer $INGEST_EMAIL_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceId": "money-stuff",
    "messageId": "<msg-id@bloomberg.com>",
    "subject": "Money Stuff: Example",
    "author": "Matt Levine",
    "publishedAt": "2026-10-13T14:00:00Z",
    "htmlBody": "<p>A long newsletter body with enough words to pass extraction.</p>",
    "canonicalUrl": "https://www.bloomberg.com/opinion/articles/2026-10-13/example"
  }'
```

## Deploy follow-ups

1. `npx wrangler d1 migrations apply one-good-read --remote` (migration `0014_money_stuff`)
2. `npx wrangler secret put INGEST_EMAIL_SECRET`
3. Deploy the Worker
4. Point the agent inbox forwarder at `/api/ingest/email` with the secret
