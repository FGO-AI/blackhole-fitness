/* Regression smoke for the pages that existed BEFORE the coaching work. The
   earlier per-feature harnesses were lost with the scratchpad, so this is a
   coarse net: every page renders in its main states with balanced tags and no
   leaked undefined/NaN, and the persistence + auth invariants still hold. */
/* read the shipped source with line endings normalised: git's autocrlf
   hands Windows a CRLF working copy, and every pattern here matches on \n */
const fs = require('fs'), vm = require('vm');
/* freeze the clock INSIDE the sandbox before the app script evaluates, so
   nothing here depends on the day it is run — same instant the date-boundary
   tests use: Wed 17 Jun 2026, 14:30 local */
const FIXED_NOW = new Date(2026, 5, 17, 14, 30).getTime();
const FREEZE_CLOCK = 'const __F=' + FIXED_NOW + ';class FakeDate extends Date{constructor(...a){super(...(a.length?a:[__F]))}static now(){return __F}};globalThis.Date=FakeDate;';
const HTML = require('path').join(__dirname, '..', 'index.html');
const js = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n').match(/<script>\n([\s\S]*)\n<\/script>/)[1];

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  PASS  ' + n); }
                               else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); } };
const EX = ['state','pageMenu','pageCalories','pagePlanFull','pageLog','pageAccount','pageWorkouts','pageGoals',
            'pageAbout','pageDetail','pageWeekdays','computePlan','repairShapes','saveLocal','loadState',
            'durableSlice','SAVE_KEY','escHtml','foodZone','initSupabase','signOutAccount','WORKOUTS_SPECIALIZED'];

function makeEnv(){
  const store = {}, writes = [];
  const fake = () => ({ addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
                        appendChild(){}, remove(){}, classList:{ toggle(){}, add(){}, remove(){} },
                        textContent:'', dataset:{}, style:{}, innerHTML:'' });
  const sb = {
    window:{}, console, matchMedia:()=>({matches:false}),
    document:{ getElementById:()=>fake(), createElement:()=>fake(), activeElement:null, addEventListener(){} },
    IntersectionObserver: class { observe(){} unobserve(){} },
    addEventListener(){}, setTimeout, clearTimeout, setInterval, clearInterval, performance, requestAnimationFrame(){},
    localStorage:{ getItem:k => k in store ? store[k] : null, setItem(k,v){ store[k]=String(v); writes.push(k); }, removeItem(k){ delete store[k]; } },
    location:{ href:'http://x/', origin:'http://x', pathname:'/', protocol:'http:' }, navigator:{},
  };
  sb.globalThis = sb; vm.createContext(sb);
  vm.runInContext(FREEZE_CLOCK, sb);
  vm.runInContext(js.slice(0, js.indexOf('/* boot */')) + '\n;Object.assign(globalThis,{' + EX.join(',') + '});\n', sb);
  return { sb, store, writes };
}
const bal = (name, h) => {
  const n = re => (h.match(re) || []).length;
  const bad = [['div', /<div\b/g, /<\/div>/g], ['span', /<span\b/g, /<\/span>/g], ['p', /<p\b/g, /<\/p>/g],
               ['button', /<button\b/g, /<\/button>/g], ['svg', /<svg\b/g, /<\/svg>/g], ['label', /<label\b/g, /<\/label>/g]]
    .filter(([, o, c]) => n(o) !== n(c)).map(x => x[0]);
  ok(name + ': tags balanced', !bad.length, bad.join(','));
  const leak = (h.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,40}/) || [''])[0];
  ok(name + ': no undefined/NaN leaked', !leak, leak);
  ok(name + ': not empty', h.trim().length > 50);
};
const profile = () => ({ goal:'gain', units:'metric', name:"O'Brien <b>", sex:'m', age:'28', h:'178', w:'77',
  activity:1.55, actLabel:'Moderately active', exp:'intermediate', days:4, equip:'gym', trainingDays:[0,2,4,6] });

