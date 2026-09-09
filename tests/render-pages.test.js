/* Renders the new/changed pages to HTML strings and checks the markup. */
/* read the shipped source with line endings normalised: git's autocrlf
   hands Windows a CRLF working copy, and every pattern here matches on \n */
const fs = require('fs'), vm = require('vm');
const js = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n')
             .match(/<script>\n([\s\S]*)\n<\/script>/)[1];
const EX = ['state','pageDetail','pageWeekdays','pagePlanFull','foodZone','setOverride',
            'computePlan','DAY_PATTERNS','freshMeals','repairShapes'];
const defs = js.slice(0, js.indexOf('/* boot */')) + `\n;Object.assign(globalThis,{${EX.join(',')}});\n`;
const fake = { addEventListener(){}, querySelector(){return null}, querySelectorAll(){return[]},
  appendChild(){}, remove(){}, classList:{toggle(){},add(){},remove(){}},
  textContent:'', dataset:{}, style:{} };
const sb = { window:{}, console, matchMedia:()=>({matches:false}),
  document:{ getElementById:()=>fake, createElement:()=>fake, activeElement:null },
  IntersectionObserver: class { observe(){} unobserve(){} },
  addEventListener(){}, setTimeout, clearTimeout, setInterval, clearInterval,
  performance, requestAnimationFrame(){},
  localStorage:{ getItem:()=>null, setItem(){}, removeItem(){} },
  location:{href:'http://x/',protocol:'http:'}, navigator:{} };
sb.globalThis = sb; vm.createContext(sb); vm.runInContext(defs, sb);
const S = sb;

let pass = 0, fail = 0;
const ok = (n, c, e='') => { if (c) { pass++; console.log('  PASS  '+n); }
                             else { fail++; console.log('  FAIL  '+n + (e ? '  -> '+e : '')); } };
function balance(html){
  const n = re => (html.match(re) || []).length;
  return { div:[n(/<div\b/g), n(/<\/div>/g)], button:[n(/<button\b/g), n(/<\/button>/g)],
           span:[n(/<span\b/g), n(/<\/span>/g)], a:[n(/<a\b/g), n(/<\/a>/g)],
           p:[n(/<p\b/g), n(/<\/p>/g)] };
}
function bal(name, h){
  const bad = Object.entries(balance(h)).filter(([, [o,c]]) => o !== c);
  ok(name + ' - tags balanced', bad.length === 0, JSON.stringify(bad));
  const leak = (h.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,40}/) || [''])[0];
  ok(name + ' - no undefined/NaN leaked', !leak, leak);
}

S.state.profile = { goal:'gain', units:'metric', name:'Alex', sex:'m', age:'28', h:'178', w:'77',
  activity:1.55, actLabel:'Moderately active', exp:'intermediate', days:4, equip:'gym' };
S.state.goal = 'gain'; S.state.workoutOverrides = {}; S.state.exSheet = null;
S.state.plan = S.computePlan();

console.log('\n-- pageDetail --');
const arg = { g:'gain', wname: encodeURIComponent('Upper Body Power') };
let h = S.pageDetail(arg); bal('clean detail page', h);
ok('glossary block present (Failure)', h.includes('What the terms mean') && h.includes('Failure'));
ok('Swap control on all 4 slots', (h.match(/data-act="exSwapOpen"/g) || []).length === 4);
ok('sets/reps editor on all 4 slots', (h.match(/data-act="exRepsOpen"/g) || []).length === 4);
ok('demo links on prescribed + arsenal', (h.match(/class="demo"/g) || []).length > 40);
ok('no Reset until something is overridden', !h.includes('data-act="exReset"'));
ok('stale "swap any of these" copy replaced', !h.includes('swap any of these into'));

S.setOverride('Upper Body Power', 0, { exercise:'Incline Dumbbell Press', sets:3, reps:'10' });
h = S.pageDetail(arg); bal('detail page with an override', h);
ok('swapped exercise is shown', h.includes('Incline Dumbbell Press'));
ok('Reset appears for that slot only', (h.match(/data-act="exReset"/g) || []).length === 1);
ok('original line quoted in the note', h.includes('originally <b>Bench Press 4x8</b>'));

