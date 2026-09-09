/* Drives the REAL adaptive-quality controller and frame-cap policy out of
   index.html — initBackground() is run in a sandbox with THREE mocked,
   requestAnimationFrame captured, and performance.now() under the test's
   control — against modelled devices.

   WHAT THIS PROVES / WHAT IT DOESN'T. No GPU, no display. Frame times are a
   MODEL: a render cost per tier, quantised to the display's refresh interval
   the way a real compositor quantises them; a skipped (capped) frame costs one
   interval. What is proven is the decision logic against that model — where
   it converges, how fast, whether it oscillates, whether it can lock out, what
   the cap does to dt. What the real frame cost of each tier is on a real
   device is exactly what cannot be known here. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const js = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').match(/<script>\n([\s\S]*)\n<\/script>/)[1];

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  PASS  ' + n); }
                               else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); } };

function makeEnv({ touch = false, cores = 8, mem = 8, rm = false, battery = null } = {}){
  const spy = { sized: 0, renders: 0 };
  const winL = {}, docL = {};
  let now = 0, pendingFrame = null;
  const V2 = class { constructor(x=0,y=0){ this.x=x; this.y=y; } copy(o){ this.x=o.x; this.y=o.y; return this; } };
  const THREE = {
    WebGLRenderer: class { constructor(){} setClearColor(){} setPixelRatio(){} setSize(){ spy.sized++; }
                           getDrawingBufferSize(t){ t.x = 800; t.y = 600; return t; } render(){ spy.renders++; } },
    Scene: class { add(){} }, OrthographicCamera: class {}, Vector2: V2,
    Matrix3: class { setFromMatrix4(){ return this; } }, Matrix4: class { makeRotationFromEuler(){ return this; } },
    Euler: class { set(){ return this; } }, Mesh: class {}, PlaneGeometry: class {},
    ShaderMaterial: class { constructor(o){ Object.assign(this, o); } },
  };
  const el = () => ({ addEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
                      appendChild(){}, remove(){}, classList:{ toggle(){}, add(){}, remove(){} },
                      textContent:'', dataset:{}, style:{}, innerHTML:'' });
  const win = { THREE };
  if (touch) win.ontouchstart = null;
  const doc = { hidden: false, getElementById: () => el(), createElement: () => el(), activeElement: null,
                addEventListener: (t, fn) => { docL[t] = fn; } };
  const nav = { hardwareConcurrency: cores, deviceMemory: mem };
  if (battery) nav.getBattery = battery;
  const sb = {
    window: win, THREE, console: { log(){}, warn(){}, error(){} },
    matchMedia: q => ({ matches: q.includes('coarse') ? touch : q.includes('reduced-motion') ? rm : false }),
    navigator: nav, document: doc,
    IntersectionObserver: class { observe(){} unobserve(){} },
    addEventListener: (t, fn) => { winL[t] = fn; }, setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => now },
    requestAnimationFrame: fn => { pendingFrame = fn; },
    devicePixelRatio: 2, innerWidth: 1280, innerHeight: 800,
    localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
    location: { href:'http://x/', origin:'http://x', pathname:'/', protocol:'http:' },
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(js.slice(0, js.indexOf('/* boot */')) + '\n;Object.assign(globalThis,{initBackground,noteInteraction});\n', sb);
  return {
    sb, spy, doc,
    setNow: v => { now = v; },
    takeFrame: () => { const f = pendingFrame; pendingFrame = null; return f; },
    perf: () => sb.window.__bhPerf(),
    fireWin: t => { if (winL[t]) winL[t](); },
    fireDoc: t => { if (docL[t]) docL[t](); },
    tap: () => { if (winL.pointerdown) winL.pointerdown(); },
  };
}

/* Run the real frame loop against a modelled device. cost[tier] is the ms the
   GPU needs at that tier. Every rAF tick lands on a vsync; a frame that
   renders occupies ceil(cost/interval) intervals, a frame the cap skips
   occupies one. The controller is what decides which happens. */
