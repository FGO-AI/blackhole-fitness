/* Calorie Tracker: quick add, water, and managing custom foods — driven
   against the REAL functions out of index.html under a stubbed DOM with a
   frozen clock (Wed 17 Jun 2026 10:30 local).

   Buttons are exercised through the real runAction() dispatcher with a stub
   element carrying the same data-* attributes the markup writes. That proves
   the WIRING from an action name to its state change; nothing is clicked or
   painted. Rendered markup is checked as a string. */
const fs = require('fs'), vm = require('vm');
const HTML = require('path').join(__dirname, '..', 'index.html');
const js = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n').match(/<script>\n([\s\S]*)\n<\/script>/)[1];

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  PASS  ' + n); }
                               else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); } };

const EX = ['state','runAction','foodZone','rolloverDay','coachTick','repairShapes','resetState','DURABLE',
            'totals','addWater','waterTargetMl','fmtWater','waterSteps','computePlan','adaptiveModel',
            'isoDay','addDays','intakeDays','intakeStats','MAX_WATER_ML','MAX_FOOD_TEXT','ML_PER_FLOZ',
            'durableSlice','freshMeals'];

function makeEnv(){
  const FIXED = new Date(2026, 5, 17, 10, 30, 0).getTime();
  const inputs = {};                                   /* id -> {value} */
  const errs = { cfErr:{ textContent:'' }, qaErr:{ textContent:'' }, waterErr:{ textContent:'' } };
  const zoneEl = { innerHTML:'' };
  const fake = () => ({ addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
                        appendChild(){}, remove(){}, classList:{ toggle(){}, add(){}, remove(){} },
                        textContent:'', dataset:{}, style:{}, innerHTML:'' });
  const cur = {
    querySelector(sel){
      const id = sel.replace('#','');
      if (id in errs) return errs[id];
      /* present so refreshFoodOnly() re-renders in place rather than calling the router */
      if (id === 'foodzone') return zoneEl;
      return id in inputs ? inputs[id] : null;
    },
    querySelectorAll(){ return []; }, addEventListener(){},
  };
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
    + ',__setCurrent:(c)=>{current=c;},__stubRefresh:()=>{refresh=()=>{};}});\n', sb);
  sb.__setCurrent(cur); sb.__stubRefresh();
  /* every scenario starts on a diary that belongs to today */
  sb.state.mealsDate = '2026-06-17';
  const act = (act, data = {}) => sb.runAction({ dataset:{ act, ...data }, textContent:'', style:{} }, cur);
  return { sb, inputs, errs, zoneEl, act };
}
const profile = (o = {}) => ({ goal:'lose', units:'metric', name:'Alex', sex:'m', age:'30', h:'178', w:'80',
  activity:1.55, actLabel:'Moderately active', exp:'intermediate', days:4, equip:'gym',
  trainingDays:[0,2,4,6], ...o });
function withPlan(sb, o){ sb.state.profile = profile(o); sb.state.goal = sb.state.profile.goal; sb.state.plan = sb.computePlan(); return sb.state.plan; }
const bal = (name, h) => {
  const n = re => (h.match(re) || []).length;
  const bad = [['div', /<div\b/g, /<\/div>/g], ['span', /<span\b/g, /<\/span>/g], ['p', /<p\b/g, /<\/p>/g],
               ['button', /<button\b/g, /<\/button>/g]]
    .filter(([, o, c]) => n(o) !== n(c)).map(x => x[0]);
  ok(name + ': tags balanced (string check)', !bad.length, bad.join(','));
  const leak = (h.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,40}/) || [''])[0];
  ok(name + ': no undefined/NaN leaked', !leak, leak);
};
const CANARY = '<img src=x onerror=alert(1)>';
const lasagna = () => ({ name:'Mom lasagna', srv:'1 slice', calories:600, p:25, c:60, f:28, cat:'Custom', custom:true });

