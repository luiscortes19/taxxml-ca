# TaxXML.ca Roadmap

What's live, what's next, and what's planned. Priorities can change as CRA specifications and user feedback evolve.

## Shipped

- **T4, T1204 and T5018** — Excel/CSV to CRA XML (2026V4 schema), with auto column mapping and sample templates
- **Correction-friendly filing details** — Step 3 details saved in the browser; Submission Reference ID auto-increments
- **Privacy and Terms pages** — live October 2026
- **Crawler fixes** — `robots.txt` and `sitemap.xml` served as UTF-8
- **Pre-download validation hardening** — SIN length and Luhn checksum, BN that isn't 15 characters is a hard stop (no more warn-and-pad), and inline errors next to the field instead of `alert()` pop-ups
- **CRA IFT checklist on Step 4 and in the FAQ** — originals vs amendments, incrementing the Submission Reference ID, and leaving optional fields blank
- **NR4** — Non-Resident Amounts, free like the other returns, with a sample template

## Later — more return types

- **T4A** — Statement of Pension, Retirement, Annuity and Other Income
- **T5** — Statement of Investment Income

See [CRA_REFERENCE_GUIDE.md](CRA_REFERENCE_GUIDE.md) for the CRA specifications behind each return type.
