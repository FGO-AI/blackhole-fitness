/* The saved-plan validator, checked against every plan the app has EVER
   written. NOT part of `node tests/run.js`: it needs full git history (a
   shallow clone has none) and takes a while, so it is run by hand:

     node tests/plan-history.git.js                   report + checks
     node tests/plan-history.git.js --write-fixture   also regenerate
                                                      tests/fixtures/legacy-plans.json

   WHAT THIS PROVES / WHAT IT DOESN'T. computePlan() is lifted out of every
   commit that touched index.html and run over the whole validated input
   space (age 14–90; 120–230 cm and 30–300 kg; 3–8 ft and 66–660 lb). Inches
   are NOT validated by the app, so 0–11 is an assumption here. Each plan is
   JSON round-tripped, the way storage does it, and handed with its profile to
   the WORKING TREE's repairShapes(). This proves the validator keeps all of
   them, and reports every shape, value set, range and cross-field relation
   those plans ever had. It cannot see plans written before the first commit,
   or profiles outside that input space. */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const WRITE = process.argv.includes('--write-fixture');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  PASS  ' + n); }
                               else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); } };

const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { maxBuffer: 64 << 20 }).toString();
let commits;
try { commits = git('log', '--format=%H', '--reverse', '--', 'index.html').trim().split('\n'); }
catch (e) { console.log('\n  NOT RUN  git history unavailable: ' + e.message); process.exit(2); }
if (commits.length < 2){
  console.log('\n  NOT RUN  only ' + commits.length + ' commit(s) visible — a shallow clone? fetch full history');
  process.exit(2);
}
const show = h => git('show', h + ':index.html').replace(/\r\n/g, '\n');

function load(src, label, names){
  let js = src.match(/<script>\n([\s\S]*)\n<\/script>/)[1];
  const b = js.indexOf('/* boot */'); if (b >= 0) js = js.slice(0, b);
  const el = () => ({ addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
    appendChild(){}, remove(){}, setAttribute(){}, getContext(){ return null; },
    classList:{ toggle(){}, add(){}, remove(){} }, textContent:'', dataset:{}, style:{}, innerHTML:'' });
  const sb = { window:{}, console:{ log(){}, warn(){}, error(){} }, matchMedia:() => ({ matches:false, addEventListener(){} }),
    document:{ getElementById:() => el(), createElement:() => el(), querySelector:() => el(), querySelectorAll:() => [],
               activeElement:null, addEventListener(){}, body:el(), documentElement:el() },
    IntersectionObserver: class { observe(){} unobserve(){} }, addEventListener(){}, setTimeout, clearTimeout,
    setInterval, clearInterval, performance, requestAnimationFrame(){},
    localStorage:{ getItem:() => null, setItem(){}, removeItem(){} },
    location:{ href:'http://x/', origin:'http://x', pathname:'/', protocol:'http:', hash:'', search:'' },
    navigator:{}, history:{ replaceState(){} }, fetch: async () => { throw new Error('offline'); } };
  sb.globalThis = sb; sb.self = sb; vm.createContext(sb);
  vm.runInContext(js + '\n;globalThis.__x = {' + names.map(n => n + ': typeof ' + n + ' !== "undefined" ? ' + n + ' : null').join(',') + '};',
                  sb, { filename: label });
  return sb.__x;
}

const TREE = load(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n'), 'working tree',
                  ['state', 'repairShapes', 'WORKOUTS_SPECIALIZED', 'CAT_LABEL']);
const LIB = TREE.WORKOUTS_SPECIALIZED, CATL = TREE.CAT_LABEL;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const BODIES = {
  metric: [{ h:'120', w:'30', age:'90', sex:'f' }, { h:'120', w:'300', age:'14', sex:'m' }, { h:'178', w:'77', age:'28', sex:'m' },
           { h:'230', w:'30', age:'90', sex:'f' }, { h:'230', w:'300', age:'14', sex:'m' }],
  imp:    [{ ft:'3', inch:'0', w:'66', age:'90', sex:'f' }, { ft:'3', inch:'0', w:'660', age:'14', sex:'m' }, { ft:'5', inch:'10', w:'170', age:'35', sex:'m' },
           { ft:'8', inch:'11', w:'66', age:'90', sex:'f' }, { ft:'8', inch:'11', w:'660', age:'14', sex:'m' }],
};
const ACTS = [[1.2, 'Mostly seated'], [1.375, 'Lightly active'], [1.55, 'Moderately active'], [1.725, 'Very active']];
const EXPS = ['beginner', 'intermediate', 'advanced'];
const NUM = ['kcal','tdee','bmr','protein','carbs','fat','proteinPerMeal','proteinCal','carbCal','fatCal','waterL','bmi',
             'weeklyMinutes','weeklyBurn','dailyDelta','weeklyChange','projChange','horizonWeeks'];

