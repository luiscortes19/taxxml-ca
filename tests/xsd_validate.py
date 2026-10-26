# Validates XML against CRA's official schema packages (tests/xsd/xmlschm<version>.zip). Used by tests/xsd.test.js.
# stdin: JSON [{"schema": "1-27-1", "rt": "NR4", "xml": "<?xml ..."}]  stdout: JSON [{"ok": true, "errors": []}]
import glob, json, os, sys, tempfile, zipfile
from lxml import etree

XSD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'xsd')
cases = json.load(sys.stdin)
compiled = {}
with tempfile.TemporaryDirectory() as tmp:
    def schema(version, rt):
        if (version, rt) not in compiled:
            d = os.path.join(tmp, version)
            if not os.path.isdir(d):
                zipfile.ZipFile(os.path.join(XSD_DIR, f'xmlschm{version}.zip')).extractall(d)
            [entry] = glob.glob(os.path.join(d, '**', f'T619_{rt}.xsd'), recursive=True)
            compiled[(version, rt)] = etree.XMLSchema(etree.parse(entry))
        return compiled[(version, rt)]
    results = []
    for c in cases:
        s = schema(c['schema'], c['rt'])
        ok = s.validate(etree.fromstring(c['xml'].encode('utf-8')))
        results.append({'ok': ok, 'errors': [f'line {e.line}: {e.message}' for e in s.error_log][:3]})
json.dump(results, sys.stdout)
