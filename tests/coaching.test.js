/* Adaptive coaching, phases 1–5, driven against the REAL functions out of
   index.html under a stubbed DOM with a frozen clock.

   Today is fixed at Wed 17 Jun 2026 10:30 local. Every date-sensitive function
   reads `new Date()` or Date.now(), and both come from a FakeDate installed in
   the sandbox, so the arithmetic is deterministic regardless of when this
   runs. String-level proof only: no browser, nothing painted. */
/* read the shipped source with line endings normalised: git's autocrlf
   hands Windows a CRLF working copy, and every pattern here matches on \n */
const fs = require('fs'), vm = require('vm');
const HTML = require('path').join(__dirname, '..', 'index.html');
const js = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n').match(/<script>\n([\s\S]*)\n<\/script>/)[1];

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  PASS  ' + n); }
                               else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const EX = ['state','isoDay','fromIso','daysBetween','todayIso','rolloverDay','logWeight','weightTrend',
            'trendSeries','adaptiveModel','recalibrate','adaptiveKcal','targetSource','targetKcal',
            'effectiveTargets','kcalGoal','todayBurn','coachNotes','coachTick','intakeStats','intakeDays',
            'periodDaysSoFar','repairShapes','resetState','computePlan','freshMeals','totals',
            'pageNutrition','pageCalories','pagePlanFull','pageMenu','macroEditor','saveMacrosFromForm',
            'ADAPT','TREND_WINDOW','durableSlice','DURABLE','weighPrompt','targetCard','netCard',
            'weightTrendCard','fmtWeight','fmtDelta','sparkline','addDays','startOfDay'];

function makeEnv(){
  const FIXED = new Date(2026, 5, 17, 10, 30, 0).getTime();
  const fake = () => ({ addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
                        appendChild(){}, remove(){}, classList:{ toggle(){}, add(){}, remove(){} },
                        textContent:'', dataset:{}, style:{}, innerHTML:'' });
  const inputs = {};
  const cur = { querySelector(sel){ const id = sel.replace('#',''); return id in inputs ? inputs[id] : (sel === '.wrap' ? fake() : null); },
                querySelectorAll(){ return []; }, addEventListener(){} };
  const sb = {
    window:{}, console, matchMedia:()=>({matches:false}),
    document:{ getElementById:()=>fake(), createElement:()=>fake(), activeElement:null, addEventListener(){} },
    IntersectionObserver: class { observe(){} unobserve(){} },
    addEventListener(){}, setTimeout, clearTimeout, setInterval, clearInterval, performance,
    requestAnimationFrame(){},
    localStorage:{ getItem:()=>null, setItem(){}, removeItem(){} },
    location:{ href:'http://x/', origin:'http://x', pathname:'/', protocol:'http:' }, navigator:{},
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  /* freeze the clock INSIDE the sandbox, before the app script evaluates */
  vm.runInContext(`
    const __FIXED = ${FIXED};
    class FakeDate extends Date {
      constructor(...a){ super(...(a.length ? a : [__FIXED])); }
      static now(){ return __FIXED; }
    }
    globalThis.Date = FakeDate;
  `, sb);
  vm.runInContext(js.slice(0, js.indexOf('/* boot */'))
    + '\n;Object.assign(globalThis,{' + EX.join(',')
    + ',__setCurrent:(c)=>{current=c;},__stubRefresh:()=>{refresh=()=>{};},__noop:()=>{}});\n', sb);
  sb.__setCurrent(cur); sb.__stubRefresh();
  return { sb, inputs };
}
const profile = (o = {}) => ({ goal:'lose', units:'metric', name:'Alex', sex:'m', age:'30', h:'178', w:'80',
  activity:1.55, actLabel:'Moderately active', exp:'intermediate', days:4, equip:'gym',
  trainingDays:[0,2,4,6], ...o });
function withPlan(sb, o){ sb.state.profile = profile(o); sb.state.goal = sb.state.profile.goal; sb.state.plan = sb.computePlan(); return sb.state.plan; }
/* 'YYYY-MM-DD' n days before the frozen today */
const dayN = (sb, n) => sb.isoDay(sb.addDays(new sb.Date(), -n));
/* seed a window: intake every day for `days` completed days, weight linear from w0 to w1 across `wdays` */
function seed(sb, { days, kcal, w0, w1, wdays = days, every = 1, skipFood = () => false }){
  for (let n = days; n >= 1; n--) if (!skipFood(n)) sb.state.intakeLog.push({ date: dayN(sb, n), kcal, p:150, c:200, f:60, n:3 });
  for (let n = wdays; n >= 1; n--) if ((wdays - n) % every === 0){
    const t = (wdays - n) / Math.max(wdays - 1, 1);
    sb.state.weighIns.push({ date: dayN(sb, n), kg: Math.round((w0 + (w1 - w0) * t) * 100) / 100 });
  }
  sb.state.intakeLog.sort((a, b) => a.date < b.date ? -1 : 1);
  sb.state.weighIns.sort((a, b) => a.date < b.date ? -1 : 1);
}
/* re-seed the 42 days behind an arbitrary `today` — simulating a later week
   means the data has to keep arriving, or the anchor guard rightly refuses */
function reseedAt(sb, today, { kcal, w0, w1 }){
  sb.state.intakeLog = []; sb.state.weighIns = [];
  for (let n = 42; n >= 1; n--){
    const d = sb.isoDay(sb.addDays(today, -n));
    if (n <= 28) sb.state.intakeLog.push({ date:d, kcal, p:150, c:200, f:60, n:3 });
    const t = (42 - n) / 41;
    sb.state.weighIns.push({ date:d, kg: Math.round((w0 + (w1 - w0) * t) * 100) / 100 });
  }
}
const bal = (name, h) => {
  const n = re => (h.match(re) || []).length;
  const bad = [['div', /<div\b/g, /<\/div>/g], ['span', /<span\b/g, /<\/span>/g], ['p', /<p\b/g, /<\/p>/g],
               ['button', /<button\b/g, /<\/button>/g], ['svg', /<svg\b/g, /<\/svg>/g]]
    .filter(([, o, c]) => n(o) !== n(c)).map(x => x[0]);
  ok(name + ': tags balanced', !bad.length, bad.join(','));
  const leak = (h.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,40}/) || [''])[0];
  ok(name + ': no undefined/NaN leaked', !leak, leak);
};