S.state.exSheet = { mode:'swap', g:'gain', wname:'Upper Body Power', slot:0, current:'Incline Dumbbell Press' };
h = S.pageDetail(arg); bal('detail page + swap sheet', h);
ok('swap sheet is a real dialog', h.includes('role="dialog"') && h.includes('aria-modal="true"'));
ok('picker lists the arsenal', (h.match(/data-act="exSwapPick"/g) || []).length > 40);

S.state.exSheet = { mode:'reps', g:'gain', wname:'Upper Body Power', slot:0, current:'Bench Press', sets:4, reps:'8' };
h = S.pageDetail(arg); bal('detail page + reps sheet', h);
ok('reuses the .qstep stepper', h.includes('class="qstep"') && h.includes('data-act="exStep"'));
ok('reuses the .qpre presets', h.includes('class="qpre"') && h.includes('data-act="exRepsPreset"'));
ok('save button shows the pending value', h.includes('Save 4×8'));

S.state.exSheet = { mode:'reps', g:'gain', wname:'Upper Body Power', slot:3, current:'Pull-ups', sets:3, reps:'Failure' };
h = S.pageDetail(arg);
ok('steppers disabled for non-numeric reps', (h.match(/data-act="exStep"[^>]*disabled/g) || []).length === 2);
S.state.exSheet = null;

console.log('\n-- pageWeekdays --');
S.state.draft = { days:4, trainingDays:[0,1,3,4] }; S.state.daysEditing = false;
h = S.pageWeekdays(); bal('weekday picker (wizard)', h);
ok('7 day chips', (h.match(/data-act="toggleDay"/g) || []).length === 7);
ok('4 pre-selected from the default pattern', (h.match(/class="daychip on"/g) || []).length === 4);
ok('Continue enabled at the right count', !/data-act="weekdaysNext"[^>]*disabled/.test(h));
ok('numbered step 6 of 7', h.includes('step 6 of 7'));

S.state.draft = { days:4, trainingDays:[0,1] };
h = S.pageWeekdays();
ok('Continue disabled at the wrong count', /data-act="weekdaysNext"[^>]*disabled/.test(h));
ok('says how many are selected', h.includes('Pick 4 — you have 2 selected.'));

S.state.draft = { days:4, trainingDays:[1,3,5,6] }; S.state.daysEditing = true;
h = S.pageWeekdays(); bal('weekday picker (edit mode)', h);
ok('edit mode offers Save + Cancel', h.includes('Save these days') && h.includes('data-act="cancelDays"'));

console.log('\n-- pagePlanFull --');
S.state.daysEditing = false;
h = S.pagePlanFull(); bal('plan page', h);
ok('"Change your days" control present', h.includes('data-act="editDays"') && h.includes('Change your days'));
ok('shows the current training days', /Currently Mon · Tue · Thu · Fri/.test(h),
   (h.match(/Currently[^<]*/) || [''])[0]);

console.log('\n-- foodZone empty state --');
S.state.meals = S.freshMeals(); S.state.customFoods = []; S.state.recents = []; S.state.favorites = [];
S.state.foodView = 'browse'; S.state.foodCat = 'All'; S.state.sheet = null; S.state.customDraftName = '';
S.state.foodQuery = 'chili dog';
h = S.foodZone(); bal('food zone, zero results', h);
ok('CTA quotes the typed term', h.includes('Add “chili dog” as a custom food'));
ok('CTA wired to the prefill action', h.includes('data-act="addCustomFromSearch"'));
S.state.foodQuery = '<img src=x onerror=alert(1)>';
ok('search term is escaped in the empty state', S.foodZone().includes('&lt;img'));
S.state.foodQuery = ''; S.state.foodView = 'custom'; S.state.customDraftName = 'chili dog';
h = S.foodZone();
ok('custom form prefills the name field', /id="cfName"[^>]*value="chili dog"/.test(h));

console.log(`\n${'='.repeat(48)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(48)}`);
process.exit(fail ? 1 : 0);
