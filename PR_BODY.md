# feat: harden pre-download validation, add IFT checklist, enable free NR4

Ships the three ROADMAP near-term items: (A) validation hardening, (B) CRA IFT checklist, (C) NR4 as a free return type.

## Starting point (before this PR)

- **SIN**: blank SIN became `000000000` plus a warning. A SIN with the wrong length was truncated and padded with `padEnd(9,'0')` plus a warning. There was no checksum. See `generateT4XML` / `generateT1204XML` / `generateT5018XML` on `master`.
- **BN**: `sanitizeBN` / `sanitizeBN_RP` / `sanitizeBN_RZ` turned a 9-digit root into a 15-character BN. Any other length only produced a warning, and the bad BN still went into the XML. The transmitter BN was never checked.
- **Errors**: `alert()` everywhere: 3 for file upload, 6 in the generators. A missing field made its border flash red for 2 seconds.
- **NR4**: `<option value="NR4" disabled>… (coming soon)`, with no generator.

## What changed

### A) Validation
- New `js/validate.js` holds the DOM-free helpers `BN_PATTERN`, `NR_ACCT_PATTERN`, `cleanBN`, `sanitizeBN(raw, program)` and `isValidSIN` (Luhn). They're tested by `node tests/validate.test.js`.
- `js/app.js`:
  - `validateFilingDetails(requiredIds, extraChecks)` is shared by all 4 generators. It marks **every** bad field at once: red border (`.has-error` → `var(--danger)`) plus a `.field-error` message under the input. It focuses the first bad field. An error clears as soon as you edit the field.
  - Transmitter BN, payer BN and NR account are **hard stops** unless they are 9 digits + 2 letters + 4 digits (`123456789RP0001`), or `NRA123456` for the NR account. Transmitter email gets a basic format check.
  - `checkSIN` handles row SINs. Blank becomes the `000000000` placeholder with a warning, as before. Anything else must be 9 digits and pass Luhn, or **generation stops**. Padding is removed.
  - `checkRecipientBN` handles row BNs. Blank becomes the CRA placeholder with a warning, as before. A bare 9-digit root still expands (RT0001 / RZ0001), but now **with a warning**. Anything else that isn't a valid 15-character BN is a **hard stop**.
  - Row errors and "no valid rows" show in a red `#generate-errors` box above the Generate button. Upload errors show inline under the dropzone (`#file-error`).
  - `grep alert( js/` → 0 results.

### B) IFT checklist
- Step 4 has a "Before you upload to IFT" list under the IFT link. It covers Original (O) vs Amendment (A), using a new Submission Reference ID each time (Step 3 already bumps it on reload), and leaving optional fields blank.
- There's a new FAQ: "How do I file a correction, and why did CRA reject my resubmission?"

### C) NR4 (free, same flow as T4/T1204/T5018)
- The option is enabled. `RETURN_TYPES.NR4` has 13 mapped fields. There's a `#nr4-specific-fields` section with a Non-Resident Account Number (saved to localStorage like the other fields). The 15-character payer BN field is hidden while NR4 is selected.
- `generateNR4XML()` follows `nr4.xsd`:
  - Slip: `RCPNT_NM` for types 1–2, `ENTPRS_NM` for types 3–5, foreign `RCPNT_ADDR` (`ste_cd`, `fgn_pstl_cd`), `tx_cntry_cd`, `fssn_nbr`, `nr_acct_nbr`, `rcpnt_tcd`, `inc_1_tcd`, `crcy_1_cd`, `NR4_AMT`, `tx_xmpt_1_cd` and `rpt_tcd`.
  - Summary: `nr_acct_nbr`, `PAYR_NM`, optional `PAYR_ADDR`, `CNTC` (no email), `tx_yr`, `slp_cnt`, `rpt_tcd`, optional `NR4_TAMT`.
- Recipient type accepts `Individual / Joint account / Corporation / Other / Government` or `1–5` (`NR4_RCPNT_TYPE_MAP`). Anything else is a row error.
- Summary `rpt_tcd` has no `C` in the schema (`otherDataType`), so a Cancel run writes `C` on the slips and `A` on the summary.
- There's a new `templates/NR4_Sample.csv`, linked in Step 1.
- Docs and copy: README, ROADMAP (items moved to Shipped; T4A/T5 stay under Later), CRA_REFERENCE_GUIDE (NR4 supported, `T619_NR4.xsd` / `nr4.xsd`, key fields), plus meta tags, JSON-LD, hero, FAQ and footer.

