/* Phase 0 gate — a scheduled session must be one the user can actually do.
   Before the equipment filter existed, `equip` only rendered a paragraph of
   advice and nothing narrowed the library, so a bodyweight-only profile could
   be handed Sled Push Sprints. This drives the real computePlan() over every
   goal x day-count x equipment combination and checks the schedule it returns.

   These are real function calls against the shipped source, not string
   checks — computePlan(), pickFrom() and findWorkout() all execute here. */
/* read the shipped source with line endings normalised: git's autocrlf
   hands Windows a CRLF working copy, and every pattern here matches on \n */
const fs = require('fs'), vm = require('vm'), path = require('path');

const HTML = path.join(__dirname, '..', 'index.html');
const src = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n');
const js = src.match(/<script>\n([\s\S]*)\n<\/script>/)[1];
// top-level const/let in a classic script are lexical, not properties of the
// global object — same as in the browser — so surface what we test explicitly
const EXPORTS = ['state','computePlan','pickFrom','findWorkout','workoutOK',
                 'availableEquip','avoidTraits','libraryFor',
                 'WORKOUTS_SPECIALIZED','EQUIP_VOCAB','EQUIP_LEVELS','AVOID_VOCAB',
                 'CAT_FALLBACK','CAT_SOURCE','SPLIT_TEMPLATES','DAY_PATTERNS',
                 'CAT_LABEL','GOALS','EQUIP_NOTE'];
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

/* a complete, valid profile — everything but the fields under test is fixed,
   so any difference between runs is caused by equipment or the avoid list */
const BASE = { name:'Test', sex:'m', age:30, units:'metric', h:180, w:80,
               activity:1.55, actLabel:'Moderately active', exp:'intermediate' };
const planFor = (over) => {
  S.state.profile = { ...BASE, ...over };
  return S.computePlan();
};
const GOAL_IDS = ['lose','gain','endure','maintain'];
const DAY_COUNTS = [3,4,5,6];
const LEVELS = ['none','basic','gym'];

/* ═══ 1 · the library is completely and legally tagged ═══ */
console.log('\n── 1 · every library entry declares what it needs ──');
const ALL = [];
for (const g of Object.keys(S.WORKOUTS_SPECIALIZED))
  for (const c of Object.keys(S.WORKOUTS_SPECIALIZED[g]))
    for (const w of S.WORKOUTS_SPECIALIZED[g][c]) ALL.push({ g, c, w });

ok('library still holds 78 sessions', ALL.length === 78, `got ${ALL.length}`);
const untagged = ALL.filter(x => !Array.isArray(x.w.eq) || !Array.isArray(x.w.av));
ok('every session has eq[] and av[]', untagged.length === 0,
   untagged.map(x => x.w.name).join(', '));
const badEq = ALL.filter(x => x.w.eq.some(e => !S.EQUIP_VOCAB.includes(e)));
ok('no eq value outside the vocabulary', badEq.length === 0,
   badEq.map(x => `${x.w.name}:${x.w.eq}`).join(', '));
const badAv = ALL.filter(x => x.w.av.some(a => !S.AVOID_VOCAB.includes(a)));
ok('no av value outside the vocabulary', badAv.length === 0,
   badAv.map(x => `${x.w.name}:${x.w.av}`).join(', '));
const emptyEq = ALL.filter(x => x.w.eq.length === 0);
ok('no session declares an empty eq[] (bodyweight is "none", not blank)',
   emptyEq.length === 0, emptyEq.map(x => x.w.name).join(', '));

/* the fallback ladder is only safe if its floor can never be filtered away */
for (const c of ['mobility','recovery']){
  const shelf = S.WORKOUTS_SPECIALIZED.maintain[c];
  const bodyweight = shelf.filter(w => w.eq.length === 1 && w.eq[0] === 'none' && w.av.length === 0);
  ok(`maintain/${c} keeps an unfilterable floor (${bodyweight.length} of ${shelf.length} need nothing)`,
     bodyweight.length > 0);
}

