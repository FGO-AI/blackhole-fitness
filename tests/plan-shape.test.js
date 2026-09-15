/* Saved-plan validation in repairShapes(): planShapeOK() and profileChoicesOK().

   WHAT THIS PROVES / WHAT IT DOESN'T. Everything here is EXECUTED: the real
   computePlan(), loadState(), repairShapes(), pageMenu() and pagePlanFull()
   out of index.html, under a stubbed DOM, with the blob going through JSON and
   localStorage the way a real load does. It proves:
     1. every plan the current computePlan() produces across the validated
        input space is kept unchanged, and its Blueprint still renders;
     2. plans written by OLDER versions of the app are kept too — samples in
        tests/fixtures/legacy-plans.json, generated from git history;
     3. each field, broken on its own in an otherwise valid blob, is rejected,
        and the app falls back to the guest Menu.
   It cannot prove that no other old version wrote a shape these samples miss.
   tests/plan-history.git.js is the check that ran every commit's computePlan()
   against this validator; it needs full git history, so it is run by hand. */
const fs = require('fs'), vm = require('vm'), path = require('path');
/* line endings normalised: git's autocrlf hands Windows a CRLF working copy */
const js = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  .replace(/\r\n/g, '\n').match(/<script>\n([\s\S]*)\n<\/script>/)[1];

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  PASS  ' + n); }
                               else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); } };

const EX = ['state','computePlan','repairShapes','loadState','SAVE_KEY','pageMenu','pagePlanFull',
            'ACTIVITY_LEVELS','WORKOUTS_SPECIALIZED','GOALS'];
function makeEnv(){
  const store = {};
  const el = () => ({ addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
                      appendChild(){}, remove(){}, classList:{ toggle(){}, add(){}, remove(){} },
                      textContent:'', dataset:{}, style:{}, innerHTML:'' });
  const sb = {
    window:{}, console, matchMedia:() => ({ matches:false }),
    document:{ getElementById:() => el(), createElement:() => el(), activeElement:null, addEventListener(){} },
    IntersectionObserver: class { observe(){} unobserve(){} },
    addEventListener(){}, setTimeout, clearTimeout, setInterval, clearInterval,
    performance, requestAnimationFrame(){},
    localStorage:{ getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); },
                   removeItem: k => { delete store[k]; } },
    location:{ href:'http://x/', origin:'http://x', pathname:'/', protocol:'http:' },
    navigator:{},
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(js.slice(0, js.indexOf('/* boot */'))
    + '\n;Object.assign(globalThis,{' + EX.join(',') + '});\n', sb);
  return { sb, store };
}
const { sb, store } = makeEnv();

/* the real load path: a JSON blob in localStorage, read back by loadState() */
function load(blob){
  store[sb.SAVE_KEY] = JSON.stringify(blob);
  Object.assign(sb.state, { profile:null, plan:null, goal:null });
  sb.loadState();
}
const renders = fn => { try { fn(); return true; } catch (e) { return e.message; } };
const CANARY = '<img/src=x/onerror=alert(1)>';