console.log('\n== A. water: adding, taking back, bounds ==');
{
  const { sb, act } = makeEnv();
  act('addWater', { ml:'250' }); act('addWater', { ml:'500' });
  ok('two taps via runAction add up to 750 ml', sb.state.water === 750, sb.state.water);
  act('addWater', { ml:'-250' });
  ok('take-back subtracts', sb.state.water === 500);
  act('addWater', { ml:'-250' }); act('addWater', { ml:'-250' }); act('addWater', { ml:'-250' });
  ok('never goes below zero', sb.state.water === 0, sb.state.water);
  sb.state.water = sb.MAX_WATER_ML - 100; act('addWater', { ml:'500' });
  ok('capped at the daily ceiling', sb.state.water === sb.MAX_WATER_ML, sb.state.water);
  sb.state.water = 0; act('addWater', { ml:'abc' }); act('addWater', { ml:'0' });
  ok('a non-number or zero amount changes nothing', sb.state.water === 0);
}
{
  const { sb, inputs, errs, act } = makeEnv();
  inputs.waterIn = { value:'330' }; act('addWaterCustom');
  ok('custom amount (metric) is taken as ml', sb.state.water === 330, sb.state.water);
  inputs.waterIn = { value:'-5' }; act('addWaterCustom');
  ok('negative custom amount refused with a message', sb.state.water === 330 && /Enter an amount/.test(errs.waterErr.textContent));
  errs.waterErr.textContent = ''; inputs.waterIn = { value:'99999' }; act('addWaterCustom');
  ok('oversized custom amount refused', sb.state.water === 330 && errs.waterErr.textContent !== '');
}
{
  const { sb, inputs, act } = makeEnv();
  withPlan(sb); sb.state.profile.units = 'imp';
  inputs.waterIn = { value:'8' }; act('addWaterCustom');
  ok('imperial custom amount is fl oz, stored as ml (8 fl oz ≈ 237 ml)', sb.state.water === 237, sb.state.water);
  ok('imperial display is fl oz', sb.fmtWater(sb.state.water) === '8 fl oz', sb.fmtWater(sb.state.water));
  ok('imperial quick steps are 8 and 16 fl oz', JSON.stringify(sb.waterSteps().map(x => x[1])) === '["8 fl oz","16 fl oz"]');
}
{
  const { sb } = makeEnv();
  ok('no plan: target falls back to 2.5 L', sb.waterTargetMl() === 2500);
  const p = withPlan(sb);
  ok('with a plan: target is the plan\'s waterL', sb.waterTargetMl() === Math.round(p.waterL * 1000), sb.waterTargetMl() + ' vs ' + p.waterL);
  ok('metric display is litres', sb.fmtWater(1250) === '1.25 L' && sb.fmtWater(2000) === '2 L' && sb.fmtWater(0) === '0 L',
     [sb.fmtWater(1250), sb.fmtWater(2000), sb.fmtWater(0)].join(' | '));
}

