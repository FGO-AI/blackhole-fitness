/* A-08 in a real browser. NOT part of `node tests/run.js`: it needs the network
   and a Chromium-family browser, so it is named *.browser.js and run by hand:

     node tests/sri.browser.js            (finds Edge or Chrome)
     BROWSER=/path/to/chrome node tests/sri.browser.js

   WHAT THIS PROVES / WHAT IT DOESN'T. The hashed CDN <script> tags are lifted
   verbatim out of index.html into a scratch page served from 127.0.0.1 and
   loaded in a headless browser, which does its own SRI enforcement:
     - with the tags as shipped, THREE and supabase must both load;
     - with one character of each hash changed, neither may load. That negative
       control is the point: without it, a pass could just mean the browser
       ignored the attribute.
   It proves the hashes match what the CDNs serve on the day it runs, which is
   what to re-run before changing a version. It does not exercise the service
   worker's cached copies, and it is not the live site. */
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const { execFile } = require('child_process');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  PASS  ' + n); }
                               else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); } };

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const head = html.slice(0, html.indexOf('</head>'));
const tags = [...head.matchAll(/<script\b[^>]*\bintegrity="[^"]*"[^>]*><\/script>/g)].map(m => m[0]);

const browser = [process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
].filter(Boolean).find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });

if (!browser){
  console.log('\n  NOT RUN  no Edge/Chrome found — set BROWSER=/path/to/browser');
  process.exit(2);                        /* never a silent pass */
}

/* change the first digest character, keeping the value well-formed base64 */
const tamper = t => t.replace(/integrity="(sha\d+-)(.)/, (m, alg, c) => `integrity="${alg}${c === 'A' ? 'B' : 'A'}`);

/* deferred scripts run (or are blocked) before DOMContentLoaded, so the probe
   sees the final outcome of both */
const page = scripts => `<!doctype html><html><head><meta charset="utf-8">
${scripts.join('\n')}
<script>
document.addEventListener('DOMContentLoaded', () => {
  const r = document.createElement('pre'); r.id = 'probe';
  r.textContent = 'PROBE THREE=' + typeof window.THREE
    + ' supabase=' + typeof (window.supabase && window.supabase.createClient) + ' END';
  document.body.appendChild(r);
});
</script></head><body></body></html>`;

const run = (url) => new Promise(resolve => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sri-browser-'));
  execFile(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--user-data-dir=' + profile, '--virtual-time-budget=20000', '--dump-dom', url],
    { timeout: 90000, maxBuffer: 16 * 1024 * 1024 },
    (err, stdout) => {
      try { fs.rmSync(profile, { recursive:true, force:true }); } catch (e) { /* browser still exiting */ }
      const m = String(stdout || '').match(/PROBE THREE=(\w+) supabase=(\w+) END/);
      resolve(m ? { three:m[1], supa:m[2] } : { error: err ? err.message : 'no probe in the dumped DOM' });
    });
});

(async () => {
  console.log('\n  browser: ' + browser);
  ok('two hashed script tags lifted from index.html', tags.length === 2, String(tags.length));
  ok('the tampered copies really differ from the shipped ones',
     tags.map(tamper).every((t, i) => t !== tags[i]));

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store' });
    res.end(page(req.url.startsWith('/tampered') ? tags.map(tamper) : tags));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  console.log('\n== 1. shipped hashes (executed in the browser) ==');
  const good = await run(base + '/shipped');
  ok('the page ran and reported back', !good.error, good.error);
  ok('three.js loaded under its integrity check', good.three === 'object', 'THREE is ' + good.three);
  ok('supabase-js loaded under its integrity check', good.supa === 'function', 'createClient is ' + good.supa);

  console.log('\n== 2. negative control: one character of each hash changed ==');
  const bad = await run(base + '/tampered');
  ok('the page ran and reported back', !bad.error, bad.error);
  ok('three.js was BLOCKED', bad.three === 'undefined', 'THREE is ' + bad.three);
  ok('supabase-js was BLOCKED', bad.supa === 'undefined', 'createClient is ' + bad.supa);

  server.close();
  console.log('\n' + '='.repeat(58) + '\n  ' + pass + ' passed, ' + fail + ' failed\n' + '='.repeat(58));
  process.exit(fail ? 1 : 0);
})();
