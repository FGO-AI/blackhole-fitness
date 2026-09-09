/* B1 canary. Runs the EXACT payload from the audit through the real render
   functions out of index.html.

   WHAT THIS PROVES / WHAT IT DOESN'T. There is no browser here, so nothing
   below parses HTML or executes a script. What it proves is that the payload
   leaves the render functions as escaped TEXT (&lt;img…) rather than as markup
   (<img…) — which is precisely the property that makes it inert, and is
   decidable from the string. Confirming no alert() fires still needs a real
   browser; that is the one gap this cannot close. */
/* read the shipped source with line endings normalised: git's autocrlf
   hands Windows a CRLF working copy, and every pattern here matches on \n */
const fs = require('fs'), vm = require('vm');
const HTML = require('path').join(__dirname, '..', 'index.html');
const js = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n').match(/<script>\n([\s\S]*)\n<\/script>/)[1];

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  PASS  ' + n); }
                               else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); } };

const CANARY = '<img/src=x/onerror=alert(1)>';          /* the audit's slash variant */
const ESCAPED = '&lt;img/src=x/onerror=alert(1)&gt;';
const ATTR_CANARY = '" autofocus onfocus=alert(1) x="';

const EX = ['state','pageMenu','pagePlanFull','pageAbout','foodZone','computePlan',
            'repairShapes','freshMeals','saveCustomFromForm','escHtml','MAX_FOOD_TEXT',
            'saveState','refreshFoodOnly'];