console.log('\n== B. water at rollover: kept only on a day that logged food ==');
{
  const { sb } = makeEnv();
  sb.state.mealsDate = '2026-06-16';
  sb.state.meals.Lunch.push({ food:{ name:'Rice', srv:'1 cup', calories:400, p:8, c:80, f:2 }, qty:1 });
  sb.state.water = 1800;
  sb.rolloverDay();
  const row = sb.state.intakeLog[0];
  ok('food + water day: water archived on that day\'s intakeLog row', row && row.date === '2026-06-16' && row.water === 1800, JSON.stringify(row));
  ok('today starts with zero water', sb.state.water === 0);
}
{
  const { sb } = makeEnv();
  sb.state.mealsDate = '2026-06-16';
  sb.state.water = 2200;                                  /* water only, no food */
  sb.rolloverDay();
  ok('water-only day: NO intakeLog row is written', sb.state.intakeLog.length === 0, JSON.stringify(sb.state.intakeLog));
  ok('water-only day: water still resets for today', sb.state.water === 0 && sb.state.mealsDate === '2026-06-17');
}
{
  const { sb } = makeEnv();
  sb.state.mealsDate = '2026-06-16';
  sb.state.meals.Dinner.push({ food:{ name:'X', srv:'1', calories:900, p:0, c:0, f:0 }, qty:1 });
  sb.rolloverDay();
  ok('food day with no water: row has no water field', !('water' in sb.state.intakeLog[0]));
}
{
  const { sb, act } = makeEnv();
  sb.state.mealsDate = '2026-06-16';                      /* the diary is yesterday's */
  sb.state.meals.Snack.push({ food:{ name:'Y', srv:'1', calories:200, p:0, c:0, f:0 }, qty:1 });
  sb.state.water = 600;
  act('addWater', { ml:'250' });
  ok('adding water after midnight archives yesterday\'s water first, then counts today',
     sb.state.intakeLog[0].water === 600 && sb.state.water === 250, JSON.stringify(sb.state.intakeLog) + ' / ' + sb.state.water);
}
{
  /* the reason water-only days are dropped: a row is a logged food day */
  const { sb } = makeEnv();
  withPlan(sb);
  const seedDays = (water) => {
    sb.state.intakeLog = []; sb.state.weighIns = []; sb.state.adaptive.updatedAt = null;
    for (let n = 28; n >= 1; n--){
      const d = sb.isoDay(sb.addDays(new sb.Date(), -n));        /* sb.Date is the frozen FakeDate */
      const row = { date:d, kcal:2000, p:150, c:200, f:60, n:3 };
      if (water) row.water = 2500;
      sb.state.intakeLog.push(row);
      sb.state.weighIns.push({ date:d, kg: 80 - (28 - n) * 0.02 });
    }
  };
  seedDays(false); const a = sb.adaptiveModel();
  seedDays(true);  const b = sb.adaptiveModel();
  ok('a water field on rows does not change the measured TDEE (pure model, same inputs)',
     a.status === 'ready' && b.status === 'ready' && a.rawTdee === b.rawTdee && a.loggedDays === b.loggedDays,
     JSON.stringify([a.status, a.rawTdee, b.status, b.rawTdee]));
}

console.log('\n== C. water persistence and repair ==');
{
  const { sb } = makeEnv();
  ok('water is in the durable slice', sb.DURABLE.includes('water') && 'water' in sb.durableSlice());
  for (const bad of ['500', -1, NaN, Infinity, 1e9, null, {}]){
    sb.state.water = bad; sb.repairShapes();
    if (sb.state.water !== 0) { ok('repair: bad water ' + String(bad) + ' -> 0', false, sb.state.water); }
  }
  ok('repair: string / negative / NaN / huge / null / object water all become 0', sb.state.water === 0);
  sb.state.water = 742.6; sb.repairShapes();
  ok('repair: a valid fractional total is kept, rounded', sb.state.water === 743);
  sb.state.intakeLog = [{ date:'2026-06-15', kcal:2000, p:1, c:1, f:1, n:2, water:'lots' },
                        { date:'2026-06-16', kcal:1800, p:1, c:1, f:1, n:2, water:1500 }];
  sb.repairShapes();
  ok('repair: a bad water value is dropped but the day\'s food row is kept',
     sb.state.intakeLog.length === 2 && !('water' in sb.state.intakeLog[0]) && sb.state.intakeLog[0].kcal === 2000);
  ok('repair: a good water value survives', sb.state.intakeLog[1].water === 1500);
  sb.state.water = 900; sb.resetState();
  ok('resetState ("Clear my data") zeroes water', sb.state.water === 0);
}

