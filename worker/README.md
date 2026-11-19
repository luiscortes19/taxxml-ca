# taxxml-report Worker

A small Cloudflare Worker that receives two kinds of JSON POST from `js/report.js`:

- `kind: "feedback"`: the Feedback form (type, message, optional email, honeypot, Turnstile token, return type / step / browser).
- `kind: "crash"`: an automatic, already-scrubbed error report (`error_kind`, scrubbed message and stack, return type, step, browser, version).

It checks the origin (`https://taxxml.ca`, `https://www.taxxml.ca` only), rejects a filled honeypot, verifies Turnstile for
feedback, rate-limits per IP, scrubs every field again (`scrub.js`, the same code as `js/report.js`), and emails the
result via Resend, from `TaxXML <alerts@mail.taxxml.ca>`. Slack is not used. **It stores nothing**: no KV, D1, R2, or
payload logging.

Live at `https://taxxml-report.taxxml-report-worker.workers.dev`, the `REPORT_ENDPOINT` in `js/report.js`. Later it may
move to `https://api.taxxml.ca` (step 6 below).

| Response | Meaning |
|---|---|
| 204 | forwarded (the alert email was accepted by Resend) |
| 400 | bad JSON, unknown kind, honeypot filled, empty message |
| 403 | origin not allowed, or Turnstile token missing / invalid / `TURNSTILE_SECRET` unset |
| 413 | body over 8 KB |
| 429 | rate limit (5 feedback or 20 crash reports per IP per 10 minutes, per Worker instance) |
| 502 | sending failed (Resend refused or was unreachable) |
| 503 | email is not configured (`RESEND_API_KEY`, `RESEND_FROM` or `ALERT_EMAIL` unset) |

## Secrets: never commit them

Every secret is a Worker secret, set with `npx wrangler secret put NAME`. Nothing goes in `wrangler.toml`, `js/report.js`, or
anywhere else in the repo. `tests/no-secrets.test.js` fails if a webhook URL, API key, or secret value is committed.

| Secret | Required | What |
|---|---|---|
| `TURNSTILE_SECRET` | yes, for feedback | Turnstile widget secret key |
| `RESEND_API_KEY` | yes | Resend API key |
| `RESEND_FROM` | yes | the sender, `TaxXML <alerts@mail.taxxml.ca>` (`mail.taxxml.ca` is verified in Resend) |
| `ALERT_EMAIL` | yes | the mailbox that receives alerts (never written in the repo) |

Without the three Resend secrets the Worker answers 503 and sends nothing. `index.js` also has an optional Slack path
(`SLACK_WEBHOOK_URL`); it is not used and stays unset, so it does nothing.

## Go-live steps (in order)

Steps 1 to 5 are done: the Worker is deployed and `js/report.js` ships its URL and the Turnstile site key, so the Feedback
button and crash reports are live on taxxml.ca and www.taxxml.ca. They are kept for a rebuild. If `REPORT_ENDPOINT` is
set back to empty, the site POSTs nothing, the Feedback links stay "Contact us" links to avanza-automation.com, and
Turnstile is never loaded.

1. **Cloudflare account.** Create one (free plan is enough) at dash.cloudflare.com.
2. **Deploy the Worker to workers.dev.**
   ```sh
   cd worker
   npx wrangler login
   npx wrangler deploy
   ```
   Note the URL it prints. Today it is `https://taxxml-report.taxxml-report-worker.workers.dev`.
3. **Turnstile widget.** In the Cloudflare dashboard, Turnstile, add a widget (Managed mode) for the hostnames
   `taxxml.ca` and `www.taxxml.ca`. Put the **site key** (public) in `js/report.js` as `TURNSTILE_SITE_KEY`. Store the
   **secret key** only as a Worker secret:
   ```sh
   npx wrangler secret put TURNSTILE_SECRET
   ```
4. **Email through Resend.** Verify `mail.taxxml.ca` in Resend, create an API key, then store each value only as a
   Worker secret (`RESEND_FROM` is `TaxXML <alerts@mail.taxxml.ca>`; `ALERT_EMAIL` is the mailbox that gets alerts):
   ```sh
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put RESEND_FROM
   npx wrangler secret put ALERT_EMAIL
   ```
   Do not set `SLACK_WEBHOOK_URL`; Slack is not used.
5. **Set the client config.** In `js/report.js`, set `REPORT_ENDPOINT` to the workers.dev URL from step 2 and
   `TURNSTILE_SITE_KEY` to the site key from step 3. Both are public, so committing them is fine. Merge the PR so GitHub
   Pages republishes, then on https://taxxml.ca check: the header shows **Feedback**, the form opens, Escape closes it,
   and a test message arrives by email.
6. **Later, optional: `api.taxxml.ca`.** Once taxxml.ca's DNS is on Cloudflare, uncomment the `routes` line in
   `wrangler.toml`, run `npx wrangler deploy`, add `api.taxxml.ca` to the Turnstile widget's hostnames if needed, and
   change `REPORT_ENDPOINT` to `https://api.taxxml.ca` in a new site PR.

## Local checks

`npm test` (from the repo root) runs `tests/worker.test.js`, which drives this Worker's `fetch` handler with a stubbed
network. The browser never POSTs from `localhost`, `127.0.0.1`, `::1`, or `file://`, and the Worker accepts only the two
production origins, so an end-to-end test needs the deployed site.
