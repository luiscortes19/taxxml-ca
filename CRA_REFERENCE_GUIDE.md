# CRA Electronic Filing — Reference Guide

## XSD Schema (XML Validation)

### Download Location
CRA labels packages by filing year: the 2027 package is for files sent in 2027, normally for the 2026 tax year.
- **2027:** https://www.canada.ca/content/dam/cra-arc/serv-info/eservices/xmlschm1-27-1.zip — version 1-27-1 (last updated September 23, 2026). Accepted starting January 11, 2027.
- **2026:** https://www.canada.ca/content/dam/cra-arc/serv-info/eservices/xmlschm1-26-3.zip — version 1-26-3 (last updated December 23, 2025). Accepted until December 22, 2026.
- IFT is closed December 22, 2026 – January 11, 2027. The app builds 1-26-3 files before December 22, 2026 and 1-27-1 files from then (`targetSchema` in `js/validate.js`).
- Both zips are vendored, unmodified, in `tests/xsd/`; `tests/xsd.test.js` validates the app's output against them.
- Sources: [What you should know before](https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/filing-information-returns-electronically-t4-t5-other-types-returns-what-you-should-know-before.html), [XML specifications](https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/xml-specs.html), [What's new for 2027](https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/whats-new-2027.html)

### 1-26-3 → 1-27-1, for the returns this tool makes
- **NR4:** new required `<CIN>` on every slip (box 13, Canadian tax identification number): one of `<sin_ttn_itn>` (9 digits), `<bn>` (BN15) or `<trust>` (1 letter + 8 digits). CRA: when the recipient hasn't provided one, enter `<sin_ttn_itn>000000000</sin_ttn_itn>`. `fssn_nbr` moves to box 30. The 1-26-3 schema doesn't allow `<CIN>`, so no NR4 file is valid under both. ([NR4 2027](https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/t619-2027/nr4-2027.html))
- **T4:** new optional other-info code 96 (`elg_prsnl_spprt_wrkr_inc_amt`); `prov_insu_ern_amt` widened. Neither is produced here, so T4 output is the same under both.
- **T5018, T1204, T619:** no changes for these returns.

### Key Schema Files

| File | Purpose |
|------|---------|
| `T619_T1204.xsd` | Main schema for T1204 submissions |
| `T619_T4.xsd` | Main schema for T4 submissions |
| `T619_T5018.xsd` | Main schema for T5018 submissions |
| `T619_NR4.xsd` | Main schema for NR4 submissions (Submission → T619 + Return → NR4) |
| `nr4.xsd` | NR4 slip, summary, amount and totals types |
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
| **SIN must pass the checksum** | 9 digits, Luhn check. `000000000` is the placeholder when the recipient has no SIN. |

---

## NR4 Key Fields

- `nr_acct_nbr` — payer's Non-Resident account, 3 letters + 6 digits (e.g. `NRA123456`). Must match on the summary and every slip.
- Slip required: `tx_cntry_cd` (3-letter country of tax residence), `fssn_nbr` (foreign tax ID, up to 20 chars), `nr_acct_nbr`, `rcpnt_tcd`, `rpt_tcd`
- `rcpnt_tcd` — 1 Individual, 2 Joint account, 3 Corporation, 4 Other (association, trust, partnership...), 5 Government / international organization
- Individuals and joint accounts use `RCPNT_NM`; everyone else uses `ENTPRS_NM`
- Recipient address is foreign: `ste_cd` and `fgn_pstl_cd` instead of `prov_cd` / `pstl_cd`
- Summary `rpt_tcd` accepts O / A only (no C). Cancelled slips go under an amended (A) summary.
- Summary `CNTC` has no email (unlike T619)

---

## T619 Transmittal Key Fields

- `TransmitterAccountNumber` — required element; CRA wants the account number, the RepID, or both, matching how you sign in to IFT. One of:
  `bn15` (9 digits + 2 upper-case letters + 4 digits), `bn9` (9 digits, My Business Account sign-in only), `trust` (1 letter + 8 digits, e.g. `T00000000`), `nr4` (3 letters + 6 digits, e.g. `AAA000000`). With a RepID only, the app leaves it empty (the XSD allows that; all its children are optional).
- `TransmitterRepID/RepID` — up to 7 alphanumeric (Represent a Client)
- `sbmt_ref_id` — unique per submission, up to 8 alphanumeric, no spaces, hyphens or special characters (the XSD only limits length; the spec is stricter). Source: [T619 2027](https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/t619-2027.html)
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
| **NR4** | Non-Resident Amounts | ✅ Supported |
| **T4A** | Statement of Pension/Other Income | 🔜 Planned |
| **T5** | Statement of Investment Income | 🔜 Planned |
| **T3** | Trust Income | Possible |
| **T4RSP** | RRSP Income | Possible |
| **T4RIF** | RRIF Income | Possible |
| **T2202** | Tuition/Education | Possible |

---

*Last updated: 2026-10-26*
