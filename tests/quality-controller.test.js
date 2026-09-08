/* Drives the REAL adaptive-quality controller out of index.html — initBackground()
   is run in a sandbox with THREE mocked, requestAnimationFrame captured, and
   performance.now() under the test's control — against modelled devices.

   WHAT THIS PROVES / WHAT IT DOESN'T. No GPU, no display. Frame times are a
   MODEL: a render cost per tier, quantised to the display's refresh interval
   the way a real compositor quantises them. What is proven is the controller's
   decision logic against that model: where it converges, how fast, whether it
   oscillates, whether it can lock out. What the real frame cost of each tier
   is on a real device is exactly what cannot be known here. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const js = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').match(/<script>\n([\s\S]*)\n<\/script>/)[1];

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  PASS  ' + n); }
                               else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); } };

function makeEnv({ touch = false, cores = 8, mem = 8 } = {}){
  const spy = { sized: 0, renders: 0 };
  const listeners = {};
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
  const sb = {
    window: win, THREE, console: { log(){}, warn(){}, error(){} },
    matchMedia: q => ({ matches: q.includes('coarse') ? touch : false }),
    navigator: { hardwareConcurrency: cores, deviceMemory: mem },
    document: { getElementById: () => el(), createElement: () => el(), activeElement: null, addEventListener(){} },
    IntersectionObserver: class { observe(){} unobserve(){} },
    addEventListener: (t, fn) => { listeners[t] = fn; }, setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => now },
    requestAnimationFrame: fn => { pendingFrame = fn; },
    devicePixelRatio: 2, innerWidth: 1280, innerHeight: 800,
    localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
    location: { href:'http://x/', origin:'http://x', pathname:'/', protocol:'http:' },
  };
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(js.slice(0, js.indexOf('/* boot */')) + '\n;Object.assign(globalThis,{initBackground});\n', sb);
  return {
    sb, spy,
    setNow: v => { now = v; },
    takeFrame: () => { const f = pendingFrame; pendingFrame = null; return f; },
    perf: () => sb.window.__bhPerf(),
    fire: t => { if (listeners[t]) listeners[t](); },
  };
}

/* Run the real frame loop against a modelled device. cost[tier] is the ms the
   GPU needs at that tier; the compositor quantises that to whole refresh
   intervals, which is what requestAnimationFrame actually delivers. */
function simulate({ hz = 60, cost, seconds = 40, profile = {}, stallMs = 0, firstFrameAt = 16.7, cheapEvery = 0 }){
  const env = makeEnv(profile);
  env.setNow(0);
  env.sb.initBackground();
  const startTier = env.perf().tier, sizedBeforeFirstFrame = env.spy.sized;
  const interval = 1000 / hz;
  const history = [];                        /* [t, tier] after each frame */
  let frame = env.takeFrame(), t = firstFrameAt;
  while (t < seconds * 1000){
    env.setNow(t); frame(t); frame = env.takeFrame();
    const tier = env.perf().tier;
    history.push([t, tier]);
    let c = cost[tier];
    if (t < stallMs) c = 200;                /* shader compile / JIT stall */
    if (cheapEvery && history.length % cheapEvery === 0) c *= 0.55;   /* view-dependent cost: a frame with less disk on screen */
    t += Math.max(1, Math.ceil(c / interval - 1e-9)) * interval;
  }
  return { env, startTier, sizedBeforeFirstFrame, history, final: env.perf() };
}
/* time-weighted share of a tier over [from, to] */
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

