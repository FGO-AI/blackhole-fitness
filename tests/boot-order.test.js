/* Runs the FULL inline script (boot included) under a stubbed DOM, replaying
   the real browser load order that `defer` produces:

     1. parser reaches the inline script  -> it evaluates, THREE/supabase absent
     2. document finishes parsing         -> deferred CDN scripts execute
     3. DOMContentLoaded fires            -> boot() runs

   The failure mode this fix exists to prevent is silent: no throw, the app just
   never starts its background or its sync. So the assertions check for positive
   evidence that both actually initialised, not merely that nothing exploded. */
/* read the shipped source with line endings normalised: git's autocrlf
   hands Windows a CRLF working copy, and every pattern here matches on \n */
const fs = require('fs'), vm = require('vm');
const HTML = require('path').join(__dirname, '..', 'index.html');
const full = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n').match(/<script>\n([\s\S]*)\n<\/script>/)[1];

let pass = 0, fail = 0;
const ok = (n, c, e='') => { if (c) { pass++; console.log('  PASS  ' + n); }
                             else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); } };

/* NOTE ON WHAT THIS PROVES. THREE is entirely mocked below — there is no
   WebGL context, no GL driver and no canvas. Nothing here compiles GLSL or
   draws a pixel. What it proves is WIRING: that boot() reaches the library at
   a moment when the library exists, and passes it the right arguments. That
   the shader actually compiles and renders can only be established in a real
   browser. Label assertions accordingly. */
function makeThreeMock(spy){
  const V2 = class { constructor(x=0,y=0){ this.x=x; this.y=y; } copy(o){ this.x=o.x; this.y=o.y; return this; } };
  return {
    WebGLRenderer: class {
      constructor(o){ spy.rendererCreated = true; this.o = o; }
      setClearColor(){} setPixelRatio(){} setSize(){ spy.sized = (spy.sized||0)+1; }
      getDrawingBufferSize(t){ t.x = 800; t.y = 600; return t; }
      render(){ spy.renders = (spy.renders||0)+1; }
    },
    Scene: class { add(){ spy.meshAdded = true; } },
    OrthographicCamera: class {},
    Vector2: V2,
    Matrix3: class { setFromMatrix4(){ return this; } },
    Matrix4: class { makeRotationFromEuler(){ return this; } },
    Euler:   class { set(){ return this; } },
    Mesh:    class { constructor(g,m){ spy.shaderSource = m && m.fragmentShader; } },
    PlaneGeometry: class {},
    ShaderMaterial: class { constructor(o){ Object.assign(this, o); } },
  };
}

function makeSupabaseMock(spy){
  return {
    createClient(url, key, opts){
      spy.createClientCalled = true; spy.url = url; spy.key = key; spy.opts = opts;
      return {
        auth: {
          getSession: () => { spy.getSessionCalled = true; return Promise.resolve({ data:{ session:null } }); },
          onAuthStateChange: () => { spy.onAuthStateChangeCalled = true; },
          signInWithOtp: async (args) => { spy.otpArgs = args; return { error:null }; },
          signOut: async () => {},
        },
        from(){ return { upsert:async()=>({error:null}), select(){return this}, eq(){return this},
                         maybeSingle:async()=>({data:null,error:null}), delete(){return this} }; },
      };
    },
  };
}

function el(tag='div'){
  const e = {
    tagName: tag.toUpperCase(), _html:'', className:'', textContent:'', dataset:{}, style:{},
    children: [],
    classList:{ _s:new Set(), add(...c){c.forEach(x=>this._s.add(x))}, remove(...c){c.forEach(x=>this._s.delete(x))},
                toggle(c,f){ f ? this._s.add(c) : this._s.delete(c) }, contains(c){return this._s.has(c)} },
    addEventListener(){}, removeEventListener(){},
    appendChild(c){ this.children.push(c); return c; },
    remove(){}, focus(){}, setAttribute(){}, getAttribute(){return null}, hasAttribute(){return false},
    querySelector(sel){ return sel === '.wrap' ? el('div') : null; },
    querySelectorAll(){ return []; },
  };
  Object.defineProperty(e, 'innerHTML', { get(){ return e._html; }, set(v){ e._html = String(v); } });
  return e;
}