console.log('\n== A. local-day helpers ==');
{
  const { sb } = makeEnv();
  ok('frozen clock: today is 2026-06-17', sb.todayIso() === '2026-06-17', sb.todayIso());
  ok('isoDay/fromIso round-trip', sb.isoDay(sb.fromIso('2026-02-28')) === '2026-02-28');
  ok('daysBetween across the US spring-forward day is still whole days',
     sb.daysBetween(sb.fromIso('2026-03-07'), sb.fromIso('2026-03-09')) === 2);
  ok('daysBetween across the autumn fall-back day too',
     sb.daysBetween(sb.fromIso('2026-10-31'), sb.fromIso('2026-11-02')) === 2);
}

console.log('\n== B. PHASE 1 · the diary becomes a history (rolloverDay) ==');
{
  const { sb } = makeEnv();
  sb.state.meals.Breakfast.push({ food:{ name:'Oats', calories:300, p:10, c:50, f:5 }, qty:1 });
  ok('legacy blob (no mealsDate): adopts today, archives nothing', sb.rolloverDay() === false
     && sb.state.mealsDate === '2026-06-17' && sb.state.intakeLog.length === 0 && sb.state.meals.Breakfast.length === 1);
  ok('same day: no-op', sb.rolloverDay() === false && sb.state.meals.Breakfast.length === 1);
}
{
  const { sb } = makeEnv();
  sb.state.mealsDate = '2026-06-16';
  sb.state.meals.Lunch.push({ food:{ name:'Rice', calories:400, p:8, c:80, f:2 }, qty:1.5 });
  const r = sb.rolloverDay();
  ok('next day: archived under YESTERDAY, diary reset, returns true',
     r === true && sb.state.intakeLog.length === 1 && sb.state.intakeLog[0].date === '2026-06-16'
     && sb.state.mealsDate === '2026-06-17' && sb.state.meals.Lunch.length === 0);
  ok('archived totals are the day\'s totals', sb.state.intakeLog[0].kcal === 600 && sb.state.intakeLog[0].n === 1,
     JSON.stringify(sb.state.intakeLog[0]));
}
{
  const { sb } = makeEnv();
  sb.state.mealsDate = '2026-06-10';                                /* a week-old EMPTY diary */
  ok('empty stale diary: reset, but NOT archived (absence = not logged)',
     sb.rolloverDay() === true && sb.state.intakeLog.length === 0 && sb.state.mealsDate === '2026-06-17');
}
{
  const { sb } = makeEnv();
  sb.state.intakeLog.push({ date:'2026-06-16', kcal:1, p:0, c:0, f:0, n:1 });
  sb.state.mealsDate = '2026-06-16';
  sb.state.meals.Dinner.push({ food:{ name:'X', calories:900, p:0, c:0, f:0 }, qty:1 });
  sb.rolloverDay();
  ok('re-archiving a date replaces rather than duplicates', sb.state.intakeLog.length === 1 && sb.state.intakeLog[0].kcal === 900);
}

