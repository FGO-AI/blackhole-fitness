/* Free-text intake — the parser fills the same draft the wizard fills, and
   computePlan() does every calculation from there.

   What is real here: sanitizeParsed, parseGoalText, concerningText,
   draftFromParsed, commitProfile, computePlan, pageDescribe, pageConfirm and
   pageSupport are the SHIPPED functions, executed. The parser now runs on the
   device, so unlike the earlier server version nothing here is stubbed: fetch
   and XMLHttpRequest are replaced with traps that FAIL the test if called.

   tests/parser.test.js holds the phrasing corpus; this file covers the path
   around it — the gate, the screens, the commit, and the frozen strings. */
/* read the shipped source with line endings normalised: git's autocrlf
   hands Windows a CRLF working copy, and every pattern here matches on \n */
const fs = require('fs'), vm = require('vm'), path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const SQL  = path.join(ROOT, 'supabase-schema.sql');
const src = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n');
const js = src.match(/<script>\n([\s\S]*)\n<\/script>/)[1];
const EXPORTS = ['state','sanitizeParsed','draftFromParsed','parseGoalText','intakeFallback',
                 'pageDescribe','pageConfirm','pageSupport','pageGoals','commitProfile',
                 'computePlan','CONFIRM_FIELDS','CONF_MIN','MAX_INTAKE','INTAKE_EXAMPLES',
                 'INTAKE_FALLBACK','GOALS','EQUIP_LEVELS','AVOID_VOCAB','EQUIP_VOCAB',
                 'availableEquip','ROUTES','nav','stack','ratePressure','PACE_LINE',
                 'concerningText','SUPPORT_MESSAGE','CONCERN_PATTERNS','VERY_LOW_KCAL'];
const defs = js.slice(0, js.indexOf('/* boot */'))
            + `\n;Object.assign(globalThis, { ${EXPORTS.join(', ')} });\n`;

const fakeEl = {
  addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
  appendChild(){}, remove(){}, classList:{ toggle(){}, add(){}, remove(){} },
  textContent:'', dataset:{}, style:{}, value:'',
};
const store = {};
/* any network use by the free-text path is a failure, so the traps count */
let netCalls = 0;
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
  location: { href:'http://x/', protocol:'http:', origin:'http://x', pathname:'/' },
  navigator: { onLine:false },
  fetch: () => { netCalls++; throw new Error('network is not allowed in the free-text path'); },
  XMLHttpRequest: class { constructor(){ netCalls++; throw new Error('network is not allowed'); } },
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

/* a complete, plausible parse result to mutate per case */
const GOOD = {
  goal:'lose', days:4, equip:'basic', exp:'intermediate',
  equipDetail:['dumbbell'], avoid:['running','jumping'], trainingDays:null,
  confidence:{ goal:0.95, days:0.9, equip:0.85, exp:0.8 },
  unparsed:['wants to run a half marathon in April'],
  summary:'Fat loss, four days a week, dumbbells at home, avoiding impact.',
};
const clone = o => JSON.parse(JSON.stringify(o));

/* ═══ 1 · sanitizeParsed is the one gate on the vocabulary ═══ */
console.log('\n── 1 · nothing outside the vocabulary reaches state ──');
ok('a well-formed payload survives intact',
   JSON.stringify(S.sanitizeParsed(clone(GOOD))) === JSON.stringify(GOOD));
ok('a non-object is rejected outright',
   S.sanitizeParsed(null) === null && S.sanitizeParsed('x') === null);

const junk = S.sanitizeParsed({ ...clone(GOOD),
  goal:'bulk', days:7, equip:'garage', exp:'elite',
  equipDetail:['dumbbell','laser','__proto__'], avoid:['running','breathing'],
});
ok('an unknown goal becomes null, not the nearest match', junk.goal === null);
ok('a day count outside 3-6 becomes null', junk.days === null, String(junk.days));
ok('an unknown equipment level becomes null', junk.equip === null);
ok('an unknown experience level becomes null', junk.exp === null);
ok('unknown kit is dropped', JSON.stringify(junk.equipDetail) === JSON.stringify(['dumbbell']));
ok('an unknown avoid trait is dropped', JSON.stringify(junk.avoid) === JSON.stringify(['running']));

