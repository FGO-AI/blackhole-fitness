/* Activity Log period bucketing. Boundary cases use FIXED calendar dates with
   hand-computed expectations, so nothing here depends on when it's run. */
const fs = require('fs'), vm = require('vm');
/* freeze the clock INSIDE the sandbox before the app script evaluates, so
   nothing here depends on the day it is run — same instant the date-boundary
   tests use: Wed 17 Jun 2026, 14:30 local */
const FIXED_NOW = new Date(2026, 5, 17, 14, 30).getTime();
const FREEZE_CLOCK = 'const __F=' + FIXED_NOW + ';class FakeDate extends Date{constructor(...a){super(...(a.length?a:[__F]))}static now(){return __F}};globalThis.Date=FakeDate;';
const HTML = require('path').join(__dirname, '..', 'index.html');
const js = fs.readFileSync(HTML, 'utf8').match(/<script>\n([\s\S]*)\n<\/script>/)[1];
const EX = ['state','freshMeals','repairShapes','startOfDay','addDays','startOfMonth','addMonths',
            'startOfWeek','doneTime','periodRange','priorRange','inRange','doneStats','pageLog',
            'logDate','LOG_PERIODS'];
const defs = js.slice(0, js.indexOf('/* boot */')) + `\n;Object.assign(globalThis,{${EX.join(',')}});\n`;
const fake = { addEventListener(){}, querySelector(){return null}, querySelectorAll(){return[]},
  appendChild(){}, remove(){}, classList:{toggle(){},add(){},remove(){}}, textContent:'', dataset:{}, style:{} };
const sb = { window:{}, console, matchMedia:()=>({matches:false}),
  document:{ getElementById:()=>fake, createElement:()=>fake, activeElement:null },
  IntersectionObserver: class { observe(){} unobserve(){} },
  addEventListener(){}, setTimeout, clearTimeout, setInterval, clearInterval, performance,
  requestAnimationFrame(){}, localStorage:{ getItem:()=>null, setItem(){}, removeItem(){} },
  location:{href:'http://x/',protocol:'http:'}, navigator:{}, Intl };
sb.globalThis = sb; vm.createContext(sb);
vm.runInContext(FREEZE_CLOCK, sb);
vm.runInContext(defs, sb);
const S = sb;

let pass=0, fail=0;
const ok=(n,c,e='')=>{ if(c){pass++;console.log('  PASS  '+n)} else {fail++;console.log('  FAIL  '+n+(e?'  -> '+e:''))} };

/* a workout completed at a given LOCAL wall-clock time */
const at = (y,mo,d,h=12,mi=0) =>
  ({ name:'Leg Day', duration:55, burn:350, tag:'Strength',
     completedAt: new Date(y,mo,d,h,mi).toISOString() });
const undatedEntry = () => ({ name:'Old Session', duration:40, burn:260, tag:'Cardio' });

const WED = new Date(2026, 5, 17, 14, 30);   // Wed 17 Jun 2026, 2:30pm local

console.log('\n-- 1. Calendar helpers, Monday-first --');
ok('the reference date really is a Wednesday', WED.getDay() === 3, 'getDay='+WED.getDay());
const ws = S.startOfWeek(WED);
ok('week starts Monday', ws.getDay() === 1, 'getDay='+ws.getDay());
ok('week start is Mon 15 Jun', ws.getFullYear()===2026 && ws.getMonth()===5 && ws.getDate()===15,
   ws.toDateString());
ok('week start is local midnight', ws.getHours()===0 && ws.getMinutes()===0);
// Sunday must belong to the week that STARTED the previous Monday
const SUN = new Date(2026, 5, 21, 10, 0);
ok('Sunday really is a Sunday', SUN.getDay() === 0);
const wsSun = S.startOfWeek(SUN);
ok('Sunday belongs to the Mon-15 week (not Sun-first)',
   wsSun.getDate() === 15 && wsSun.getMonth() === 5, wsSun.toDateString());