console.log('\n== B. PHASE 1 · weight: units, smoothing, series ==');
{
  const { sb } = makeEnv();
  ok('rejects nonsense', sb.logWeight('abc') === false && sb.logWeight(5) === false && sb.state.weighIns.length === 0);
  ok('accepts a real reading (metric, stored in kg)', sb.logWeight('80.26') === true && sb.state.weighIns[0].kg === 80.3);
  ok('second reading the same day replaces, not appends', sb.logWeight(81) && sb.state.weighIns.length === 1 && sb.state.weighIns[0].kg === 81);
  ok('a single reading IS the trend', near(sb.weightTrend('2026-06-17'), 81, 0.001));
}
{
  const { sb } = makeEnv();
  withPlan(sb, { units:'imp', w:'176' });
  ok('imperial input converts to kg canonically', sb.logWeight(176.4) && near(sb.state.weighIns[0].kg, 80.0, 0.05), String(sb.state.weighIns[0].kg));
  ok('and displays back in lb', /^176\.\d lb$/.test(sb.fmtWeight(sb.state.weighIns[0].kg)), sb.fmtWeight(sb.state.weighIns[0].kg));
  ok('deltas display in lb with a sign', sb.fmtDelta(-0.5) === '−1.1 lb' && sb.fmtDelta(0.5) === '+1.1 lb', sb.fmtDelta(-0.5));
}
{
  /* the point of the trend: noise in, signal out */
  const { sb } = makeEnv();
  for (let n = 14; n >= 1; n--) sb.state.weighIns.push({ date: dayN(sb, n), kg: 80 + (n % 2 ? 1 : -1) });   /* 81,79,81,79… */
  const t = sb.weightTrend(dayN(sb, 1));
  ok('alternating ±1 kg readings smooth to within 0.35 kg of the real 80', near(t, 80, 0.35), String(t));
  const series = sb.trendSeries(14, dayN(sb, 1));
  const settled = series.slice(-7);                 /* after a week the average has history behind it */
  const rawSwing = Math.max(...settled.map(x => x.raw)) - Math.min(...settled.map(x => x.raw));
  const trendSwing = Math.max(...settled.map(x => x.trend)) - Math.min(...settled.map(x => x.trend));
  ok('once settled, the trend swing is a fraction of the raw swing', rawSwing === 2 && trendSwing < 0.7, `raw ${rawSwing} trend ${trendSwing.toFixed(2)}`);
  ok('series carries raw readings alongside', series.every(x => x.raw !== null) && series.length === 14);
}
{
  const { sb } = makeEnv();
  seed(sb, { days:28, kcal:2000, w0:82, w1:80 });
  const s = sb.trendSeries(28, dayN(sb, 1));
  ok('a real decline shows as a decline in the trend', s[s.length - 1].trend < s[0].trend - 1.2, `${s[0].trend.toFixed(2)} → ${s[s.length-1].trend.toFixed(2)}`);
  ok('days with no reading still get a trend (no gaps in the line)',
     (() => { const { sb: e } = makeEnv(); seed(e, { days:14, kcal:1, w0:80, w1:80, every:3 });
              const q = e.trendSeries(14, dayN(e, 1)); return q.length === 14 && q.some(x => x.raw === null); })());
}

