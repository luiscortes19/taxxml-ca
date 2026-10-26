# TaxXML.ca

Free online tool to convert Excel spreadsheets to CRA-compliant XML for electronic filing.

🔗 **Live:** [https://taxxml.ca](https://taxxml.ca)

## Supported Return Types

| Return | Description | Status |
|--------|-------------|--------|
| **T4** | Statement of Remuneration Paid | ✅ Supported |
| **T1204** | Government Service Contract Payments | ✅ Supported |
| **T5018** | Statement of Contract Payments | ✅ Supported |
| **NR4** | Non-Resident Amounts | ✅ Supported |
| **T4A** | Statement of Pension / Other Income | 🔜 Coming soon |
| **T5** | Statement of Investment Income | 🔜 Coming soon |

## Privacy

All processing happens **entirely in your browser**. Your data is never uploaded to any server. You can verify this by disconnecting from the internet — the tool works offline.

## How It Works

1. **Upload** your `.xlsx` or `.csv` spreadsheet.
2. **Map** your columns to the required CRA fields (auto-detected with smart column matching).
3. **Fill in** your Transmitter and Payer details — saved automatically for future corrections.
4. **Download** your CRA-compliant XML file and submit it via the [CRA Internet File Transfer (IFT)](https://www.canada.ca/en/revenue-agency/services/e-services/cra-login-services.html) portal.

## Features

- **Auto column mapping** — detects your header names and maps them to CRA fields automatically
- **Phone & postal code formatting** — auto-formats as you type (`###-###-####` and `A1A 1A1`)
- **Same as Transmitter** — one checkbox syncs all payer fields from transmitter
- **Correction-friendly** — Step 3 filing details are saved to localStorage; the Submission Reference ID auto-increments on reload so re-submissions are ready in seconds
- **Sample templates** — downloadable CSV templates for T4, T1204, T5018, and NR4
- **Pre-download validation** — SIN length + checksum, BN and NR account checks, every T619 transmitter account form (BN15, BN9, trust, NR) or RepID; problems are shown inline next to the field and block the download
- **CRA IFT checklist** — Step 4 and the FAQ explain originals vs amendments, Submission Reference IDs, and blank optional fields
- **Privacy first** — 100% client-side, no server, works offline

See [ROADMAP.md](ROADMAP.md) for what's planned next.

## Technical

- Pure HTML/CSS/JS — no build step, no server required
- [SheetJS](https://sheetjs.com/) for Excel/CSV parsing
- [Lucide Icons](https://lucide.dev/) for SVG icons
- Output tested against CRA's published schema packages: 1-27-1 (2027 package, accepted from January 11, 2027) and 1-26-3 (2026 package, accepted until December 22, 2026). From December 22, 2026 the tool builds 1-27-1 files; only NR4 differs (the new `<CIN>`, box 13). See `tests/xsd/README.md`
- Tests: `npm install` (once, fetches the xlsx 0.20.3 build index.html loads) then `npm test`. Runs every `tests/*.test.js`:
  - `golden.test.js` — real `js/app.js` pipeline (parse file → auto map → generate) must reproduce `tests/fixtures/*.golden.xml` byte for byte. Regenerate only for an intended XML change: `UPDATE_GOLDENS=1 node tests/golden.test.js`
  - `samples.test.js` — every `templates/*_Sample.csv` generates XML with zero validation errors
  - `samples-per-return.test.js` — each sample under its own return: well-formed CRA shape (Submission/T619/Return), real amounts, totals; under any other return: blocked with an error; injected leading-zero IDs survive
  - `identifiers.test.js` — SIN / BN / foreign tax ID / ZIP keep leading zeros (CSV in UTF-8, UTF-16LE/BE; XLSX)
  - `xsd.test.js` — every sample and golden input, made in both schema modes, validated against CRA's own XSDs (needs `python3` + `lxml`; skips loudly without them)
  - `seasonal.test.js` — default tax year, target schema by date, T619 account / RepID / submission ref ID, NR4 Canadian tax ID, landing-page deep links
  - `analytics.test.js`, `ux.test.js`, `validate.test.js` — GA4 funnel events (no-PII scan), Step 2/3 UX, SIN/BN helpers
  - `ga.test.js` — `js/ga.js` gating (hostname/protocol matrix, internal flag), `cta_click` / `sample_downloaded`
  - `tests/harness.js` loads the browser code into a Node `vm` with a minimal DOM stub; no browser needed
- Hosted on GitHub Pages

## Analytics (GA4)

Every page loads Google Analytics through `js/ga.js` (property `G-E2F5Q3RZVH`). Events and their parameters are listed on the Privacy page. They contain no personal data.

- **Local copies never send anything.** On `localhost`, `127.0.0.1`, `::1` or `file://`, gtag.js isn't loaded and `track()` does nothing.
- **Mark your own browser as internal:** open any page once with `?internal=1` (for example `https://taxxml.ca/?internal=1`). GA still loads, but every hit from this browser carries `traffic_type=internal`. GA4's *Internal Traffic* data filter drops those hits once the filter is Active. Do this once on each browser or device you use. To undo it, open any page with `?internal=0`. The flag is the `taxxml_internal` key in localStorage, so clearing site data also removes it.
- **See events live:** add `?debug_mode=1` (for example `/?internal=1&debug_mode=1`), then open GA4 Admin > DebugView. It applies to that page load only.

## CRA Resources

- [CRA IFT Login Portal](https://www.canada.ca/en/revenue-agency/services/e-services/cra-login-services.html)
- [T619 2027 Specification](https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/t619-2027.html) ([2026](https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/t619-2026.html))
- [NR4 2027 Specification](https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/t619-2027/nr4-2027.html)
- [T1204 2027 Specification](https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/t619-2027/t1204-2027.html)

## Built by

[AVANZA Business Automation](https://avanza-automation.com) — Business process automation for Canadian businesses.

## License

© 2026 AVANZA Business Automation. All rights reserved.
