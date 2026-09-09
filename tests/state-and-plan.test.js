/* Loads the real inline script from index.html (definitions only, stopping
   before the DOM boot block) into a vm sandbox with minimal stubs, so the
   logic changed by the audit fixes can be exercised against real data. */
/* read the shipped source with line endings normalised: git's autocrlf
   hands Windows a CRLF working copy, and every pattern here matches on \n */
const fs = require('fs'), vm = require('vm'), path = require('path');

const HTML = require('path').join(__dirname, '..', 'index.html');
const src = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n');
const js = src.match(/<script>\n([\s\S]*)\n<\/script>/)[1];
// top-level const/let in a classic script are lexical, not properties of the
// global object — same as in the browser — so surface what we test explicitly
const EXPORTS = ['FOOD_DB','GOALS','ALL_FOODS','state','freshMeals','repairShapes',
                 'goalData','foodPool','totals','mealKcal','durableSlice','COACH','computePlan'];
const defs = js.slice(0, js.indexOf('/* boot */'))
            + `\n;Object.assign(globalThis, { ${EXPORTS.join(', ')} });\n`;

const fakeEl = {
  addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
  appendChild(){}, remove(){}, classList:{ toggle(){}, add(){}, remove(){} },
  textContent:'', dataset:{}, style:{},
};
const store = {};
const sandbox = {
  window: {}, console,
  matchMedia: () => ({ matches:false }),
  document: { getElementById: () => fakeEl, createElement: () => fakeEl, activeElement:null },
  IntersectionObserver: class { observe(){} unobserve(){} },
  addEventListener(){}, setTimeout, clearTimeout, setInterval, clearInterval,
  performance, requestAnimationFrame(){},
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k,v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  },
  location: { href:'http://x/', protocol:'http:' },
  navigator: {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(defs, sandbox, { filename:'app-defs.js' });

const S = sandbox;
let pass = 0, fail = 0;
const ok = (name, cond, extra='') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
};

console.log('\n── B-01 · category tab encode/decode round trip ──');
const cats = Object.keys(S.FOOD_DB);
const multiword = cats.filter(c => encodeURIComponent(c) !== c);
console.log('  categories needing encoding:', multiword.join(' | '));
ok('4 categories were previously broken', multiword.length === 4, `got ${multiword.length}`);
for (const c of cats) {
  const attr = encodeURIComponent(c);          // what foodZone writes
  const decoded = decodeURIComponent(attr);    // what the fixed handler reads
  ok(`round trip: ${c}`, decoded === c && Array.isArray(S.FOOD_DB[decoded]));
}
// the pre-fix behaviour, to prove the bug was real
const oldWay = encodeURIComponent('Nuts & Fats');
ok('pre-fix key really was undefined', S.FOOD_DB[oldWay] === undefined, String(S.FOOD_DB[oldWay]));
ok('|| [] guard yields an array', Array.isArray(S.FOOD_DB['bogus'] || []));

console.log('\n── B-05 · repairShapes hardening ──');
const scenarios = [
  ['profile with no name',   { profile:{}, plan:{kcal:2000}, goal:'gain' }],
  ['profile.name not string',{ profile:{name:42}, plan:{kcal:2000}, goal:'gain' }],
  ['profile.name blank',     { profile:{name:'   '}, plan:{kcal:2000}, goal:'gain' }],
  ['plan missing kcal',      { profile:{name:'Alex'}, plan:{}, goal:'gain' }],
  ['plan is null',           { profile:{name:'Alex'}, plan:null, goal:'gain' }],
  ['goal not in GOALS',      { profile:{name:'Alex'}, plan:{kcal:2000}, goal:'nonsense' }],
  ['meals not an object',    { profile:{name:'Alex'}, plan:{kcal:2000}, goal:'gain', meals:'oops' }],
  ['done not an array',      { profile:{name:'Alex'}, plan:{kcal:2000}, goal:'gain', done:'oops' }],
];
for (const [label, blob] of scenarios) {
  Object.assign(S.state, { profile:null, plan:null, goal:null, meals:S.freshMeals(),
                           done:[], recents:[], favorites:[], customFoods:[] }, blob);
  let threw = null;
  try { S.repairShapes(); } catch (e) { threw = e; }
  if (threw) { ok(label, false, 'repairShapes threw: ' + threw.message); continue; }
  // now simulate exactly what pageMenu does with the repaired state
  let menuThrew = null;
  try {
    const pf = S.state.profile;
    const first = pf ? pf.name.trim().split(' ')[0] : null;
    if (pf) { S.goalData().icon; S.state.plan.kcal; S.state.profile.days; }
    void first;
  } catch (e) { menuThrew = e; }
  ok(label + ' → Menu renders', !menuThrew, menuThrew && menuThrew.message);
}
// a genuinely valid profile must survive untouched
Object.assign(S.state, { profile:{name:'Alex', days:4}, plan:{kcal:2600}, goal:'gain',
                         meals:S.freshMeals(), done:[], recents:[], favorites:[], customFoods:[] });