console.log('\n== C. PHASE 2 · adaptiveModel says what the data supports ==');
{
  const { sb } = makeEnv();
  ok('no plan → noplan', sb.adaptiveModel().status === 'noplan');
  withPlan(sb);
  const m0 = sb.adaptiveModel();
  ok('plan but no data → learning, 14 days needed', m0.status === 'learning' && m0.needDays === 14, JSON.stringify(m0));
}
{
  const { sb } = makeEnv(); withPlan(sb);
  seed(sb, { days:10, kcal:2000, w0:80, w1:80 });
  const m = sb.adaptiveModel();
  ok('10 days of data → still learning, says how many more', m.status === 'learning' && m.needDays === 4, JSON.stringify(m));
  ok('and the TARGET is untouched (formula)', sb.targetSource() === 'formula' && sb.targetKcal() === sb.state.plan.kcal);
}
{
  const { sb } = makeEnv(); withPlan(sb);
  seed(sb, { days:28, kcal:2000, w0:80, w1:79, skipFood: n => n % 4 !== 0 });   /* 7 of 28 days logged */
  const m = sb.adaptiveModel();
  ok('7/28 food days → sparse-food, target held', m.status === 'sparse-food' && m.loggedDays === 7 && m.needLogged === 20
     && sb.recalibrate() === false && sb.state.adaptive.tdee === null, JSON.stringify(m));
}
{
  const { sb } = makeEnv(); withPlan(sb);
  seed(sb, { days:28, kcal:2000, w0:80, w1:79, wdays:28, every:28 });   /* one weigh-in, at the start */
  const m = sb.adaptiveModel();
  ok('too few weigh-ins → sparse-weight, target held', m.status === 'sparse-weight' && sb.recalibrate() === false, JSON.stringify(m));
}
{
  const { sb } = makeEnv(); withPlan(sb);
  /* 4 weigh-ins, but all in the first week: the END of the window is unanchored */
  seed(sb, { days:28, kcal:2000, w0:80, w1:80 });
  sb.state.weighIns = sb.state.weighIns.filter(w => w.date <= dayN(sb, 21));
  const m = sb.adaptiveModel();
  ok('weigh-ins that don\'t reach the end of the window → sparse-weight (late anchor missing)',
     m.status === 'sparse-weight' && m.late === false, JSON.stringify(m));
}
{
  /* the inference itself. 2,000 kcal/day, trend falls 1 kg over the 28-day
     window (readings extend 14 days before it so the lag is equal at both
     ends) → expenditure ≈ 2000 + 7700/28 ≈ 2275 */
  const { sb } = makeEnv(); withPlan(sb);
  seed(sb, { days:28, kcal:2000, w0:80.5, w1:79, wdays:42 });
  const m = sb.adaptiveModel();
  ok('enough overlapping data → ready', m.status === 'ready' && m.windowDays === 28 && m.loggedDays === 28, JSON.stringify(m));
  ok('trend change over the window ≈ −1.0 kg', near(m.changeKg, -1.0, 0.08), m.changeKg.toFixed(3));
  ok('estimated expenditure ≈ 2,275 kcal', near(m.rawTdee, 2275, 30), String(m.rawTdee));
  ok('the window ends yesterday, never today', !sb.state.intakeLog.some(e => e.date === '2026-06-17'));
}

