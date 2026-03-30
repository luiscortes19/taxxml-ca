# TaxXML.ca

Free online tool to convert Excel spreadsheets to CRA-compliant XML for electronic filing.

🔗 **Live:** [https://taxxml.ca](https://taxxml.ca)

## Supported Return Types

| Return | Description | Status |
|--------|-------------|--------|
| **T4** | Statement of Remuneration Paid | ✅ Supported |
| **T1204** | Government Service Contract Payments | ✅ Supported |
| **T5018** | Statement of Contract Payments | ✅ Supported |
| **NR4** | Non-Resident Amounts | 🔜 Coming soon |
| **T4A** | Statement of Pension / Other Income | 🔜 Coming soon |
| **T5** | Statement of Investment Income | 🔜 Coming soon |

## Privacy

All processing happens **entirely in your browser**. Your data is never uploaded to any server. You can verify this by disconnecting from the internet — the tool works offline.

## How It Works

1. **Upload** your `.xlsx` or `.csv` spreadsheet.
2. **Map** your columns to the required CRA fields (auto-detected).
3. **Fill in** your Transmitter and Payer details.
4. **Download** your CRA-compliant XML file and submit it via the [CRA Internet File Transfer (IFT)](https://www.canada.ca/en/revenue-agency/services/e-services/cra-login-services.html) portal.

## Technical

- Pure HTML/CSS/JS — no build step, no server required
- [SheetJS](https://sheetjs.com/) for Excel/CSV parsing
- [Lucide Icons](https://lucide.dev/) for SVG icons
- CRA 2026V4 schema compliant (T619, T4, T1204, T5018)
- Hosted on GitHub Pages

## CRA Resources

- [CRA IFT Login Portal](https://www.canada.ca/en/revenue-agency/services/e-services/cra-login-services.html)
- [T619 Specification](https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/t619-2026.html)
- [T1204 Specification](https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/t619-2026/t1204-2026.html)

## Built by

[AVANZA Business Automation](https://avanza-automation.com) — Business process automation for Canadian businesses.

## License

© 2026 AVANZA Business Automation. All rights reserved.
