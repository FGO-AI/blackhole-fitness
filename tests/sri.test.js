/* A-08: Subresource Integrity and version pinning on the two CDN scripts.

   WHAT THIS PROVES / WHAT IT DOESN'T. Everything here is a STRING check on the
   shipped index.html and sw.js (sw.js is run in a vm only to read CDN_ASSETS;
   its install handler is not run). It proves the tags carry the locked hashes
   and crossorigin, the Supabase URL is pinned to an exact version, and the
   service worker pre-caches the very URLs the page asks for. It does NOT prove
   that a browser enforces the hashes, or that they still match what the CDNs
   serve — that needs a browser and the network, and lives in
   tests/sri.browser.js, run by hand (deliberately not *.test.js, so this suite
   stays offline). */
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');
/* line endings normalised: git's autocrlf hands Windows a CRLF working copy */
const html  = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  PASS  ' + n); }
                               else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); } };

/* The locked values. Each was checked against a fresh download before it was
   committed: three.js against the sha512 cdnjs publishes for r128, Supabase by
   hashing 2.116.0 as served by jsDelivr. Moving either version means changing
   its hash here on purpose, then re-running tests/sri.browser.js. */
const THREE_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const THREE_SRI = 'sha512-dLxUelApnYxpLt6K2iomGngnHO83iUvZytA3YjDUCjT0HDOHKXnVYdf3hU4JjM8uEhxf9nD1/ey98U3t2vZ0qQ==';
const SUPA_SRC  = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.116.0/dist/umd/supabase.min.js';
const SUPA_SRI  = 'sha384-JBR+x8blGwjDRO63aHCGiZMD4VNiTR4ZUGA+N6ZKLf3zNt1fK8IBpcgPaMrxqWBp';

const head = html.slice(0, html.indexOf('</head>'));
/* external scripts only: an empty body between the tags */
const tags = [...head.matchAll(/<script\b([^>]*)><\/script>/g)].map(m => m[1]);
const attr = (t, name) => {
  const m = t.match(new RegExp('\\s' + name + '(?:="([^"]*)")?(?=\\s|$)'));
  return m ? (m[1] === undefined ? true : m[1]) : null;
};
const bySrc = src => tags.find(t => attr(t, 'src') === src);

console.log('\n== 1. three.js ==');
{
  const t = bySrc(THREE_SRC);
  ok('a script tag loads three.js r128 from cdnjs (string check)', !!t, tags.map(x => attr(x, 'src')).join(' | '));
  ok('it carries the locked sha512 integrity value', t && attr(t, 'integrity') === THREE_SRI, t && attr(t, 'integrity'));
  /* without crossorigin the request is no-cors, the response is opaque, and the
     browser blocks the script rather than skip the check — so this is load-bearing */
  ok('it is crossorigin="anonymous"', t && attr(t, 'crossorigin') === 'anonymous', t && attr(t, 'crossorigin'));
  ok('it is still deferred', t && attr(t, 'defer') === true);
}

console.log('\n== 2. supabase-js ==');
{
  const t = bySrc(SUPA_SRC);
  ok('a script tag loads supabase-js pinned to 2.116.0 (string check)', !!t, tags.map(x => attr(x, 'src')).join(' | '));
  ok('it carries the locked sha384 integrity value', t && attr(t, 'integrity') === SUPA_SRI, t && attr(t, 'integrity'));
  ok('it is crossorigin="anonymous"', t && attr(t, 'crossorigin') === 'anonymous', t && attr(t, 'crossorigin'));
  ok('it is still deferred', t && attr(t, 'defer') === true);
  ok('no floating major version anywhere in index.html (@2/ would move under the hash)',
     !/supabase-js@\d+\//.test(html), (html.match(/.{0,40}supabase-js@\d+\/.{0,20}/) || [''])[0]);
}

console.log('\n== 3. every CDN script, not just these two ==');
{
  const cdn = tags.filter(t => /^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\//.test(attr(t, 'src') || ''));
  ok('exactly two scripts come from cdnjs/jsDelivr', cdn.length === 2, String(cdn.length));
  ok('each has integrity AND crossorigin="anonymous"',
     cdn.every(t => typeof attr(t, 'integrity') === 'string' && attr(t, 'crossorigin') === 'anonymous'));
  const shape = v => /^sha384-[A-Za-z0-9+/]{64}$/.test(v) || /^sha512-[A-Za-z0-9+/]{86}==$/.test(v);
  ok('each integrity value is a well-formed sha384/sha512 digest', cdn.every(t => shape(attr(t, 'integrity'))));
}

console.log('\n== 4. Turnstile stays unhashed, deliberately ==');
{
  /* Cloudflare serves api.js unversioned and updates it in place; a pinned hash
     would block the script on their next release and break sign-in with it */
  const t = tags.find(x => /^https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/.test(attr(x, 'src') || ''));
  ok('the Turnstile script tag is present (string check)', !!t);
  ok('and has no integrity attribute', t && attr(t, 'integrity') === null);
}

console.log('\n== 5. the service worker pre-caches the same URLs ==');
{
  /* the offline copy is only useful if its URL is the one the page requests */
  const sb = { self:{ addEventListener(){}, location:{ origin:'https://fgo-ai.github.io' } } };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(swSrc + '\n;globalThis.__cdn = CDN_ASSETS;', sb, { filename:'sw.js' });
  const cdn = [...sb.__cdn].sort();
  ok('CDN_ASSETS is exactly the two hashed script URLs (read by running sw.js in a vm)',
     JSON.stringify(cdn) === JSON.stringify([THREE_SRC, SUPA_SRC].sort()), JSON.stringify(cdn));
  ok('no floating supabase-js major in sw.js either', !/supabase-js@\d+\//.test(swSrc));
}

console.log('\n' + '='.repeat(58) + '\n  ' + pass + ' passed, ' + fail + ' failed\n' + '='.repeat(58));
process.exit(fail ? 1 : 0);