console.log('\n== C. PHASE 2 · recalibrate: every guardrail ==');
{
  /* formula says ~2,600 burn; the data says ~3,500. The move must be capped. */
  const { sb } = makeEnv(); const plan = withPlan(sb, { goal:'maintain' });
  seed(sb, { days:28, kcal:3500, w0:80, w1:80, wdays:42 });
  const raw = sb.adaptiveModel().rawTdee;
  ok('precondition: raw estimate is far above the formula', raw - plan.tdee > 600, `raw ${raw} vs ${plan.tdee}`);
  const before = sb.targetKcal();
  ok('first recalibration changes the target', sb.recalibrate() === true);
  ok('…by exactly the step cap, not the whole gap', sb.state.adaptive.tdee === plan.tdee + sb.ADAPT.step, String(sb.state.adaptive.tdee));
  ok('target moved up, and by a bounded amount', sb.targetKcal() > before && sb.targetKcal() - before <= sb.ADAPT.step + 10);
  ok('a plain-language reason is recorded', /averaged 3500 kcal/.test(sb.state.adaptive.lastChange.reason)
     && /held steady/.test(sb.state.adaptive.lastChange.reason), sb.state.adaptive.lastChange.reason);
  ok('same week again → no move (cadence)', sb.recalibrate() === false && sb.state.adaptive.tdee === plan.tdee + sb.ADAPT.step);
  /* a week passes, with a week more of the same data behind it */
  const wk1 = sb.addDays(new sb.Date(), 7);
  reseedAt(sb, wk1, { kcal:3500, w0:80, w1:80 });
  ok('one week later → moves again, still ≤ step', sb.recalibrate(sb.isoDay(wk1)) === true
     && sb.state.adaptive.tdee === plan.tdee + 2 * sb.ADAPT.step);
  /* many weeks with the same extreme data: must hit the drift cap and stop */
  for (let d = 14; d <= 14 + 20 * 7; d += 7){
    const T = sb.addDays(new sb.Date(), d);
    reseedAt(sb, T, { kcal:3500, w0:80, w1:80 });
    sb.recalibrate(sb.isoDay(T));
  }
  ok('after 20 more weeks the estimate is pinned at formula + drift cap, no further',
     sb.state.adaptive.tdee === plan.tdee + sb.ADAPT.drift, String(sb.state.adaptive.tdee));
}
{
  /* blend: a raw estimate INSIDE the step cap still only moves halfway */
  const { sb } = makeEnv(); const plan = withPlan(sb, { goal:'maintain' });
  const kcal = plan.tdee + 100;                        /* steady weight at burn+100 → raw ≈ tdee+100 */
  seed(sb, { days:28, kcal, w0:80, w1:80, wdays:42 });
  sb.recalibrate();
  ok('a +100 raw gap moves the estimate ~+50 (blended), not +100', near(sb.state.adaptive.tdee - plan.tdee, 50, 4), String(sb.state.adaptive.tdee - plan.tdee));
}
{
  /* no oscillation: the raw signal flips sign every week; the estimate must not chase it */
  const { sb } = makeEnv(); const plan = withPlan(sb, { goal:'maintain' });
  const hist = [];
  for (let wk = 0; wk < 8; wk++){
    sb.state.intakeLog = []; sb.state.weighIns = [];
    const today = sb.addDays(new sb.Date(), wk * 7);
    const T = sb.isoDay(today);
    const kcal = wk % 2 ? 3400 : 1400;                  /* alternating wild weeks */
    for (let n = 42; n >= 1; n--){ const dd = sb.isoDay(sb.addDays(today, -n));
      if (n <= 28) sb.state.intakeLog.push({ date:dd, kcal, p:100, c:100, f:50, n:2 });
      sb.state.weighIns.push({ date:dd, kg:80 }); }
    sb.recalibrate(T); hist.push(sb.state.adaptive.tdee);
  }
  const moves = hist.slice(1).map((v, i) => Math.abs(v - hist[i]));
  ok('every weekly move ≤ step cap', moves.every(x => x <= sb.ADAPT.step), moves.join(','));
  ok('estimate stays within the drift band', hist.every(v => Math.abs(v - plan.tdee) <= sb.ADAPT.drift), hist.join(','));
  ok('target never swings more than the cap week to week',
     (() => { let last = null, worst = 0;
       for (const v of hist){ sb.state.adaptive.tdee = v; const t = sb.targetKcal(); if (last !== null) worst = Math.max(worst, Math.abs(t - last)); last = t; }
       return worst <= sb.ADAPT.step + 10; })());
}
{
  /* the 1,300 floor holds even when the data argues for less */
  const { sb } = makeEnv(); withPlan(sb, { goal:'lose', sex:'f', age:'60', h:'150', w:'48', activity:1.2 });
  const plan = sb.state.plan;
  ok('precondition: a small, sedentary profile already sits near the floor', plan.kcal <= 1400, String(plan.kcal));
  seed(sb, { days:28, kcal:1000, w0:48, w1:48.6, wdays:42 });   /* gaining on 1,000 → data says burn ≈ 835 */
  for (let d = 0; d < 70; d += 7) sb.recalibrate(sb.isoDay(sb.addDays(new sb.Date(), d)));
  ok('estimate was pulled down…', sb.state.adaptive.tdee < plan.tdee);
  ok('…but the target never goes below 1,300', sb.targetKcal() === 1300 && sb.adaptiveKcal() === 1300, String(sb.targetKcal()));
}
{
  /* declining the adjustment */
  const { sb } = makeEnv(); const plan = withPlan(sb, { goal:'maintain' });
  seed(sb, { days:28, kcal:3500, w0:80, w1:80, wdays:42 });
  sb.recalibrate();
  ok('adaptive is on by default and in force', sb.targetSource() === 'adaptive' && sb.targetKcal() !== plan.kcal);
  sb.state.adaptive.enabled = false;
  ok('declined → formula target, estimate kept for information', sb.targetSource() === 'formula' && sb.targetKcal() === plan.kcal && sb.state.adaptive.tdee !== null);
  const t = sb.state.adaptive.tdee, wk1 = sb.addDays(new sb.Date(), 7);
  reseedAt(sb, wk1, { kcal:3500, w0:80, w1:80 });
  ok('while declined the estimate keeps learning, but no target change is recorded',
     sb.recalibrate(sb.isoDay(wk1)) === false && sb.state.adaptive.tdee !== t && sb.targetKcal() === plan.kcal);
}

console.log('\n== C. PHASE 2 + 5 · target precedence and macro shape ==');
{
  const { sb } = makeEnv(); const plan = withPlan(sb, { goal:'lose' });
  const f = sb.effectiveTargets();
  ok('formula: identical to the plan', f.source === 'formula' && f.kcal === plan.kcal && f.protein === plan.protein && f.carbs === plan.carbs && f.fat === plan.fat);
  sb.state.adaptive.tdee = plan.tdee + 300;
  const a = sb.effectiveTargets();
  ok('adaptive: kcal from the estimate with the goal\'s adjustment', a.source === 'adaptive' && a.kcal === Math.max(1300, Math.round((plan.tdee + 300) * 0.8 / 10) * 10), String(a.kcal));
  ok('adaptive: protein unchanged (bodyweight-anchored), fat 27%, carbs the remainder',
     a.protein === plan.protein && a.fat === Math.round(a.kcal * 0.27 / 9) && a.carbs === Math.round((a.kcal - a.protein*4 - a.fat*9) / 4));
  sb.state.prefs.macros = { protein:180, carbs:220, fat:70 };
  const m = sb.effectiveTargets();
  ok('manual beats adaptive: kcal is the gram sum', m.source === 'manual' && m.kcal === 180*4 + 220*4 + 70*9 && m.protein === 180);
}

