# Production deployment

## Current deployment

The production safe shell is deployed at `https://read.zhuying.fun`. The public home page is available over HTTPS. `/admin` fails closed with HTTP 403 because the Access application audience has not been configured. Scheduled handlers are deployed but return immediately while `AUTOMATION_ENABLED=false`.

## Provisioned resources

The Cloudflare account currently has dedicated One Good Read resources:

- D1: `one-good-read` (`4ea72c4b-ded9-4c87-86ac-8bb849546acd`)
- R2: `one-good-read-content`
- Vectorize: `one-good-read-articles`, 384 dimensions, cosine metric

All D1 migrations through `0007_retry_storage_alerts.sql` have been applied remotely.

## Remaining activation inputs

- Cloudflare Access application audience (`ACCESS_AUD`) for `read.zhuying.fun`
- production OpenAI API key stored with Wrangler Secrets
- optional Email Sending domain onboarding

After Access and AI are configured, set `AI_PROVIDER=openai`, `EMBEDDING_PROVIDER=openai`, and `AUTOMATION_ENABLED=true`, run the deployment safety check, and deploy again.

## Deployment safety gate

`npm run deploy` runs `scripts/check-production-config.mjs` before Wrangler. Deployment fails closed until all of the following are configured:

- `APP_ORIGIN`: final HTTPS domain
- `ADMIN_EMAIL`: administrator address
- `ACCESS_TEAM_DOMAIN`: `https://<team>.cloudflareaccess.com`
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
npx wrangler secret put OPENAI_API_KEY
```

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

- `30 16 * * *`: 00:30 Asia/Shanghai discovery and daily workflow.
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
