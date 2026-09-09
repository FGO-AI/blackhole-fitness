/* Exercises the new workout-customization, glossary and weekday-remap logic
   against the real source in index.html. */
/* read the shipped source with line endings normalised: git's autocrlf
   hands Windows a CRLF working copy, and every pattern here matches on \n */
const fs = require('fs'), vm = require('vm');

const HTML = require('path').join(__dirname, '..', 'index.html');
const js = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n').match(/<script>\n([\s\S]*)\n<\/script>/)[1];
const EXPORTS = ['FOOD_DB','GOALS','ALL_FOODS','state','freshMeals','repairShapes','DURABLE',
                 'WORKOUTS_SPECIALIZED','EXERCISE_DB','DAY_PATTERNS','DAYNAMES','SPLIT_TEMPLATES',
                 'parseSetLine','parseSpec','resolveSlot','setOverride','clearOverride','ovSlot',
                 'findWorkout','glossaryFor','PROTOCOL_GLOSSARY','demoUrl','computePlan',
                 'durableSlice','loadState','saveLocal','CAT_LABEL','escHtml'];
const defs = js.slice(0, js.indexOf('/* boot */'))
           + `\n;Object.assign(globalThis, { ${EXPORTS.join(', ')} });\n`;

const fakeEl = { addEventListener(){}, querySelector(){return null}, querySelectorAll(){return []},
  appendChild(){}, remove(){}, classList:{toggle(){},add(){},remove(){}},
  textContent:'', dataset:{}, style:{} };