const MON = new Date(2026, 5, 22, 0, 5);
ok('the next Monday starts a NEW week', S.startOfWeek(MON).getDate() === 22, S.startOfWeek(MON).toDateString());
ok('startOfMonth is the 1st at midnight',
   (m=>m.getDate()===1 && m.getMonth()===5 && m.getHours()===0)(S.startOfMonth(WED)));
ok('addMonths rolls the year over', (m=>m.getFullYear()===2027 && m.getMonth()===0)(S.addMonths(new Date(2026,11,5),1)));
ok('addDays rolls the month over', (d=>d.getMonth()===6 && d.getDate()===1)(S.addDays(new Date(2026,5,30),1)));

console.log('\n-- 2. Range boundaries are half-open [start, end) --');
const [ts,te] = S.periodRange('today', WED);
ok('today starts at local midnight', ts.getDate()===17 && ts.getHours()===0);
ok('today ends at next local midnight', te.getDate()===18 && te.getHours()===0);
const [wsr,wer] = S.periodRange('week', WED);
ok('week is Mon 15 -> Mon 22', wsr.getDate()===15 && wer.getDate()===22);
const [msr,mer] = S.periodRange('month', WED);
ok('month is 1 Jun -> 1 Jul', msr.getMonth()===5 && msr.getDate()===1 && mer.getMonth()===6 && mer.getDate()===1);
ok('career has no range', S.periodRange('career', WED) === null);
const [pts] = S.priorRange('today', WED);  ok('yesterday is the 16th', pts.getDate()===16);
const [pws] = S.priorRange('week', WED);   ok('last week starts Mon 8 Jun', pws.getDate()===8);
const [pms] = S.priorRange('month', WED);  ok('last month starts 1 May', pms.getMonth()===4 && pms.getDate()===1);

console.log('\n-- 3. THE LATE-NIGHT CASE: 23:50 must stay in today --');
{
  const late = at(2026,5,17,23,50);
  const utcDay = late.completedAt.slice(0,10);
  console.log(`        stored UTC instant is ${late.completedAt} (UTC calendar day ${utcDay})`);
  ok('counts as today despite the UTC date', S.inRange(S.periodRange('today', WED))(late));
  ok('does NOT leak into tomorrow',
     !S.inRange(S.periodRange('today', new Date(2026,5,18,9,0)))(late));
  const early = at(2026,5,17,0,10);
  ok('00:10 also counts as today', S.inRange(S.periodRange('today', WED))(early));
  ok('23:59 on the 16th is yesterday, not today',
     !S.inRange(S.periodRange('today', WED))(at(2026,5,16,23,59)) &&
      S.inRange(S.priorRange('today', WED))(at(2026,5,16,23,59)));
}

console.log('\n-- 4. Week and month boundaries --');
{
  const inWeek = S.inRange(S.periodRange('week', WED));
  ok('Mon 15 00:00 is in this week', inWeek(at(2026,5,15,0,0)));
  ok('Sun 21 23:59 is in this week', inWeek(at(2026,5,21,23,59)));
  ok('Sun 14 23:59 is NOT (previous week)', !inWeek(at(2026,5,14,23,59)));
  ok('Mon 22 00:00 is NOT (next week)', !inWeek(at(2026,5,22,0,0)));
  ok('...and Sun 14 lands in last week', S.inRange(S.priorRange('week', WED))(at(2026,5,14,23,59)));

  const inMonth = S.inRange(S.periodRange('month', WED));
  ok('1 Jun 00:00 is in this month', inMonth(at(2026,5,1,0,0)));
  ok('30 Jun 23:59 is in this month', inMonth(at(2026,5,30,23,59)));
  ok('31 May 23:59 is NOT', !inMonth(at(2026,4,31,23,59)));
  ok('1 Jul 00:00 is NOT', !inMonth(at(2026,6,1,0,0)));
  ok('...and 31 May lands in last month', S.inRange(S.priorRange('month', WED))(at(2026,4,31,23,59)));

  // the acceptance case: something done on the 1st, viewed later the same month
  const first = at(2026,5,1,9,0);
  ok('a session on the 1st is still in THIS MONTH on the 17th', inMonth(first));
  ok('...but NOT in this week', !inWeek(first));
  ok('...and NOT in today', !S.inRange(S.periodRange('today', WED))(first));
  ok('...and always in career', S.inRange(null)(first));
}