console.log('\n== D. quick add ==');
{
  const { sb, inputs, act } = makeEnv();
  sb.state.activeMeal = 'Lunch';
  Object.assign(inputs, { qaKcal:{ value:'450' }, qaLabel:{ value:'Office cake' }, qaP:{ value:'5' }, qaC:{ value:'' }, qaF:{ value:'20' } });
  act('quickAddSave');
  const e = sb.state.meals.Lunch[0];
  ok('quick add logs one entry into the active meal', sb.state.meals.Lunch.length === 1 && e.qty === 1);
  ok('entry carries the label, kcal and macros (blank carbs = 0)',
     e.food.name === 'Office cake' && e.food.calories === 450 && e.food.p === 5 && e.food.c === 0 && e.food.f === 20 && e.food.quick === true,
     JSON.stringify(e.food));
  ok('totals include it', sb.totals().kcal === 450);
  ok('quick add is not pushed to recents', sb.state.recents.length === 0);
  ok('form closes back to browse', sb.state.foodView === 'browse');
  const h = sb.foodZone();
  ok('diary row reads "Quick add" instead of a serving', /Office cake[\s\S]*?Quick add · P 5 · C 0 · F 20/.test(h));
  bal('food zone with a quick-add entry', h);
}
{
  const { sb, inputs, errs, act } = makeEnv();
  Object.assign(inputs, { qaKcal:{ value:'300' }, qaLabel:{ value:'' } });
  act('quickAddSave');
  ok('blank label defaults to "Quick add"', sb.state.meals.Breakfast[0].food.name === 'Quick add');
  sb.state.meals.Breakfast = [];
  for (const [kcal, why] of [['', 'empty'], ['0', 'zero'], ['-50', 'negative'], ['5001', 'over 5000'], ['abc', 'non-number']]){
    errs.qaErr.textContent = ''; inputs.qaKcal = { value:kcal }; act('quickAddSave');
    if (sb.state.meals.Breakfast.length || !errs.qaErr.textContent) ok('kcal ' + why + ' refused', false);
  }
  ok('kcal empty / 0 / negative / >5000 / non-number all refused with a message', sb.state.meals.Breakfast.length === 0);
  inputs.qaKcal = { value:'200' }; inputs.qaP = { value:'-3' }; errs.qaErr.textContent = ''; act('quickAddSave');
  ok('negative macro refused', sb.state.meals.Breakfast.length === 0 && /Macros/.test(errs.qaErr.textContent));
  inputs.qaP = { value:'' }; inputs.qaLabel = { value:CANARY }; errs.qaErr.textContent = ''; act('quickAddSave');
  ok('label with < or > refused at the gate (canary never stored)', sb.state.meals.Breakfast.length === 0 && /label/i.test(errs.qaErr.textContent));
  inputs.qaLabel = { value:'x'.repeat(sb.MAX_FOOD_TEXT + 1) }; errs.qaErr.textContent = ''; act('quickAddSave');
  ok('over-long label refused, not truncated', sb.state.meals.Breakfast.length === 0 && /characters/.test(errs.qaErr.textContent));
}
{
  const { sb } = makeEnv();
  /* straight into state, past the gate — what a synced blob could hold */
  sb.state.meals.Snack.push({ food:{ name:CANARY, srv:'quick add', calories:100, p:0, c:0, f:0, quick:true }, qty:1 });
  const h = sb.foodZone();
  ok('a hostile quick-add label already in state renders escaped', !h.includes(CANARY) && h.includes('&lt;img src=x'));
}
{
  const { sb, inputs, act } = makeEnv();
  sb.state.mealsDate = '2026-06-16';
  sb.state.meals.Dinner.push({ food:{ name:'Old', srv:'1', calories:700, p:0, c:0, f:0 }, qty:1 });
  Object.assign(inputs, { qaKcal:{ value:'150' } });
  act('quickAddSave');
  ok('quick add after midnight lands in TODAY, yesterday archived intact',
     sb.state.intakeLog.length === 1 && sb.state.intakeLog[0].kcal === 700 && sb.totals().kcal === 150);
}
{
  const { sb, act } = makeEnv();
  act('setFoodView', { view:'quick' });
  const h = sb.foodZone();
  ok('quick view renders the form with meal tabs', h.includes('id="qaKcal"') && h.includes('data-act="quickAddSave"') && h.includes('data-act="setMeal"'));
  bal('quick add form', h);
  act('setFoodView', { view:'browse' });
  ok('browse view offers both "+ Create custom food" and "+ Quick add calories"',
     /data-view="custom"/.test(sb.foodZone()) && /data-view="quick"/.test(sb.foodZone()));
}