console.log('\n== D. PHASE 3 · net calories ==');
{
  const { sb } = makeEnv(); const plan = withPlan(sb);
  sb.state.done.push({ name:'Run', tag:'Cardio', duration:30, burn:300, completedAt: new sb.Date().toISOString() });
  sb.state.done.push({ name:'Old', tag:'Cardio', duration:30, burn:999, completedAt: sb.addDays(new sb.Date(), -1).toISOString() });
  ok('off by default', sb.state.prefs.netCalories === false);
  ok('off → goal is the base target', sb.kcalGoal() === plan.kcal);
  ok('todayBurn counts only today', sb.todayBurn() === 300);
  sb.state.prefs.netCalories = true;
  ok('on → today\'s burn is added, yesterday\'s is not', sb.kcalGoal() === plan.kcal + 300, String(sb.kcalGoal()));
  const h = sb.netCard();
  ok('the card explains the tradeoff honestly', /way to stall/.test(h) && /estimates/.test(h));
  sb.state.adaptive.tdee = plan.tdee;
  ok('with a measured target it warns about double counting', /count it twice/.test(sb.netCard()));
}

console.log('\n== E. PHASE 4 · nutrition stats ==');
{
  const { sb } = makeEnv(); const plan = withPlan(sb, { goal:'maintain' });
  const T = plan.kcal;
  /* Wed 17 Jun: week started Mon 15. Two archived days this week + today live; one last week. */
  sb.state.intakeLog = [
    { date:'2026-06-12', kcal:T,          p:plan.protein,     c:200, f:60, n:3 },   /* last week */
    { date:'2026-06-15', kcal:T + 50,     p:plan.protein,     c:200, f:60, n:3 },   /* within 10%, protein hit */
    { date:'2026-06-16', kcal:T * 0.8,    p:plan.protein*0.5, c:100, f:40, n:2 },   /* outside, protein miss */
  ];
  sb.state.mealsDate = '2026-06-17';
  sb.state.meals.Breakfast.push({ food:{ name:'X', calories:T, p:plan.protein, c:1, f:1 }, qty:1 });
  const week = sb.intakeStats([sb.fromIso('2026-06-15'), sb.fromIso('2026-06-22')]);
  ok('week: 3 logged days (2 archived + today live)', week.logged === 3, JSON.stringify(week));
  ok('week: within-10% and protein counts', week.within === 2 && week.protein === 2, JSON.stringify(week));
  ok('week: average is the mean of the three', week.kcal === Math.round((T + 50 + T*0.8 + T) / 3));
  const today = sb.intakeStats([sb.fromIso('2026-06-17'), sb.fromIso('2026-06-18')]);
  ok('today: just the live diary', today.logged === 1 && today.kcal === T);
  const all = sb.intakeStats(null);
  ok('career: everything', all.logged === 4);
  ok('periodDaysSoFar: today 1, week 3 (Mon–Wed), month 17', sb.periodDaysSoFar('today') === 1 && sb.periodDaysSoFar('week') === 3 && sb.periodDaysSoFar('month') === 17,
     [sb.periodDaysSoFar('today'), sb.periodDaysSoFar('week'), sb.periodDaysSoFar('month')].join(','));
  sb.state.nutPeriod = 'week';
  const h = sb.pageNutrition();
  bal('Nutrition page (week)', h);
  ok('reports logged-of-elapsed, not a streak', /3 of 3 days/.test(h) && !/streak/i.test(h) && !/fail/i.test(h));
  ok('the period switcher is the Activity Log\'s .seg', /class="seg rv" role="group"/.test(h) && (h.match(/data-act="setNutPeriod"/g) || []).length === 4);
  ok('no red failure state for a day over target', !/var\(--danger\)/.test(h));
}
{
  const { sb } = makeEnv();
  bal('Nutrition page (empty, guest)', sb.pageNutrition());
  ok('empty state points to the tracker', /Open Calorie Tracker/.test(sb.pageNutrition()));
}