console.log('\n== pages, guest ==');
{
  const { sb } = makeEnv();
  bal('Menu', sb.pageMenu());
  bal('Calorie Tracker', sb.pageCalories());
  bal('Activity Log (empty)', sb.pageLog());
  bal('Account (signed out)', sb.pageAccount());
  bal('Workout Library', sb.pageWorkouts());
  bal('Goals (wizard step 1)', sb.pageGoals());
  sb.state.draft = { goal:'gain', units:'metric', name:'" onfocus=x' };
  bal('About (wizard step 2)', sb.pageAbout());
  ok('About: draft name is attribute-escaped', /value="&quot; onfocus=x"/.test(sb.pageAbout()));
}
console.log('\n== pages, with a plan ==');
{
  const { sb } = makeEnv();
  sb.state.profile = profile(); sb.state.goal = 'gain'; sb.state.plan = sb.computePlan();
  bal('Menu', sb.pageMenu());
  ok('Menu: profile name escaped', /O&#39;Brien/.test(sb.pageMenu()) && !/<b>\./.test(sb.pageMenu()));
  bal('Plan', sb.pagePlanFull());
  /* first name only: split(' ')[0] drops the "<b>" token, so what remains must be the escaped apostrophe */
  ok('Plan: kicker name escaped', /engineered for O&#39;Brien</.test(sb.pagePlanFull()));
  bal('Calorie Tracker', sb.pageCalories());
  sb.state.done.push({ name:'Upper Body Power', tag:'Strength', duration:45, burn:320, completedAt:new sb.Date().toISOString() });
  sb.state.done.push({ name:'Legacy', tag:'Cardio', duration:20, burn:150 });
  sb.state.logPeriod = 'career';
  bal('Activity Log (career)', sb.pageLog());
  sb.state.logPeriod = 'today';
  bal('Activity Log (today)', sb.pageLog());
  const w = sb.WORKOUTS_SPECIALIZED.gain.upperbody[0];
  bal('Workout detail', sb.pageDetail({ g:'gain', wname: encodeURIComponent(w.name) }));
  sb.state.draft = { ...profile() };
  bal('Weekday picker', sb.pageWeekdays());
  sb.state.session = { id:'u', email:'a@b.com' };
  bal('Account (signed in)', sb.pageAccount());
}
console.log('\n== tracker with hostile custom food (XSS regression) ==');
{
  const { sb } = makeEnv();
  const bad = { name:'<img/src=x/onerror=alert(1)>', srv:'<svg/onload=1>', calories:100, p:1, c:1, f:1, cat:'Custom', custom:true };
  sb.state.customFoods = [bad]; sb.state.foodCat = 'Custom';
  sb.state.meals.Breakfast.push({ food:bad, qty:1 }); sb.state.sheet = { food:bad, qty:1 };
  const h = sb.foodZone();
  ok('no raw <img or <svg/onload in the output', !/<img/.test(h) && !/<svg\/onload/.test(h));
  ok('escaped form present at ≥3 surfaces', (h.split('&lt;img/src=x/onerror=alert(1)&gt;').length - 1) >= 3);
}
console.log('\n== persistence + auth invariants ==');
{
  const { sb, store, writes } = makeEnv();
  sb.state.goal = 'gain'; sb.saveLocal();
  ok('guest writes nothing', writes.length === 0);
  sb.state.session = { id:'u', email:'a@b.com' }; sb.saveLocal();
  ok('signed-in writes the durable slice', writes.length === 1 && sb.SAVE_KEY in store);
  const blob = JSON.parse(store[sb.SAVE_KEY]);
  ok('the blob carries the coaching fields', 'weighIns' in blob && 'intakeLog' in blob && 'adaptive' in blob && 'prefs' in blob && 'mealsDate' in blob);
  ok('and none of the transient ones', !('session' in blob) && !('nutPeriod' in blob) && !('macroEditing' in blob) && !('sheet' in blob));
  sb.state.customFoods = [{ name:'', srv:'x', calories:1, p:1, c:1, f:1 }, { name:'ok', srv:'1', calories:1, p:1, c:1, f:1 }];
  sb.repairShapes();
  ok('repairShapes still drops malformed custom foods', sb.state.customFoods.length === 1);
}
{
  const { sb, store } = makeEnv();
  let signedOut = 0;
  sb.window.supabase = { createClient(){ return { auth:{ signOut: async () => { signedOut++; }, getSession: async () => ({data:{session:null}}), onAuthStateChange(){} }, from(){ return {}; } }; } };
  sb.initSupabase();
  sb.state.session = { id:'u', email:'a@b.com' }; sb.saveLocal();
  (async () => {
    await sb.signOutAccount();
    ok('sign-out still wipes the local cache', signedOut === 1 && !(sb.SAVE_KEY in store) && sb.state.session === null);
    console.log('\n' + '='.repeat(60) + '\n  ' + pass + ' passed, ' + fail + ' failed\n' + '='.repeat(60));
    process.exit(fail ? 1 : 0);
  })();
}