console.log('\n-- 5. Undated (pre-migration) entries --');
{
  ok('doneTime is null with no field', S.doneTime(undatedEntry()) === null);
  ok('doneTime is null for garbage', S.doneTime({completedAt:'not a date'}) === null);
  ok('doneTime parses a real stamp', typeof S.doneTime(at(2026,5,17)) === 'number');
  const u = undatedEntry();
  ok('excluded from today',  !S.inRange(S.periodRange('today', WED))(u));
  ok('excluded from week',   !S.inRange(S.periodRange('week',  WED))(u));
  ok('excluded from month',  !S.inRange(S.periodRange('month', WED))(u));
  ok('INCLUDED in career',    S.inRange(null)(u));
}

console.log('\n-- 6. repairShapes on legacy / corrupt history --');
{
  const seed = () => { Object.assign(S.state, { meals:S.freshMeals(), recents:[], favorites:[],
    customFoods:[], workoutOverrides:{}, profile:null, plan:null, goal:null }); };
  seed(); S.state.done = [ undatedEntry(), at(2026,5,17), {completedAt:'garbage', burn:1, duration:1, name:'x', tag:'y'} ];
  S.repairShapes();
  ok('unparseable completedAt is dropped, not fabricated',
     S.state.done.length === 3 && !('completedAt' in S.state.done[2]));
  ok('valid stamps are preserved', typeof S.state.done[1].completedAt === 'string');
  ok('absent stamps stay absent', !('completedAt' in S.state.done[0]));

  seed(); S.state.done = [ null, undefined, 'nonsense', at(2026,5,17), undatedEntry() ];
  S.repairShapes();
  ok('non-object entries are removed', S.state.done.length === 2, JSON.stringify(S.state.done.length));
  ok('...and totals still compute without throwing',
     (()=>{ try { S.doneStats(S.inRange(null)); return true; } catch(e){ return false; } })());

  seed(); S.state.done = 'not an array'; S.repairShapes();
  ok('a non-array done is reset', Array.isArray(S.state.done) && S.state.done.length === 0);
}

console.log('\n-- 7. The shared reducer --');
{
  Object.assign(S.state, { meals:S.freshMeals(), recents:[], favorites:[], customFoods:[],
    workoutOverrides:{}, profile:null, plan:null, goal:null });
  S.state.done = [ at(2026,5,17,9), at(2026,5,17,18), at(2026,5,15,7), at(2026,5,2,7),
                   at(2026,4,20,7), undatedEntry() ];
  const st = p => S.doneStats(S.inRange(S.periodRange(p, WED)));
  const today = st('today'), week = st('week'), month = st('month'), career = S.doneStats(S.inRange(null));
  ok('today = 2 sessions',  today.count === 2, JSON.stringify(today));
  ok('week  = 3 sessions',  week.count  === 3, JSON.stringify(week));
  ok('month = 4 sessions',  month.count === 4, JSON.stringify(month));
  ok('career = 6 (incl. the undated one)', career.count === 6, JSON.stringify(career));
  ok('kcal aggregates correctly', today.kcal === 700 && week.kcal === 1050, JSON.stringify({t:today.kcal,w:week.kcal}));
  ok('minutes aggregate correctly', today.minutes === 110 && month.minutes === 220);
  ok('career kcal includes the undated entry', career.kcal === 350*5 + 260, String(career.kcal));
  ok('buckets nest: today <= week <= month <= career',
     today.count <= week.count && week.count <= month.count && month.count <= career.count);
  const prior = S.doneStats(S.inRange(S.priorRange('month', WED)));
  ok('last month = 1 session', prior.count === 1, JSON.stringify(prior));
}

