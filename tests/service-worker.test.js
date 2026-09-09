/* Loads the real sw.js into a vm sandbox with a stubbed ServiceWorkerGlobalScope
   and drives genuine fetch events through it. Node can't run a service worker,
   but the handler is just a function over caches/fetch — so mock those and the
   branching, caching and offline behaviour are all directly observable. */
/* read the shipped source with line endings normalised: git's autocrlf
   hands Windows a CRLF working copy, and every pattern here matches on \n */
const fs = require('fs'), vm = require('vm');
const SW = require('path').join(__dirname, '..', 'sw.js');
const src = fs.readFileSync(SW, 'utf8').replace(/\r\n/g, '\n');
/* read the current key from source so a routine bump can't break the tests */
const CACHE = src.match(/const CACHE = '([^']+)'/)[1];

let pass = 0, fail = 0;
const ok = (n, c, e='') => { if (c) { pass++; console.log('  PASS  ' + n); }
                             else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); } };

/* ---- minimal Fetch API stand-ins ---- */
class Res {
  constructor(body, { ok = true, status = 200, tag = '' } = {}) {
    this.body = body; this.ok = ok; this.status = status; this.tag = tag;
  }
  clone(){ return new Res(this.body, { ok:this.ok, status:this.status, tag:this.tag }); }
}
Res.error = () => new Res(null, { ok:false, status:0, tag:'NETWORK_ERROR' });

function makeEnv({ network, cacheSeed = {} }){
  const stores = { };                       // cacheName -> { url: Res }
  const log = { puts: [], fetches: [], matches: [] };
  const cacheObj = name => ({
    async put(key, res){ const k = String(key.url || key); (stores[name] ||= {})[k] = res; log.puts.push({ cache:name, key:k, tag:res.tag }); },
    async add(){}, async addAll(){},
    async match(key){ const k = String(key.url || key); return (stores[name] || {})[k] || undefined; },
  });
  const caches = {
    async open(name){ stores[name] ||= {}; return cacheObj(name); },
    async match(key){
      const k = String(key.url || key);
      log.matches.push(k);
      for (const n of Object.keys(stores)) if (stores[n][k]) return stores[n][k];
      return undefined;
    },
    async keys(){ return Object.keys(stores); },
    async delete(n){ delete stores[n]; return true; },
  };
  // seed: { cacheName: { url: Res } }
  for (const [name, entries] of Object.entries(cacheSeed)){
    stores[name] = {};
    for (const [url, res] of Object.entries(entries)) stores[name][url] = res;
  }

  const handlers = {};
  const sandbox = {
    self: {
      addEventListener: (t, fn) => { handlers[t] = fn; },
      location: { origin: 'https://fgo-ai.github.io' },
      skipWaiting: async () => {}, clients: { claim: async () => {} },
    },
    caches, Response: Res, URL, console,
    fetch: async (req) => { log.fetches.push(String(req.url || req)); return network(req); },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename:'sw.js' });
  return { handlers, stores, log, caches };
}

/* drive one fetch event and return what the SW responded with (or MISS if it
   declined to handle the request at all) */
async function dispatch(handlers, request){
  let responded = null;
  handlers.fetch({ request, respondWith(p){ responded = p; } });
  return responded === null ? 'NOT_HANDLED' : await responded;
}
const nav  = (url='https://fgo-ai.github.io/blackhole-fitness/') => ({ url, method:'GET', mode:'navigate' });
const asset= (url) => ({ url, method:'GET', mode:'cors' });