function simulate({ hz = 60, cost, seconds = 40, profile = {}, stallMs = 0, firstFrameAt = 16.7, cheapEvery = 0, onTick = null }){
  const env = makeEnv(profile);
  env.setNow(0);
  env.sb.initBackground();
  const startTier = env.perf().tier, sizedBeforeFirstFrame = env.spy.sized;
  const interval = 1000 / hz;
  const history = [], rendered = [];              /* [t, tier] per tick; t of each rendered frame */
  let frame = env.takeFrame(), t = firstFrameAt;
  while (t < seconds * 1000){
    if (onTick) onTick(env, t);
    env.setNow(t);
    const before = env.spy.renders;
    frame(t); frame = env.takeFrame();
    const didRender = env.spy.renders > before;
    const tier = env.perf().tier;
    history.push([t, tier, didRender]);
    if (!frame) break;                             /* loop stopped (reduced motion / hidden) */
    let n = 1;
    if (didRender){
      rendered.push(t);
      let c = cost[tier];
      if (t < stallMs) c = 200;
      if (cheapEvery && history.length % cheapEvery === 0) c *= 0.55;
      n = Math.max(1, Math.ceil(c / interval - 1e-9));
    }
    t += n * interval;
  }
  return { env, startTier, sizedBeforeFirstFrame, history, rendered, final: env.perf(), nextFrame: frame, stoppedAt: frame ? null : t };
}
function share(history, tier, from, to){
  let inT = 0, total = 0;
  for (let i = 1; i < history.length; i++){
    const [t0, tr] = history[i - 1], [t1] = history[i];
    if (t1 <= from || t0 >= to) continue;
    const d = Math.min(t1, to) - Math.max(t0, from);
    total += d; if (tr === tier) inT += d;
  }
  return total ? inT / total : 0;
}
const firstTimeAt = (history, tier) => (history.find(([, tr]) => tr === tier) || [Infinity])[0];
const transitions = history => history.filter(([, tr], i) => i && tr !== history[i - 1][1]).map(([t, tr]) => [t, tr]);
const gapsBetween = ts => ts.slice(1).map((v, i) => +(v - ts[i]).toFixed(2));

console.log('\n-- device profile: start at top quality, one step down only for a weak profile --');
{
  const cheap = { 0:8, 1:6, 2:5, 3:4, 4:3 };
  ok('desktop → tier 0', simulate({ cost:cheap, seconds:0.1 }).startTier === 0);
  ok('capable phone → tier 0 (top quality first)', simulate({ cost:cheap, seconds:0.1, profile:{ touch:true, cores:8, mem:8 } }).startTier === 0);
  ok('phone with 4 cores → tier 1', simulate({ cost:cheap, seconds:0.1, profile:{ touch:true, cores:4, mem:8 } }).startTier === 1);
  ok('phone with 4 GB → tier 1', simulate({ cost:cheap, seconds:0.1, profile:{ touch:true, cores:8, mem:4 } }).startTier === 1);
  const r = simulate({ cost:cheap, seconds:0.1 });
  ok('renderer sized BEFORE the first frame (applyTier at boot)', r.sizedBeforeFirstFrame > 0);
  ok('tier 0 budgets at boot: 250 steps, 6 octaves', r.final.steps === 250 && r.final.oct === 6);
  ok('uPixel = 2 / drawingBufferHeight', Math.abs(r.final.uPixel - 2 / 600) < 1e-12);
}

console.log('\n-- FIX 2: dt under a frame cap (the half-speed bug) --');
{
  /* a phone at 60 Hz under the 30 fps active cap. Every other vsync is skipped;
     the rendered frames must be 33.3 ms apart from the CONTROLLER's point of
     view too, which is only true if lastT was not advanced on the skips. */
  const r = simulate({ hz:60, cost:{ 0:8, 1:6, 2:5, 3:4, 4:3 }, seconds:6, profile:{ touch:true } });
  ok('touch device is capped at 30 while active', r.final.frameCap === 30, String(r.final.frameCap));
  const ticks = r.history.length, renders = r.rendered.length;
  ok('roughly every other vsync renders under a 30 cap on 60 Hz', Math.abs(renders / ticks - 0.5) < 0.05, `${renders}/${ticks}`);
  const g = gapsBetween(r.rendered.slice(10, 40));
  ok('rendered frames are one capped interval apart (33.3 ms), not one vsync', g.every(x => Math.abs(x - 33.33) < 0.5), g.slice(0, 6).join(','));
  ok('the controller measures the capped interval — lastT was NOT advanced on skipped frames', Math.abs(r.final.avgFrameMs - 33.33) < 0.5, String(r.final.avgFrameMs));
  ok('a desktop is uncapped and renders every vsync', (() => { const d = simulate({ hz:60, cost:{ 0:8, 1:6, 2:5, 3:4, 4:3 }, seconds:3 }); return d.final.frameCap === 0 && d.rendered.length === d.history.length; })());
}