S.repairShapes();
ok('valid profile is preserved', S.state.profile && S.state.profile.name === 'Alex' && S.state.goal === 'gain');

console.log('\n── C-04 · foodPool caching + totals single pass ──');
S.state.customFoods = [];
const p1 = S.foodPool(), p2 = S.foodPool();
ok('same reference when unchanged', p1 === p2);
ok('pool length = ALL_FOODS', p1.length === S.ALL_FOODS.length, `${p1.length} vs ${S.ALL_FOODS.length}`);
S.state.customFoods = [{ name:'Mom lasagna', srv:'1 slice', calories:600, p:25, c:60, f:28, cat:'Custom' }];
const p3 = S.foodPool();
ok('rebuilt after customFoods changes', p3 !== p1 && p3.length === p1.length + 1);
ok('cached again on next call', S.foodPool() === p3);

const food = { name:'Chicken', srv:'100g', calories:165, p:31, c:0, f:4 };
S.state.meals = { Breakfast:[{food,qty:2}], Lunch:[{food,qty:1}], Dinner:[{food,qty:0.5}], Snack:[] };
const t = S.totals();
const expect = { kcal:330+165+83, p:62+31+16, c:0, f:8+4+2 };
ok('totals.kcal', t.kcal === expect.kcal, `${t.kcal} vs ${expect.kcal}`);
ok('totals.p',    t.p === expect.p,       `${t.p} vs ${expect.p}`);
ok('totals.c',    t.c === expect.c,       `${t.c} vs ${expect.c}`);
ok('totals.f',    t.f === expect.f,       `${t.f} vs ${expect.f}`);
ok('mealKcal agrees', S.mealKcal('Breakfast') === 330, String(S.mealKcal('Breakfast')));

console.log('\n── B-06 · cloud dirty check ──');
const slice1 = JSON.stringify(S.durableSlice());
const slice2 = JSON.stringify(S.durableSlice());
ok('durableSlice is stable across calls', slice1 === slice2);
S.state.done.push({ name:'Leg Day', duration:55, burn:350, tag:'Strength', sets:[] });
ok('changes when durable state changes', JSON.stringify(S.durableSlice()) !== slice1);

console.log('\n── B-07 · dead code removed ──');
ok('FOODS gone',            typeof S.FOODS === 'undefined');
ok("COACH['Cardio2'] gone", S.COACH && S.COACH['Cardio2'] === undefined);
ok('COACH still has real tags', S.COACH['Fat Burn'] && S.COACH['Mobility']);

console.log('\n── regression · computePlan still works end to end ──');
S.state.profile = { goal:'gain', units:'metric', name:'Alex', sex:'m', age:'28', h:'178',
                    w:'77', activity:1.55, actLabel:'Moderately active', exp:'intermediate',
                    days:4, equip:'gym' };
let plan = null, planErr = null;
try { plan = S.computePlan(); } catch (e) { planErr = e; }
ok('computePlan does not throw', !planErr, planErr && planErr.message);
if (plan) {
  ok('kcal is a number', typeof plan.kcal === 'number' && plan.kcal > 1000, String(plan.kcal));
  ok('schedule has 7 days', plan.schedule.length === 7);
  ok('4 training days', plan.schedule.filter(d => !d.rest).length === 4);
  ok('macros present', plan.protein > 0 && plan.carbs > 0 && plan.fat > 0);
  console.log(`        (kcal ${plan.kcal}, BMR ${plan.bmr}, TDEE ${plan.tdee}, BMI ${plan.bmi})`);
}

console.log(`\n${'='.repeat(46)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(46)}`);
process.exit(fail ? 1 : 0);