(async () => {

console.log('\n-- 1. THE ORIGINAL BUG: deploy with no cache-key bump --');
{
  // cache holds the OLD document under the current (unchanged) key
  const env = makeEnv({
    cacheSeed: { [CACHE]: { './index.html': new Res('OLD PAGE', { tag:'OLD' }) } },
    network: async () => new Res('NEW PAGE', { tag:'NEW' }),
  });
  const res = await dispatch(env.handlers, nav());
  ok('navigation serves the NEW page even though CACHE never changed',
     res.tag === 'NEW', `got ${res.tag}`);
  ok('it actually hit the network', env.log.fetches.length === 1);
  await new Promise(r => setTimeout(r, 0));   // the cache.put is fire-and-forget
  ok('the fresh page replaces the cached shell',
     env.stores[[CACHE]]['./index.html'].tag === 'NEW',
     env.stores[[CACHE]]['./index.html'].tag);
}

console.log('\n-- 2. OFFLINE: last good document still serves --');
{
  const env = makeEnv({
    cacheSeed: { [CACHE]: { './index.html': new Res('CACHED PAGE', { tag:'CACHED' }) } },
    network: async () => { throw new TypeError('Failed to fetch'); },
  });
  const res = await dispatch(env.handlers, nav());
  ok('serves the cached shell, not an error', res.tag === 'CACHED', `got ${res.tag}`);
  ok('did try the network first', env.log.fetches.length === 1);
}

console.log('\n-- 3. OFFLINE with nothing cached --');
{
  const env = makeEnv({ cacheSeed:{}, network: async () => { throw new TypeError('offline'); } });
  const res = await dispatch(env.handlers, nav());
  ok('returns a network error rather than hanging or throwing', res.tag === 'NETWORK_ERROR', String(res.tag));
}

console.log('\n-- 4. A 500 must not poison the offline shell --');
{
  const env = makeEnv({
    cacheSeed: { [CACHE]: { './index.html': new Res('GOOD PAGE', { tag:'GOOD' }) } },
    network: async () => new Res('Server Error', { ok:false, status:500, tag:'ERR500' }),
  });
  const res = await dispatch(env.handlers, nav());
  ok('the 500 is passed through to the page', res.tag === 'ERR500');
  await new Promise(r => setTimeout(r, 0));
  ok('but the cached shell is left intact',
     env.stores[[CACHE]]['./index.html'].tag === 'GOOD',
     env.stores[[CACHE]]['./index.html'].tag);
}

console.log('\n-- 5. NON-NAVIGATION REQUESTS: cache-first, unchanged --');
{
  const ICON = 'https://fgo-ai.github.io/blackhole-fitness/icon-192.png';
  const env = makeEnv({
    cacheSeed: { [CACHE]: { [ICON]: new Res('cached icon', { tag:'CACHED_ICON' }) } },
    network: async () => new Res('network icon', { tag:'NETWORK_ICON' }),
  });
  const res = await dispatch(env.handlers, asset(ICON));
  ok('cached icon is served from cache', res.tag === 'CACHED_ICON', String(res.tag));
  ok('network was NOT touched', env.log.fetches.length === 0, JSON.stringify(env.log.fetches));
}
{
  const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
  const env = makeEnv({ cacheSeed:{ [CACHE]: {} }, network: async () => new Res('lib', { tag:'CDN' }) });
  const res = await dispatch(env.handlers, asset(CDN));
  ok('uncached CDN script falls through to the network', res.tag === 'CDN');
  await new Promise(r => setTimeout(r, 0));
  ok('cross-origin response is NOT cached opportunistically',
     !(env.stores[[CACHE]] || {})[CDN], JSON.stringify(Object.keys(env.stores[[CACHE]] || {})));
}
{
  const OWN = 'https://fgo-ai.github.io/blackhole-fitness/manifest.json';
  const env = makeEnv({ cacheSeed:{ [CACHE]: {} }, network: async () => new Res('{}', { tag:'MANIFEST' }) });
  await dispatch(env.handlers, asset(OWN));
  await new Promise(r => setTimeout(r, 0));
  ok('same-origin asset IS cached opportunistically (unchanged behaviour)',
     (env.stores[[CACHE]] || {})[OWN] !== undefined);
}

console.log('\n-- 6. NON-GET is still ignored entirely --');
{
  const env = makeEnv({ cacheSeed:{}, network: async () => new Res('x') });
  const res = await dispatch(env.handlers, { url:'https://x/y', method:'POST', mode:'cors' });
  ok('POST is not intercepted', res === 'NOT_HANDLED', String(res));
}

console.log('\n-- 7. activate still purges superseded caches --');
{
  const env = makeEnv({
    cacheSeed: { 'bhf-old-1': { a:new Res('old') }, 'bhf-old-2': { a:new Res('older') }, [CACHE]: { a:new Res('current') } },
    network: async () => new Res('x'),
  });
  let done; env.handlers.activate({ waitUntil: p => { done = p; } });
  await done;
  ok('old cache versions deleted', !env.stores['bhf-old-1'] && !env.stores['bhf-old-2']);
  ok('current cache kept', !!env.stores[[CACHE]]);
}

console.log(`\n${'='.repeat(52)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(52)}`);
process.exit(fail ? 1 : 0);
})();