console.log('\n-- THE SPEC SCENARIO: 60 Hz phone, 30 fps target, true capacity is the top tier --');
{
  /* someone is using the app: a tap every 6 s keeps it out of idle */
  let lastTap = 0;
  const cost = { 0:30, 1:24, 2:18, 3:14, 4:12 };
  const r = simulate({ hz:60, cost, seconds:40, profile:{ touch:true },
                       onTick: (env, t) => { if (t - lastTap >= 6000){ env.tap(); lastTap = t; } } });
  ok('starts at tier 0', r.startTier === 0);
  ok('settles at tier 0 — no tier change at all in 40 s', transitions(r.history).length === 0 && r.final.tier === 0, JSON.stringify(transitions(r.history)));
  ok('reads as pinned at the 30 fps cap, never as dropping', Math.abs(r.final.avgFrameMs - 33.33) < 0.5, String(r.final.avgFrameMs));
  const i = simulate({ hz:60, cost, seconds:40, profile:{ touch:true } });
  ok('left untouched: idles to the 20 fps cap, still no tier change', i.final.frameCap === 20 && Math.abs(i.final.avgFrameMs - 50) < 0.5 && transitions(i.history).length === 0, `${i.final.frameCap} / ${i.final.avgFrameMs}`);
}

console.log('\n-- a weak phone degrades to what holds 30 and stays there --');
{
  const cost = { 0:60, 1:45, 2:30, 3:25, 4:20 };
  let lastTap = 0;
  const r = simulate({ hz:60, cost, seconds:40, profile:{ touch:true, cores:4, mem:4 },
                       onTick: (env, t) => { if (t - lastTap >= 6000){ env.tap(); lastTap = t; } } });
  const h = r.history, tr = transitions(h);
  ok('starts one step down (weak profile)', r.startTier === 1);
  ok('degrades to tier 2 (the first that holds 33 ms) within 3 s', firstTimeAt(h, 2) <= 3000, 'first at ' + firstTimeAt(h, 2));
  ok('never sinks past tier 2', !h.some(([, t]) => t > 2), 'max ' + Math.max(...h.map(x => x[1])));
  ok('holds tier 2 for ≥ 85% of the time after settling', share(h, 2, 3000, 40000) >= 0.85, share(h, 2, 3000, 40000).toFixed(3));
  const probes = tr.filter(([, t]) => t === 1);
  ok('still probes upward — no lockout', probes.length >= 1, 'probes: ' + probes.length);
  const gaps = probes.slice(1).map(([t], i) => t - probes[i][0]);
  ok('cooldown between probes grows — no oscillation', gaps.every((g, i) => i === 0 || g >= gaps[i - 1]), gaps.join(','));
  ok('no tier change during the 1.5 s warm-up', !tr.some(([t]) => t < 1500));
  /* the same phone left untouched: under the idle cap a heavier tier would
     read as pinned, so probing must be suppressed or quality climbs while idle
     and pops back down on the next tap */
  const idle = simulate({ hz:60, cost, seconds:40, profile:{ touch:true, cores:4, mem:4 } });
  ok('while idle it does NOT probe upward — tier holds at 2 the whole time', share(idle.history, 2, 9000, 40000) === 1 && idle.final.frameCap === 20, share(idle.history, 2, 9000, 40000).toFixed(3));
}

