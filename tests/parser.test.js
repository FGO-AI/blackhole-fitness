/* The on-device goal parser — a corpus of real phrasings with expected parses,
   plus properties that must hold for ANY input.

   Everything here executes the shipped parseGoalText() from index.html. There
   is no stub anywhere in this file: fetch and XMLHttpRequest are replaced with
   traps that fail the run if the parser ever touches the network.

   Expectations are hand-written against what a careful reader would take from
   each sentence, not copied from the parser's output. Where the parser should
   decline — a tie, bare "home", "I sat in the sun" — the expectation is null
   with zero confidence, because a wrong pre-selection silently builds the
   wrong plan while a blank just asks. */
/* read the shipped source with line endings normalised: git's autocrlf
   hands Windows a CRLF working copy, and every pattern here matches on \n */
const fs = require('fs'), vm = require('vm'), path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = path.join(ROOT, 'index.html');
const src = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n');
const js = src.match(/<script>\n([\s\S]*)\n<\/script>/)[1];
const EXPORTS = ['state','parseGoalText','sanitizeParsed','draftFromParsed','pageConfirm',
                 'CONFIRM_FIELDS','CONF_MIN','MAX_INTAKE','INTAKE_EXAMPLES','SUPPORT_MESSAGE',
                 'ratePressure','GOALS','EQUIP_LEVELS','EQUIP_VOCAB','AVOID_VOCAB','EXP_NOTE',
                 'GOAL_SUMMARY','EQUIP_SUMMARY','AVOID_LABEL'];
const defs = js.slice(0, js.indexOf('/* boot */'))
            + `\n;Object.assign(globalThis, { ${EXPORTS.join(', ')} });\n`;