/* ═══ 2 · the 48 combinations ═══ */
console.log('\n── 2 · 4 goals × 4 day-counts × 3 equipment levels ──');
let combos = 0, scheduled = 0;
for (const goal of GOAL_IDS) for (const days of DAY_COUNTS) for (const equip of LEVELS){
  combos++;
  const avail = S.EQUIP_LEVELS[equip];
  const p = planFor({ goal, days, equip });
  const sessions = p.schedule.filter(s => !s.rest);
  const impossible = sessions.filter(s => !s.w.eq.every(e => avail.includes(e)));
  const lost = days - sessions.length;
  const detail = `${goal}/${days}d/${equip}`;
  ok(`${detail} — every session performable`, impossible.length === 0,
     impossible.map(s => `${s.w.name} needs ${s.w.eq}`).join(' | '));
  ok(`${detail} — ${days} sessions scheduled, none dropped`, lost === 0,
     `scheduled ${sessions.length}`);
  scheduled += sessions.length;
}
ok('all 48 combinations generated', combos === 48, `got ${combos}`);
console.log(`  (${scheduled} scheduled sessions checked)`);

/* ═══ 3 · every scheduled session is still reachable from its card ═══ */
console.log('\n── 3 · cross-goal substitutions stay linkable ──');
let unreachable = [], substitutedPlans = 0;
for (const goal of GOAL_IDS) for (const days of DAY_COUNTS) for (const equip of LEVELS){
  const p = planFor({ goal, days, equip });
  if (p.substitutions.length) substitutedPlans++;
  for (const s of p.schedule.filter(x => !x.rest))
    if (S.findWorkout(s.g, s.w.name) !== s.w)
      unreachable.push(`${goal}/${days}/${equip}: ${s.w.name} under g=${s.g}`);
}
ok('findWorkout(s.g, name) resolves for every scheduled session',
   unreachable.length === 0, unreachable.slice(0,4).join(' | '));
ok('some combinations did need substitution (the ladder is exercised)',
   substitutedPlans > 0, `${substitutedPlans} of 48`);

/* ═══ 4 · substitutions are reported honestly ═══ */
console.log('\n── 4 · substitutions are recorded, not silent ──');
const gymPlans = GOAL_IDS.flatMap(goal => DAY_COUNTS.map(days =>
  ({ goal, days, p: planFor({ goal, days, equip:'gym' }) })));
const gymSubs = gymPlans.filter(x => x.p.substitutions.length);
ok('a full gym never needs a substitution', gymSubs.length === 0,
   gymSubs.map(x => `${x.goal}/${x.days}`).join(', '));

const bwGain = planFor({ goal:'gain', days:4, equip:'none' });
ok('bodyweight "build muscle" substitutes rather than scheduling barbell work',
   bwGain.substitutions.length > 0, JSON.stringify(bwGain.substitutions));
ok('…and every swap names a real from/to category',
   bwGain.substitutions.every(s => typeof s.from === 'string' && typeof s.to === 'string'
                                   && s.from !== s.to));
ok('…and the plan page can label both ends of every swap',
   bwGain.substitutions.every(s => S.CAT_LABEL[s.to]), JSON.stringify(bwGain.substitutions));
ok('…and swaps are deduplicated, not one per affected day',
   bwGain.substitutions.length <= 4 &&
   new Set(bwGain.substitutions.map(s => s.from + '>' + s.to)).size === bwGain.substitutions.length);

/* ═══ 4b · repeats land on different sessions ═══
   Regression: the repeat counter used to key on the template category. On a
   dumbbells-only "build muscle" plan, upperbody and lowerbody both fall to
   maintain/balanced, each counter sat at 0, and Monday and Tuesday came back
   as the same workout. The counter now keys on the shelf actually used. */
