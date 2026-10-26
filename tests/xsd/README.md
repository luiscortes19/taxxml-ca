# CRA XML schema packages (vendored, unmodified)

`tests/xsd.test.js` validates the XML this tool generates against these official CRA schema packages,
through `tests/xsd_validate.py` (Python 3 + lxml). The zips are byte-for-byte the files CRA publishes.

| File | CRA version | CRA says | SHA-256 |
|---|---|---|---|
| `xmlschm1-26-3.zip` | 1-26-3 (2026 package) | T619 2026 version accepted for processing until December 22, 2026 | `eaa9f869aaa8270662d16989839399cc6700437b7a349113bf812d76a49310c5` |
| `xmlschm1-27-1.zip` | 1-27-1 (2027 package) | T619 2027 version accepted starting January 11, 2027 | `304b4379d06f2989120aa088b19b61b3b10ecbad1770c4cab50aa285038d6801` |

Downloaded 2026-10-26 from:
- https://www.canada.ca/content/dam/cra-arc/serv-info/eservices/xmlschm1-26-3.zip
- https://www.canada.ca/content/dam/cra-arc/serv-info/eservices/xmlschm1-27-1.zip

Listed on [What you should know before you file electronically](https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/filing-information-returns-electronically-t4-t5-other-types-returns-what-you-should-know-before.html).
Acceptance dates: [XML specifications](https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/xml-specs.html)
and [What's new for 2027](https://www.canada.ca/en/revenue-agency/services/e-services/filing-information-returns-electronically-t4-t5-other-types-returns-overview/whats-new-2027.html).
CRA labels packages by filing year: the 2027 package is for files sent in 2027, normally for the 2026 tax year.

To add a new package: download the zip from canada.ca, add it here with its hash, and add the version to `SCHEMAS` in `tests/xsd.test.js`.