console.log('\n== F. safety notes ==');
{
  const { sb } = makeEnv(); withPlan(sb, { goal:'lose' });
  seed(sb, { days:28, kcal:1900, w0:84, w1:78, wdays:42 });     /* ~1 kg/week on ~79 kg ≈ 1.3%/wk; intake NOT under target, so only this note can fire */
  const notes = sb.coachNotes();
  ok('sustained loss > 1%/week → a gentle "faster than recommended" note, not a celebration',
     notes.some(n => /faster than the 0\.5–1%/.test(n)) && !notes.some(n => /great|congrat|amazing/i.test(n)), notes.join(' | '));
}
{
  const { sb } = makeEnv(); withPlan(sb, { goal:'maintain' });
  seed(sb, { days:28, kcal:900, w0:80, w1:80, wdays:42 });      /* logging far under target */
  ok('intake far under target → the "if meals are going unlogged" note', sb.coachNotes().some(n => /unlogged/.test(n)));
}
{
  const { sb } = makeEnv(); withPlan(sb, { goal:'maintain' });
  seed(sb, { days:28, kcal:sb.state.plan.kcal, w0:80, w1:80, wdays:42 });
  ok('on-plan data → no notes', sb.coachNotes().length === 0, JSON.stringify(sb.coachNotes()));
}

console.log('\n== G. repairShapes hardens every new field ==');
{
  const { sb } = makeEnv();
  sb.state.weighIns = [ { date:'2026-06-01', kg:80 }, { date:'2026-06-01', kg:81 }, { date:'bad', kg:80 }, { date:'2026-05-30', kg:'80' },
                        { date:'2026-05-29', kg:5 }, null, 'x', { date:'2026-05-28', kg:79 } ];
  sb.state.intakeLog = [ { date:'2026-06-02', kcal:1, p:1, c:1, f:1, n:1 }, { date:'2026-06-03', kcal:'x', p:1, c:1, f:1, n:1 }, { date:'2026-06-01', kcal:2, p:2, c:2, f:2, n:2 } ];
  sb.state.mealsDate = 'yesterday';
  sb.state.adaptive = 'nope';
  sb.state.prefs = { netCalories:'yes', weighDismissed:42, macros:{ protein:'a', carbs:1, fat:1 } };
  sb.repairShapes();
  ok('weighIns: junk dropped, duplicate date deduped (last wins), sorted ascending',
     sb.state.weighIns.length === 2 && sb.state.weighIns[0].date === '2026-05-28' && sb.state.weighIns[1].kg === 81, JSON.stringify(sb.state.weighIns));
  ok('intakeLog: non-numeric entry dropped, sorted', sb.state.intakeLog.length === 2 && sb.state.intakeLog[0].date === '2026-06-01');
  ok('mealsDate: not a date → null', sb.state.mealsDate === null);
  ok('adaptive: garbage → defaults', JSON.stringify(sb.state.adaptive) === JSON.stringify({ enabled:true, tdee:null, updatedAt:null, lastChange:null }));
  ok('prefs: garbage → defaults, invalid macros → null', sb.state.prefs.netCalories === false && sb.state.prefs.weighDismissed === null && sb.state.prefs.macros === null);
  sb.state.adaptive = { enabled:false, tdee:2100, updatedAt:'2026-06-10', lastChange:{ from:2000, to:2100, at:'2026-06-10', reason:'r' } };
  sb.repairShapes();
  ok('adaptive: a valid record survives intact', sb.state.adaptive.enabled === false && sb.state.adaptive.tdee === 2100 && sb.state.adaptive.lastChange.reason === 'r');
  ok('all five new fields are in the durable slice', ['weighIns','mealsDate','intakeLog','adaptive','prefs'].every(k => sb.DURABLE.includes(k)));
  sb.resetState();
  ok('resetState clears them', sb.state.weighIns.length === 0 && sb.state.intakeLog.length === 0 && sb.state.mealsDate === null && sb.state.adaptive.tdee === null && sb.state.prefs.macros === null);
}

console.log('\n== H. PHASE 5 · gram editor ==');
{
  const { sb, inputs } = makeEnv(); withPlan(sb);
  inputs.mcP = { value:'100' }; inputs.mcC = { value:'100' }; inputs.mcF = { value:'30' };   /* 1,070 kcal */
  const err = { textContent:'' }; inputs.mcErr = err;
  sb.saveMacrosFromForm();
  ok('a sum under 1,300 is rejected with the floor named', sb.state.prefs.macros === null && /1,300 floor/.test(err.textContent), err.textContent);
  inputs.mcP.value = '180'; inputs.mcC.value = '220'; inputs.mcF.value = '70';
  sb.saveMacrosFromForm();
  ok('a valid split saves and takes over the target', sb.state.prefs.macros && sb.state.prefs.macros.protein === 180 && sb.targetSource() === 'manual' && sb.targetKcal() === 2230);
  bal('macro editor (closed, with override)', sb.macroEditor());
  ok('closed editor shows the split and a reset', /P 180 · C 220 · F 70 = 2230 kcal/.test(sb.macroEditor()) && /macroReset/.test(sb.macroEditor()));
  sb.state.macroEditing = true;
  const h = sb.macroEditor();
  bal('macro editor (open)', h);
  ok('open editor prefills the current values and shows the live sum', /value="180"/.test(h) && /2230 kcal/.test(h) && /% protein/.test(h));
  sb.state.prefs.macros = null;
  ok('reset → back to formula', sb.targetSource() === 'formula');
}