console.log('\n-- 8. pageLog rendering --');
{
  const bal = h => { const n=re=>(h.match(re)||[]).length;
    return n(/<div\b/g)===n(/<\/div>/g) && n(/<button\b/g)===n(/<\/button>/g) &&
           n(/<span\b/g)===n(/<\/span>/g) && n(/<p\b/g)===n(/<\/p>/g); };
  Object.assign(S.state, { meals:S.freshMeals(), recents:[], favorites:[], customFoods:[],
    workoutOverrides:{}, profile:null, plan:null, goal:null });

  S.state.done = []; S.state.logPeriod = 'career';
  let h = S.pageLog();
  ok('empty state unchanged', h.includes('Nothing burned yet') && h.includes('Find a Workout'));
  ok('empty state shows no period switcher', !h.includes('setLogPeriod'));

  // relative to the sandbox's frozen "now": pageLog() still takes the
  // default-argument path through periodRange(), it just gets a fixed answer
  const now = new Date(FIXED_NOW);
  const rel = (dayOffset, h2=12) => { const d = S.addDays(now, dayOffset);
    return { name:'Leg Day', duration:55, burn:350, tag:'Strength',
             completedAt: new Date(d.getFullYear(), d.getMonth(), d.getDate(), h2).toISOString() }; };
  S.state.done = [ rel(0), rel(0), undatedEntry() ];

  S.state.logPeriod = 'career'; h = S.pageLog();
  ok('career: markup balanced', bal(h));
  ok('career: four period buttons', (h.match(/data-act="setLogPeriod"/g)||[]).length === 4);
  ok('career: reuses the .seg pattern', h.includes('class="seg rv"'));
  ok('career: counts the undated entry', /<b>3<\/b><span>Workouts<\/span>/.test(h));
  ok('career: shows the disclosure line', h.includes('logged before dates were tracked'));
  ok('career: no trend arrows', !h.includes('class="trend'));
  ok('career: lists all 3', (h.match(/Leg Day|Old Session/g)||[]).length === 3);

  S.state.logPeriod = 'today'; h = S.pageLog();
  ok('today: markup balanced', bal(h));
  ok('today: counts only the 2 dated-today entries', /<b>2<\/b><span>Workouts<\/span>/.test(h));
  ok('today: undated entry excluded from the list', !h.includes('Old Session'));
  ok('today: NO disclosure line', !h.includes('logged before dates were tracked'));
  ok('today: shows trend arrows', h.includes('class="trend'));
  ok('today: says what it compares against', h.includes('compared with yesterday'));
  ok('today: trend is up vs an empty yesterday', h.includes('▲ +2'));
  ok('today: list item carries a date', /Today · /.test(h));

  S.state.logPeriod = 'week';  h = S.pageLog(); ok('week: compares with last week', h.includes('compared with last week'));
  S.state.logPeriod = 'month'; h = S.pageLog(); ok('month: compares with last month', h.includes('compared with last month'));

  // a period with nothing in it must not look like data loss
  S.state.done = [ rel(-400) ];
  S.state.logPeriod = 'today'; h = S.pageLog();
  ok('empty period keeps the switcher', h.includes('setLogPeriod'));
  ok('empty period reassures rather than implying loss', h.includes('Your history is still here'));
  ok('empty period shows zeros, not the first-run state', /<b>0<\/b><span>Workouts<\/span>/.test(h) && !h.includes('Nothing burned yet'));
  ok('empty period says so in the list area', h.includes('No sessions in this period'));

  // undated-only history
  S.state.done = [ undatedEntry(), undatedEntry() ];
  S.state.logPeriod = 'career'; h = S.pageLog();
  ok('plural disclosure wording', h.includes('2 workouts logged before dates were tracked'));
  S.state.done = [ undatedEntry() ];
  h = S.pageLog();
  ok('singular disclosure wording', h.includes('1 workout logged before dates were tracked'));
}

console.log(`\n${'='.repeat(54)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(54)}`);
process.exit(fail ? 1 : 0);