console.log('\n== E. managing custom foods ==');
{
  const { sb, act } = makeEnv();
  sb.state.customFoods = [lasagna()];
  sb.state.foodCat = 'Custom';
  let h = sb.foodZone();
  ok('Custom tab rows carry Edit and Delete', h.includes('data-act="editCustom"') && h.includes('data-act="delCustom"'));
  bal('custom tab with manage rows', h);
  sb.state.foodCat = 'All';
  ok('All tab rows do not', !sb.foodZone().includes('data-act="editCustom"'));
  sb.state.foodCat = 'Custom'; sb.state.foodQuery = 'lasag';
  ok('search results do not', !sb.foodZone().includes('data-act="editCustom"'));
}
{
  const { sb, inputs, act } = makeEnv();
  const orig = lasagna();
  sb.state.customFoods = [{ name:'Soup', srv:'1 bowl', calories:200, p:5, c:20, f:8, cat:'Custom', custom:true }, orig];
  sb.state.recents = [orig]; sb.state.favorites = [orig];
  sb.state.meals.Dinner.push({ food:orig, qty:2 });         /* already eaten */
  sb.state.foodCat = 'Custom';
  act('editCustom', { fname: encodeURIComponent('Mom lasagna') });
  ok('Edit opens the form in edit mode', sb.state.foodView === 'custom' && sb.state.customEdit === 'Mom lasagna');
  const h = sb.foodZone();
  ok('form is prefilled from the food', h.includes('value="1 slice"') && h.includes('value="600"') && h.includes('value="Mom lasagna"'));
  ok('button says "Save changes"', h.includes('Save changes'));
  bal('custom edit form', h);
  Object.assign(inputs, { cfName:{ value:'Mom lasagna (big)' }, cfSrv:{ value:'1 big slice' }, cfCal:{ value:'800' },
                          cfP:{ value:'30' }, cfC:{ value:'80' }, cfF:{ value:'35' } });
  act('saveCustom');
  const names = sb.state.customFoods.map(x => x.name);
  ok('edit replaces in place (order kept, no duplicate)', JSON.stringify(names) === '["Soup","Mom lasagna (big)"]', JSON.stringify(names));
  ok('edited values stored', sb.state.customFoods[1].calories === 800 && sb.state.customFoods[1].srv === '1 big slice');
  ok('recents and favorites follow the edit', sb.state.recents[0].name === 'Mom lasagna (big)' && sb.state.favorites[0].calories === 800);
  ok('the already-logged entry is untouched', sb.state.meals.Dinner[0].food.name === 'Mom lasagna' && sb.totals().kcal === 1200);
  ok('saving an edit returns to the Custom tab without opening the log sheet',
     sb.state.foodView === 'browse' && sb.state.foodCat === 'Custom' && sb.state.sheet === null && sb.state.customEdit === null);
}
{
  const { sb, inputs, errs, act } = makeEnv();
  sb.state.customFoods = [lasagna()];
  act('editCustom', { fname: encodeURIComponent('Mom lasagna') });
  Object.assign(inputs, { cfName:{ value:CANARY }, cfSrv:{ value:'1' }, cfCal:{ value:'100' } });
  act('saveCustom');
  ok('editing is held to the same < > gate', sb.state.customFoods[0].name === 'Mom lasagna' && /< or >/.test(errs.cfErr.textContent));
}
{
  const { sb } = makeEnv();
  /* a hostile custom food already in state, opened for edit */
  sb.state.customFoods = [{ name:CANARY, srv:'"><script>x</script>', calories:1, p:0, c:0, f:0, cat:'Custom', custom:true }];
  sb.state.customEdit = CANARY; sb.state.foodView = 'custom';
  const h = sb.foodZone();
  ok('edit prefill escapes name and serving in value=""', !h.includes(CANARY) && !h.includes('"><script>') && h.includes('&quot;&gt;&lt;script&gt;'));
  sb.state.foodView = 'browse'; sb.state.foodCat = 'Custom';
  const h2 = sb.foodZone();
  ok('manage-row aria-labels escape the name', !h2.includes(CANARY) && h2.includes('aria-label="Edit &lt;img'));
}
{
  const { sb, inputs, act } = makeEnv();
  const a = lasagna(), b = { name:'Soup', srv:'1 bowl', calories:200, p:5, c:20, f:8, cat:'Custom', custom:true };
  sb.state.customFoods = [a, b]; sb.state.recents = [a, b];
  act('editCustom', { fname: encodeURIComponent('Mom lasagna') });
  Object.assign(inputs, { cfName:{ value:'Soup' }, cfSrv:{ value:'1 bowl' }, cfCal:{ value:'250' } });
  act('saveCustom');
  ok('renaming onto another custom food\'s name leaves one food, listed once in recents',
     sb.state.customFoods.length === 1 && sb.state.customFoods[0].calories === 250
     && sb.state.recents.length === 1 && sb.state.recents[0].calories === 250,
     JSON.stringify(sb.state.recents.map(x => [x.name, x.calories])));
}
{
  const { sb, act } = makeEnv();
  const orig = lasagna();
  sb.state.customFoods = [orig]; sb.state.recents = [orig]; sb.state.favorites = [orig];
  sb.state.meals.Lunch.push({ food:orig, qty:1 });
  sb.state.foodCat = 'Custom';
  const del = () => act('delCustom', { fname: encodeURIComponent('Mom lasagna') });
  del();
  ok('first Delete tap only arms it', sb.state.customFoods.length === 1 && sb.state.customConfirmDel === 'Mom lasagna');
  ok('armed row asks for a second tap', sb.foodZone().includes('Tap again to delete'));
  del();
  ok('second tap deletes it', sb.state.customFoods.length === 0 && sb.state.customConfirmDel === null);
  ok('removed from recents and favorites', sb.state.recents.length === 0 && sb.state.favorites.length === 0);
  ok('logged entry kept', sb.state.meals.Lunch.length === 1 && sb.totals().kcal === 600);
  ok('deleting the last custom food leaves the (now gone) Custom tab for All', sb.state.foodCat === 'All');
}
{
  const { sb, act } = makeEnv();
  sb.state.customFoods = [lasagna()];
  act('delCustom', { fname: encodeURIComponent('Mom lasagna') });
  act('setFoodView', { view:'browse' });
  ok('leaving the view disarms a pending delete', sb.state.customConfirmDel === null);
  act('delCustom', { fname: encodeURIComponent('Mom lasagna') });
  ok('…so the next tap arms again rather than deleting', sb.state.customFoods.length === 1);
  act('editCustom', { fname: encodeURIComponent('No such food') });
  ok('Edit on an unknown name is a no-op', sb.state.customEdit === null && sb.state.foodView === 'browse');
}

console.log('\n== F. rendering across views ==');
{
  const { sb } = makeEnv();
  withPlan(sb);
  sb.state.water = 1250;
  let h = sb.foodZone();
  ok('water card shows progress against the plan target', h.includes('1.25 L') && h.includes(sb.fmtWater(sb.waterTargetMl())));
  ok('take-back button shown once there is water', h.includes('data-ml="-250"'));
  bal('food zone with water (metric)', h);
  sb.state.water = 0;
  ok('no take-back button at zero', !sb.foodZone().includes('data-ml="-250"'));
  sb.state.profile.units = 'imp'; sb.state.water = 473;
  h = sb.foodZone();
  ok('imperial water card in fl oz', h.includes('16 fl oz') && h.includes('placeholder="Other amount (fl oz)"'));
  bal('food zone with water (imperial)', h);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
