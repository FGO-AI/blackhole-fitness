/* Static checks on the black-hole fragment shader and its JS wiring.

   WHAT THIS PROVES / WHAT IT DOESN'T. There is no GPU here. Nothing below
   compiles GLSL against a driver or draws a pixel. Every assertion is a
   STRING-LEVEL check on the shipped source: structure, declared-vs-used
   identifiers, uniform parity between GLSL and JS, and the presence of each
   ported construct. If a pure-JS GLSL parser happens to be resolvable it is
   used for a real SYNTAX parse — still not a compile. Whether the shader
   compiles and renders correctly can only be established in a browser. */
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, e = '') => { if (c) { pass++; console.log('  PASS  ' + n); }
                               else { fail++; console.log('  FAIL  ' + n + (e ? '  -> ' + e : '')); } };

/* ---- extract the fragment shader exactly as three.js receives it ---- */
const fragM = html.match(/const frag = `\n([\s\S]*?)\n`;\n\n  scene\.add\(/);
ok('fragment shader source located', !!fragM);
const frag = fragM ? fragM[1] : '';
const noComments = frag.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

console.log('\n-- structure (string checks) --');
{
  const count = (s, re) => (s.match(re) || []).length;
  ok('braces balanced', count(noComments, /\{/g) === count(noComments, /\}/g));
  ok('parens balanced', count(noComments, /\(/g) === count(noComments, /\)/g));
  ok('single pass: no render targets or post pipeline anywhere in index.html',
     !/WebGLRenderTarget|EffectComposer|RenderPass|ShaderPass|UnrealBloom/.test(html));
  ok('still renders straight to the canvas element', /new THREE\.WebGLRenderer\(\{ canvas/.test(html));
}

console.log('\n-- uniform parity: GLSL declarations vs the JS uniforms object --');
{
  const glslU = new Set();
  for (const m of noComments.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)) glslU.add(m[1]);
  const jsBlock = (html.match(/const uniforms = \{([\s\S]*?)\n  \};/) || ['', ''])[1];
  const jsU = new Set([...jsBlock.matchAll(/^\s*(\w+):\s*\{/gm)].map(m => m[1]));
  const onlyGlsl = [...glslU].filter(u => !jsU.has(u)), onlyJs = [...jsU].filter(u => !glslU.has(u));
  ok('every GLSL uniform is supplied from JS', onlyGlsl.length === 0, onlyGlsl.join(','));
  ok('every JS uniform is declared in GLSL', onlyJs.length === 0, onlyJs.join(','));
  ok('uPixel and uOct are among them', glslU.has('uPixel') && glslU.has('uOct') && jsU.has('uPixel') && jsU.has('uOct'));
}

console.log('\n-- declared vs used identifiers (approximate static analysis) --');
{
  /* main() body by brace matching */
  const start = noComments.indexOf('void main(){');
  let depth = 0, end = -1;
  for (let i = start; i < noComments.length; i++){
    if (noComments[i] === '{') depth++;
    else if (noComments[i] === '}'){ depth--; if (depth === 0){ end = i; break; } }
  }
  const body = noComments.slice(start, end + 1);
  const stripped = body.replace(/\.[xyzwrgba]{1,4}\b/g, '');            /* drop swizzles */
  /* every declarator in a declaration statement, comma lists included
     (`float cr = cos(uRoll), sr = sin(uRoll);` declares two) — split on commas
     at paren depth 0 and take the name before any '=' */
  const declared = new Set();
  for (const m of stripped.matchAll(/\b(?:float|vec2|vec3|vec4|bool|int|mat2|mat3)\s+([^;{]*?);/g)){
    let depth = 0, cur = ''; const parts = [];
    for (const ch of m[1]){
      if (ch === '(') depth++; else if (ch === ')') depth--;
      if (ch === ',' && depth === 0){ parts.push(cur); cur = ''; } else cur += ch;
    }
    parts.push(cur);
    for (const part of parts){ const nm = part.trim().split(/[\s=]/)[0]; if (/^[A-Za-z_]\w*$/.test(nm)) declared.add(nm); }
  }
  const used = [...stripped.matchAll(/(?<![\w.])([A-Za-z_]\w*)/g)].map(m => m[1]);
  const counts = {}; for (const u of used) counts[u] = (counts[u] || 0) + 1;
  const unused = [...declared].filter(d => (counts[d] || 0) < 2);
  ok('no declared-but-unused locals in main()', unused.length === 0, unused.join(','));

  const builtins = new Set(('gl_FragCoord gl_FragColor length dot cross normalize mix clamp smoothstep step exp pow sin cos atan asin '
    + 'abs max min floor fract sqrt mat2 mat3 vec2 vec3 vec4 float int bool for if else break continue return true false void out in '
    + 'uniform const discard').split(' '));
  const uniforms = new Set([...noComments.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)].map(m => m[1]));
  const funcs = new Set([...noComments.matchAll(/^(?:float|vec2|vec3|vec4|void)\s+(\w+)\s*\(/gm)].map(m => m[1]));
  const undeclared = [...new Set(used)].filter(u => !declared.has(u) && !builtins.has(u) && !uniforms.has(u) && !funcs.has(u));
  ok('no undeclared identifiers in main()', undeclared.length === 0, undeclared.join(','));
  ok('debrisAnalytic is a top-level function, declared after hash and before main',
     funcs.has('debrisAnalytic') && noComments.indexOf('float hash(') < noComments.indexOf('vec3 debrisAnalytic(')
       && noComments.indexOf('vec3 debrisAnalytic(') < noComments.indexOf('void main('));
}

console.log('\n-- one disk-plane read per step --');
{
  const loop = noComments.slice(noComments.indexOf('for(int i=0; i<260; i++)'), noComments.indexOf('if(!captured && length(pos) < 2.2)'));
  ok('the site has no precession matrix (spec: use pos directly)', !/precInv/.test(noComments));
  ok('dPre is assigned exactly once inside the march loop', (loop.match(/vec3 dPre = /g) || []).length === 1);
  ok('the step clamp reads dPre', /abs\(dPre\.y\) \* 0\.42/.test(loop));
  ok('the crossing test reads dPre, not a second transform', /if\(dPre\.y \* npos\.y < 0\.\)/.test(loop) && !/pos\.y \* npos\.y/.test(loop.replace(/dPre\.y \* npos\.y/g, '')));
}

console.log('\n-- each ported construct is present (presence, not behaviour) --');
{
  const has = (label, re) => ok(label, re.test(noComments), 'pattern not found');
  has('BUG 1  aspect fit after p', /float aspect = uRes\.x \/ max\(uRes\.y, 1\.\);\s*float fit = clamp\(1\.28 \/ max\(aspect, 0\.05\), 1\.0, 2\.45\);\s*p \*= fit;/);
  has('BUG 3a step clamp near the disk plane', /if\(rXZpre > 1\.9 && rXZpre < 8\.2\)\{\s*dt = min\(dt, max\(abs\(dPre\.y\) \* 0\.42, 0\.016\)\);/);
  has('BUG 3b exhausted-near-hole rays are captured', /if\(!captured && length\(pos\) < 2\.2\) captured = true;/);
  has('BUG 4  silhouette anti-aliasing before the ring block', /float pixW = uDist \* \(uPixel \* fit\) \/ 2\.05;\s*float silhouette = smoothstep\(0\.0, pixW \* 1\.4, minR - 1\.0\);\s*col \*= silhouette;/);
  has('BUG 4  primary ring sharpness clamped to the pixel grid', /float ringK = min\(140\., 0\.55\/max\(uPixel\*uPixel, 1e-6\)\);\s*float ring = exp\(-graze\*graze\*ringK\);/);
  has('PERF 1 distance-scaled step cap', /float dtMax = mix\(0\.40, 3\.2, smoothstep\(8\.5, 22\.0, r\)\);\s*float dt = clamp\(\.14\*\(r-\.8\), \.028, dtMax\);/);
  has('PERF 2 star layers reduced to three', /for\(float l=1\.; l<3\.5; l\+\+\)/);
  has('PERF 2 galaxy structure uses two noise octaves', /body \*= \.75 \+ \.5\*\(noise\(q\*14\. \+ id\)\*0\.65 \+ noise\(q\*29\. \+ id\)\*0\.35\);/);
  has('fbm loop gated by uOct', /for\(int i=0;i<6;i\+\+\)\{ if\(float\(i\) >= uOct\) break;/);
  has('ADD 1  winding accumulated after npos', /vec3 nvel = vel \+ acc\*dt;\s*windTotal \+= abs\(atan\(length\(cross\(pos,npos\)\), dot\(pos,npos\)\)\);/);
  has('ADD 1  secondary + tertiary rings', /float loops = windTotal \/ 3\.14159;[\s\S]*?float sringK = min\(620\.,[\s\S]*?float tringK = min\(2100\.,/);
  has('ADD 2  path length accumulated at the end of each step', /pos = npos; vel = nvel;\s*traveled \+= dt;/);
  has('ADD 2  debris tested once per pixel, occluded against traveled', /vec3 rockCol = debrisAnalytic\(ro, normalize\(rd\), captured \? traveled : 1e8, rockT\);\s*bool rockFront = \(rockT < 1e8\) && \(rockT < traveled \+ 0\.001\);/);
  has('ADD 2  a front rock wins over everything, dust on top', /if\(rockFront\)\{\s*gl_FragColor = vec4\(rockCol \+ dustCol, 1\.\);\s*return;/);
  has('ADD 3  dust accumulates into its own variable', /vec3 dustCol = vec3\(0\.\);/);
  has('ADD 3  dust survives the captured early return', /if\(captured\)\{ gl_FragColor = vec4\(dustCol, 1\.\); return; \}/);
  has('ADD 3  dust added on the normal path before the filmic curve', /col \+= dustCol;\s*col = 1\.0 - exp\(-col \* 1\.5\);/);
  ok('debris is NOT sampled inside the march loop',
     !/debrisAnalytic/.test(noComments.slice(noComments.indexOf('for(int i=0; i<260; i++)'), noComments.indexOf('traveled += dt;'))));
  ok('the old fixed step cap is gone', !/clamp\(\.14\*\(r-\.8\), \.028, \.40\)/.test(noComments));
  ok('the old fixed ring exponent is gone', !/exp\(-graze\*graze\*140\.\)/.test(noComments));
  ok('the old four-layer star loop is gone', !/l<4\.5/.test(noComments));
}

console.log('\n-- ember palette untouched --');
{
  for (const lit of ['vec3(1.0,.99,.97)', 'vec3(1.0,.80,.52)', 'vec3(.85,.42,.16)', 'vec3(1.,.98,.94)', 'vec3(1.,.62,.30)', 'vec3(1.,.5,.2)'])
    ok('palette literal still present: ' + lit, frag.includes(lit));
  ok('clear colour still 0x0d0f14', /setClearColor\(0x0d0f14, 1\)/.test(html));
  /* on code, not comments: a pre-existing comment describes the hot-spot's "wider bloom" */
  ok('nothing out of scope crept in', !/\b(bloom|vignette|chromatic|anamorphic|jets?|nebula|Kerr|frameDrag|TAA|temporal)\b/.test(noComments));
}

console.log('\n-- JS wiring --');
{
  const init = html.slice(html.indexOf('function initBackground(){'), html.indexOf('/* ================= PAGE SYSTEM'));
  ok('uPixel is set on every resize as 2 / drawingBufferHeight', /uniforms\.uPixel\.value = 2\.0 \/ Math\.max\(dbs\.y, 1\);/.test(init));
  ok('uOct is set from the tier', /uniforms\.uOct\.value = q\.oct;/.test(init));
  ok('five tiers with the raised floor', /\{ scale:0\.55, pr:1\.15, steps:110, oct:3 \}/.test(init) && (init.match(/\{ scale:/g) || []).length === 5);
  ok('applyTier(START_TIER) is called after the TIERS const', init.indexOf('const TIERS = [') < init.indexOf('applyTier(START_TIER);'));
  ok('bootAt is set immediately before the first requestAnimationFrame', /bootAt = performance\.now\(\);\s*requestAnimationFrame\(frame\);/.test(init));
  ok('applyTier records lastTierChange', /function applyTier\(i\)\{[\s\S]*?lastTierChange = performance\.now\(\);/.test(init));
  ok('the old controller is gone', !/DOWN_MS|UP_MS|hasSteppedDown|adaptQuality/.test(init));
  ok('no user-facing quality control was added', !/data-act="(quality|tier)/.test(html));
}

console.log('\n-- optional real syntax parse --');
{
  let parser = null;
  try { parser = require('@shaderfrog/glsl-parser'); } catch (e) { parser = null; }
  if (!parser){
    console.log('  SKIP  @shaderfrog/glsl-parser not resolvable — no syntax parse this run (string checks above still hold)');
  } else {
    let err = null;
    try { parser.parser.parse('precision highp float;\n' + frag); } catch (e) { err = e; }
    ok('GLSL parses (syntax only — NOT a driver compile)', !err, err && String(err.message).slice(0, 160));
  }
}

console.log('\n' + '='.repeat(58) + '\n  ' + pass + ' passed, ' + fail + ' failed\n' + '='.repeat(58));
process.exit(fail ? 1 : 0);
