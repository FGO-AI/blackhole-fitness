/* Free-text intake — the parser fills the same draft the wizard fills, and
   computePlan() does every calculation from there.

   What is real here and what is not:
   - sanitizeParsed, draftFromParsed, commitProfile, computePlan, pageDescribe,
     pageConfirm and pageSupport are the SHIPPED functions, executed.
   - parseGoalText is executed against a STUBBED fetch. That proves the client's
     branching, not that the Edge Function works — no request leaves this file.
   - The Edge Function itself is Deno TypeScript and cannot run under node, so
     everything in section 7 is a SOURCE check on supabase/functions/parse-goal
     — proof of what the code says, not of what a deployed function does. */
/* read the shipped source with line endings normalised: git's autocrlf
   hands Windows a CRLF working copy, and every pattern here matches on \n */
const fs = require('fs'), vm = require('vm'), path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const FN   = path.join(ROOT, 'supabase', 'functions', 'parse-goal', 'index.ts');
const SQL  = path.join(ROOT, 'supabase-schema.sql');
const src = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n');
const js = src.match(/<script>\n([\s\S]*)\n<\/script>/)[1];
const EXPORTS = ['state','sanitizeParsed','draftFromParsed','parseGoalText','intakeFallback',
                 'pageDescribe','pageConfirm','pageSupport','pageGoals','commitProfile',
                 'computePlan','CONFIRM_FIELDS','CONF_MIN','MAX_INTAKE','INTAKE_EXAMPLES',
                 'INTAKE_FALLBACK','PARSE_URL','GOALS','EQUIP_LEVELS','AVOID_VOCAB',
                 'EQUIP_VOCAB','ROUTES','nav','stack','ratePressure','PACE_LINE'];
const defs = js.slice(0, js.indexOf('/* boot */'))
            + `\n;Object.assign(globalThis, { ${EXPORTS.join(', ')} });\n`;

const fakeEl = {
  addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
  appendChild(){}, remove(){}, classList:{ toggle(){}, add(){}, remove(){} },
  textContent:'', dataset:{}, style:{}, value:'',
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
  location: { href:'http://x/', protocol:'http:', origin:'http://x', pathname:'/' },
  navigator: { onLine:true },
  AbortController: class { constructor(){ this.signal = { aborted:false }; } abort(){ this.signal.aborted = true; } },
  fetch: null,
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

/* ═══ 1 · sanitizeParsed is the client's own gate ═══ */
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

/* ═══ 3 · every failure lands in the wizard ═══ */
console.log('\n── 3 · fallbacks (stubbed fetch — no request leaves this file) ──');
const session = { id:'u1', email:'a@b.c' };
const fakeSupa = { auth: { getSession: async () => ({ data:{ session:{ access_token:'jwt' } } }) } };

/* The stub must stay installed across every await inside parseGoalText — an
   earlier version restored it synchronously, which meant the stub was already
   gone by the time the real fetch call ran and every case looked like a
   network error. `supa` is a module-level `let`, so it is assigned through the
   context's global lexical scope rather than as a property of globalThis. */
async function callParse(fetchImpl, { online = true, sess = session, supa = fakeSupa } = {}){
  S.navigator.onLine = online;
  S.state.session = sess;
  S.supa = supa;
  vm.runInContext('supa = globalThis.supa;', S);
  S.fetch = fetchImpl;
  try { return await S.parseGoalText('lose weight, 4 days, dumbbells'); }
  finally { S.fetch = null; }
}
const reply = (status, body) => async () => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
});