console.log('\n== 1. Every plan the current computePlan() makes is kept ==');
{
  /* the validated input space: age 14–90; 120–230 cm, 30–300 kg; 3–8 ft, 66–660 lb */
  const BODIES = {
    metric: [{ h:'120', w:'30', age:'90', sex:'f' }, { h:'178', w:'77', age:'28', sex:'m' }, { h:'230', w:'300', age:'14', sex:'m' }],
    imp:    [{ ft:'3', inch:'0', w:'66', age:'90', sex:'f' }, { ft:'5', inch:'10', w:'170', age:'35', sex:'m' }, { ft:'8', inch:'11', w:'660', age:'14', sex:'m' }],
  };
  const VARIANTS = [{}, { trainingDays:[1,2,5,6] }, { avoid:['running','jumping','overhead','heavy-spinal','swimming'] },
                    { equipDetail:['dumbbell'] }, { src:'text', trainingDays:[0,2,4,6], avoid:['jumping'], equipDetail:[] }];
  const EXPS = ['beginner','intermediate','advanced'];
  let n = 0, kept = 0, rendered = 0, firstLost = '', firstThrow = '';
  const seen = { floored:false, substituted:false, imp:false, metric:false, goals:new Set(), days:new Set() };
  for (const goal of sb.GOALS.map(g => g.id)) for (const days of [3,4,5,6]) for (const equip of ['none','basic','gym'])
  for (const units of ['metric','imp']) for (const body of BODIES[units]) for (const a of sb.ACTIVITY_LEVELS)
  for (const extra of (days === 4 ? VARIANTS : [{}])){
    const pf = { goal, units, name:'Alex', ...body, activity:a.v, actLabel:a.l, exp:EXPS[n % 3], days, equip, ...extra };
    sb.state.profile = JSON.parse(JSON.stringify(pf)); sb.state.goal = goal;
    const plan = sb.computePlan();
    n++;
    if (plan.floored) seen.floored = true;
    if (plan.substitutions.length) seen.substituted = true;
    seen[units] = true; seen.goals.add(goal); seen.days.add(days);
    load({ profile:pf, plan, goal });
    const same = sb.state.goal === goal
      && JSON.stringify(sb.state.plan) === JSON.stringify(plan)
      && JSON.stringify(sb.state.profile) === JSON.stringify(pf);
    if (same) kept++; else if (!firstLost) firstLost = JSON.stringify(pf);
    const r = renders(() => { sb.pagePlanFull(); sb.pageMenu(); });
    if (r === true) rendered++; else if (!firstThrow) firstThrow = r;
  }
  ok(`all ${n} plans kept unchanged through JSON + loadState()`, kept === n, `${n - kept} lost, first: ${firstLost}`);
  ok(`all ${n} still render the Blueprint and the Menu`, rendered === n, firstThrow);
  ok('the grid reaches the 1,300 kcal floor', seen.floored);
  ok('the grid includes plans with equipment substitutions', seen.substituted);
  ok('the grid covers both unit systems, all four goals and 3–6 days',
     seen.imp && seen.metric && seen.goals.size === 4 && seen.days.size === 4);
}

console.log('\n== 2. Plans written by older versions are kept ==');
{
  const LEGACY = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'legacy-plans.json'), 'utf8')).plans;
  ok('the fixture holds plans from two old versions', new Set(LEGACY.map(x => x.commit)).size === 2,
     [...new Set(LEGACY.map(x => x.commit))].join(','));
  ok('(fixture) it includes the old lose + conditioning form',
     LEGACY.some(x => x.plan.schedule.some(s => s.cat === 'conditioning' && s.g === 'lose')));
  ok('(fixture) and no plan in it has a substitutions field', LEGACY.every(x => !('substitutions' in x.plan)));
  let kept = 0, rendered = 0, firstLost = '';
  for (const x of LEGACY){
    load({ profile:x.profile, plan:x.plan, goal:x.goal });
    if (sb.state.plan && JSON.stringify(sb.state.plan) === JSON.stringify(x.plan) && sb.state.goal === x.goal) kept++;
    else if (!firstLost) firstLost = x.commit + ' ' + x.goal + ' ' + x.profile.days + ' days';
    if (renders(() => sb.pagePlanFull()) === true) rendered++;
  }
  ok(`all ${LEGACY.length} legacy plans kept unchanged`, kept === LEGACY.length, firstLost);
  ok('and their Blueprints render', rendered === LEGACY.length);
}

console.log('\n== 3. One broken field at a time → reset to the guest Menu ==');
const baseProfile = () => ({ goal:'gain', units:'metric', name:'Alex', sex:'m', age:'28', h:'178', w:'77',
  activity:1.55, actLabel:'Moderately active', exp:'intermediate', days:4, equip:'gym' });
sb.state.profile = baseProfile(); sb.state.goal = 'gain';
const BASE = JSON.stringify({ profile:baseProfile(), plan:sb.computePlan(), goal:'gain' });
const fresh     = () => JSON.parse(BASE);
const trainDay  = b => b.plan.schedule.find(s => !s.rest);
const restDay   = b => b.plan.schedule.find(s => s.rest);
const cardioDay = b => b.plan.schedule.find(s => !s.rest && s.g === 'lose' && s.cat === 'cardio');
const outcome = blob => {
  load(blob);
  return { kept: !!(sb.state.profile && sb.state.plan && sb.state.goal),
           reset: !sb.state.profile && !sb.state.plan && !sb.state.goal };
};
const LIB = sb.WORKOUTS_SPECIALIZED;
const OTHER_SHELF_NAME = (() => {
  const t = trainDay(fresh()), mine = LIB[t.g][t.cat].map(w => w.name);
  for (const g of Object.keys(LIB)) for (const c of Object.keys(LIB[g]))
    for (const w of LIB[g][c]) if (!mine.includes(w.name)) return w.name;
})();