console.log('\n── 4b · repeats advance even across substituted categories ──');
const collisions = [];
for (const goal of GOAL_IDS) for (const days of DAY_COUNTS) for (const equip of LEVELS){
  const p = planFor({ goal, days, equip });
  const avail = S.EQUIP_LEVELS[equip];
  const sessions = p.schedule.filter(s => !s.rest);
  const names = sessions.map(s => s.w.name);
  /* The best any scheduler could do: per shelf, you get as many distinct
     sessions as you drew times — capped by how many that shelf actually has
     available. lose/cardio holds exactly one bodyweight session, so a 4-day
     bodyweight plan drawing from it twice MUST repeat it; that is the library
     being thin, not the picker colliding. */
  const used = {};
  for (const s of sessions){
    const k = s.g + '/' + s.cat;
    used[k] = (used[k] || 0) + 1;
  }
  const expect = Object.keys(used).reduce((sum, k) => {
    const [g, c] = k.split('/');
    const have = S.WORKOUTS_SPECIALIZED[g][c].filter(w => S.workoutOK(w, avail, [])).length;
    return sum + Math.min(used[k], have);
  }, 0);
  if (new Set(names).size < expect)
    collisions.push(`${goal}/${days}d/${equip}: ${new Set(names).size} distinct, ${expect} were reachable (${names.join(', ')})`);
}
ok('no plan repeats a session while an unused one was available',
   collisions.length === 0, collisions.slice(0, 3).join('  |  '));

const bwGain2 = planFor({ goal:'gain', days:4, equip:'basic' });
const bwNames = bwGain2.schedule.filter(s => !s.rest).map(s => s.w.name);
ok('gain/4d/basic gives 4 distinct sessions (was 3 with a duplicate Monday/Tuesday)',
   new Set(bwNames).size === 4, bwNames.join(', '));

/* pickFrom mutates the tally it is handed — that is what lets two categories
   sharing one shelf advance through it instead of colliding */
const tally = {}, avail = S.EQUIP_LEVELS.basic;
const a1 = S.pickFrom('gain', 'upperbody', tally, avail, []);
const a2 = S.pickFrom('gain', 'lowerbody', tally, avail, []);
ok('two categories falling to one shelf pick different sessions',
   a1.w.name !== a2.w.name, `${a1.w.name} / ${a2.w.name}`);
ok('…and both report the shelf they actually landed on',
   a1.realCat === 'balanced' && a2.realCat === 'balanced' &&
   a1.realGoal === 'maintain' && a2.realGoal === 'maintain');
ok('…and the shared tally advanced twice', tally['maintain/balanced'] === 2,
   JSON.stringify(tally));
const c1 = S.pickFrom('gain', 'conditioning', {}, S.EQUIP_LEVELS.gym, []);
ok('conditioning is sourced, not substituted', c1.substituted === null
   && c1.realGoal === 'lose' && c1.realCat === 'cardio', JSON.stringify(c1.substituted));

/* ═══ 5 · the stated acceptance criteria ═══ */
console.log('\n── 5 · acceptance criteria ──');
const HEAVY = ['barbell','machine','pool','specialty','cardio-machine','bike'];
for (const goal of GOAL_IDS) for (const days of DAY_COUNTS){
  const p = planFor({ goal, days, equip:'basic' });
  const bad = p.schedule.filter(s => !s.rest && s.w.eq.some(e => HEAVY.includes(e)));
  ok(`"only dumbbells at home" — ${goal}/${days}d has no barbell, machine, sled or pool work`,
     bad.length === 0, bad.map(s => `${s.w.name}:${s.w.eq}`).join(' | '));
}
for (const goal of GOAL_IDS) for (const days of DAY_COUNTS){
  const p = planFor({ goal, days, equip:'gym', avoid:['running','jumping'] });
  const bad = p.schedule.filter(s => !s.rest && s.w.av.some(a => a === 'running' || a === 'jumping'));
  ok(`"bad knees, nothing high-impact" — ${goal}/${days}d has no running or jumping`,
     bad.length === 0, bad.map(s => `${s.w.name}:${s.w.av}`).join(' | '));
}
/* the hardest case: nothing to train with AND impact ruled out */
for (const goal of GOAL_IDS){
  const p = planFor({ goal, days:5, equip:'none', avoid:['running','jumping'] });
  const sessions = p.schedule.filter(s => !s.rest);
  const bad = sessions.filter(s =>
    !s.w.eq.every(e => e === 'none') || s.w.av.some(a => a === 'running' || a === 'jumping'));
  ok(`bodyweight + no impact — ${goal}/5d still fills 5 days, all of them doable`,
     sessions.length === 5 && bad.length === 0,
     bad.map(s => s.w.name).join(' | ') || `only ${sessions.length} days`);
}

