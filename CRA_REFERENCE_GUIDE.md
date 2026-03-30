# CRA Electronic Filing — Reference Guide

## XSD Schema (XML Validation)

### Download Location
- **URL:** https://www.canada.ca/content/dam/cra-arc/serv-info/eservices/xmlschm1-26-3.zip
- **Version:** 1-26-3 (last updated December 23, 2025)

### Key Schema Files

| File | Purpose |
|------|---------|
| `T619_T1204.xsd` | Main schema for T1204 submissions |
| `T619_T4.xsd` | Main schema for T4 submissions |
| `T619_T5018.xsd` | Main schema for T5018 submissions |
| `complex.xsd` | Shared complex types (addresses, names, contacts) |
| `simple.xsd` | Simple types (BN patterns, SIN patterns, province codes) |

---

## CRA Validation Rules

| Rule | Details |
|------|---------|
| **No empty optional tags** | If a field has no value, omit the element entirely. `<field/>` is rejected. |
| **SIN required on every slip** | Even corporations must have `<sin>000000000</sin>` |
| **rcpnt_bn required on every slip** | Even sole proprietors need `<rcpnt_bn>000000000RT0000</rcpnt_bn>` |
| **cntry_cd must be exactly 3 letters** | Pattern `\p{L}{3}`. E.g., `CAN`, `USA`. |
| **BN must be exactly 15 chars** | 9 digits + 2 letters + 4 digits (e.g., `123456789RT0001`). |
| **Postal code: no spaces** | `K1A0B1` not `K1A 0B1` |

---

## T619 Transmittal Key Fields

- `bn15` — Transmitter BN (15 chars)
- `sbmt_ref_id` — Unique per submission (up to 8 alphanumeric chars); increment on re-submission (A, B, C...)
- `summ_cnt` — Number of summaries (usually `1`)
- `lang_cd` — `E` (English) or `F` (French)

---

## CRA IFT Portal (Submission)

https://www.canada.ca/en/revenue-agency/services/e-services/cra-login-services.html

- Requires CRA My Business Account or Represent a Client
- Max file size: 150 MB
- Accepts XML only

---

## Available Return Types

| Return | Description | Status |
|--------|-------------|--------|
| **T4** | Statement of Remuneration Paid | ✅ Supported |
| **T1204** | Government Service Contract Payments | ✅ Supported |
| **T5018** | Statement of Contract Payments | ✅ Supported |
| **NR4** | Non-Resident Amounts | 🔜 Planned |
| **T4A** | Statement of Pension/Other Income | 🔜 Planned |
| **T5** | Statement of Investment Income | 🔜 Planned |
| **T3** | Trust Income | Possible |
| **T4RSP** | RRSP Income | Possible |
| **T4RIF** | RRIF Income | Possible |
| **T2202** | Tuition/Education | Possible |

---

*Last updated: 2026-03-30*