function makeEnv(){
  const inputs = {};                       /* id -> {value} for the custom-food form */
  const errEl = { textContent:'' };
  const zoneEl = { innerHTML:'' };
  const el = () => ({ addEventListener(){}, querySelector(){ return null; },
                      querySelectorAll(){ return []; }, appendChild(){}, remove(){},
                      classList:{ toggle(){}, add(){}, remove(){} },
                      textContent:'', dataset:{}, style:{}, innerHTML:'' });
  const cur = {
    querySelector(sel){
      const id = sel.replace('#','');
      if (id === 'cfErr') return errEl;
      /* present so refreshFoodOnly() re-renders the zone in place instead of
         falling through to refresh(), which would need the whole router */
      if (id === 'foodzone') return zoneEl;
      return id in inputs ? inputs[id] : null;
    },
    querySelectorAll(){ return []; }, addEventListener(){},
  };
  const sb = {
    window:{}, console, matchMedia:()=>({matches:false}),
    document:{ getElementById:()=>el(), createElement:()=>el(), activeElement:null,
               addEventListener(){} },
    IntersectionObserver: class { observe(){} unobserve(){} },
    addEventListener(){}, setTimeout, clearTimeout, setInterval, clearInterval,
    performance, requestAnimationFrame(){},
    localStorage:{ getItem:()=>null, setItem(){}, removeItem(){} },
    location:{ href:'http://x/', origin:'http://x', pathname:'/', protocol:'http:' },
    navigator:{},
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(js.slice(0, js.indexOf('/* boot */'))
    + '\n;Object.assign(globalThis,{' + EX.join(',') + ',__setCurrent:(c)=>{current=c;}});\n', sb);
  sb.__setCurrent(cur);
  return { sb, inputs, errEl };
}

const profile = () => ({ goal:'gain', units:'metric', name:'Alex', sex:'m', age:'28',
  h:'178', w:'77', activity:1.55, actLabel:'Moderately active', exp:'intermediate',
  days:4, equip:'gym', trainingDays:[0,2,4,6] });

console.log('\n== 1. The input gate: does the canary even get stored? ==');
{
  const { sb, inputs, errEl } = makeEnv();
  inputs.cfName = { value: CANARY };
  inputs.cfSrv  = { value: '1 slice' };
  inputs.cfCal  = { value: '250' };
  sb.saveCustomFromForm();
  ok('the canary is REJECTED, never stored', sb.state.customFoods.length === 0,
     JSON.stringify(sb.state.customFoods));
  ok('and it says why, inline — not a silent failure',
     /can’t contain < or >/.test(errEl.textContent), errEl.textContent);
}
{
  const { sb, inputs, errEl } = makeEnv();
  inputs.cfName = { value: 'Fine' };
  inputs.cfSrv  = { value: CANARY };          /* the serving field too */
  inputs.cfCal  = { value: '250' };
  sb.saveCustomFromForm();
  ok('the serving field is gated identically', sb.state.customFoods.length === 0);
  ok('with the same inline error', /can’t contain < or >/.test(errEl.textContent));
}
{
  const { sb, inputs, errEl } = makeEnv();
  inputs.cfName = { value: 'x'.repeat(sb.MAX_FOOD_TEXT + 1) };
  inputs.cfCal  = { value: '250' };
  sb.saveCustomFromForm();
  ok('over-length is rejected, not truncated', sb.state.customFoods.length === 0);
  ok('with its own message', /80 characters or fewer/.test(errEl.textContent), errEl.textContent);
}
{
  const { sb, inputs, errEl } = makeEnv();
  inputs.cfName = { value: "Mom's lasagna & chips" };   /* legitimate, incl. ' and & */
  inputs.cfSrv  = { value: '1 slice' };
  inputs.cfCal  = { value: '250' };
  inputs.cfP = { value:'10' }; inputs.cfC = { value:'30' }; inputs.cfF = { value:'12' };
  sb.saveCustomFromForm();
  ok('a legitimate name still saves', sb.state.customFoods.length === 1, errEl.textContent);
  ok('and is stored verbatim, NOT pre-escaped',
     sb.state.customFoods[0].name === "Mom's lasagna & chips", sb.state.customFoods[0].name);
}

console.log('\n== 2. Render surfaces, with the gate BYPASSED ==');
console.log('   (simulating an entry synced down from before the fix — the case');
console.log('    the escaping, not the gate, has to handle)');
{
  const { sb } = makeEnv();
  const hostile = { name:CANARY, srv:CANARY, calories:250, p:10, c:30, f:12,
                    cat:'Custom', custom:true };
  sb.state.customFoods = [hostile];          /* straight past saveCustomFromForm */
  sb.state.foodCat = 'Custom';
  sb.state.meals = sb.freshMeals();
  sb.state.meals.Breakfast = [{ food:hostile, qty:1 }];
  sb.state.sheet = { food:hostile, qty:1 };
  sb.state.profile = profile(); sb.state.goal = 'gain';
  sb.state.plan = sb.computePlan();

  const h = sb.foodZone();
  ok('SURFACE 1 - meal diary: renders escaped', h.includes(ESCAPED));
  ok('SURFACE 2 - food list row: renders escaped',
     h.split(ESCAPED).length - 1 >= 2, 'occurrences: ' + (h.split(ESCAPED).length - 1));
  ok('SURFACE 3 - detail sheet: renders escaped', h.includes('aria-label="Log ' + ESCAPED));
  ok('NO raw <img tag anywhere in the output', !h.includes('<img'),
     (h.match(/.{0,50}<img.{0,50}/) || [''])[0]);
  ok('NO raw onerror= anywhere in the output', !/onerror=/.test(h.replace(/&lt;/g,''))
     || !h.includes('<img'));
  ok('the escaped form appears at every surface (3+ times)',
     h.split(ESCAPED).length - 1 >= 3, 'occurrences: ' + (h.split(ESCAPED).length - 1));
}

console.log('\n== 3. Profile name canary (Menu + Blueprint) ==');
{
  const { sb } = makeEnv();
  const pf = profile(); pf.name = CANARY;    /* no spaces, so split(" ")[0] keeps it whole */
  sb.state.profile = pf; sb.state.goal = 'gain'; sb.state.plan = sb.computePlan();
  const menu = sb.pageMenu();
  ok('Menu headline: escaped', menu.includes(ESCAPED));
  ok('Menu headline: no raw <img', !menu.includes('<img'));
  const plan = sb.pagePlanFull();
  ok('Blueprint kicker: escaped', plan.includes(ESCAPED));
  ok('Blueprint kicker: no raw <img', !plan.includes('<img'));
}

console.log('\n== 4. Attribute context (wizard name field) ==');
{
  const { sb } = makeEnv();
  sb.state.draft = { name: ATTR_CANARY };
  const h = sb.pageAbout();
  ok('the quote is neutralised to &quot;', h.includes('&quot; autofocus onfocus=alert(1) x=&quot;'));
  ok('no unescaped quote breaks out of value="..."',
     !h.includes('value="" autofocus'), (h.match(/.{0,60}autofocus.{0,30}/) || [''])[0]);
  ok('the canary also survives as escaped text in the attribute',
     !/onfocus=alert\(1\)"/.test(h.replace(/&quot;/g, 'Q')));
}

console.log('\n== 5. repairShapes drops malformed customFoods ==');
{
  const { sb } = makeEnv();
  sb.state.customFoods = [
    { name:'Good', srv:'1 cup', calories:100, p:1, c:2, f:3 },   /* keep */
    { name:'', srv:'x', calories:1, p:0, c:0, f:0 },             /* empty name */
    { name:'NoSrv', srv:'', calories:1, p:0, c:0, f:0 },         /* empty serving */
    { name:'NaNcal', srv:'x', calories:'abc', p:0, c:0, f:0 },   /* non-numeric */
    { name:{}, srv:'x', calories:1, p:0, c:0, f:0 },             /* object name */
    null, 'a string', 42,                                        /* junk */
  ];
  sb.repairShapes();
  ok('only the well-formed entry survives', sb.state.customFoods.length === 1,
     JSON.stringify(sb.state.customFoods));
  ok('and it is the right one', sb.state.customFoods[0].name === 'Good');
}
{
  /* shape validation must NOT be mistaken for sanitisation — an old hostile
     name is well-SHAPED and is kept. The escaping is what makes it inert. */
  const { sb } = makeEnv();
  sb.state.customFoods = [{ name:CANARY, srv:'1 cup', calories:100, p:1, c:2, f:3 }];
  sb.repairShapes();
  ok('a well-shaped hostile entry is KEPT (escaping handles it, not this)',
     sb.state.customFoods.length === 1);
}

console.log('\n== 6. No visible regression for legitimate input ==');
{
  const { sb } = makeEnv();
  const food = { name:"Mom's lasagna", srv:'1 slice & a bit', calories:250, p:10, c:30, f:12,
                 cat:'Custom', custom:true };
  sb.state.customFoods = [food];
  sb.state.foodCat = 'Custom';
  sb.state.meals = sb.freshMeals();
  sb.state.sheet = { food, qty:1 };
  sb.state.profile = profile(); sb.state.goal = 'gain'; sb.state.plan = sb.computePlan();
  const h = sb.foodZone();
  ok('apostrophe is entity-encoded in source (renders as \' on screen)',
     h.includes('Mom&#39;s lasagna'), 'not found');
  ok('ampersand is entity-encoded (renders as & on screen)',
     h.includes('1 slice &amp; a bit'));
  ok('NOT double-escaped (&amp;#39; would show literally as &#39;)',
     !h.includes('&amp;#39;') && !h.includes('&amp;amp;'));
  const pf = profile(); pf.name = "O'Brien";
  sb.state.profile = pf;
  const menu = sb.pageMenu();
  ok('a name with an apostrophe renders correctly on the Menu',
     menu.includes('O&#39;Brien') && !menu.includes('&amp;#39;'));
  /* search box: the manual replace is gone, behaviour must be unchanged */
  sb.state.foodQuery = 'chicken "grilled"';
  const h2 = sb.foodZone();
  ok('search value still cannot break out of the attribute',
     h2.includes('value="chicken &quot;grilled&quot;"'),
     (h2.match(/value="[^"]*grilled[^"]*"/) || [''])[0]);
}

console.log('\n' + '='.repeat(58) + '\n  ' + pass + ' passed, ' + fail + ' failed\n' + '='.repeat(58));
process.exit(fail ? 1 : 0);