{
  ok('control: the untouched blob is kept', outcome(fresh()).kept);
  ok('control: and its Blueprint renders', renders(() => sb.pagePlanFull()) === true);
  const b = fresh(); delete b.plan.substitutions;
  ok('control: a plan with no substitutions field (older saves) is kept', outcome(b).kept);
  const c = fresh(), d = cardioDay(c);
  ok('(setup) the base plan has a lose/cardio session', !!d);
  d.cat = 'conditioning';
  ok("control: that session stored the old way, lose + 'conditioning', is kept", outcome(c).kept);
  ok('(setup) a real workout name that is not on that shelf exists', typeof OTHER_SHELF_NAME === 'string');
}

const SCENARIOS = [
  /* numbers: type, range, and agreement with the fields they derive from */
  ['plan.kcal as a string',                          b => { b.plan.kcal = String(b.plan.kcal); }],
  ['plan.kcal below the 1,300 floor',                b => { b.plan.kcal = 1290; b.plan.dailyDelta = 1290 - b.plan.tdee; }],
  ['plan.kcal above any validated body',             b => { b.plan.kcal = 12000; b.plan.dailyDelta = 12000 - b.plan.tdee; }],
  ['plan.kcal not a multiple of 10',                 b => { b.plan.kcal += 5; b.plan.dailyDelta += 5; }],
  ['plan.floored not a boolean',                     b => { b.plan.floored = 'false'; }],
  ['plan.floored true with kcal above the floor',    b => { b.plan.floored = true; }],
  ['plan.bmr zero',                                  b => { b.plan.bmr = 0; }],
  ['plan.tdee as a string',                          b => { b.plan.tdee = String(b.plan.tdee); }],
  ['plan.protein fractional',                        b => { b.plan.protein += 0.5; }],
  ['plan.carbs negative',                            b => { b.plan.carbs = -1; b.plan.carbCal = -4; }],
  ['plan.fat null',                                  b => { b.plan.fat = null; }],
  ['plan.proteinCal disagreeing with protein',       b => { b.plan.proteinCal += 4; }],
  ['plan.fatCal disagreeing with fat',               b => { b.plan.fatCal += 9; }],
  ['plan.proteinPerMeal disagreeing with protein',   b => { b.plan.proteinPerMeal += 1; }],
  ['plan.dailyDelta disagreeing with kcal - tdee',   b => { b.plan.dailyDelta += 50; }],
  ['plan.bmi out of range',                          b => { b.plan.bmi = 1000; }],
  ['plan.bmi as a string',                           b => { b.plan.bmi = String(b.plan.bmi); }],
  ['plan.waterL carrying markup',                    b => { b.plan.waterL = CANARY; }],
  ['plan.weeklyChange negative',                     b => { b.plan.weeklyChange = -0.5; }],
  ['plan.projChange null (how JSON stores Infinity)',b => { b.plan.projChange = null; }],
  ['plan.horizonWeeks not 12',                       b => { b.plan.horizonWeeks = 13; }],
  ['plan.weeklyMinutes disagreeing with the week',   b => { b.plan.weeklyMinutes += 1; }],
  ['plan.weeklyBurn as a string',                    b => { b.plan.weeklyBurn = String(b.plan.weeklyBurn); }],
  /* strings from a closed set */
  ['plan.bmiCat carrying markup',                    b => { b.plan.bmiCat = CANARY; }],
  ['plan.bmiCat in the wrong case',                  b => { b.plan.bmiCat = 'Healthy range'; }],
  ['plan.steps carrying markup',                     b => { b.plan.steps = CANARY; }],
  ['plan.steps not one of the two targets',          b => { b.plan.steps = '12,000'; }],
  ['plan.changeUnit not kg or lb',                   b => { b.plan.changeUnit = 'stone'; }],
  ['plan.projDir carrying markup',                   b => { b.plan.projDir = CANARY; }],
  /* meals */
  ['plan.meals not an array',                        b => { b.plan.meals = 'oops'; }],
  ['plan.meals missing one',                         b => { b.plan.meals.pop(); }],
  ['plan.meals out of order',                        b => { b.plan.meals.reverse(); }],
  ['a meal name carrying markup',                    b => { b.plan.meals[0].name = CANARY; }],
  ['a meal kcal as a string',                        b => { b.plan.meals[1].kcal = String(b.plan.meals[1].kcal); }],
  ['a meal protein negative',                        b => { b.plan.meals[2].p = -1; }],
  /* the week */
  ['plan.schedule not an array',                     b => { b.plan.schedule = {}; }],
  ['plan.schedule six days long',                    b => { b.plan.schedule.pop(); }],
  ['a day name carrying markup',                     b => { b.plan.schedule[0].day = CANARY; }],
  ['the days out of order',                          b => { b.plan.schedule.push(b.plan.schedule.shift()); }],
  ['a rest day with rest: "yes"',                    b => { restDay(b).rest = 'yes'; }],
  ['a rest day carrying a workout',                  b => { restDay(b).w = trainDay(b).w; }],
  ['a session with rest: false',                     b => { trainDay(b).rest = false; }],
  ['a session goal carrying markup',                 b => { trainDay(b).g = CANARY; }],
  ['a session goal of __proto__',                    b => { trainDay(b).g = '__proto__'; }],
  ['a session goal of toString',                     b => { trainDay(b).g = 'toString'; }],
  ['a session category carrying markup',             b => { trainDay(b).cat = CANARY; }],
  ['a session category of constructor',              b => { trainDay(b).cat = 'constructor'; }],
  ['a session category from another goal',           b => { trainDay(b).cat = 'running'; }],
  ["the old 'conditioning' form under the wrong goal", b => { const d = cardioDay(b); d.cat = 'conditioning'; d.g = 'gain'; }],
  ['a session with no workout',                      b => { delete trainDay(b).w; }],
  ['a session workout that is an array',             b => { trainDay(b).w = []; }],
  ['a workout name carrying markup',                 b => { trainDay(b).w.name = CANARY; }],
  ['a real workout name from a different shelf',     b => { trainDay(b).w.name = OTHER_SHELF_NAME; }],
  ['a workout tag carrying markup',                  b => { trainDay(b).w.tag = CANARY; }],
  ['a workout tag that is a number',                 b => { trainDay(b).w.tag = 7; }],
  ['a workout duration as a string',                 b => { const d = trainDay(b); d.w.duration = String(d.w.duration); }],
  ['a workout burn of zero',                         b => { const d = trainDay(b); b.plan.weeklyBurn -= d.w.burn; d.w.burn = 0; }],
  /* coverage and substitutions */
  ['plan.coverage not an array',                     b => { b.plan.coverage = 'oops'; }],
  ['a coverage entry carrying markup',               b => { b.plan.coverage[0] = CANARY; }],
  ['plan.coverage reordered',                        b => { b.plan.coverage.reverse(); }],
  ['plan.coverage missing an area',                  b => { b.plan.coverage.pop(); }],
  ['plan.coverage with a duplicate',                 b => { b.plan.coverage.push(b.plan.coverage[0]); }],
  ['plan.substitutions not an array',                b => { b.plan.substitutions = 'oops'; }],
  ['a substitution carrying markup',                 b => { b.plan.substitutions = [{ from:CANARY, to:'cardio' }]; }],
  ['a substitution that is null',                    b => { b.plan.substitutions = [null]; }],
  /* the profile fields rendered beside the plan */
  ['profile.actLabel carrying markup',               b => { b.profile.actLabel = CANARY; }],
  ['profile.actLabel a number (the page lower-cases it)', b => { b.profile.actLabel = 42; }],
  ['profile.days as a string',                       b => { b.profile.days = '4'; }],
  ['profile.days outside 3–6',                       b => { b.profile.days = 7; }],
  ["profile.days disagreeing with the plan's sessions", b => { b.profile.days = 5; }],
  ['profile.exp carrying markup',                    b => { b.profile.exp = CANARY; }],
  ['profile.equip carrying markup',                  b => { b.profile.equip = CANARY; }],
  ['profile.goal carrying markup',                   b => { b.profile.goal = CANARY; }],
  ['profile.goal disagreeing with the saved goal',   b => { b.profile.goal = 'lose'; }],
];
for (const [label, breakIt] of SCENARIOS){
  const b = fresh();
  let setupErr = null;
  try { breakIt(b); } catch (e) { setupErr = e.message; }
  if (setupErr) { ok(label, false, 'scenario setup threw: ' + setupErr); continue; }
  const r = outcome(b);
  const menu = renders(() => sb.pageMenu());
  ok(label + ' → reset, Menu renders', r.reset && menu === true,
     !r.reset ? 'NOT reset' : 'Menu threw: ' + menu);
}

console.log('\n' + '='.repeat(58) + '\n  ' + pass + ' passed, ' + fail + ' failed\n' + '='.repeat(58));
process.exit(fail ? 1 : 0);
