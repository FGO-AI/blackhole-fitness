/* Email+password auth and the guest-persists-nothing change, driven against
   the REAL functions out of index.html under a stubbed DOM + mocked supabase-js.

   WHAT THIS PROVES / WHAT IT DOESN'T. supabase-js is mocked, so nothing here
   contacts Supabase, hashes anything, or validates a real credential. What it
   proves is which call the app makes, with which arguments, and — the point of
   most of it — where the password does and does not end up. Whether Supabase
   accepts the credential can only be established against the live project. */
/* read the shipped source with line endings normalised: git's autocrlf
   hands Windows a CRLF working copy, and every pattern here matches on \n */
const fs = require('fs'), vm = require('vm');
const HTML = require('path').join(__dirname, '..', 'index.html');
const js = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n').match(/<script>\n([\s\S]*)\n<\/script>/)[1];

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  PASS  ' + n); }
                               else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); } };

/* top-level const/let are lexical, not global properties — re-export them, plus
   two accessors for the captcha module vars that have no other way out */
const EX = ['state','saveState','saveLocal','loadState','durableSlice','SAVE_KEY',
            'initSupabase','submitAuth','signOutAccount','authFormReady','authErrorText',
            'MIN_PASSWORD','repairShapes','validEmail','captchaConfigured','pageAccount',
            'resetState','clearSavedData','TURNSTILE_SITE_KEY'];
const defs = js.slice(0, js.indexOf('/* boot */'))
  + '\n;Object.assign(globalThis,{' + EX.join(',') + ',' +
    '__cap:()=>({token:captchaToken,live:captchaLive}),' +
    '__setCap:(t,l)=>{captchaToken=t;captchaLive=l;},' +
    '__setMode:(m)=>{state.authMode=m;}});\n';

const PW  = 'correct-horse-battery';   /* the canary: must never turn up anywhere */
const PW2 = 'a-different-one-9';

