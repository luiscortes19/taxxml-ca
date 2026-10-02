# TaxXML.ca Roadmap

What's live, what's next, and what's planned. Priorities can change as CRA specifications and user feedback evolve.

## Shipped

- **T4, T1204 and T5018** — Excel/CSV to CRA XML (2026V4 schema), with auto column mapping and sample templates
- **Correction-friendly filing details** — Step 3 details saved in the browser; Submission Reference ID auto-increments
- **Privacy and Terms pages** — live October 2026
- **Crawler fixes** — `robots.txt` and `sitemap.xml` served as UTF-8

## Near term — UX and reliability

- **Pre-download validation hardening** — check SIN length and Luhn checksum, make a BN that isn't 15 characters a hard stop (no more warn-and-pad), and replace `alert()` pop-ups with inline errors next to the field. Goal: fewer CRA IFT rejects.
- **CRA IFT checklist on Step 4 and in the FAQ** — plain-language guidance on:
  - filing a correction (amended) vs an original return
  - incrementing the Submission Reference ID when you resubmit
  - leaving optional fields blank rather than sending empty tags, which CRA rejects

## Later — more return types

- **NR4** — Non-Resident Amounts
- **T4A** — Statement of Pension, Retirement, Annuity and Other Income
- **T5** — Statement of Investment Income

See [CRA_REFERENCE_GUIDE.md](CRA_REFERENCE_GUIDE.md) for the CRA specifications behind each return type.
