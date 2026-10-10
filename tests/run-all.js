// Runs every tests/*.test.js in its own node process; exits non-zero if any fails.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js')).sort();
let failed = 0;
for (const f of files) {
  try { execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' }); }
  catch { failed++; console.error(`FAILED: ${f}`); }
}
console.log(`${files.length - failed}/${files.length} test files passed`);
process.exit(failed ? 1 : 0);
