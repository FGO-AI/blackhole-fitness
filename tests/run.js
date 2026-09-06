#!/usr/bin/env node
/* Runs every *.test.js in this directory in sequence and fails loudly if any
   of them fails. No package.json, no framework: each test file is a plain
   Node script that prints what it checked and exits non-zero on failure, and
   this just totals them.

   A green run proves the LOGIC in index.html and sw.js is correct — the tests
   read the real shipped source and drive its real functions. It proves
   nothing about what the deployed site is serving. See "Tests" in README.md
   for the deploy checks that answer that. */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();
if (!files.length) { console.error('no *.test.js files found in ' + dir); process.exit(2); }

const only = process.argv.slice(2);              /* node tests/run.js xss auth  -> just those */
const chosen = only.length ? files.filter(f => only.some(o => f.includes(o))) : files;

const rows = [];
let anyFail = false, totalPass = 0, totalFail = 0;
for (const f of chosen) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write('\n' + '#'.repeat(72) + '\n# ' + f + '\n' + '#'.repeat(72) + '\n' + out);
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const pass = m ? +m[1] : 0, fail = m ? +m[2] : 0;
  const ok = r.status === 0 && m && fail === 0;
  if (!ok) anyFail = true;
  totalPass += pass; totalFail += fail;
  rows.push({ f, status: ok ? 'PASS' : (m ? 'FAIL' : 'CRASH'), pass, fail, ms: Date.now() - started });
}

console.log('\n' + '='.repeat(72));
for (const r of rows)
  console.log('  %s  %s  %s passed, %s failed  (%sms)',
    r.status.padEnd(5), r.f.padEnd(34), String(r.pass).padStart(4), String(r.fail).padStart(2), r.ms);
console.log('='.repeat(72));
console.log('  %d files, %d assertions passed, %d failed — %s',
  rows.length, totalPass, totalFail, anyFail ? 'FAILED' : 'ALL GREEN');
console.log('='.repeat(72));
process.exit(anyFail ? 1 : 0);