function makeEnv(){
  const store = {};
  const writes = [];          /* every value ever handed to setItem */
  const calls  = { signUp:[], signInWithPassword:[], signOut:0, otp:[] };

  const fakeEl = { addEventListener(){}, querySelector(){ return null; },
                   querySelectorAll(){ return []; }, appendChild(){}, remove(){},
                   classList:{ toggle(){}, add(){}, remove(){} },
                   textContent:'', dataset:{}, style:{}, innerHTML:'' };

  const sb = {
    window:{}, console,
    matchMedia: () => ({ matches:false }),
    document:{ getElementById:()=>fakeEl, createElement:()=>fakeEl, activeElement:null,
               addEventListener(){} },
    IntersectionObserver: class { observe(){} unobserve(){} },
    addEventListener(){}, setTimeout, clearTimeout, setInterval, clearInterval,
    performance, requestAnimationFrame(){},
    localStorage:{
      getItem(k){ return k in store ? store[k] : null; },
      setItem(k,v){ store[k] = String(v); writes.push({ key:k, value:String(v) }); },
      removeItem(k){ delete store[k]; writes.push({ key:k, value:null, removed:true }); },
    },
    location:{ href:'https://fgo-ai.github.io/blackhole-fitness/',
               origin:'https://fgo-ai.github.io', pathname:'/blackhole-fitness/', protocol:'https:' },
    navigator:{},
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(defs, sb);

  /* mock supabase-js, then let the app's own initSupabase() pick it up — that
     is the only way to populate the module-scoped `supa` from out here */
  sb.window.supabase = {
    createClient(url, key, opts){
      sb.__clientOpts = opts;
      return {
        auth:{
          signUp: async (a) => { calls.signUp.push(a); return sb.__signUpResult || { data:{ session:{} }, error:null }; },
          signInWithPassword: async (a) => { calls.signInWithPassword.push(a); return sb.__signInResult || { data:{ session:{} }, error:null }; },
          signInWithOtp: async (a) => { calls.otp.push(a); return { error:null }; },
          signOut: async () => { calls.signOut++; },
          getSession: async () => ({ data:{ session:null } }),
          onAuthStateChange(){},
        },
        from(){ return { upsert:async()=>({error:null}), select(){return this;}, eq(){return this;},
                         maybeSingle:async()=>({data:null,error:null}), delete(){return this;} }; },
      };
    },
  };
  sb.initSupabase();
  return { sb, store, writes, calls };
}

const signedIn = sb => { sb.state.session = { id:'u-1', email:'a@b.com' }; };
const guest    = sb => { sb.state.session = null; };

(async () => {

console.log('\n== PART 2 — guest mode persists nothing ==');
{
  const { sb, store, writes } = makeEnv();
  guest(sb);
  sb.state.goal = 'gain';
  sb.state.done = [{ name:'Leg Day', kcal:400, completedAt:'2026-06-17T14:30:00.000Z' }];
  sb.state.meals.Breakfast = [{ name:'Oats', calories:300 }];
  sb.saveState(); sb.saveState(); sb.saveLocal();
  ok('a guest interaction writes NOTHING to localStorage',
     writes.length === 0, JSON.stringify(writes));
  ok('the storage key does not exist', !(sb.SAVE_KEY in store));
}
{
  const { sb, store, writes } = makeEnv();
  signedIn(sb);
  sb.state.goal = 'gain';
  sb.saveLocal();
  ok('a SIGNED-IN user still writes their local cache', writes.length === 1);
  ok('and it lands under the real storage key', sb.SAVE_KEY in store);
  const blob = JSON.parse(store[sb.SAVE_KEY]);
  ok('the cache holds the durable slice', blob.goal === 'gain');
}
{
  /* the read side must be UNTOUCHED: gating the write is the whole change */
  const { sb, store } = makeEnv();
  /* assert on `done`: repairShapes() deliberately nulls goal/profile/plan
     together, so a partial blob's goal would be cleared for reasons that have
     nothing to do with this change. `done` survives on its own. */
  store[sb.SAVE_KEY] = JSON.stringify({ done:[{ name:'X', kcal:1 }],
                                        favorites:[{ name:'Oats' }] });
  guest(sb);
  sb.loadState();
  ok('loadState() still READS even as a guest (read path left alone)',
     sb.state.done.length === 1 && sb.state.favorites.length === 1,
     JSON.stringify({ done: sb.state.done, fav: sb.state.favorites }));
}
{
  const { sb, store, writes, calls } = makeEnv();
  signedIn(sb);
  sb.saveLocal();
  ok('precondition: cache written while signed in', sb.SAVE_KEY in store);
  await sb.signOutAccount();
  ok('signOut called through to supabase', calls.signOut === 1);
  ok('the storage key is GONE, not just logically ignored',
     !(sb.SAVE_KEY in store), JSON.stringify(Object.keys(store)));
  ok('removal was an explicit removeItem', writes.some(w => w.removed && w.key === sb.SAVE_KEY));
  ok('session cleared', sb.state.session === null);
  /* and nothing may quietly re-write it afterwards */
  sb.saveState(); sb.saveLocal();
  ok('post-sign-out activity re-writes nothing', !(sb.SAVE_KEY in store));
}

console.log('\n== PART 1 — which call, with which arguments ==');
{
  const { sb, calls } = makeEnv();
  sb.__setMode('signin');
  await sb.submitAuth('a@b.com', PW);
  ok('sign-in mode calls signInWithPassword', calls.signInWithPassword.length === 1);
  ok('sign-in mode does NOT call signUp', calls.signUp.length === 0);
  ok('never falls back to the removed magic link', calls.otp.length === 0);
  const a = calls.signInWithPassword[0];
  ok('email passed through', a.email === 'a@b.com');
  ok('password passed through to supabase (the one legitimate use)', a.password === PW);
}
{
  const { sb, calls } = makeEnv();
  sb.__setMode('signup');
  await sb.submitAuth('new@b.com', PW);
  ok('create-account mode calls signUp', calls.signUp.length === 1);
  ok('create-account mode does NOT call signInWithPassword', calls.signInWithPassword.length === 0);
  ok('email passed through', calls.signUp[0].email === 'new@b.com');
}
{
  const { sb, calls } = makeEnv();
  sb.__setMode('signin');
  sb.__setCap('tok-abc', true);
  await sb.submitAuth('a@b.com', PW);
  ok('captchaToken is forwarded when one has been solved',
     calls.signInWithPassword[0].options.captchaToken === 'tok-abc');
}
{
  const { sb, calls } = makeEnv();
  sb.__setMode('signin');
  sb.__setCap('', false);
  await sb.submitAuth('a@b.com', PW);
  ok('no captchaToken key at all when none was solved',
     !('captchaToken' in calls.signInWithPassword[0].options));
}

console.log('\n== PART 1 — the password must not survive the call ==');
{
  const { sb, store, writes } = makeEnv();
  signedIn(sb);
  sb.__setMode('signin');
  await sb.submitAuth('a@b.com', PW);
  sb.saveState(); sb.saveLocal();
  const stateJson = JSON.stringify(sb.state);
  ok('password is NOT anywhere in `state`', stateJson.indexOf(PW) === -1);
  ok('password is NOT in anything written to localStorage',
     writes.every(w => (w.value || '').indexOf(PW) === -1));
  ok('password is NOT in the stored blob',
     Object.values(store).every(v => String(v).indexOf(PW) === -1));
  ok('password is NOT in the durable slice', JSON.stringify(sb.durableSlice()).indexOf(PW) === -1);
  ok('the feedback message does not echo it', String(sb.state.authMsg).indexOf(PW) === -1);
}
{
  /* a failing attempt is the path most likely to leak the credential back */
  const { sb, store, writes } = makeEnv();
  sb.__setMode('signin');
  sb.__signInResult = { data:{ session:null },
                        error:{ message:'Invalid login credentials' } };
  await sb.submitAuth('a@b.com', PW);
  ok('wrong password produces a human message, not the API string',
     sb.state.authMsg === 'That email and password don’t match an account.', sb.state.authMsg);
  ok('the failure path leaks nothing into state', JSON.stringify(sb.state).indexOf(PW) === -1);
  ok('the failure path leaks nothing into storage',
     writes.every(w => (w.value || '').indexOf(PW) === -1)
     && Object.values(store).every(v => String(v).indexOf(PW) === -1));
  ok('busy flag released so the form is usable again', sb.state.authBusy === false);
}
{
  const { sb } = makeEnv();
  sb.__setMode('signin');
  sb.__signInResult = null;
  const orig = sb.window.supabase;
  /* force the catch block: the likeliest place to log an error object whole */
  sb.window.supabase = { createClient(){ return { auth:{
      signInWithPassword(){ throw new Error('boom ' + PW); },
      signUp(){ throw new Error('boom'); } }, from(){ return {}; } }; } };
  sb.initSupabase();
  await sb.submitAuth('a@b.com', PW);
  ok('a thrown error yields a generic message',
     sb.state.authMsg.indexOf('Couldn’t reach the server') === 0, sb.state.authMsg);
  ok('and the thrown error text (which held the password) is NOT surfaced',
     sb.state.authMsg.indexOf(PW) === -1 && JSON.stringify(sb.state).indexOf(PW) === -1);
  sb.window.supabase = orig;
}

console.log('\n== PART 1 — signup edge case and error mapping ==');
{
  const { sb } = makeEnv();
  sb.__setMode('signup');
  sb.__signUpResult = { data:{ session:null }, error:null };   /* Confirm email still ON */
  await sb.submitAuth('new@b.com', PW);
  ok('signUp with no session explains the dashboard setting',
     /email confirmation is switched on/.test(sb.state.authMsg), sb.state.authMsg);
}
{
  const { sb } = makeEnv();
  const map = [
    ['User already registered',            /already has an account/],
    ['captcha protection: request disallowed', /verify you’re human/],
    ['Email rate limit exceeded',          /Too many attempts/],
    ['Password should be at least 6 characters', /password was rejected/],
    ['Email not confirmed',                /needs email confirmation/],
  ];
  for (const [api, want] of map){
    ok('maps "' + api.slice(0, 34) + '"', want.test(sb.authErrorText(api)), sb.authErrorText(api));
  }
  ok('an unknown message is passed through rather than swallowed',
     sb.authErrorText('some novel failure') === 'some novel failure');
}

console.log('\n== PART 1 — client-side gate before Supabase is ever called ==');
{
  const { sb } = makeEnv();
  ok('the client minimum is 8', sb.MIN_PASSWORD === 8);
  const page = (pw, pw2) => ({ querySelector(sel){
    if (sel === '#authPass')  return { value: pw };
    if (sel === '#authPass2') return pw2 === undefined ? null : { value: pw2 };
    return null;
  }});
  /* authFormReady reads pendingEmail, which is module-scoped; drive it via the
     signed-out form's own path by checking the password rules only */
  sb.__setMode('signin');
  sb.__setCap('', false);
  ok('7 characters is refused', sb.authFormReady(page('1234567')) === false);
  ok('a mismatched confirmation is refused in signup mode',
     (sb.__setMode('signup'), sb.authFormReady(page(PW, PW2))) === false);
}
{
  const { sb } = makeEnv();
  sb.__setMode('signin');
  sb.__setCap('', true);     /* widget on screen, nothing solved */
  const page = { querySelector: sel => sel === '#authPass' ? { value: PW } : null };
  ok('a live, unsolved captcha blocks submission', sb.authFormReady(page) === false);
}

console.log('\n== Wiring that must not have regressed ==');
{
  const { sb } = makeEnv();
  ok('PKCE is still set (free, and already right if a reset flow is added)',
     sb.__clientOpts && sb.__clientOpts.auth && sb.__clientOpts.auth.flowType === 'pkce',
     JSON.stringify(sb.__clientOpts));
  ok('the Turnstile key is still the unconfigured placeholder',
     sb.captchaConfigured() === false && /^YOUR_/.test(sb.TURNSTILE_SITE_KEY));
  const h = sb.pageAccount();
  ok('the account form offers both modes',
     h.includes('data-mode="signin"') && h.includes('data-mode="signup"'));
  ok('it has a password field', h.includes('id="authPass"'));
  ok('password inputs are type=password', (h.match(/type="password"/g) || []).length >= 1);
  ok('NO password value is ever echoed into the markup', !/id="authPass"[^>]*value=/.test(h));
  ok('the captcha mount point is present', h.includes('id="authCaptcha"'));
  ok('no magic-link remnants in the markup',
     !/sendMagicLink|resendLink|Check your/.test(h));
  ok('guest copy no longer promises local saving',
     !h.includes('still saves on this device') && h.includes('nothing is saved'));
}

console.log('\n' + '='.repeat(58) + '\n  ' + pass + ' passed, ' + fail + ' failed\n' + '='.repeat(58));
process.exit(fail ? 1 : 0);
})();