const fakeEl = {
  addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
  appendChild(){}, remove(){}, classList:{ toggle(){}, add(){}, remove(){} },
  textContent:'', dataset:{}, style:{}, value:'',
};
let netCalls = 0;
const sandbox = {
  window: {}, console,
  matchMedia: () => ({ matches:false }),
  document: { getElementById: () => fakeEl, createElement: () => fakeEl, activeElement:null },
  IntersectionObserver: class { observe(){} unobserve(){} },
  addEventListener(){}, setTimeout, clearTimeout, setInterval, clearInterval,
  performance, requestAnimationFrame(){},
  localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  location: { href:'http://x/', protocol:'http:', origin:'http://x', pathname:'/' },
  navigator: { onLine:false },
  fetch: () => { netCalls++; throw new Error('the parser must not use the network'); },
  XMLHttpRequest: class { constructor(){ netCalls++; throw new Error('the parser must not use the network'); } },
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

/* ════════════════════════════ the corpus ════════════════════════════
   expect:      fields to compare exactly (arrays compared as sets)
   conf:        [low, high] bounds on confidence for named fields
   unparsedHas: fragments that must appear somewhere in `unparsed`
   rate:        what ratePressure() must say about the same text
   outcome:     'parsed' (default) | 'blocked' | 'unusable'                */
const NONSENSE = (() => {
  const toks = ['zqvx','bkrt','plmq','wxyz','qqzz','vvkk','jjhh','ffgg','xkcd','pfft'];
  let s = '', i = 0;
  while (s.length < 500) s += toks[(i++ * 7) % toks.length] + (i % 5 ? ' ' : ', ');
  return s.slice(0, 500);
})();

const CASES = [
  /* ── every example chip in the UI ── */
  { text:'Lose about 15 lb, 4 days a week, dumbbells at home',
    expect:{ goal:'lose', days:4, equip:'basic', equipDetail:['dumbbell'], exp:null, avoid:[], trainingDays:null },
    conf:{ goal:[0.7, 0.8], days:[0.9, 0.9], equip:[0.9, 0.9], exp:[0, 0] },
    unparsedHas:['15 lb'], rate:false },
  { text:"Build muscle, gym access, 5 days, I've lifted for a couple years",
    expect:{ goal:'gain', days:5, equip:'gym', equipDetail:[], exp:'intermediate', avoid:[] },
    conf:{ goal:[0.9, 1], equip:[0.9, 0.9], exp:[0.8, 0.9] }, rate:false },
  { text:'Get my cardio back, 3 days, bad knees so nothing high-impact',
    expect:{ goal:'endure', days:3, equip:null, avoid:['running','jumping'], exp:null },
    conf:{ equip:[0, 0] }, rate:false },

  /* ── the deliberately awkward ones named in the brief ── */
  { text:'15 lb, 4 days a week, dumbbells at home',
    expect:{ goal:null, days:4, equip:'basic' }, conf:{ goal:[0, 0] }, unparsedHas:['15 lb'], rate:false },
  { text:'half marathon in April',
    expect:{ goal:'endure', days:null, equip:null }, unparsedHas:['half marathon','april'], rate:false },
  { text:'bad knees so nothing high-impact',
    expect:{ goal:null, equip:null, avoid:['running','jumping'] }, conf:{ equip:[0, 0] } },
  { text:'I have nothing',
    expect:{ equip:'none', equipDetail:['none'], goal:null }, conf:{ equip:[0.9, 0.9] } },
  { text:'5 days, gym, been lifting 3 years',
    expect:{ days:5, equip:'gym', exp:'advanced', goal:null }, conf:{ exp:[0.9, 0.9] } },
  { text:'mon wed fri',
    expect:{ trainingDays:[0,2,4], days:3, goal:null }, conf:{ days:[0.85, 0.85] } },
  { text:'weekends only',
    expect:{ days:3, trainingDays:null }, conf:{ days:[0.65, 0.65] }, unparsedHas:['2 days'] },
  { text:'', outcome:'unusable' },
  { text:'💪🏋️‍♀️🔥🔥', outcome:'unusable' },
  { text:NONSENSE, outcome:'unusable' },

  /* ── goal ── */
  { text:'I want to lose weight', expect:{ goal:'lose' }, conf:{ goal:[0.95, 0.95] } },
  /* a tie is not an answer — but it is not "nothing usable" either: both goals
     were seen, so they are reported back and Screen 2 asks which one */
  { text:'lose weight and build muscle', expect:{ goal:null }, conf:{ goal:[0, 0] },
    unparsedHas:['more than one goal','lose weight','build muscle'] },
  { text:'I want to get stronger', expect:{ goal:'gain' }, conf:{ goal:[0.95, 0.95] } },
  { text:'tone up', expect:{ goal:'gain' }, conf:{ goal:[0.7, 0.8] } },
  { text:'stay fit and healthy', expect:{ goal:'maintain' } },
  { text:'train for a 5k', expect:{ goal:'endure' }, unparsedHas:['5k'] },
  { text:'I want to build endurance', expect:{ goal:'endure' }, conf:{ goal:[0.9, 1] } },
  { text:'get my wind back', expect:{ goal:'endure' } },
  { text:'swimming and cycling to build my endurance', expect:{ goal:'endure', equipDetail:[] } },
  { text:'I want to maintain my weight and stay healthy, 3 days', expect:{ goal:'maintain', days:3 } },
  { text:'I hate my body fat and want to lean out', expect:{ goal:'lose' } },   /* not a crisis signal */

  /* ── days ── */
  { text:'four times a week', expect:{ days:4 }, conf:{ days:[0.9, 0.9] } },
  { text:'twice a week', expect:{ days:3 }, conf:{ days:[0.65, 0.65] }, unparsedHas:['2 days'] },
  { text:'2 days a week', expect:{ days:3 }, conf:{ days:[0.65, 0.65] }, unparsedHas:['2 days'] },
  { text:'7 days a week', expect:{ days:6 }, conf:{ days:[0.65, 0.65] }, unparsedHas:['7 days'] },
  { text:'3x a week at the gym', expect:{ days:3, equip:'gym' } },

  /* ── weekdays ── */
  { text:'I can do tues and thurs',
    expect:{ days:3, trainingDays:null }, conf:{ days:[0.65, 0.65] }, unparsedHas:['2 days'] },
  { text:'monday tuesday thursday friday, 4 days a week', expect:{ days:4, trainingDays:[0,1,3,4] } },
  { text:'mon wed fri, 4 days a week', expect:{ days:4, trainingDays:null } },   /* count and days disagree */
  { text:'Mon, Wed & Fri mornings', expect:{ days:3, trainingDays:[0,2,4] } },
  { text:'every other day', expect:{ days:3, trainingDays:[0,2,4] } },
  { text:'sat and sun', expect:{ days:3, trainingDays:null }, unparsedHas:['2 days'] },
  { text:'I sat in the sun all weekend', outcome:'unusable' },   /* words, not a schedule */

  /* ── equipment ── */
  { text:'no equipment, just bodyweight', expect:{ equip:'none', equipDetail:['none'] } },
  { text:'I have a kettlebell and some resistance bands',
    expect:{ equip:'basic', equipDetail:['kettlebell','bands'] } },
  { text:'I go to Planet Fitness', expect:{ equip:'gym', goal:null } },
  { text:'home gym with a barbell and a squat rack',
    expect:{ equip:'gym', equipDetail:['barbell'] }, conf:{ equip:[0.6, 0.65] } },   /* two levels named */
  { text:'I have a home gym', expect:{ equip:'basic', equipDetail:[] }, conf:{ equip:[0.6, 0.65] } },
  { text:'I train at home', outcome:'unusable' },   /* bare "home" says where, not what */
  { text:'I have access to a pool', expect:{ equip:null, equipDetail:['pool'] }, conf:{ equip:[0, 0] } },
  { text:'treadmill at home', expect:{ equip:null, equipDetail:['cardio-machine'] } },   /* not a gym */
  { text:'I have dumbbells but no gym',
    expect:{ equip:'basic', equipDetail:['dumbbell'] }, conf:{ equip:[0.6, 0.65] } },
  { text:'no pool, but I have a bike', expect:{ equipDetail:['bike'], avoid:['swimming'] } },

  /* ── experience ── */
  { text:"I'm a complete beginner", expect:{ exp:'beginner' } },
  { text:'getting back into it after a long break', expect:{ exp:'beginner' } },
  { text:"I've trained on and off for a while", expect:{ exp:'intermediate' } },
  { text:'been training for 10 years', expect:{ exp:'advanced' }, conf:{ exp:[0.9, 0.9] } },
  { text:'I competed in powerlifting', expect:{ exp:'advanced' } },
  { text:"I'm new to lifting, 3 days, bodyweight only", expect:{ exp:'beginner', days:3, equip:'none' } },

  /* ── things to work around ── */
  { text:'bad back, no deadlifts', expect:{ avoid:['heavy-spinal'], goal:null } },
  { text:'my shoulder hurts when I press overhead', expect:{ avoid:['overhead'] } },
  { text:"I can't swim", expect:{ avoid:['swimming'], goal:null } },   /* can't swim ≠ endurance goal */
  { text:'no running, I hate it, but I want to lose weight', expect:{ avoid:['running'], goal:'lose' } },
  { text:'I have diabetes and bad knees, want to lose weight',
    expect:{ goal:'lose', avoid:['running','jumping'] }, unparsedHas:['diabet'] },

  /* ── seen, not used ── */
  { text:'I want abs and bigger arms', expect:{ goal:null }, unparsedHas:['abs'] },
  { text:'I have asthma', expect:{ goal:null }, unparsedHas:['asthma'] },
  { text:'lose 30 lb in a month', expect:{ goal:'lose' }, unparsedHas:['30 lb','a month'], rate:true },
  { text:'drop 2 stone by summer', expect:{ goal:'lose' }, conf:{ goal:[0.6, 0.65] },
    unparsedHas:['2 stone','summer'], rate:true },
  { text:'cut to 1200 calories', expect:{ goal:'lose' }, unparsedHas:['1200'], rate:true },

  /* ── safety short-circuits ── */
  { text:'I want to stop eating completely and lose weight', outcome:'blocked' },
  { text:'cut to 800 calories a day', outcome:'blocked' },

  /* ── hostile and oversized ── */
  { text:'<script>alert(1)</script> lose weight, 4 days', expect:{ goal:'lose', days:4 } },
  { text:'lose weight 4 days a week '.repeat(30), expect:{ goal:'lose', days:4 } },
];

const setEq = x => Array.isArray(x) ? JSON.stringify([...x].sort()) : JSON.stringify(x);
const clip = t => JSON.stringify(t.length > 58 ? t.slice(0, 55) + '…' : t);

console.log(`\n── 1 · corpus: ${CASES.length} phrasings ──`);
const results = [];
for (const c of CASES){
  let r, threw = null;
  try { r = S.parseGoalText(c.text); } catch (e) { threw = e; }
  if (threw){ ok(clip(c.text), false, 'THREW: ' + threw.message); continue; }
  results.push({ c, r });
  const outcome = c.outcome || 'parsed';
  if (outcome === 'blocked'){
    ok(`${clip(c.text)} → blocked`, r.blocked === true && r.message === S.SUPPORT_MESSAGE && !r.parsed,
       JSON.stringify(r).slice(0, 120));
    continue;
  }
  if (outcome === 'unusable'){
    ok(`${clip(c.text)} → falls back to the questions`, r.fail === 'unusable', JSON.stringify(r).slice(0, 160));
    continue;
  }
  if (!r.parsed){ ok(clip(c.text), false, 'expected a parse, got ' + JSON.stringify(r)); continue; }
  const p = r.parsed, bad = [];
  for (const [k, v] of Object.entries(c.expect || {}))
    if (setEq(p[k]) !== setEq(v)) bad.push(`${k}: expected ${setEq(v)}, got ${setEq(p[k])}`);
  for (const [k, [lo, hi]] of Object.entries(c.conf || {})){
    const got = p.confidence[k];
    if (!(got >= lo - 1e-9 && got <= hi + 1e-9)) bad.push(`confidence.${k}: expected ${lo}–${hi}, got ${got}`);
  }
  for (const frag of (c.unparsedHas || []))
    if (!p.unparsed.some(u => u.toLowerCase().includes(frag.toLowerCase())))
      bad.push(`unparsed lacks "${frag}" in ${JSON.stringify(p.unparsed)}`);
  if (c.rate != null && S.ratePressure(c.text) !== c.rate) bad.push(`ratePressure expected ${c.rate}`);
  ok(clip(c.text), bad.length === 0, bad.join(' | '));
}
ok(`the corpus has at least 40 inputs (${CASES.length})`, CASES.length >= 40);
ok('the corpus includes every example chip currently in the UI',
   S.INTAKE_EXAMPLES.every(ex => CASES.some(c => c.text === ex)));

/* ═══════════════════════ properties for ANY input ═══════════════════════ */
const GOAL_IDS  = S.GOALS.map(g => g.id);
const LEVELS    = Object.keys(S.EQUIP_LEVELS);
const EXPS      = Object.keys(S.EXP_NOTE);
const REQUIRED  = ['goal','days','equip','exp'];
const TEMPLATE_WORDS = new Set(
  [...Object.values(S.GOAL_SUMMARY), ...Object.values(S.EQUIP_SUMMARY), ...Object.values(S.AVOID_LABEL),
   'days a week', 'avoiding and', '3 4 5 6']
    .join(' ').toLowerCase().match(/[a-z0-9]+/g));

/* Returns a list of violations — empty when the result is lawful. */
function lawful(text, r){
  const v = [];
  const shapes = ['parsed','blocked','fail'].filter(k => r && r[k] != null);
  if (shapes.length !== 1) return [`result must be exactly one of parsed/blocked/fail, got ${JSON.stringify(r)}`];
  if (r.blocked){ if (r.message !== S.SUPPORT_MESSAGE) v.push('blocked without the fixed message'); return v; }
  if (r.fail){ if (r.fail !== 'unusable') v.push(`unknown failure "${r.fail}"`); return v; }
  const p = r.parsed;
  if (!(p.goal === null || GOAL_IDS.includes(p.goal))) v.push(`goal out of vocabulary: ${p.goal}`);
  if (!(p.days === null || [3,4,5,6].includes(p.days))) v.push(`days out of range: ${p.days}`);
  if (!(p.equip === null || LEVELS.includes(p.equip))) v.push(`equip out of vocabulary: ${p.equip}`);
  if (!(p.exp === null || EXPS.includes(p.exp))) v.push(`exp out of vocabulary: ${p.exp}`);
  if (!Array.isArray(p.equipDetail) || p.equipDetail.some(e => !S.EQUIP_VOCAB.includes(e))) v.push(`equipDetail: ${p.equipDetail}`);
  if (!Array.isArray(p.avoid) || p.avoid.some(a => !S.AVOID_VOCAB.includes(a))) v.push(`avoid: ${p.avoid}`);
  if (p.trainingDays !== null){
    const td = p.trainingDays;
    if (!Array.isArray(td) || td.length !== p.days || td.some((d, i) => !Number.isInteger(d) || d < 0 || d > 6 || (i && td[i-1] >= d)))
      v.push(`trainingDays unlawful: ${JSON.stringify(td)} for days ${p.days}`);
  }
  for (const f of REQUIRED){
    const c = p.confidence[f];
    if (!(typeof c === 'number' && c >= 0 && c <= 1)) v.push(`confidence.${f} = ${c}`);
    /* a field the parser did not find carries no confidence — "no match is null" */
    if (p[f] === null && c !== 0) v.push(`${f} is null but confidence is ${c}`);
  }
  if (!Array.isArray(p.unparsed) || p.unparsed.length > 5 || p.unparsed.some(u => typeof u !== 'string' || u.length > 160))
    v.push(`unparsed: ${JSON.stringify(p.unparsed)}`);
  if (typeof p.summary !== 'string' || p.summary.length > 240) v.push('summary not a capped string');
  if (/[<>]/.test(p.summary)) v.push(`summary carries markup: ${p.summary}`);
  const words = (p.summary.toLowerCase().match(/[a-z0-9]+/g) || []);
  const alien = words.filter(w => !TEMPLATE_WORDS.has(w));
  if (alien.length) v.push(`summary uses words no template has — it said something the parser did not find: ${alien}`);
  /* and it names exactly what was extracted, no more and no less */
  const sum = p.summary.toLowerCase();
  for (const id of GOAL_IDS)
    if (sum.includes(S.GOAL_SUMMARY[id].toLowerCase()) !== (p.goal === id)) v.push(`summary vs goal ${id}`);
  for (const lv of LEVELS)
    if (sum.includes(S.EQUIP_SUMMARY[lv].toLowerCase()) !== (p.equip === lv)) v.push(`summary vs equip ${lv}`);
  for (const d of [3,4,5,6])
    if (sum.includes(`${d} days a week`) !== (p.days === d)) v.push(`summary vs days ${d}`);
  return v;
}

console.log('\n── 2 · every corpus result is lawful ──');
for (const { c, r } of results){
  const v = lawful(c.text, r);
  ok(`${clip(c.text)} — within vocabulary, honest confidence, truthful summary`, v.length === 0, v.join(' | '));
}

console.log('\n── 3 · seeded fuzz: no crash, nothing outside the vocabulary ──');
let seed = 0x5eed1234;
const rand = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0;
  let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const PIECES = ['lose','weight','build','muscle','gym','home','nothing','no','not',"can't",'swim','run',
  'running','knees','back','shoulder','mon','wed','fri','sat','sun','weekends','every other day','twice',
  'days','day','x','times','a week','3','4','7','12','0','99','years','months','been','lifting',
  'dumbbells','pool','bike','bands','barbell','home gym','no pool','no gym','stone','lb','kg','by',
  'in a month','april','marathon','5k','calories','800','1200','cardio','stay fit','tone up','tie',
  ',','.','!','?',"'",'"','&','/','-','—','(',')','<b>','</script>','💪','🔥','🏋️‍♀️',' ','\t','\n',
  'Ünïcödé','ＧＹＭ','zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz','I','hate','my','body','fat','myself'];
const pick = () => PIECES[Math.floor(rand() * PIECES.length)];
const FUZZ = 400;
let fuzzBad = [], threwOn = null;
for (let i = 0; i < FUZZ; i++){
  const n = Math.floor(rand() * 80);
  let t = '';
  for (let j = 0; j < n; j++) t += pick() + (rand() < 0.7 ? ' ' : '');
  if (rand() < 0.1) t = t.repeat(4);                 /* sometimes longer than the cap */
  let r;
  try { r = S.parseGoalText(t); } catch (e) { threwOn = { t, e }; break; }
  const v = lawful(t, r);
  if (v.length) fuzzBad.push(`${JSON.stringify(t.slice(0, 50))}: ${v[0]}`);
}
ok(`${FUZZ} generated inputs never throw`, !threwOn, threwOn ? `${threwOn.e.message} on ${JSON.stringify(threwOn.t.slice(0, 80))}` : '');
ok(`${FUZZ} generated inputs never produce an unlawful result`, fuzzBad.length === 0, fuzzBad.slice(0, 3).join('  ||  '));
const ODD = [null, undefined, 0, 42, NaN, {}, [], ['lose weight'], true, () => 'lose', 'x'.repeat(100000)];
const oddBad = [];
for (const t of ODD){
  try { const r = S.parseGoalText(t); const v = lawful(String(t), r); if (v.length) oddBad.push(`${typeof t}: ${v[0]}`); }
  catch (e) { oddBad.push(`${typeof t} threw ${e.message}`); }
}
ok('non-string and huge inputs never throw and stay lawful', oddBad.length === 0, oddBad.join(' | '));

/* ═══════════ low confidence is flagged on Screen 2, never defaulted ═══════════ */
console.log('\n── 4 · Screen 2 flags every null and low-confidence field ──');
let flagBad = [];
S.state.intake = { text:'', busy:false, error:'', parsed:null, fallbackMsg:'' };
for (const { c, r } of results){
  if (!r.parsed) continue;
  const p = r.parsed, d = S.draftFromParsed(p);
  for (const f of REQUIRED){
    const want = (p[f] != null && p.confidence[f] >= S.CONF_MIN) ? p[f] : null;
    if (d[f] !== want) flagBad.push(`${clip(c.text)}: draft.${f} = ${d[f]}, expected ${want}`);
  }
  S.state.intake.text = c.text; S.state.intake.parsed = p; S.state.draft = d;
  const html = S.pageConfirm();
  const marked = (html.match(/class="needs"/g) || []).length;
  const unanswered = S.CONFIRM_FIELDS.filter(x => d[x.f] == null).length;
  if (marked !== unanswered) flagBad.push(`${clip(c.text)}: ${unanswered} unanswered but ${marked} marked`);
  const continueOn = !/data-act="confirmNext" disabled/.test(html);
  if (continueOn !== (unanswered === 0)) flagBad.push(`${clip(c.text)}: Continue ${continueOn ? 'enabled' : 'disabled'} with ${unanswered} unanswered`);
}
ok('below-threshold and null fields arrive unselected, are marked, and gate Continue — for every corpus parse',
   flagBad.length === 0, flagBad.slice(0, 3).join('  ||  '));
const shaky = results.filter(({ r }) => r.parsed && REQUIRED.some(f => r.parsed[f] != null && r.parsed.confidence[f] < S.CONF_MIN));
const blanks = results.filter(({ r }) => r.parsed && REQUIRED.some(f => r.parsed[f] == null));
ok(`the corpus actually exercises unanswered fields (${blanks.length} parses leave at least one blank)`, blanks.length >= 10);
console.log(`     (${shaky.length} parses carry a found-but-unconfident field)`);

/* ═══════════════════════ computePlan, byte for byte ═══════════════════════ */
console.log('\n── 5 · computePlan() is untouched ──');
const FROZEN = fs.readFileSync(path.join(__dirname, 'fixtures', 'computePlan.frozen.txt'), 'utf8').replace(/\r\n/g, '\n');
const start = src.indexOf('\nfunction computePlan(){\n');
const end = src.indexOf('\n}\n', start + 1);
const current = start >= 0 && end > start ? src.slice(start + 1, end + 3) : '';
ok('the frozen fixture is the real function, taken from 1e89f01',
   FROZEN.startsWith('function computePlan(){\n') && FROZEN.split('\n').length > 100);
ok('computePlan() is byte-identical to the frozen copy (after newline normalisation)',
   current === FROZEN,
   current ? `differs: ${current.length} vs ${FROZEN.length} chars` : 'computePlan not found in index.html');
/* Parser identifiers only. An earlier version also looked for plain words like
   "summary", which computePlan has always used in its own comments ("summary
   of what the week covers") — so it failed on a function that had not changed
   by a single byte. */
ok('…and nothing in it refers to the parser',
   !/parseGoalText|normText|GOAL_SIGNALS|sanitizeParsed|draftFromParsed|ratePressure|concerningText|INTAKE_/.test(current));

/* ═══════════════════════ no network, ever ═══════════════════════ */
console.log('\n── 6 · the parser never touched the network ──');
ok(`zero network calls across ${CASES.length} corpus inputs, ${FUZZ} fuzzed inputs and ${ODD.length} odd ones`,
   netCalls === 0, `${netCalls} call(s)`);

/* timing is reported, not asserted — a CI box is not a phone */
{
  const long = 'I want to lose weight and build some strength, 4 days a week, dumbbells and bands at home, bad knees, been training on and off for a while, mon tue thu fri, half marathon in April. '.repeat(3).slice(0, 500);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 1000; i++) S.parseGoalText(long);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`     1000 parses of a 500-character description: ${ms.toFixed(0)} ms (${(ms / 1000).toFixed(3)} ms each)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