const extra = S.sanitizeParsed({ ...clone(GOOD),
  kcal:1200, protein:180, carbs:90, fat:40, schedule:[{day:'Mon'}],
  workouts:['HIIT Circuit'], tdee:2400, plan:{kcal:1200},
});
const LEAK = ['kcal','protein','carbs','fat','schedule','workouts','tdee','plan','meals','bmr'];
ok('a payload carrying calories, macros, workouts or a schedule loses all of it',
   LEAK.every(k => !(k in extra)), Object.keys(extra).filter(k => LEAK.includes(k)).join(', '));
ok('…and keeps exactly the contract fields',
   JSON.stringify(Object.keys(extra).sort()) === JSON.stringify(Object.keys(GOOD).sort()),
   Object.keys(extra).sort().join(','));

const conf = S.sanitizeParsed({ ...clone(GOOD), confidence:{ goal:7, days:-3, equip:'high', exp:null } });
ok('confidence above 1 is clamped', conf.confidence.goal === 1);
ok('confidence below 0 is clamped', conf.confidence.days === 0);
ok('a non-numeric confidence becomes 0',
   conf.confidence.equip === 0 && conf.confidence.exp === 0);

const td = S.sanitizeParsed({ ...clone(GOOD), days:3, trainingDays:[0,2,4] });
ok('a weekday list matching the day count is kept',
   JSON.stringify(td.trainingDays) === JSON.stringify([0,2,4]));
const tdBad = S.sanitizeParsed({ ...clone(GOOD), days:3, trainingDays:[0,2,4,5,9,-1] });
ok('out-of-range weekdays are dropped, and a length mismatch voids the list',
   tdBad.trainingDays === null, JSON.stringify(tdBad.trainingDays));

const long = S.sanitizeParsed({ ...clone(GOOD),
  summary:'x'.repeat(500), unparsed:['a','b','c','d','e','f','g', 'y'.repeat(400)] });
ok('the summary is length-capped', long.summary.length === 240, String(long.summary.length));
ok('unparsed is capped at 5 entries', long.unparsed.length === 5, String(long.unparsed.length));
ok('each unparsed entry is length-capped', long.unparsed.every(u => u.length <= 160));

/* ═══ 2 · low confidence is shown as a question, never a default ═══ */
console.log('\n── 2 · draftFromParsed never guesses ──');
const shaky = S.draftFromParsed(S.sanitizeParsed({ ...clone(GOOD),
  confidence:{ goal:0.95, days:0.4, equip:0.59, exp:0.61 } }));
ok('a confident field is pre-selected', shaky.goal === 'lose');
ok('a field below the threshold is left unset', shaky.days === null, String(shaky.days));
ok(`…including one just under ${S.CONF_MIN}`, shaky.equip === null, String(shaky.equip));
ok(`…and one just over ${S.CONF_MIN} is kept`, shaky.exp === 'intermediate');
ok('the draft is marked as coming from free text', shaky.src === 'text');
ok('a null day count voids the weekday list too', shaky.trainingDays === null);
const nulls = S.draftFromParsed(S.sanitizeParsed({ ...clone(GOOD),
  goal:null, days:null, equip:null, exp:null, confidence:{goal:1,days:1,equip:1,exp:1} }));
ok('a null field stays null even at full confidence',
   [nulls.goal, nulls.days, nulls.equip, nulls.exp].every(v => v === null));

/* ═══ 3 · the whole path runs on the device ═══
   Offline, signed out, and with fetch and XMLHttpRequest trapped. If the
   free-text path needed a network, a server or an account, this shows it. */
console.log('\n── 3 · offline, signed out, network trapped — executed ──');
const session = { id:'u1', email:'a@b.c' };
S.state.session = null;