console.log('\n-- device profile picks the starting tier before the first frame --');
{
  ok('desktop → tier 0', simulate({ cost:{0:8,1:6,2:5,3:4,4:3}, seconds:0.1 }).startTier === 0);
  ok('touch, capable → tier 1', simulate({ cost:{0:8,1:6,2:5,3:4,4:3}, seconds:0.1, profile:{ touch:true, cores:8, mem:8 } }).startTier === 1);
  ok('touch, 4 cores → tier 2 (weak)', simulate({ cost:{0:8,1:6,2:5,3:4,4:3}, seconds:0.1, profile:{ touch:true, cores:4, mem:8 } }).startTier === 2);
  ok('touch, 4 GB → tier 2 (weak)', simulate({ cost:{0:8,1:6,2:5,3:4,4:3}, seconds:0.1, profile:{ touch:true, cores:8, mem:4 } }).startTier === 2);
  const r = simulate({ cost:{0:8,1:6,2:5,3:4,4:3}, seconds:0.1 });
  ok('the renderer was sized BEFORE the first frame (applyTier at boot)', r.sizedBeforeFirstFrame > 0);
  ok('tier 0 budgets applied at boot: 250 steps, 6 octaves', r.final.steps === 250 && r.final.oct === 6);
  ok('uPixel = 2 / drawingBufferHeight', Math.abs(r.final.uPixel - 2 / 600) < 1e-12, String(r.final.uPixel));
}

console.log('\n-- THE SPEC SCENARIO: 60 Hz display, true capacity is tier 1 --');
{
  const cost = { 0:24, 1:15, 2:12, 3:10, 4:9 };        /* tier 0 misses vsync; everything else fits */
  const r = simulate({ hz:60, cost, seconds:40 });
  const h = r.history, tr = transitions(h);
  ok('starts at tier 0', r.startTier === 0);
  ok('converges on tier 1 within 3 s', firstTimeAt(h, 1) <= 3000, 'first at ' + firstTimeAt(h, 1) + 'ms');
  ok('no tier change during the 1.5 s warm-up', !tr.some(([t]) => t < 1500), JSON.stringify(tr.slice(0, 3)));
  ok('never sinks below tier 1', !h.some(([, t]) => t > 1), 'max tier ' + Math.max(...h.map(x => x[1])));
  ok('holds tier 1 for ≥ 85% of the time after converging', share(h, 1, 3000, 40000) >= 0.85, share(h, 1, 3000, 40000).toFixed(3));
  const probes = tr.filter(([, t]) => t === 0);
  ok('it still PROBES upward — no permanent lockout', probes.length >= 1, 'probes: ' + probes.length);
  const retreats = tr.filter(([, t]) => t === 1);
  ok('every probe retreats within one check interval', probes.every(([pt]) => { const rt = retreats.find(([t]) => t > pt); return rt && rt[0] - pt <= 1500; }));
  const gaps = probes.slice(1).map(([t], i) => t - probes[i][0]);
  ok('cooldown grows between probes (no oscillation)', gaps.every((g, i) => i === 0 || g >= gaps[i - 1]), gaps.join(','));
  ok('learned the real refresh interval (~16.7 ms × 1.02)', Math.abs(r.final.refreshMs - 17.0) < 0.3, String(r.final.refreshMs));
}

console.log('\n-- BUG FIX 2: a compile stall at load must not park it at the floor --');
{
  const cost = { 0:24, 1:15, 2:12, 3:10, 4:9 };
  const r = simulate({ hz:60, cost, seconds:40, stallMs:1200 });   /* 200 ms frames for the first 1.2 s */
  ok('still converges on tier 1', share(r.history, 1, 5000, 40000) >= 0.85, share(r.history, 1, 5000, 40000).toFixed(3));
  ok('never went below tier 1 because of the stall', !r.history.some(([, t]) => t > 1));
}
{
  /* the first requestAnimationFrame delta is measured from initialisation, not
     from a previous frame. Fed straight into the refresh estimate it would say
     "250 Hz display", every tier would read as dropping, and the controller
     would sink to the floor with nothing able to bring it back. */
  const cost = { 0:24, 1:15, 2:12, 3:10, 4:9 };
  const r = simulate({ hz:60, cost, seconds:40, firstFrameAt:4 });
  ok('a 4 ms first-frame delta does not poison the refresh estimate', Math.abs(r.final.refreshMs - 17.0) < 0.3, String(r.final.refreshMs));
  ok('and the device still converges on tier 1, not the floor', share(r.history, 1, 5000, 40000) >= 0.85 && !r.history.some(([, t]) => t > 1));
}

