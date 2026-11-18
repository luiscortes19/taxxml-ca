# taxxml-report Worker

A small Cloudflare Worker that receives two kinds of JSON POST from `js/report.js`:

- `kind: "feedback"`: the Feedback form (type, message, optional email, honeypot, Turnstile token, return type / step / browser).
- `kind: "crash"`: an automatic, already-scrubbed error report (`error_kind`, scrubbed message and stack, return type, step, browser, version).

It checks the origin (`https://taxxml.ca`, `https://www.taxxml.ca` only), rejects a filled honeypot, verifies Turnstile for
feedback, rate-limits per IP, scrubs every field again (`scrub.js`, the same code as `js/report.js`), and forwards the
result to Slack and/or email via Resend. **It stores nothing**: no KV, D1, R2, or payload logging.

| Response | Meaning |
|---|---|
| 204 | forwarded to at least one destination |
| 400 | bad JSON, unknown kind, honeypot filled, empty message |
| 403 | origin not allowed, or Turnstile token missing / invalid / `TURNSTILE_SECRET` unset |
| 413 | body over 8 KB |
| 429 | rate limit (5 feedback or 20 crash reports per IP per 10 minutes, per Worker instance) |
| 502 | Slack and email both failed |
| 503 | neither Slack nor email is configured |

## Secrets: never commit them

Every secret is a Worker secret, set with `npx wrangler secret put NAME`. Nothing goes in `wrangler.toml`, `js/report.js`, or
anywhere else in the repo. `tests/no-secrets.test.js` fails if a webhook URL, API key, or secret value is committed.

| Secret | Required | What |
|---|---|---|
| `SLACK_WEBHOOK_URL` | Slack or email | Slack incoming webhook URL |
| `TURNSTILE_SECRET` | yes, for feedback | Turnstile widget secret key |
| `RESEND_API_KEY` | optional | Resend API key |
| `RESEND_FROM` | with Resend | sender on a domain verified in Resend, e.g. `TaxXML <alerts@your-verified-domain>` |
| `ALERT_EMAIL` | with Resend | the mailbox that receives alerts |

Slack-only and email-only both work. With neither, the Worker answers 503 and sends nothing.

## Go-live steps (in order)

The site PR can be merged **before** any of this. With `REPORT_ENDPOINT` empty in `js/report.js`, the site POSTs nothing,
the Feedback links stay "Contact us" links to avanza-automation.com, and Turnstile is never loaded.

1. **Cloudflare account.** Create one (free plan is enough) at dash.cloudflare.com.
2. **Deploy the Worker to workers.dev.**
   ```sh
   cd worker
   npx wrangler login
   npx wrangler deploy
   ```
   Note the URL it prints, `https://taxxml-report.<account>.workers.dev`.
3. **Turnstile widget.** In the Cloudflare dashboard, Turnstile, add a widget (Managed mode) for the hostnames
   `taxxml.ca` and `www.taxxml.ca`. Put the **site key** (public) in `js/report.js` as `TURNSTILE_SITE_KEY`. Store the
   **secret key** only as a Worker secret:
   ```sh
   npx wrangler secret put TURNSTILE_SECRET
   ```
4. **Slack incoming webhook.** In Slack, create an app with Incoming Webhooks for the alerts channel, copy the webhook URL,
   and store it only as a Worker secret:
   ```sh
   npx wrangler secret put SLACK_WEBHOOK_URL
   ```
5. **Optional: email through Resend.** Verify a sending domain in Resend, create an API key, then:
   ```sh
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put RESEND_FROM
   npx wrangler secret put ALERT_EMAIL
   ```
6. **Set the client Worker URL.** In `js/report.js`, set `REPORT_ENDPOINT` to the workers.dev URL from step 2 (and the
   site key from step 3). These two values are public, so committing them is fine. Open a PR for that change.
7. **Redeploy the site.** Merge that PR so GitHub Pages republishes. Then on https://taxxml.ca check:
   the header shows **Feedback**, the form opens, Escape closes it, a test message reaches Slack (and email).
8. **Later, optional: `api.taxxml.ca`.** Once taxxml.ca's DNS is on Cloudflare, uncomment the `routes` line in
   `wrangler.toml`, run `npx wrangler deploy`, add `api.taxxml.ca` to the Turnstile widget's hostnames if needed, and
   change `REPORT_ENDPOINT` to `https://api.taxxml.ca` in a new site PR.

## Local checks

`npm test` (from the repo root) runs `tests/worker.test.js`, which drives this Worker's `fetch` handler with a stubbed
network. The browser never POSTs from `localhost`, `127.0.0.1`, `::1`, or `file://`, and the Worker accepts only the two
production origins, so an end-to-end test needs the deployed site.
