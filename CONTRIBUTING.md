# Contributing

Contributions are welcome, especially source adapters, extraction fixtures, ranking tests, accessibility fixes, and Cloudflare deployment improvements.

Before opening a pull request:

```bash
npm install
npm run check
```

Source adapters must:

- use an official public page or feed;
- never bypass a paywall, login, CAPTCHA, or explicit access restriction;
- return only allowlisted authors and standalone text;
- include tests using small synthetic or permissively licensed fixtures rather than copied full articles.

Never commit API keys, administrator identity, production feedback, fetched full text, R2 objects, or local Wrangler state.