(async () => {
  ok('signed out → auth fallback',
     (await callParse(reply(200, {}), { sess:null })).fail === 'auth');
  ok('no supabase client → auth fallback',
     (await callParse(reply(200, {}), { supa:null })).fail === 'auth');
  ok('offline → offline fallback',
     (await callParse(reply(200, {}), { online:false })).fail === 'offline');
  ok('429 → rate-limit fallback',
     (await callParse(reply(429, { error:'rate' }))).fail === 'rate');
  ok('500 → down fallback',
     (await callParse(reply(500, { error:'upstream' }))).fail === 'down');
  ok('502 → down fallback',
     (await callParse(reply(502, { error:'upstream' }))).fail === 'down');
  ok('a 200 with no parsed payload → unusable fallback',
     (await callParse(reply(200, { error:'unusable' }))).fail === 'unusable');
  ok('unparseable JSON → down fallback',
     (await callParse(async () => ({ ok:true, status:200, json: async () => { throw new Error('bad'); } }))).fail === 'down');
  ok('a thrown network error → down fallback',
     (await callParse(async () => { throw new Error('ECONNREFUSED'); })).fail === 'down');
  const aborted = await callParse(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
  ok('an aborted request → timeout fallback', aborted.fail === 'timeout', JSON.stringify(aborted));
  ok('every fallback key has wording to show the user',
     ['auth','offline','rate','timeout','down','unusable']
       .every(k => typeof S.INTAKE_FALLBACK[k] === 'string' && S.INTAKE_FALLBACK[k].length > 20));
  ok('…and every one of them names the questions as the way forward',
     Object.values(S.INTAKE_FALLBACK).every(m => /question/i.test(m)),
     Object.entries(S.INTAKE_FALLBACK).filter(([,m]) => !/question/i.test(m)).map(([k]) => k).join(', '));

  const blocked = await callParse(reply(200, { blocked:true, message:'fixed support wording' }));
  ok('a blocked response is surfaced, not treated as a failure',
     blocked.blocked === true && blocked.message === 'fixed support wording');
  const good = await callParse(reply(200, { parsed: clone(GOOD) }));
  ok('a good response comes back sanitized', good.parsed && good.parsed.goal === 'lose');

  ok('the endpoint is the project function URL, not a model vendor',
     /\/functions\/v1\/parse-goal$/.test(S.PARSE_URL) && !/anthropic|openai/i.test(S.PARSE_URL),
     S.PARSE_URL);

  /* ═══ 4 · the screens ═══ */
  console.log('\n── 4 · the intake screens render and escape ──');
  S.state.session = session;
  S.state.intake = { text:'', busy:false, error:'', parsed:null, fallbackMsg:'' };
  let h = S.pageDescribe();
  ok('describe screen renders', h.length > 400);
  ok('…offers the wizard as an always-available alternative', /data-act="useWizard"/.test(h));
  ok('…offers every example as a one-tap fill',
     S.INTAKE_EXAMPLES.every((_, i) => h.includes(`data-act="intakeEg" data-i="${i}"`)));
  ok('…caps the textarea at the same length the server enforces',
     h.includes(`maxlength="${S.MAX_INTAKE}"`) && S.MAX_INTAKE === 500);

  const XSS = '"><img src=x onerror=alert(1)>';
  S.state.intake.text = XSS;
  h = S.pageDescribe();
  ok('the user\'s own text is escaped when echoed back',
     !h.includes('<img src=x') && h.includes('&lt;img'), h.slice(h.indexOf('textarea'), h.indexOf('textarea') + 200));

  S.state.intake.parsed = S.sanitizeParsed({ ...clone(GOOD), summary: XSS, unparsed:[XSS] });
  S.state.draft = S.draftFromParsed(S.state.intake.parsed);
  h = S.pageConfirm();
  ok('confirm screen renders', h.length > 800);
  ok('the model-authored summary is escaped', !h.includes('<img src=x'));
  ok('the model-authored unparsed list is escaped',
     (h.match(/&lt;img/g) || []).length >= 2, String((h.match(/&lt;img/g) || []).length));
  ok('every parsed field is shown as an editable chip row',
     S.CONFIRM_FIELDS.every(x => h.includes(`data-act="pickField"\n             data-f="${x.f}"`)
                              || h.includes(`data-f="${x.f}"`)));
  ok('the avoid list is editable too', /data-act="toggleAvoid"/.test(h));
  ok('named kit is editable too', /data-act="toggleKit"/.test(h));
  ok('Continue is enabled once every required field is set',
     /data-act="confirmNext" >|data-act="confirmNext"\s*>/.test(h) && !/data-act="confirmNext" disabled/.test(h));

  S.state.draft.days = null; S.state.draft.equip = null;
  h = S.pageConfirm();
  ok('Continue is disabled while anything is unanswered', /data-act="confirmNext" disabled/.test(h));
  ok('…and the unanswered fields are visibly marked',
     (h.match(/class="needs"/g) || []).length === 2, String((h.match(/class="needs"/g) || []).length));
  ok('…and the screen says how many are left', /2 still to answer/.test(h));

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
  S.state.intake.busy = true;  bal('describe (busy)', S.pageDescribe());  S.state.intake.busy = false;
  S.state.draft = S.draftFromParsed(S.sanitizeParsed(clone(GOOD)));
  bal('confirm (complete)', S.pageConfirm());
  S.state.draft.days = null; S.state.draft.equip = null;
  bal('confirm (incomplete)', S.pageConfirm());
  S.state.draft = S.draftFromParsed(S.sanitizeParsed({ ...clone(GOOD),
    days:3, trainingDays:[0,2,4], equipDetail:[], unparsed:[], summary:'' }));
  bal('confirm (weekdays named, nothing unparsed)', S.pageConfirm());
  bal('support', S.pageSupport('one\n\ntwo'));

  h = S.pageSupport('first paragraph\n\nsecond paragraph');
  ok('the support screen renders both paragraphs',
     h.includes('first paragraph') && h.includes('second paragraph'));
  ok('…carries no plan, target or number', !/kcal|calorie|macro|protein/i.test(h));
  ok('…and still offers the questions', /data-act="useWizard"/.test(h));
  h = S.pageSupport(XSS);
  ok('…and escapes the message it was handed', !h.includes('<img src=x'));

  S.state.intake.fallbackMsg = 'The written version isn\'t reachable right now.';
  h = S.pageGoals();
  ok('the wizard explains why it is showing after a fallback',
     h.includes('reachable right now'));
  S.state.intake.fallbackMsg = XSS;
  ok('…and escapes that message too', !S.pageGoals().includes('<img src=x'));
  S.state.intake.fallbackMsg = '';
  ok('…and shows no notice when arriving normally', !S.pageGoals().includes('border-color:var(--ember-mid);padding:13px 16px;margin-top:18px'));

  /* ═══ 5 · one commit path, one plan ═══ */
  console.log('\n── 5 · a parsed profile and a tapped profile build the same plan ──');
  const BODY = { name:'Alex', sex:'m', age:30, units:'metric', h:180, w:80,
                 activity:1.55, actLabel:'Moderately active' };
  const tapped = { ...BODY, goal:'lose', days:4, equip:'basic', exp:'intermediate',
                   trainingDays:[0,1,3,4] };
  /* The same ANSWERS, not merely the same shape: free text can carry an avoid
     list and named kit that the wizard has no way to express, and those
     legitimately change which sessions get picked. Compare a parse that used
     neither, so any difference would be the commit path drifting. */
  const plain = { ...clone(GOOD), avoid:[], equipDetail:[] };
  const parsedDraft = { ...S.draftFromParsed(S.sanitizeParsed(plain)), ...BODY,
                        trainingDays:[0,1,3,4] };

  S.state.profile = tapped;   const planA = S.computePlan();
  S.state.profile = { ...parsedDraft }; const planB = S.computePlan();
  const differs = Object.keys(planA).filter(k => JSON.stringify(planA[k]) !== JSON.stringify(planB[k]));
  ok('identical answers produce an identical plan whichever path filled them in',
     differs.length === 0, differs.join(', '));

  ok('the free-text draft carries no field computePlan does not read',
     !('kcal' in parsedDraft) && !('summary' in parsedDraft) && !('confidence' in parsedDraft));

  /* ═══ 6 · the stated acceptance criteria, end to end ═══ */
  console.log('\n── 6 · acceptance criteria ──');
  const fromText = (p, body = BODY) => {
    S.state.profile = { ...S.draftFromParsed(S.sanitizeParsed(p)), ...body };
    return S.computePlan();
  };
  const dumbbells = fromText({ ...clone(GOOD), goal:'gain', equip:'basic',
    equipDetail:['dumbbell'], avoid:[] });
  const heavy = ['barbell','machine','pool','specialty','cardio-machine','bike'];
  const badKit = dumbbells.schedule.filter(s => !s.rest && s.w.eq.some(e => heavy.includes(e)));
  ok('"I only have dumbbells at home" → no barbell, machine, sled or pool work',
     badKit.length === 0, badKit.map(s => `${s.w.name}:${s.w.eq}`).join(' | '));

  const knees = fromText({ ...clone(GOOD), goal:'endure', equip:'gym',
    equipDetail:[], avoid:['running','jumping'] });
  const badMove = knees.schedule.filter(s => !s.rest && s.w.av.some(a => a === 'running' || a === 'jumping'));
  ok('"bad knees, nothing high-impact" → no running or jumping',
     badMove.length === 0, badMove.map(s => `${s.w.name}:${s.w.av}`).join(' | '));
  ok('…and the week is still full', knees.schedule.filter(s => !s.rest).length === 4);

  ok('a stated rate does not move the target — only GOAL_TUNING and the floor do',
     fromText({ ...clone(GOOD), unparsed:['wants to lose 30 lb in a month'] }).kcal
       === fromText({ ...clone(GOOD), unparsed:[] }).kcal);
  ok('and that target still respects the 1300 floor',
     fromText(clone(GOOD), { ...BODY, w:42, h:150, age:70, sex:'f' }).kcal >= 1300);

  /* ═══ 7 · the Edge Function (SOURCE CHECKS — Deno, cannot run here) ═══ */
  console.log('\n── 7 · parse-goal source (string checks — not an executed function) ──');
  const fn = fs.readFileSync(FN, 'utf8').replace(/\r\n/g, '\n');
  const sql = fs.readFileSync(SQL, 'utf8').replace(/\r\n/g, '\n');

  ok('no API key literal anywhere in the client bundle',
     !/sk-ant-/.test(src) && !/ANTHROPIC_API_KEY/.test(src));
  ok('the function reads its key from the environment, never a literal',
     /Deno\.env\.get\("ANTHROPIC_API_KEY"\)/.test(fn) && !/sk-ant-/.test(fn));
  ok('unauthenticated calls are rejected before anything is spent',
     /Bearer /.test(fn) && /auth\.getUser\(\)/.test(fn)
     && fn.indexOf('auth.getUser()') < fn.indexOf('claim_parse_goal_call'));
  ok('the rate limit is claimed before the paid call',
     fn.indexOf('claim_parse_goal_call') < fn.indexOf('messages.parse'));
  ok('the safety gate runs before the paid call too',
     fn.indexOf('concerningText(text)') < fn.indexOf('claim_parse_goal_call'));
  ok('input is length-capped server-side, not only in the textarea',
     /text\.length > MAX_TEXT/.test(fn) && /MAX_TEXT = 500/.test(fn));
  ok('the response is rebuilt field by field, so extra keys cannot pass through',
     /const parsed = \{/.test(fn) && !/\.\.\.raw/.test(fn));
  ok('the prompt forbids calories, macros, workouts and schedules',
     /Never output calorie targets, macronutrient amounts, workout names/.test(fn));
  ok('a refusal is checked before the content is read',
     fn.indexOf('stop_reason === "refusal"') < fn.indexOf('res.parsed_output'));
  ok('the support wording is a constant in code, not model output',
     /const SUPPORT_MESSAGE =/.test(fn) && /findahelpline\.com/.test(fn));
  ok('the safety gate does not depend on the model cooperating',
     /concerningText/.test(fn) && /raw\.concern === true/.test(fn));
  ok('only error.message is logged, never the request body',
     /e instanceof Error \? e\.message/.test(fn) && !/console\.(log|error)\([^)]*\btext\b/.test(fn));
  ok('the function pins the model explicitly',
     /model: "claude-opus-5"/.test(fn));

  ok('the rate-limit counter lives in Postgres, not in the stateless function',
     /create table if not exists public\.parse_goal_calls/.test(sql));
  ok('…with RLS on and no policy, so no client can reset it',
     /alter table public\.parse_goal_calls enable row level security/.test(sql)
     && !/create policy .* on public\.parse_goal_calls/.test(sql));
  ok('…and the limit is a constant in the function, not a caller argument',
     /hourly_limit constant integer/.test(sql)
     && /create or replace function public\.claim_parse_goal_call\(\)/.test(sql));
  ok('…claimed in a single upsert so concurrent calls cannot both read the old count',
     /on conflict \(user_id\) do update/.test(sql));
  ok('…and search_path is pinned on the security definer function',
     /security definer[\s\S]{0,80}set search_path = public, pg_temp/.test(sql));

  /* ═══ 8 · the safety gate, actually executed ═══
     concerningText is plain JS behind two type annotations, so it is lifted
     out of the shipped .ts and run for real rather than grepped. This is the
     one part of the Edge Function these tests genuinely exercise. */
  console.log('\n── 8 · concerningText (lifted from the shipped .ts and run) ──');
  const lifted = fn.match(/const CONCERN_PATTERNS[\s\S]*?\n\}\n/);
  ok('concerningText could be lifted out of the function source', !!lifted);
  const gateCtx = { RegExp, Number, out:null };
  vm.createContext(gateCtx);
  vm.runInContext(
    lifted[0].replace(/:\s*RegExp\[\]/, '').replace(/:\s*string/g, '').replace(/:\s*boolean/g, '')
    + '\nout = concerningText;', gateCtx, { filename:'parse-goal-gate.js' });
  const gate = gateCtx.out;

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
    'Lose about 15 lb, 4 days a week, dumbbells at home',
    "Build muscle, gym access, 5 days, I've lifted for a couple years",
    'Get my cardio back, 3 days, bad knees so nothing high-impact',
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
     [ '', '   ', '???', ' ', 'x'.repeat(500) ].every(t => typeof gate(t) === 'boolean'));

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

  S.state.intake.parsed = S.sanitizeParsed(clone(GOOD));
  S.state.draft = S.draftFromParsed(S.state.intake.parsed);
  S.state.intake.text = 'lose 30 lb in a month, 4 days a week, dumbbells';
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
     /About the pace/.test(S.pageConfirm())
     && !S.pageConfirm().includes(S.PACE_LINE.lose));
  S.state.draft.goal = 'lose';

  S.state.intake.text = 'Lose about 15 lb, 4 days a week, dumbbells at home';
  ok('an ordinary description gets no pace lecture', !/About the pace/.test(S.pageConfirm()));

  ok('a rate claim changes nothing about the arithmetic',
     fromText({ ...clone(GOOD), unparsed:['wants to lose 30 lb in a month'] }).kcal
       === fromText({ ...clone(GOOD), unparsed:[] }).kcal
     && !/ratePressure|PACE_LINE|unparsed/.test(
          src.slice(src.indexOf('function computePlan()'), src.indexOf('const COACH'))));

  /* ═══ 10 · the two safety strings the spec freezes ═══ */
  console.log('\n── 10 · the existing warning and disclaimer are unchanged ──');
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
  ok('the new intake note adds to them rather than replacing one',
     src.includes('This is exercise selection, not medical advice'));
  ok('the 1300 kcal floor is still the only floor, in both target paths',
     (src.match(/Math\.max\((?:kcal, )?1300/g) || []).length >= 1
     && src.includes('Math.max(1300,'));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
})();