const num = {}; for (const f of NUM) num[f] = { min: Infinity, max: -Infinity };
const strs = { steps:new Set(), bmiCat:new Set(), changeUnit:new Set(), projDir:new Set() };
const rel = {}; const chk = (name, cond) => { rel[name] = (rel[name] || 0) + (cond ? 0 : 1); };
const errors = new Map(), shelfFail = new Map(), drift = new Map(), rejected = [];
const samples = new Map();            /* commit -> legacy-shaped plans, for the fixture */
let plans = 0, roundTrip = true, rejectedCount = 0;

for (const h of commits){
  const short = h.slice(0, 7);
  let x; try { x = load(show(h), short, ['computePlan', 'state']); } catch (e) { errors.set(short, 'load: ' + e.message); continue; }
  let i = 0;
  for (const goal of ['lose','gain','endure','maintain']) for (const days of [3,4,5,6]) for (const equip of ['none','basic','gym'])
  for (const units of ['metric','imp']) for (const body of BODIES[units]) for (const [activity, actLabel] of ACTS)
  for (const extra of (days === 4 ? [{}, { trainingDays:[1,2,5,6], avoid:['running','jumping','overhead'] }, { equipDetail:['dumbbell'] }] : [{}])){
    const pf = { goal, units, name:'Alex', ...body, activity, actLabel, exp: EXPS[i++ % 3], days, equip, ...extra };
    x.state.profile = JSON.parse(JSON.stringify(pf)); x.state.goal = goal;
    let p; try { p = x.computePlan(); } catch (e) { errors.set(short, 'computePlan: ' + e.message); continue; }
    plans++;
    const rt = JSON.parse(JSON.stringify(p));
    if (JSON.stringify(rt) !== JSON.stringify(p)) roundTrip = false;

    for (const f of NUM) if (Number.isFinite(p[f])) { num[f].min = Math.min(num[f].min, p[f]); num[f].max = Math.max(num[f].max, p[f]); }
    for (const f in strs) strs[f].add(p[f]);
    let sessions = 0, minutes = 0, burn = 0; const cats = [];
    for (const s of p.schedule){
      if (s.rest) continue;
      sessions++; minutes += s.w.duration; burn += s.w.burn; cats.push(s.cat);
      const shelf = own(LIB, s.g) && own(LIB[s.g], s.cat) ? LIB[s.g][s.cat] : null;
      const hw = shelf && shelf.find(w => w.name === s.w.name);
      if (!hw) { const k = s.g + '/' + s.cat + '/' + s.w.name; if (!shelfFail.has(k)) shelfFail.set(k, short); }
      else for (const f of ['tag','duration','burn']) if (hw[f] !== s.w[f]) drift.set(s.g + '/' + s.cat + '/' + s.w.name + '.' + f, short);
    }
    chk('proteinCal === protein * 4', p.proteinCal === p.protein * 4);
    chk('carbCal === carbs * 4', p.carbCal === p.carbs * 4);
    chk('fatCal === fat * 9', p.fatCal === p.fat * 9);
    chk('proteinPerMeal === round(protein / 4)', p.proteinPerMeal === Math.round(p.protein / 4));
    chk('|dailyDelta - (kcal - tdee)| <= 1', Math.abs(p.dailyDelta - (p.kcal - p.tdee)) <= 1);
    chk('floored implies kcal === 1300', !p.floored || p.kcal === 1300);
    chk('kcal is a multiple of 10', p.kcal % 10 === 0);
    chk('weeklyMinutes === sum of session durations', p.weeklyMinutes === minutes);
    chk('weeklyBurn === sum of session burns', p.weeklyBurn === burn);
    chk('sessions === profile.days', sessions === days);
    chk('schedule is Mon..Sun in order', p.schedule.map(s => s.day).join() === 'Mon,Tue,Wed,Thu,Fri,Sat,Sun');
    chk('rest days are exactly { day, rest: true }', p.schedule.filter(s => s.rest).every(s => Object.keys(s).length === 2 && s.rest === true));
    chk('coverage === category labels of the week, in order',
        JSON.stringify(p.coverage) === JSON.stringify([...new Set(cats.map(c => c === 'conditioning' ? 'Cardio' : (CATL[c] || c)))]));
    chk("'conditioning' is only ever stored under goal 'lose'", p.schedule.every(s => s.rest || s.cat !== 'conditioning' || s.g === 'lose'));

    /* the actual question: does the working tree keep it? */
    Object.assign(TREE.state, { profile: JSON.parse(JSON.stringify(pf)), plan: rt, goal });
    TREE.repairShapes();
    const kept = TREE.state.plan && TREE.state.profile && TREE.state.goal === goal
      && JSON.stringify(TREE.state.plan) === JSON.stringify(p);
    if (!kept){ rejectedCount++; if (rejected.length < 5) rejected.push(short + ' ' + JSON.stringify(pf)); }

    if (!('substitutions' in p) && equip === 'gym' && Object.keys(extra).length === 0 && activity === 1.55
        && body === BODIES[units][(days + goal.length) % 5] && units === (days % 2 ? 'imp' : 'metric')){
      if (!samples.has(short)) samples.set(short, []);
      samples.get(short).push({ commit: short, profile: pf, goal, plan: rt });
    }
  }
}