/* ═══ 6 · the parser-facing inputs are validated at the read site ═══ */
console.log('\n── 6 · equipDetail / avoid are filtered, not trusted ──');
ok('unknown equip level opens everything (old profiles keep their plan)',
   S.availableEquip({ equip:'wat' }).length === S.EQUIP_VOCAB.length);
ok('missing equip opens everything', S.availableEquip({}).length === S.EQUIP_VOCAB.length);
ok('equipDetail overrides the level when present',
   JSON.stringify(S.availableEquip({ equip:'gym', equipDetail:['dumbbell'] }).sort())
     === JSON.stringify(['dumbbell','none']));
ok('equipDetail always implies bodyweight',
   S.availableEquip({ equip:'none', equipDetail:['bands'] }).includes('none'));
ok('junk inside equipDetail is dropped, not matched',
   !S.availableEquip({ equipDetail:['dumbbell','__proto__','barbell; DROP'] }).includes('barbell; DROP'));
ok('an empty equipDetail falls back to the level rather than to bodyweight-only',
   S.availableEquip({ equip:'gym', equipDetail:[] }).length === S.EQUIP_VOCAB.length);
ok('avoid is filtered to the known vocabulary',
   JSON.stringify(S.avoidTraits({ avoid:['running','nonsense'] })) === JSON.stringify(['running']));
ok('a non-array avoid is ignored', S.avoidTraits({ avoid:'running' }).length === 0);
ok('an avoid list of pure junk cannot empty the library',
   planFor({ goal:'lose', days:4, equip:'gym', avoid:['x','y','z'] })
     .schedule.filter(s => !s.rest).length === 4);

/* ═══ 7 · the nutrition half is untouched by any of this ═══ */
console.log('\n── 7 · equipment changes the sessions, never the numbers ──');
/* waterL is deliberately NOT in this list — computePlan scales hydration with
   weeklyMinutes, so it is a legitimate downstream consequence of which sessions
   were scheduled. It gets its own check below rather than being dropped. */
const NUM = ['kcal','protein','carbs','fat','tdee','bmr','bmi','proteinPerMeal',
             'dailyDelta','weeklyChange','projChange','steps','floored','meals'];
for (const goal of GOAL_IDS){
  const a = planFor({ goal, days:4, equip:'gym' });
  const b = planFor({ goal, days:4, equip:'none', avoid:['running','jumping'] });
  const diff = NUM.filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  ok(`${goal}: identical fuel targets with a gym and with nothing`, diff.length === 0,
     diff.map(k => `${k}: ${JSON.stringify(a[k])} vs ${JSON.stringify(b[k])}`).join(', '));
}
/* hydration may move, but only through training volume — reproduce the
   documented formula rather than accepting any drift */
const hydration = [];
for (const goal of GOAL_IDS) for (const equip of LEVELS){
  const p = planFor({ goal, days:4, equip });
  const expect = Math.round((80*35/1000 + p.weeklyMinutes/7*0.012) * 10) / 10;
  if (p.waterL !== expect) hydration.push(`${goal}/${equip}: ${p.waterL} vs ${expect}`);
}
ok('waterL tracks weeklyMinutes and nothing else', hydration.length === 0,
   hydration.join(' | '));
const floorCheck = planFor({ goal:'lose', days:3, equip:'none', w:42, h:150, age:70, sex:'f' });
ok('the 1300 kcal floor still holds under the filter', floorCheck.kcal >= 1300,
   String(floorCheck.kcal));

/* ═══ 8 · the advice matches what the code does ═══ */
console.log('\n── 8 · EQUIP_NOTE no longer promises manual substitution ──');
ok('the bodyweight note does not tell the user to swap moves themselves',
   !/swap barbell and machine moves/i.test(S.EQUIP_NOTE.none), S.EQUIP_NOTE.none);
ok('a note exists for each of the three levels',
   LEVELS.every(l => typeof S.EQUIP_NOTE[l] === 'string' && S.EQUIP_NOTE[l].length > 20));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