console.log('\n-- desktop (uncapped): the vsync-target path still works --');
{
  const r = simulate({ hz:60, cost:{ 0:24, 1:15, 2:12, 3:10, 4:9 }, seconds:40 });
  const h = r.history, tr = transitions(h);
  ok('converges on tier 1 within 3 s', firstTimeAt(h, 1) <= 3000, 'first at ' + firstTimeAt(h, 1));
  ok('holds tier 1 ≥ 85% after converging, probes bounded', share(h, 1, 3000, 40000) >= 0.85 && tr.filter(([, t]) => t === 0).length >= 1);
  ok('learned the display interval (~16.7 × 1.02)', Math.abs(r.final.refreshMs - 17.0) < 0.3, String(r.final.refreshMs));
  const s = simulate({ hz:60, cost:{ 0:24, 1:15, 2:12, 3:10, 4:9 }, seconds:40, stallMs:1200 });
  ok('a compile stall at load does not park it at the floor', share(s.history, 1, 5000, 40000) >= 0.85 && !s.history.some(([, t]) => t > 1));
  const f = simulate({ hz:60, cost:{ 0:24, 1:15, 2:12, 3:10, 4:9 }, seconds:40, firstFrameAt:4 });
  ok('a 4 ms first-frame delta does not poison the refresh estimate', Math.abs(f.final.refreshMs - 17.0) < 0.3 && !f.history.some(([, t]) => t > 1));
  const v = simulate({ hz:120, cost:{ 0:24, 1:14, 2:8, 3:7, 4:6 }, seconds:40, cheapEvery:7 });
  ok('120 Hz desktop learns ~8.3 ms from a fast frame and settles where 120 holds (tier 2)', Math.abs(v.final.refreshMs - 8.5) < 0.3 && share(v.history, 2, 8000, 40000) >= 0.8);
  const d = simulate({ hz:60, cost:{ 0:60, 1:50, 2:45, 3:40, 4:36 }, seconds:40 });
  ok('a device that drops even at the floor sinks to it and stays', d.final.tier === 4 && transitions(d.history).length === 4);
}

console.log('\n-- 120 Hz phone under the cap --');
{
  const r = simulate({ hz:120, cost:{ 0:20, 1:16, 2:12, 3:10, 4:8 }, seconds:20, profile:{ touch:true } });
  const g = gapsBetween(r.rendered.slice(10, 40));
  ok('renders every 4th vsync (33.3 ms) — the cap, not the display, sets the pace', g.every(x => Math.abs(x - 33.33) < 0.5), g.slice(0, 5).join(','));
  ok('stays at tier 0', transitions(r.history).length === 0);
}

console.log('\n-- idle throttle: cap only, never the tier --');
{
  const r = simulate({ hz:60, cost:{ 0:20, 1:16, 2:12, 3:10, 4:8 }, seconds:14, profile:{ touch:true } });
  ok('active for the first 8 s: 30 fps cap', (() => { const e = makeEnv({ touch:true }); e.setNow(0); e.sb.initBackground(); const f = e.takeFrame(); e.setNow(100); f(100); return e.perf().frameCap === 30; })());
  ok('after 8 s untouched: cap drops to 20', r.final.frameCap === 20 && r.final.idle === true, String(r.final.frameCap));
  const gA = gapsBetween(r.rendered.filter(t => t > 2000 && t < 7500)), gI = gapsBetween(r.rendered.filter(t => t > 9500));
  ok('rendered cadence goes from 33.3 ms to 50 ms', gA.every(x => Math.abs(x - 33.33) < 0.5) && gI.every(x => Math.abs(x - 50) < 0.5), `${gA[0]} → ${gI[0]}`);
  ok('the tier did NOT change on the idle transition', transitions(r.history).length === 0);
  /* interaction brings it straight back */
  const env = r.env; let frame = r.nextFrame; let t = r.history[r.history.length - 1][0];
  env.setNow(t + 50); env.tap();
  t += 50; env.setNow(t); frame(t); frame = env.takeFrame();
  ok('a tap restores the 30 cap on the very next frame', env.perf().frameCap === 30 && env.perf().idle === false, String(env.perf().frameCap));
  /* the page system counts too */
  const e2 = makeEnv({ touch:true }); e2.setNow(0); e2.sb.initBackground(); let f2 = e2.takeFrame();
  e2.setNow(9000); f2(9000); f2 = e2.takeFrame();
  ok('9 s in with no interaction: idle', e2.perf().frameCap === 20);
  e2.setNow(9010); e2.sb.noteInteraction(); f2(9010 + 60);
  ok('noteInteraction() (what navigation and scroll call) restores the active cap', e2.perf().frameCap === 30);
}