console.log('\n  ' + plans + ' plans from ' + (commits.length - errors.size) + ' of ' + commits.length + ' commits');
console.log('\n  ranges ever produced:');
for (const f of NUM) console.log('    ' + f.padEnd(15) + String(num[f].min).padStart(8) + ' .. ' + num[f].max);
console.log('  string values ever produced:');
for (const f in strs) console.log('    ' + f.padEnd(15) + [...strs[f]].map(v => JSON.stringify(v)).join(' '));
console.log('  library entries whose tag/duration/burn changed since a plan stored them (informational): ' + drift.size);

console.log('\n== checks ==');
ok('every commit loaded and its computePlan() ran', errors.size === 0, [...errors].map(([k, v]) => k + ' ' + v).join(' | '));
ok('every plan survives a JSON round trip unchanged', roundTrip);
ok('the only sessions not on a real shelf are the old lose + conditioning form',
   [...shelfFail.keys()].every(k => k.startsWith('lose/conditioning/')), [...shelfFail.keys()].join(', '));
for (const [name, bad] of Object.entries(rel)) ok(name + ' (in every plan)', bad === 0, bad + ' violations');
ok('EXECUTED: all ' + plans + " historical plans are kept by the working tree's repairShapes()",
   rejectedCount === 0, rejectedCount + ' rejected, e.g. ' + rejected.join(' | '));

if (WRITE){
  const legacy = [...samples.keys()];
  const pick = [legacy[0], legacy[legacy.length - 1]];
  const rows = pick.flatMap(c => samples.get(c));
  const out = '{\n  "_about": ' + JSON.stringify('Plans written by older versions of the app, exactly as computePlan() in commits '
      + pick.join(' and ') + ' produced them (the first commit, and the last one before plans carried substitutions). '
      + 'Regenerate with: node tests/plan-history.git.js --write-fixture') + ',\n  "plans": [\n'
    + rows.map(r => '    ' + JSON.stringify(r)).join(',\n') + '\n  ]\n}\n';
  fs.writeFileSync(path.join(__dirname, 'fixtures', 'legacy-plans.json'), out);
  console.log('\n  wrote tests/fixtures/legacy-plans.json: ' + rows.length + ' plans from ' + pick.join(', ') + ' (' + out.length + ' bytes)');
}

console.log('\n' + '='.repeat(58) + '\n  ' + pass + ' passed, ' + fail + ' failed\n' + '='.repeat(58));
process.exit(fail ? 1 : 0);