console.log('\n-- other displays and devices --');
{
  /* A faster display can only be LEARNED from a frame that actually hits its
     vsync. With perfectly steady costs a 120 Hz device at a tier rendering in
     two intervals looks exactly like a 60 Hz device pinned at vsync — so it
     holds the tier that gives 60 fps, which is a correct, non-locked outcome. */
  const r = simulate({ hz:120, cost:{ 0:24, 1:14, 2:8, 3:7, 4:6 }, seconds:40 });
  ok('120 Hz, steady costs: settles on the tier that holds 60 fps (tier 1), not the floor', share(r.history, 1, 6000, 40000) >= 0.8 && !r.history.some(([, t]) => t > 1), share(r.history, 1, 6000, 40000).toFixed(3));
  ok('120 Hz, steady costs: refresh estimate stays at the 60 Hz cap', Math.abs(r.final.refreshMs - 17.0) < 0.3, String(r.final.refreshMs));
  /* real frame cost varies with the view; once one cheap frame lands on an
     8.3 ms interval the true refresh is learned and the controller steps down
     to the tier that holds 120 */
  const v = simulate({ hz:120, cost:{ 0:24, 1:14, 2:8, 3:7, 4:6 }, seconds:40, cheapEvery:7 });
  ok('120 Hz, varying costs: learns ~8.3 ms from a fast frame', Math.abs(v.final.refreshMs - 8.5) < 0.3, String(v.final.refreshMs));
  ok('120 Hz, varying costs: converges on the tier that actually holds 120 (tier 2)', share(v.history, 2, 8000, 40000) >= 0.8, share(v.history, 2, 8000, 40000).toFixed(3));
}
{
  const r = simulate({ hz:60, cost:{ 0:9, 1:8, 2:7, 3:6, 4:5 }, seconds:40 });
  ok('a fast desktop stays at tier 0 the whole time', transitions(r.history).length === 0 && r.final.tier === 0);
}
{
  /* a device that only holds vsync at the floor: must sink to it, then keep
     probing one tier up and retreating — never parked */
  const r = simulate({ hz:60, cost:{ 0:60, 1:50, 2:40, 3:30, 4:12 }, seconds:60 });
  const tr = transitions(r.history);
  ok('a device that holds only the floor reaches it', r.history.some(([, t]) => t === 4));
  ok('…and still probes upward from the floor afterwards (no lockout)', tr.some(([, tier], i) => tier === 3 && i && tr[i - 1][1] === 4), JSON.stringify(tr));
  ok('…and comes back to the floor after each probe', tr.filter(x => x[1] === 3).length <= tr.filter(x => x[1] === 4).length);
}
{
  /* a device that drops at EVERY tier, floor included: it sinks and holds —
     probing up from a tier that is already dropping would be pointless */
  const r = simulate({ hz:60, cost:{ 0:60, 1:50, 2:45, 3:40, 4:36 }, seconds:40 });
  ok('a device that drops even at the floor sinks to it and stays', r.final.tier === 4 && transitions(r.history).length === 4);
}
{
  const r = simulate({ hz:60, cost:{ 0:24, 1:15, 2:12, 3:10, 4:9 }, seconds:40, profile:{ touch:true, cores:8, mem:8 } });
  ok('a capable phone starting at tier 1 simply stays there', share(r.history, 1, 0, 40000) >= 0.9, share(r.history, 1, 0, 40000).toFixed(3));
}

console.log('\n-- resize --');
{
  const env = makeEnv(); env.setNow(0); env.sb.initBackground();
  const before = env.perf();
  env.spy.sized = 0;
  env.fire('resize');
  const after = env.perf();
  ok('a resize re-sizes the renderer', env.spy.sized === 1);
  ok('…keeps the tier and re-derives uPixel', after.tier === before.tier && Math.abs(after.uPixel - 2 / 600) < 1e-12);
  ok('__bhPerf exposes what a tester needs', ['tier','steps','scale','pr','oct','uPixel','avgFrameMs','fps','refreshMs','probing','coolUntil','downgrades','startTier']
       .every(k => k in before), Object.keys(before).join(','));
}

console.log('\n' + '='.repeat(58) + '\n  ' + pass + ' passed, ' + fail + ' failed\n' + '='.repeat(58));
process.exit(fail ? 1 : 0);