(async () => {
  const r1 = S.parseGoalText('lose weight, 4 days a week, dumbbells at home');
  ok('parseGoalText returns a plain result, not a promise', r1 && typeof r1.then !== 'function');
  ok('offline and signed out, a description still parses',
     !!(r1.parsed && r1.parsed.goal === 'lose' && r1.parsed.days === 4), JSON.stringify(r1));

  const r2 = S.parseGoalText('I want to stop eating completely and lose 10 lb, 4 days a week');
  ok('a crisis description is blocked before anything is parsed',
     r2.blocked === true && !('parsed' in r2), JSON.stringify(r2).slice(0, 120));
  ok('…with SUPPORT_MESSAGE itself, not an assembled variant', r2.message === S.SUPPORT_MESSAGE);

  const r3 = S.parseGoalText('zqvx bkrt plmq');
  ok('a description with nothing recognisable falls back', r3.fail === 'unusable', JSON.stringify(r3));
  ok('the only failure left is "unusable" — offline, auth, rate and timeout are gone',
     JSON.stringify(Object.keys(S.INTAKE_FALLBACK)) === '["unusable"]',
     Object.keys(S.INTAKE_FALLBACK).join(','));
  ok('…and its wording names the questions as the way forward', /question/i.test(S.INTAKE_FALLBACK.unusable));
  ok('no network call was attempted across any of that', netCalls === 0, `${netCalls} call(s)`);

  const go = src.slice(src.indexOf("if (a.act === 'intakeGo')"), src.indexOf("if (a.act === 'pickField')"));
  ok('SOURCE (string check): intakeGo calls the parser directly — no .then, no await',
     /const res = parseGoalText\(state\.intake\.text\);/.test(go) && !/\.then\(|\bawait\b/.test(go));
  ok('SOURCE (string check): Goal Analysis opens the free-text screen for everyone, signed in or not',
     /goals:\s+\(\) => nav\('Goal Analysis', pageDescribe\),/.test(src));

  /* ═══ 4 · the screens ═══ */
  console.log('\n── 4 · the intake screens render and escape ──');
  S.state.session = session;
  S.state.intake = { text:'', busy:false, error:'', parsed:null, fallbackMsg:'' };
  let h = S.pageDescribe();
  ok('describe screen renders', h.length > 400);
  ok('…offers the wizard as an always-available alternative', /data-act="useWizard"/.test(h));
  ok('…offers every example as a one-tap fill',
     S.INTAKE_EXAMPLES.every((_, i) => h.includes(`data-act="intakeEg" data-i="${i}"`)));
  ok('…caps the textarea at the same length the parser reads',
     h.includes(`maxlength="${S.MAX_INTAKE}"`) && S.MAX_INTAKE === 500);
  ok('…and says the description never leaves the device', /never sent anywhere or stored/.test(h));

  const XSS = '"><img src=x onerror=alert(1)>';
  S.state.intake.text = XSS;
  h = S.pageDescribe();
  ok('the user\'s own text is escaped when echoed back',
     !h.includes('<img src=x') && h.includes('&lt;img'), h.slice(h.indexOf('textarea'), h.indexOf('textarea') + 200));

  S.state.intake.parsed = S.sanitizeParsed({ ...clone(GOOD), summary: XSS, unparsed:[XSS] });
  S.state.draft = S.draftFromParsed(S.state.intake.parsed);
  h = S.pageConfirm();
  ok('confirm screen renders', h.length > 800);
  ok('a hostile summary is escaped', !h.includes('<img src=x'));
  ok('a hostile unparsed entry is escaped',
     (h.match(/&lt;img/g) || []).length >= 2, String((h.match(/&lt;img/g) || []).length));
  ok('every parsed field is shown as an editable chip row',
     S.CONFIRM_FIELDS.every(x => h.includes(`data-f="${x.f}"`)));
  ok('the avoid list is editable too', /data-act="toggleAvoid"/.test(h));
  ok('named kit is editable too', /data-act="toggleKit"/.test(h));
  ok('Continue is enabled once every required field is set',
     /data-act="confirmNext"\s*>/.test(h) && !/data-act="confirmNext" disabled/.test(h));

  S.state.draft.days = null; S.state.draft.equip = null;
  h = S.pageConfirm();
  ok('Continue is disabled while anything is unanswered', /data-act="confirmNext" disabled/.test(h));
  ok('…and the unanswered fields are visibly marked',
     (h.match(/class="needs"/g) || []).length === 2, String((h.match(/class="needs"/g) || []).length));
  ok('…and the screen says how many are left', /2 still to answer/.test(h));

  /* The Screen 2 bug this change surfaced. availableEquip prefers named kit
     over the level, so a level picked on this screen was silently ignored
     whenever the parser had named kit. First prove the precedence is real —
     that is why the fix matters — then that the handler clears the kit. */
  ok('availableEquip really does let named kit outrank the level',
     JSON.stringify(S.availableEquip({ equip:'gym', equipDetail:['dumbbell'] }).sort())
       === JSON.stringify(['dumbbell','none']));
  const pick = src.slice(src.indexOf("if (a.act === 'pickField')"), src.indexOf("if (a.act === 'toggleAvoid'"));
  ok('SOURCE (string check): changing the equipment level clears the named kit',
     /if \(f === 'equip'\) state\.draft\.equipDetail = \[\];/.test(pick));

  /* the same structural check render-pages.test.js applies to every other
     page: a template literal with a branch in it is where an unclosed tag or
     a leaked undefined hides */
  const balance = html => {
    const n = re => (html.match(re) || []).length;
    return { div:[n(/<div\b/g), n(/<\/div>/g)], button:[n(/<button\b/g), n(/<\/button>/g)],
             span:[n(/<span\b/g), n(/<\/span>/g)], p:[n(/<p\b/g), n(/<\/p>/g)],
             ul:[n(/<ul\b/g), n(/<\/ul>/g)], li:[n(/<li\b/g), n(/<\/li>/g)],
             textarea:[n(/<textarea\b/g), n(/<\/textarea>/g)], label:[n(/<label\b/g), n(/<\/label>/g)] };
  };
  const bal = (name, html) => {
    const bad = Object.entries(balance(html)).filter(([, [o, c]]) => o !== c);
    ok(name + ' — tags balanced', bad.length === 0, JSON.stringify(bad));
    const leak = (html.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,40}/) || [''])[0];
    ok(name + ' — nothing leaked', !leak, leak);
  };
  S.state.intake.text = 'lose weight';
  bal('describe', S.pageDescribe());
  S.state.draft = S.draftFromParsed(S.sanitizeParsed(clone(GOOD)));
  bal('confirm (complete)', S.pageConfirm());
  S.state.draft.days = null; S.state.draft.equip = null;
  bal('confirm (incomplete)', S.pageConfirm());
  S.state.draft = S.draftFromParsed(S.sanitizeParsed({ ...clone(GOOD),
    days:3, trainingDays:[0,2,4], equipDetail:[], unparsed:[], summary:'' }));
  bal('confirm (weekdays named, nothing unparsed)', S.pageConfirm());
  bal('support', S.pageSupport(S.SUPPORT_MESSAGE));

  h = S.pageSupport(S.SUPPORT_MESSAGE);
  ok('the support screen renders every paragraph of the fixed message',
     S.SUPPORT_MESSAGE.split('\n\n').every(para => h.includes(para.slice(0, 40))));
  ok('…carries no plan, target or number beyond the helplines',
     !/kcal|calorie|macro|protein/i.test(h));
  ok('…and still offers the questions', /data-act="useWizard"/.test(h));
  ok('…and escapes whatever it is handed', !S.pageSupport(XSS).includes('<img src=x'));

  S.state.intake.fallbackMsg = S.INTAKE_FALLBACK.unusable;
  h = S.pageGoals();
  ok('the wizard explains why it is showing after a fallback',
     h.includes("couldn't pull anything usable") || h.includes('couldn&#39;t pull anything usable'));
  S.state.intake.fallbackMsg = XSS;
  ok('…and escapes that message too', !S.pageGoals().includes('<img src=x'));
  S.state.intake.fallbackMsg = '';
  ok('…and shows no notice when arriving normally',
     !S.pageGoals().includes('border-color:var(--ember-mid);padding:13px 16px;margin-top:18px'));

  /* ═══ 5 · one commit path, one plan ═══ */
  console.log('\n── 5 · a parsed profile and a tapped profile build the same plan ──');
  const BODY = { name:'Alex', sex:'m', age:30, units:'metric', h:180, w:80,
                 activity:1.55, actLabel:'Moderately active' };
  const tapped = { ...BODY, goal:'lose', days:4, equip:'basic', exp:'intermediate',
                   trainingDays:[0,1,3,4] };
  /* The same ANSWERS, not merely the same shape: free text can carry an avoid
     list and named kit that the wizard has no way to express, and those
     legitimately change which sessions get picked. */
  const real = S.parseGoalText('Lose weight, 4 days a week, intermediate, dumbbells and small kit');
  const parsedDraft = { ...S.draftFromParsed({ ...real.parsed, avoid:[], equipDetail:[] }), ...BODY,
                        trainingDays:[0,1,3,4] };
  ok('the real parser produced the same four answers the wizard was given',
     parsedDraft.goal === 'lose' && parsedDraft.days === 4 && parsedDraft.equip === 'basic'
     && parsedDraft.exp === 'intermediate', JSON.stringify(real.parsed));

  S.state.profile = tapped;   const planA = S.computePlan();
  S.state.profile = { ...parsedDraft }; const planB = S.computePlan();
  const differs = Object.keys(planA).filter(k => JSON.stringify(planA[k]) !== JSON.stringify(planB[k]));
  ok('identical answers produce an identical plan whichever path filled them in',
     differs.length === 0, differs.join(', '));
  ok('the free-text draft carries no field computePlan does not read',
     !('kcal' in parsedDraft) && !('summary' in parsedDraft) && !('confidence' in parsedDraft));

  /* ═══ 6 · the stated acceptance criteria, end to end, from real text ═══ */
  console.log('\n── 6 · acceptance criteria, from real sentences through the real parser ──');
  const fromText = (text, body = BODY) => {
    const r = S.parseGoalText(text);
    if (!r.parsed) return null;
    const d = S.draftFromParsed(r.parsed);
    /* stand in for the user answering whatever Screen 2 left blank */
    S.state.profile = { goal:'maintain', days:4, equip:'gym', exp:'intermediate',
                        ...Object.fromEntries(Object.entries(d).filter(([, v]) => v != null)), ...body };
    return S.computePlan();
  };
  const dumbbells = fromText('I only have dumbbells at home, want to build muscle, 4 days');
  const heavy = ['barbell','machine','pool','specialty','cardio-machine','bike'];
  const badKit = dumbbells.schedule.filter(s => !s.rest && s.w.eq.some(e => heavy.includes(e)));
  ok('"I only have dumbbells at home" → no barbell, machine, sled or pool work',
     badKit.length === 0, badKit.map(s => `${s.w.name}:${s.w.eq}`).join(' | '));

  const knees = fromText('Get my cardio back, 4 days, bad knees so nothing high-impact');
  const badMove = knees.schedule.filter(s => !s.rest && s.w.av.some(a => a === 'running' || a === 'jumping'));
  ok('"bad knees, nothing high-impact" → no running or jumping',
     badMove.length === 0, badMove.map(s => `${s.w.name}:${s.w.av}`).join(' | '));
  ok('…and the week is still full', knees.schedule.filter(s => !s.rest).length === 4);

  ok('a stated rate does not move the target — only GOAL_TUNING and the floor do',
     fromText('lose 30 lb in a month, 4 days a week, dumbbells').kcal
       === fromText('lose weight, 4 days a week, dumbbells').kcal);
  ok('and that target still respects the 1300 floor',
     fromText('lose weight, 3 days, dumbbells', { ...BODY, w:42, h:150, age:70, sex:'f' }).kcal >= 1300);

  /* ═══ 7 · nothing external exists any more ═══ */
  console.log('\n── 7 · no function, no endpoint, no key, no network ──');
  const sql = fs.readFileSync(SQL, 'utf8').replace(/\r\n/g, '\n');
  const intake = src.slice(src.indexOf('/* ================= FREE-TEXT INTAKE'),
                           src.indexOf('/* --- wizard step 1: goal --- */'));
  ok('the intake module could be located', intake.length > 5000, String(intake.length));
  ok('the Edge Function source is gone from the repo',
     !fs.existsSync(path.join(ROOT, 'supabase', 'functions', 'parse-goal')));
  ok('…and so is the supabase/ directory it lived in', !fs.existsSync(path.join(ROOT, 'supabase')));
  ok('SOURCE (string check): the intake module makes no network call',
     !/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon|WebSocket/.test(intake));
  ok('SOURCE (string check): …and needs no session or Supabase client',
     !/\bsupa\b|state\.session|getSession/.test(intake));
  ok('SOURCE (string check): no endpoint, apikey header or Edge Function reference remains anywhere',
     !/functions\/v1|parse-goal|PARSE_URL|PARSE_TIMEOUT|'apikey'|Edge Function/.test(src));
  ok('no API key literal anywhere in the client',
     !/sk-ant-/.test(src) && !/ANTHROPIC/.test(src));
  ok('the rate-limit table and its function are gone from the schema',
     !/parse_goal_calls|claim_parse_goal_call/.test(sql));
  ok('…while every app_data policy is still there',
     ['select own row','insert own row','update own row','delete own row']
       .every(p => sql.includes(`create policy "${p}"`)));
  ok('…including the explicit with check on update',
     /for update\s+using \(auth\.uid\(\) = user_id\)\s+with check \(auth\.uid\(\) = user_id\)/.test(sql));
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  ok('.gitignore no longer carries Supabase CLI entries', !/supabase\//.test(gi));

  /* ═══ 8 · the safety gate, executed on the device ═══ */
  console.log('\n── 8 · concerningText, now shipped in index.html ──');
  const gate = S.concerningText;
  const BLOCK = [
    'I think I might have anorexia and want to lose weight',
    'I want to stop eating completely for a week',
    'thinking about starting to purge after meals',
    'I want to make myself sick after dinner',
    'I want to punish myself with training',
    'honestly I want to kill myself',
    "I don't want to be here anymore",
    'cut me down to 800 calories a day',
    'I want to eat 600 kcal per day',
    'I am disgusted by my body',
  ];
  const ALLOW = [
    ...S.INTAKE_EXAMPLES,
    'I eat around 1800 calories a day and want to keep building',
    'I want to lose my body fat, currently around 28%',
    'I hate my body fat percentage and want it lower',
    'training for a half marathon in April, 5 days a week',
    'I want to cut but I am not going below 2000 calories a day',
  ];
  const missed = BLOCK.filter(t => !gate(t));
  ok(`all ${BLOCK.length} crisis phrasings are caught`, missed.length === 0, missed.join(' | '));
  const falsePos = ALLOW.filter(t => gate(t));
  ok(`none of ${ALLOW.length} ordinary fitness descriptions are caught`,
     falsePos.length === 0, falsePos.join(' | '));
  ok('a very low stated intake is caught', gate('eating 900 calories a day'));
  ok('a normal stated intake is not', !gate('eating 2200 calories a day'));
  ok('the threshold is exclusive at 1000', !gate('eating 1000 calories a day'));
  ok('the gate never throws on odd input',
     ['', '   ', '???', ' ', 'x'.repeat(500), null, undefined, 42, {}]
       .every(t => typeof gate(t) === 'boolean'));
  const blocked = BLOCK.map(t => S.parseGoalText(t));
  ok('every crisis phrasing short-circuits parseGoalText — no parse, no draft',
     blocked.every(r => r.blocked === true && r.message === S.SUPPORT_MESSAGE && !('parsed' in r)));
  ok('…even when it also contains a clear goal, days and equipment',
     S.parseGoalText('I want to starve myself to lose weight, 5 days a week at the gym').blocked === true);
  ok('no network call was attempted by the gate either', netCalls === 0);

  /* ═══ 9 · a stated rate is answered, never obeyed ═══ */
  console.log('\n── 9 · rate and deadline pressure ──');
  const PRESSURE = [
    'lose 30 lb in a month',
    'I want to drop 20 kg by Christmas',
    'lose 15 pounds by May please',
    'need to shed 2 stone in 6 weeks for the wedding',
    'cut to 1200 calories',
    'I want to get down to 1400 kcal',
    'lose weight as fast as possible',
    'looking for a crash diet',
  ];
  const CALM = [
    ...S.INTAKE_EXAMPLES,
    'Build muscle, gym access, 5 days, I have lifted for a couple of years',
    'training for a half marathon in April, 5 days a week',
    'I train 4 days a week and want to stay fit',
    'maybe I will add a day later on',
    'lose 15 lb, dumbbells at home',
  ];
  const missedRate = PRESSURE.filter(t => !S.ratePressure(t));
  ok(`all ${PRESSURE.length} rate/deadline phrasings are recognised`,
     missedRate.length === 0, missedRate.join(' | '));
  const falseRate = CALM.filter(t => S.ratePressure(t));
  ok(`none of ${CALM.length} ordinary descriptions are — including the example chips`,
     falseRate.length === 0, falseRate.join(' | '));
  ok('a non-string cannot crash the detector',
     [null, undefined, 42, {}].every(t => S.ratePressure(t) === false));

  S.state.intake.text = 'lose 30 lb in a month, 4 days a week, dumbbells';
  S.state.intake.parsed = S.parseGoalText(S.state.intake.text).parsed;
  S.state.draft = S.draftFromParsed(S.state.intake.parsed);
  h = S.pageConfirm();
  ok('the confirm screen names the pace the plan does target', /About the pace/.test(h));
  ok('…says the calories do not move to hit a date', /do not move to hit a date/.test(h));
  ok('…and says faster tends not to stick', /faster than that tends not to/.test(h));
  ok('…quotes the pace for the goal that was parsed',
     h.includes(S.PACE_LINE.lose), S.PACE_LINE.lose);
  ok('…and invents no number about this particular user',
     !/\b(kcal|calories per day|\d{3,4} kcal)\b/i.test(h.slice(h.indexOf('About the pace'), h.indexOf('About the pace') + 700)));
  bal('confirm (rate pressure)', h);

  S.state.draft.goal = null;
  ok('with no goal chosen yet the note still appears, without a pace claim',
     /About the pace/.test(S.pageConfirm()) && !S.pageConfirm().includes(S.PACE_LINE.lose));
  S.state.draft.goal = 'lose';

  S.state.intake.text = 'Lose about 15 lb, 4 days a week, dumbbells at home';
  ok('an ordinary description gets no pace lecture', !/About the pace/.test(S.pageConfirm()));

  ok('a rate claim changes nothing about the arithmetic',
     !/ratePressure|PACE_LINE|unparsed|parseGoalText/.test(
          src.slice(src.indexOf('function computePlan()'), src.indexOf('const COACH'))));

  /* ═══ 10 · the strings the spec freezes ═══ */
  console.log('\n── 10 · frozen safety strings, verbatim ──');
  ok('the >1% bodyweight/week warning is present verbatim',
     src.includes('faster than the 0.5–1% usually recommended. Eating a little more is reasonable here; the target will not go lower on its own.'));
  ok('…and still fires only for a fat-loss goal above 1%',
     /goal === 'lose' && m\.lossPctPerWeek > 1/.test(src));
  const DISCLAIMERS = [
    'Estimates for healthy adults, not medical advice — that includes targets measured from your own data',
    'Targets — including ones measured from your own data — are estimates for healthy adults, not medical advice.',
    'Patterns, not grades: a day over or under target is information, not a verdict.',
  ];
  DISCLAIMERS.forEach((d, i) =>
    ok(`disclaimer ${i + 1} of ${DISCLAIMERS.length} is present verbatim`, src.includes(d)));
  ok('the intake note adds to them rather than replacing one',
     src.includes('This is exercise selection, not medical advice'));
  ok('the 1300 kcal floor is still the only floor, in both target paths',
     src.includes('Math.max(kcal, 1300)') && src.includes('Math.max(1300,'));

  /* Moved from the server to the device, with the spec's instruction that the
     wording must not change — so it is locked here in full, character for
     character, rather than by spot-checking a helpline. */
  const FROZEN_SUPPORT =
    'Some of what you wrote sounds like it might be about more than training, ' +
    'so this app is going to step back rather than hand you a number. That is ' +
    'not a judgement, and nothing is wrong with you for it.\n\n' +
    'If you want to talk to someone, findahelpline.com lists free, confidential ' +
    'services in most countries. In the US you can call or text 988. For eating ' +
    'concerns specifically, NEDA is at 1-800-931-2237 and Beat (UK) is at ' +
    '0808 801 0677.\n\n' +
    'The questionnaire is still here whenever you want it.';
  ok('SUPPORT_MESSAGE matches the frozen wording character for character',
     S.SUPPORT_MESSAGE === FROZEN_SUPPORT,
     `lengths ${S.SUPPORT_MESSAGE.length} vs ${FROZEN_SUPPORT.length}`);
  ok('…and exists exactly once in the source, so there is no second copy to drift',
     (src.match(/const SUPPORT_MESSAGE =/g) || []).length === 1);
  ok('the gate still has its six crisis patterns', S.CONCERN_PATTERNS.length === 6,
     String(S.CONCERN_PATTERNS.length));
  ok('the low-intake threshold is still 1000 kcal', S.VERY_LOW_KCAL === 1000);
  ok('the unusable fallback wording is unchanged',
     S.INTAKE_FALLBACK.unusable === "I couldn't pull anything usable out of that. These questions will get there.");

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