console.log('\n== I. surfaces render in every state ==');
{
  const { sb } = makeEnv();
  bal('Calorie Tracker (guest, nothing)', sb.pageCalories());
  ok('guest still gets the weigh-in prompt', /id="wtIn"/.test(sb.pageCalories()));
  ok('guest gets no coaching section without a plan or weigh-ins', !/>Coaching</.test(sb.pageCalories()));
}
{
  const { sb } = makeEnv(); withPlan(sb);
  const h = sb.pageCalories();
  bal('Calorie Tracker (plan, learning)', h);
  ok('learning state is spelled out', /Learning your metabolism/.test(h) && /14 more days/.test(h));
  ok('weigh-in prompt present, once', (h.match(/id="wtIn"/g) || []).length === 1);
  sb.state.prefs.weighDismissed = '2026-06-17';
  ok('dismissed today → no prompt', !/id="wtIn"/.test(sb.pageCalories()));
  sb.state.prefs.weighDismissed = null; sb.logWeight(80);
  ok('weighed today → no prompt either', !/id="wtIn"/.test(sb.pageCalories()));
}
{
  const { sb } = makeEnv(); const plan = withPlan(sb, { goal:'maintain' });
  seed(sb, { days:28, kcal:3500, w0:80, w1:80, wdays:42 });
  sb.recalibrate();
  const h = sb.pageCalories();
  bal('Calorie Tracker (measured)', h);
  ok('target card says Measured, cites both numbers, offers to decline',
     /Measured/.test(h) && new RegExp(String(sb.state.adaptive.tdee)).test(h) && new RegExp('assumed ' + plan.tdee).test(h) && /adaptiveOff/.test(h));
  ok('"What changed" note is present and escaped through escHtml', /What changed:/.test(h) && /so your target moves from/.test(h));
  ok('weight trend card: labelled as a trend, dots + line', /This is a <b>trend<\/b>/.test(h) && /<polyline/.test(h) && /class="raw"/.test(h));
  bal('Plan page (measured)', sb.pagePlanFull());
  ok('plan page: "why this number" now explains measurement, not just Mifflin', /measured, not predicted/.test(sb.pagePlanFull()));
  ok('plan page: disclaimer extended to measured targets', /targets measured from your own data/.test(sb.pagePlanFull()));
  sb.state.adaptive.enabled = false;
  ok('declined → card offers to re-enable', /adaptiveOn/.test(sb.pageCalories()) && /formula target/.test(sb.pageCalories()));
}
{
  const { sb } = makeEnv(); withPlan(sb);
  bal('Plan page (formula)', sb.pagePlanFull());
  ok('plan page (formula) still explains Mifflin and offers the gram editor', /Mifflin-St Jeor\)/.test(sb.pagePlanFull()) && /macroEdit/.test(sb.pagePlanFull()));
  sb.state.prefs.macros = { protein:180, carbs:220, fat:70 };
  bal('Plan page (manual macros)', sb.pagePlanFull());
  ok('plan page (manual) says so', /You set these yourself/.test(sb.pagePlanFull()) && /Your macros/.test(sb.pagePlanFull()));
  bal('Menu (with plan)', sb.pageMenu());
  ok('menu offers Nutrition and quotes the effective target', /data-route="nutrition"/.test(sb.pageMenu()) && /2230 kcal/.test(sb.pageMenu()));
}
{
  const { sb } = makeEnv();
  ok('sparkline: fewer than 2 points draws nothing', sb.sparkline([]) === '' && sb.sparkline([{trend:1,raw:null}]) === '');
  const svg = sb.sparkline([{trend:80,raw:81},{trend:80.2,raw:null},{trend:80.4,raw:79}]);
  ok('sparkline: one polyline, a dot per raw reading', (svg.match(/<polyline/g)||[]).length === 1 && (svg.match(/<circle/g)||[]).length === 2 && /aria-hidden="true"/.test(svg));
}

console.log('\n' + '='.repeat(60) + '\n  ' + pass + ' passed, ' + fail + ' failed\n' + '='.repeat(60));
process.exit(fail ? 1 : 0);