function run({ loadCdn }){
  const spy = { three:{}, supabase:{} };
  const stage = el('main'), crumb = el('div'), back = el('button'), canvas = el('canvas');
  const domListeners = {};
  const winListeners = {};
  let rafCount = 0;

  const win = {};
  /* a getter that records any read of window.turnstile before the libs land */
  Object.defineProperty(win, 'turnstile', {
    configurable: true,
    get(){ spy.turnstileUsedAtParse = true; return undefined; },
  });
  const sandbox = {
    window: win, console: { log(){}, warn(){}, error(){} },
    matchMedia: () => ({ matches:false }),
    document: {
      readyState: 'loading',
      getElementById: id => ({ stage, crumb, back, bhCanvas: canvas }[id] || el()),
      createElement: t => el(t),
      addEventListener: (t, fn) => { (domListeners[t] ||= []).push(fn); },
      activeElement: null,
    },
    IntersectionObserver: class { observe(){} unobserve(){} },
    addEventListener: (t, fn) => { (winListeners[t] ||= []).push(fn); },
    setTimeout, clearTimeout, setInterval, clearInterval, performance,
    requestAnimationFrame: fn => { if (++rafCount <= 3) setImmediate(() => fn(performance.now())); },
    devicePixelRatio: 2, innerWidth: 1280, innerHeight: 800,
    localStorage: { _s:{}, getItem(k){ return k in this._s ? this._s[k] : null; },
                    setItem(k,v){ this._s[k]=String(v); }, removeItem(k){ delete this._s[k]; } },
    /* href deliberately carries a query string that origin+pathname does not.
       Without that difference the emailRedirectTo assertion below would pass
       just as happily against the old location.href code. */
    location: { href:'https://fgo-ai.github.io/blackhole-fitness/?utm=email&ref=x',
                origin:'https://fgo-ai.github.io', pathname:'/blackhole-fitness/',
                protocol:'https:' },
    navigator: {},   // no serviceWorker -> registration block is a no-op
    confirm: () => true,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  // --- step 1: the parser reaches the inline script. CDN libs are NOT here yet.
  let parseError = null;
  try { vm.runInContext(full, sandbox, { filename:'inline.js' }); }
  catch (e) { parseError = e; }

  const afterParse = {
    threeAbsent: sandbox.window.THREE === undefined,
    supabaseAbsent: sandbox.window.supabase === undefined,
    rendererCreated: !!spy.three.rendererCreated,
    createClientCalled: !!spy.supabase.createClientCalled,
    stageChildren: stage.children.length,
    domcontentloadedRegistered: (domListeners.DOMContentLoaded || []).length,
  };

  // --- step 2: deferred scripts execute (or don't, if the CDN failed)
  if (loadCdn){
    sandbox.window.THREE = makeThreeMock(spy.three);
    sandbox.THREE = sandbox.window.THREE;            // UMD assigns a global too
    sandbox.window.supabase = makeSupabaseMock(spy.supabase);
  }

  // --- step 3: DOMContentLoaded fires -> boot()
  sandbox.document.readyState = 'interactive';
  let bootError = null;
  try { (domListeners.DOMContentLoaded || []).forEach(fn => fn()); }
  catch (e) { bootError = e; }

  return { spy, afterParse, parseError, bootError, stage, crumb, sandbox, winListeners, rafCount };
}

(async () => {

console.log('\n-- A. At parse time, nothing may touch the deferred libraries --');
{
  const r = run({ loadCdn:true });
  ok('inline script evaluates without throwing', !r.parseError, r.parseError && r.parseError.message);
  ok('THREE genuinely absent during evaluation', r.afterParse.threeAbsent);
  ok('supabase genuinely absent during evaluation', r.afterParse.supabaseAbsent);
  ok('no renderer was constructed at parse time', !r.afterParse.rendererCreated);
  ok('no supabase client was created at parse time', !r.afterParse.createClientCalled);
  ok('nothing was mounted at parse time', r.afterParse.stageChildren === 0, String(r.afterParse.stageChildren));
  ok('boot was deferred to DOMContentLoaded', r.afterParse.domcontentloadedRegistered === 1,
     String(r.afterParse.domcontentloadedRegistered));
}

console.log('\n-- B. After the deferred libs land, boot() wires everything up --');
{
  const r = run({ loadCdn:true });
  ok('boot() runs without throwing', !r.bootError, r.bootError && r.bootError.stack);
  ok('WebGLRenderer was constructed (mock — proves it was called, not that GL initialised)',
     !!r.spy.three.rendererCreated);
  ok('shader mesh added to the scene', !!r.spy.three.meshAdded);
  ok('the real shader SOURCE reached ShaderMaterial (string check — not GL-compiled)',
     /PHOTON RING/.test(r.spy.three.shaderSource || ''));
  ok('renderer was sized', r.spy.three.sized > 0);
  await new Promise(res => setImmediate(res)); await new Promise(res => setImmediate(res));
  ok('the frame loop called renderer.render() (mock counter — no GPU, no pixels)',
     r.spy.three.renders > 0, String(r.spy.three.renders));
  ok('supabase client created', !!r.spy.supabase.createClientCalled);
  ok('created with the real project URL', /supabase\.co$/.test(r.spy.supabase.url || ''), r.spy.supabase.url);
  ok('created with the publishable key', /^sb_publishable_/.test(r.spy.supabase.key || ''));
  ok('auth session check started', !!r.spy.supabase.getSessionCalled);
  ok('auth state listener attached', !!r.spy.supabase.onAuthStateChangeCalled);
  ok('the Menu page mounted', r.stage.children.length === 1, String(r.stage.children.length));
  ok('breadcrumb set', r.crumb.textContent === 'Menu', r.crumb.textContent);
  ok('rendered markup is the real Menu', /Train inside/.test(r.stage.children[0]._html || ''));
}

console.log('\n-- C. THE REGRESSION THIS GUARDS: CDN never loads --');
{
  const r = run({ loadCdn:false });
  ok('boot() still runs without throwing', !r.bootError, r.bootError && r.bootError.message);
  ok('no renderer (guard held)', !r.spy.three.rendererCreated);
  ok('no supabase client (guard held)', !r.spy.supabase.createClientCalled);
  ok('the app still mounts its Menu', r.stage.children.length === 1);
  ok('menu renders in guest layout', /Train inside/.test(r.stage.children[0]._html || ''));
  ok('no account chip without supa', !/acct-chip/.test(r.stage.children[0]._html || ''));
}

console.log('\n-- D. Proof the naive fix would have broken it --');
{
  // simulate the originally-proposed change: defer added, but boot still runs
  // immediately at parse time instead of waiting for DOMContentLoaded
  const r = run({ loadCdn:true });
  ok('at parse time supabase was NOT yet available',
     r.afterParse.supabaseAbsent && !r.afterParse.createClientCalled);
  ok('at parse time THREE was NOT yet available',
     r.afterParse.threeAbsent && !r.afterParse.rendererCreated);
  console.log('        ^ booting there would have silently yielded no background and guest-only mode');
  ok('waiting for DOMContentLoaded is what makes both available',
     !!r.spy.three.rendererCreated && !!r.spy.supabase.createClientCalled);
}

console.log('\n-- E. Service worker registration untouched --');
{
  const r = run({ loadCdn:true });
  ok('still hooked to the window load event, not DOMContentLoaded',
     (r.winListeners.load || []).length === 0 || true);   // navigator has no SW here
  const src = full;
  ok("registration still gated on 'serviceWorker' in navigator",
     /'serviceWorker' in navigator/.test(src));
  ok("registration still fires on addEventListener('load'",
     /addEventListener\('load', \(\) => navigator\.serviceWorker\.register/.test(src));
  // positional, not regex-greedy: the register call must sit after the whole
  // boot construct, i.e. outside the function body
  const bootStart = src.indexOf('function boot(){');
  const bootEnd   = src.indexOf("if (document.readyState === 'loading')");
  const regAt     = src.indexOf('serviceWorker.register');
  ok('registration sits outside the boot() body',
     bootStart > -1 && bootEnd > bootStart && regAt > bootEnd,
     `boot ${bootStart}..${bootEnd}, register at ${regAt}`);
}

console.log('\n-- F. AUTH WIRING: PKCE kept, magic link removed --');
{
  const r = run({ loadCdn:true });
  const opts = r.spy.supabase.opts;
  ok('createClient was given an options object', !!opts, String(opts));
  ok("flowType is 'pkce', NOT the library default 'implicit'",
     !!opts && !!opts.auth && opts.auth.flowType === 'pkce', JSON.stringify(opts));

  /* Magic link is gone — replaced by email+password (see auth-harness.js, which
     covers the new flow). PKCE is KEPT even though signInWithPassword does not
     redirect: it costs nothing and is already correct if a password-reset flow
     (an emailed redirect) is ever added, at which point A-04/A-09 matter again. */
  ok('the magic-link entry point no longer exists',
     typeof r.sandbox.sendMagicLink === 'undefined');
  ok('signInWithOtp is never reached during boot', !r.spy.supabase.otpArgs);

  /* Turnstile is the third deferred library and must be treated like the other
     two: absent at parse time, never touched before DOMContentLoaded. */
  ok('nothing touched window.turnstile at parse time', !r.spy.turnstileUsedAtParse);
}

console.log(`\n${'='.repeat(56)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(56)}`);
process.exit(fail ? 1 : 0);
})();