console.log('\n-- hidden tab: paused entirely, resumes without a stall --');
{
  const env = makeEnv({ touch:true }); env.setNow(0); env.sb.initBackground();
  let frame = env.takeFrame();
  env.setNow(100); frame(100); frame = env.takeFrame();
  const r0 = env.spy.renders;
  env.doc.hidden = true;
  env.setNow(150); frame(150); const after = env.takeFrame();
  ok('with document.hidden the frame renders nothing and schedules nothing', env.spy.renders === r0 && after === null);
  env.doc.hidden = false; env.setNow(30000); env.tap(); env.fireDoc('visibilitychange');   /* the user came back and touched it */
  const resumed = env.takeFrame();
  ok('visibilitychange (visible) schedules exactly one frame', typeof resumed === 'function' && env.takeFrame() === null);
  env.fireDoc('visibilitychange');
  ok('a second visibilitychange does not start a second loop', env.takeFrame() === null);
  env.setNow(30034); resumed(30034);
  ok('the frame after resume renders', env.spy.renders === r0 + 1);
  /* the 30 s away must not be read as a 30 s frame */
  let f = env.takeFrame(), t = 30034;
  for (let i = 0; i < 40; i++){ t += 33.33; env.setNow(t); f(t); f = env.takeFrame(); }
  ok('measured frame time after resume is the normal cadence, not the gap', env.perf().avgFrameMs < 40, String(env.perf().avgFrameMs));
}

console.log('\n-- battery: feature-detected, optional, reversible --');
{
  ok('no getBattery at all is a silent no-op', (() => { const e = makeEnv({ touch:true }); e.setNow(0); e.sb.initBackground(); return e.perf().lowBattery === false; })());
  ok('a getBattery that throws is swallowed', (() => { const e = makeEnv({ touch:true, battery: () => { throw new Error('nope'); } }); e.setNow(0); e.sb.initBackground(); return e.perf().lowBattery === false; })());
  const listeners = {};
  const batt = { level: 0.1, charging: false, addEventListener: (t, fn) => { listeners[t] = fn; } };
  const env = makeEnv({ touch:true, battery: () => Promise.resolve(batt) });
  env.setNow(0); env.sb.initBackground();
  const startTier = env.perf().tier;
  (async () => {
    await Promise.resolve(); await Promise.resolve();
    let frame = env.takeFrame(); env.setNow(100); frame(100); frame = env.takeFrame();
    ok('low and not charging: one tier down and the idle cap, even while active', env.perf().tier === startTier + 1 && env.perf().frameCap === 20 && env.perf().lowBattery === true, JSON.stringify(env.perf()));
    batt.charging = true; listeners.chargingchange();
    env.setNow(150); frame(150); frame = env.takeFrame();
    ok('charging again: tier and cap restored', env.perf().tier === startTier && env.perf().frameCap === 30 && env.perf().lowBattery === false, JSON.stringify(env.perf()));
    batt.charging = false; batt.level = 0.5; listeners.levelchange();
    env.setNow(200); frame(200);
    ok('unplugged at 50%: not low, nothing changes', env.perf().tier === startTier && env.perf().lowBattery === false);

    console.log('\n-- reduced motion: one static frame, then nothing --');
    {
      const e = makeEnv({ touch:true, rm:true }); e.setNow(0); e.sb.initBackground();
      const f = e.takeFrame();
      ok('one frame is scheduled at boot', typeof f === 'function');
      e.setNow(16); f(16);
      ok('it renders once and schedules no further frame', e.spy.renders === 1 && e.takeFrame() === null);
    }

    console.log('\n-- resize --');
    {
      const e = makeEnv(); e.setNow(0); e.sb.initBackground();
      const before = e.perf(); e.spy.sized = 0; e.fireWin('resize'); const after = e.perf();
      ok('a resize re-sizes the renderer, keeps the tier, re-derives uPixel', e.spy.sized === 1 && after.tier === before.tier && Math.abs(after.uPixel - 2 / 600) < 1e-12);
      ok('__bhPerf exposes what a tester needs', ['tier','steps','scale','pr','oct','uPixel','avgFrameMs','fps','refreshMs','probing','coolUntil','downgrades','startTier','frameCap','idle','lowBattery','isTouch'].every(k => k in before), Object.keys(before).join(','));
    }

    console.log('\n' + '='.repeat(58) + '\n  ' + pass + ' passed, ' + fail + ' failed\n' + '='.repeat(58));
    process.exit(fail ? 1 : 0);
  })();
}