const store = {};
const sandbox = { window:{}, console, matchMedia:()=>({matches:false}),
  document:{ getElementById:()=>fakeEl, createElement:()=>fakeEl, activeElement:null },
  IntersectionObserver: class { observe(){} unobserve(){} },
  addEventListener(){}, setTimeout, clearTimeout, setInterval, clearInterval,
  performance, requestAnimationFrame(){},
  localStorage:{ getItem:k=>(k in store?store[k]:null), setItem:(k,v)=>{store[k]=String(v)},
                 removeItem:k=>{delete store[k]} },
  location:{href:'http://x/',protocol:'http:'}, navigator:{} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(defs, sandbox, { filename:'app-defs.js' });
const S = sandbox;

let pass=0, fail=0;
const ok=(n,c,e='')=>{ if(c){pass++;console.log('  PASS  '+n)} else {fail++;console.log('  FAIL  '+n+(e?'  → '+e:''))} };

// every prescribed line and arsenal spec in the whole dataset
const allLines=[], allWorkouts=[];
for (const g of Object.keys(S.WORKOUTS_SPECIALIZED))
  for (const cat of Object.values(S.WORKOUTS_SPECIALIZED[g]))
    for (const w of cat){ allWorkouts.push(w); w.sets.forEach(l=>allLines.push(l)); }
const allSpecs=[];
for (const arr of Object.values(S.EXERCISE_DB)) for (const x of arr) allSpecs.push(x.s);

console.log('\n── #4a · "Max" rename ──');
ok('no xMax notation anywhere', !allLines.some(l=>/x\s*Max\b/i.test(l)) && !allSpecs.some(s=>/x\s*Max\b/i.test(s)));
ok('"3x Failure" is present', allLines.some(l=>/3x Failure/.test(l)));
ok('unrelated "VO2 Max Intervals" untouched', allSpecs.length && Object.values(S.EXERCISE_DB).flat().some(x=>x.n==='VO2 Max Intervals'));
ok('AMRAP rep targets untouched', allSpecs.some(s=>/AMRAP/.test(s)));

console.log('\n── #1/#4b · parsing the real dataset (no crashes, sane splits) ──');
let parsed=0, unparsed=0, bad=[];
for (const l of allLines){
  let r; try { r = S.parseSetLine(l); } catch(e){ bad.push(l+' → '+e.message); continue; }
  if (r.sets != null){
    parsed++;
    if (!(r.sets>0) || !r.reps || !r.name) bad.push(`${l} → ${JSON.stringify(r)}`);
  } else unparsed++;
}
ok('parseSetLine never throws on real data', bad.length===0, bad.slice(0,3).join(' | '));
console.log(`        ${parsed} lines carry sets×reps, ${unparsed} are free-text (rendered as-is)`);
ok('a good share of lines are editable', parsed > 100, String(parsed));
const cases = [
  ['Bench Press 4x8',                 {name:'Bench Press', sets:4, reps:'8', suffix:''}],
  ['Bulgarian Split Squat 3x8 each',  {name:'Bulgarian Split Squat', sets:3, reps:'8', suffix:' each'}],
  ['Pull-ups 3x Failure',             {name:'Pull-ups', sets:3, reps:'Failure', suffix:''}],
  ['Plank 3x45-60s',                  {name:'Plank', sets:3, reps:'45-60s', suffix:''}],
  ['Rest 30s',                        {sets:null}],
  ['Sprint up stairs',                {sets:null}],
  ['Jump squats x20',                 {sets:null}],
  ['20s all-out / 10s rest x8 rounds',{sets:null}],
];
for (const [inp, exp] of cases){
  const r = S.parseSetLine(inp);
  const good = Object.entries(exp).every(([k,v]) => r[k] === v);
  ok(`parse: ${inp}`, good, JSON.stringify(r));
}
let specBad=[];
for (const sp of allSpecs){ const r=S.parseSpec(sp); if(!(r.sets>0)||!r.reps) specBad.push(sp+' → '+JSON.stringify(r)); }
ok('parseSpec always yields usable sets/reps', specBad.length===0, specBad.slice(0,3).join(' | '));
ok('parseSpec 4x6-8', S.parseSpec('4x6-8').sets===4 && S.parseSpec('4x6-8').reps==='6-8');
ok('parseSpec 3xAMRAP', S.parseSpec('3xAMRAP').reps==='AMRAP');
ok('parseSpec falls back on "2-3min"', S.parseSpec('2-3min').sets===3 && S.parseSpec('2-3min').reps==='10');

console.log('\n── #1 · swap / reset round trip ──');
S.state.workoutOverrides = {};
const w = S.findWorkout('gain','Upper Body Power');
ok('findWorkout locates the workout', !!w);
ok('slot 3 is the renamed line', w.sets[3] === 'Pull-ups 3x Failure', w.sets[3]);
let r0 = S.resolveSlot(w,0);
ok('slot 0 resolves to the prescribed exercise', r0.name==='Bench Press' && r0.sets===4 && r0.reps==='8' && !r0.overridden);
S.setOverride('Upper Body Power', 0, { exercise:'Incline Dumbbell Press', sets:3, reps:'10' });
let r1 = S.resolveSlot(w,0);
ok('after swap, name changes', r1.name==='Incline Dumbbell Press', r1.name);
ok('after swap, sets/reps come from the arsenal spec', r1.sets===3 && r1.reps==='10');
ok('slot is flagged overridden', r1.overridden && r1.swapped);
ok('original line still recoverable for the reset note', r1.base.name==='Bench Press');
ok('other slots unaffected', S.resolveSlot(w,1).name==='Barbell Row' && !S.resolveSlot(w,1).overridden);
S.setOverride('Upper Body Power', 0, { sets:5, reps:'12' });
let r2 = S.resolveSlot(w,0);
ok('sets/reps edit keeps the swapped exercise', r2.name==='Incline Dumbbell Press' && r2.sets===5 && r2.reps==='12');
S.clearOverride('Upper Body Power', 0);
ok('reset restores the original completely', (()=>{const r=S.resolveSlot(w,0);
  return r.name==='Bench Press'&&r.sets===4&&r.reps==='8'&&!r.overridden})());
ok('empty workout entry is pruned', S.state.workoutOverrides['Upper Body Power']===undefined);
// sets/reps edit with no swap
S.setOverride('Upper Body Power', 2, { sets:5, reps:'5' });
const r3 = S.resolveSlot(w,2);
ok('edit-only keeps the original exercise', r3.name==='Overhead Press' && r3.sets===5 && r3.reps==='5' && r3.overridden && !r3.swapped);

console.log('\n── #1 · overrides persist (durable slice → JSON → reload) ──');
ok('workoutOverrides is in DURABLE', S.DURABLE.includes('workoutOverrides'));
const slice = S.durableSlice();
ok('present in the saved slice', slice.workoutOverrides && slice.workoutOverrides['Upper Body Power']);
const rehydrated = JSON.parse(JSON.stringify(slice));
S.state.workoutOverrides = {};                        // simulate a fresh page
ok('cleared before reload', S.resolveSlot(w,2).sets===3);
for (const k of S.DURABLE) if (rehydrated[k] != null) S.state[k] = rehydrated[k];
S.repairShapes();
ok('survives a refresh', (()=>{const r=S.resolveSlot(w,2); return r.sets===5&&r.reps==='5'&&r.overridden})());
// keys come back as strings from JSON — resolveSlot must still find them
ok('numeric slot keys survive JSON round trip', S.ovSlot('Upper Body Power', 2) !== null);
// older blob with no workoutOverrides at all
delete S.state.workoutOverrides; S.repairShapes();
ok('older blob without the field is repaired', S.state.workoutOverrides && typeof S.state.workoutOverrides==='object');
S.state.workoutOverrides = 'corrupt'; S.repairShapes();
ok('corrupt value is repaired', S.state.workoutOverrides && !Array.isArray(S.state.workoutOverrides));

console.log('\n── #2a · glossary coverage ──');
const REQUIRED = ['Tabata','HIIT','EMOM','AMRAP','Fartlek','Pyramid','Ladder','Tempo','Circuit','Intervals'];
for (const term of REQUIRED)
  ok(`glossary defines ${term}`, S.PROTOCOL_GLOSSARY.some(([t])=>t===term));
// note: `re instanceof RegExp` is false across vm realms — duck-type instead
ok('every entry has a plain-English sentence',
   S.PROTOCOL_GLOSSARY.every(([t,re,def]) => typeof def==='string' && def.length>40 && typeof re.test==='function'));
const tab = S.findWorkout('lose','Tabata Pyramid');
const tabG = S.glossaryFor(tab).map(([t])=>t);
ok('Tabata Pyramid surfaces both Tabata and Pyramid', tabG.includes('Tabata')&&tabG.includes('Pyramid'), tabG.join(','));
ok('Upper Body Power surfaces Failure (from the rename)', S.glossaryFor(w).map(([t])=>t).includes('Failure'));
const hiit = S.findWorkout('lose','HIIT Circuit');
ok('HIIT Circuit surfaces HIIT and Circuit', (()=>{const t=S.glossaryFor(hiit).map(x=>x[0]);
  return t.includes('HIIT')&&t.includes('Circuit')})());
let covered = allWorkouts.filter(x=>S.glossaryFor(x).length).length;
console.log(`        ${covered} of ${allWorkouts.length} workouts show at least one definition`);
ok('no workout throws in glossaryFor', (()=>{try{allWorkouts.forEach(S.glossaryFor);return true}catch(e){return false}})());

console.log('\n── #2b · demo links ──');
const u = S.demoUrl('Bulgarian Split Squat');
ok('points at a YouTube search', u.startsWith('https://www.youtube.com/results?search_query='));
ok('query is encoded and includes "exercise form"', u.includes('Bulgarian%20Split%20Squat%20exercise%20form'), u);
// apostrophes stay literal in a query string (valid), and escHtml round-trips
// them exactly when the URL is placed in the href attribute
ok('spaces and quotes are encoded', !/[ "]/.test(S.demoUrl(`Farmer's Walk "heavy"`).split('=')[1]));
ok("apostrophe survives escHtml -> browser decode",
   (u => S.escHtml(u).replace(/&#39;/g, "'") === u)(S.demoUrl("Child's Pose")));
ok('names with punctuation still yield a valid URL',
   (() => { try { new URL(S.demoUrl(`Farmer's Walk "heavy" & more`)); return true; } catch { return false; } })());

console.log('\n── #5 · weekday remap ──');
const baseProfile = { goal:'gain', units:'metric', name:'Alex', sex:'m', age:'28', h:'178', w:'77',
  activity:1.55, actLabel:'Moderately active', exp:'intermediate', days:4, equip:'gym' };
const catsOf  = pl => pl.schedule.filter(s=>!s.rest).map(s=>s.cat);
const daysOf  = pl => pl.schedule.filter(s=>!s.rest).map(s=>s.day);

S.state.profile = { ...baseProfile };                       // no trainingDays (legacy)
const legacy = S.computePlan();
ok('legacy profile uses DAY_PATTERNS[4]',
   JSON.stringify(daysOf(legacy)) === JSON.stringify(S.DAY_PATTERNS[4].map(i=>S.DAYNAMES[i])),
   daysOf(legacy).join(','));

S.state.profile = { ...baseProfile, trainingDays:[1,3,5,6] };   // Tue/Thu/Sat/Sun
const moved = S.computePlan();
ok('focus-area sequence is IDENTICAL after remap',
   JSON.stringify(catsOf(moved)) === JSON.stringify(catsOf(legacy)),
   `${catsOf(legacy).join(',')}  vs  ${catsOf(moved).join(',')}`);
ok('only the weekdays changed',
   JSON.stringify(daysOf(moved)) === JSON.stringify(['Tue','Thu','Sat','Sun']), daysOf(moved).join(','));
ok('still 4 sessions + 3 rest days',
   moved.schedule.filter(s=>!s.rest).length===4 && moved.schedule.filter(s=>s.rest).length===3);
ok('weekly volume unchanged', moved.weeklyMinutes===legacy.weeklyMinutes && moved.weeklyBurn===legacy.weeklyBurn);
ok('calories unchanged', moved.kcal===legacy.kcal);

S.state.profile = { ...baseProfile, trainingDays:[6,1,5,3] };   // unsorted input
const unsorted = S.computePlan();
ok('unsorted selection is normalised to calendar order',
   JSON.stringify(daysOf(unsorted)) === JSON.stringify(['Tue','Thu','Sat','Sun']), daysOf(unsorted).join(','));
ok('unsorted still gives the same cat sequence',
   JSON.stringify(catsOf(unsorted)) === JSON.stringify(catsOf(legacy)));

S.state.profile = { ...baseProfile, trainingDays:[0,2] };       // wrong length → fallback
const mismatch = S.computePlan();
ok('length mismatch falls back to the default pattern',
   JSON.stringify(daysOf(mismatch)) === JSON.stringify(daysOf(legacy)), daysOf(mismatch).join(','));

for (const n of [3,4,5,6]){
  S.state.profile = { ...baseProfile, days:n };
  const def = S.computePlan();
  const custom = [...S.DAY_PATTERNS[n]].map(i=>(i+2)%7).sort((a,b)=>a-b);
  S.state.profile = { ...baseProfile, days:n, trainingDays:custom };
  const cus = S.computePlan();
  ok(`${n} days/week: sequence preserved under remap`,
     JSON.stringify(catsOf(cus))===JSON.stringify(catsOf(def)),
     `${catsOf(def).join(',')} vs ${catsOf(cus).join(',')}`);
  ok(`${n} days/week: lands on the chosen weekdays`,
     JSON.stringify(daysOf(cus))===JSON.stringify(custom.map(i=>S.DAYNAMES[i])), daysOf(cus).join(','));
}

console.log(`\n${'='.repeat(52)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(52)}`);
process.exit(fail?1:0);