### Example output (NR4 sample, abridged)
```xml
<NR4Slip>
  <RCPNT_NM><snm>Smith</snm><gvn_nm>John</gvn_nm></RCPNT_NM>
  <RCPNT_ADDR><addr_l1_txt>123 Main St</addr_l1_txt><cty_nm>Seattle</cty_nm><ste_cd>WA</ste_cd><fgn_pstl_cd>98101</fgn_pstl_cd><cntry_cd>USA</cntry_cd></RCPNT_ADDR>
  <tx_cntry_cd>USA</tx_cntry_cd>
  <fssn_nbr>987-65-4320</fssn_nbr>
  <nr_acct_nbr>NRA123456</nr_acct_nbr>
  <rcpnt_tcd>1</rcpnt_tcd>
  <inc_1_tcd>06</inc_1_tcd>
  <crcy_1_cd>CAD</crcy_1_cd>
  <NR4_AMT><gro_1_incamt>5000.00</gro_1_incamt><nr_tx_1_amt>750.00</nr_tx_1_amt></NR4_AMT>
  <rpt_tcd>O</rpt_tcd>
</NR4Slip>
...
<NR4Summary>
  <nr_acct_nbr>NRA123456</nr_acct_nbr>
  <PAYR_NM><l1_nm>Acme Payer</l1_nm></PAYR_NM>
  <CNTC><cntc_nm>Jane</cntc_nm><cntc_area_cd>604</cntc_area_cd><cntc_phn_nbr>638-8328</cntc_phn_nbr></CNTC>
  <tx_yr>2025</tx_yr><slp_cnt>2</slp_cnt><rpt_tcd>O</rpt_tcd>
  <NR4_TAMT><tot_gro_1_incamt>15000.00</tot_gro_1_incamt><tot_nr_tx_1_amt>3250.00</tot_nr_tx_1_amt></NR4_TAMT>
</NR4Summary>
```

Example inline errors:
- Field error under `py-bn`: *"Must be exactly 15 characters: 9 digits + 2 letters + 4 digits (e.g. 123456789RP0001)."*
- Row error: *"Row 2: "John Doe" SIN "123456789" is invalid — fails the SIN checksum (check for a typo)"*

## Behaviour changes to review
1. **Payer BN on Step 3 no longer auto-expands a 9-digit root.** T4 used to append `RP0001` and T5018 `RZ0001`; now it's a hard stop asking for all 15 characters. The field already said "15 chars", and a guessed `0001` account can be wrong.
2. **Recipient 9-digit roots in the spreadsheet still expand, but now with a warning.** Making them a hard stop would break typical AP exports and the T1204/T5018 samples. Say if you want it strict.
3. **T4 sample SINs changed** from `123456789` / `987654321`, which fail Luhn and would now hard-stop the bundled sample, to valid test SINs `046454286` / `130692544`.
4. Option considered and rejected: one combined pop-up or modal of all errors. Inline per-field errors plus one row-error box matched the roadmap wording and the existing `.warnings-box` style.

## Known limits / not done
- NR4 only covers income line 1. There are no `inc_2_*`, `SEC_RCPNT_NM` (second joint holder) or `payr_nbr` columns yet; add them if a user needs them.
- The NR4 recipient address country is taken from the country of tax residence, because there's no separate address-country column.
- NR4 summary totals add up all slips as-is. If slips use different currencies, you get a warning but no conversion.
- Already broken on `master`, not fixed here: the T4 sample's "Employee Name" column doesn't auto-map to Last/First Name. The T1204 summary emits an empty `<T1204_TAMT>` if every amount is 0.
- `index.html` already loads GA4 (`G-E2F5Q3RZVH`) on `master`. This PR doesn't touch it.

## Verification done
- `node tests/validate.test.js` passes (SIN Luhn, BN 15-char, NR account pattern).
- I ran the real `index.html` + `app.js` headless in jsdom against all four sample templates. Every valid sample generates. Short / 9-digit / garbage BNs, bad NR account, a Luhn-failing SIN, a bad country and an unknown recipient type are all blocked, with inline errors and no XML.
- The generated **NR4 (Original and Cancel), T4, T5018 and T1204 XML all validate** against the CRA 1-26-3 XSDs (`T619_NR4.xsd`, `T619_T4.xsd`, `T619_T5018.xsd`, `T619_T1204.xsd`) using lxml.

## Manual test checklist
- [ ] Step 1: the NR4 option is selectable and not labelled "coming soon" or anything paid. The NR4 sample link downloads `NR4_Sample.csv`.
- [ ] Upload a `.txt` file → red inline message under the dropzone, no pop-up.
- [ ] NR4: upload the sample → all 13 fields auto-map → Step 3 shows "Non-Resident Account Number" and hides the 15-character payer BN field.
- [ ] NR4: fill transmitter and payer, enter NR account `NRA123456` → Generate → Download. In the XML: 2 × `NR4Slip`, 1 × `NR4Summary`, the same `nr_acct_nbr` everywhere, no empty tags (Berlin row has no `ste_cd`).
- [ ] NR4: NR account `NR12345` → inline error under the field, stays on Step 3.
- [ ] NR4: Report Type = Cancel → slips have `<rpt_tcd>C`, summary has `<rpt_tcd>A`.
- [ ] Any type: transmitter BN `12345` and payer BN `123456789RP001` → both fields marked red with messages, no download. Typing in a field clears its error.
- [ ] T4: change a SIN in the sample to `123456789` → red "Fix 1 problem(s)" box listing the row, no download. Blank SIN → generates with a "no SIN" warning on Step 4.
- [ ] T5018: leave the fiscal day blank → inline "Required." under it (no pop-up).
- [ ] T5018 sample → generates. Step 4 warns that the root `987654321` was expanded to `…RZ0001`.
- [ ] Step 4 shows the "Before you upload to IFT" checklist. The FAQ has the new corrections question. FAQ, hero and meta mention NR4.
- [ ] Reload the page → Step 3 details restore (including the NR account) and the Submission Reference ID is bumped.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
