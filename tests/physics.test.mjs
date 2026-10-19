import test from 'node:test';
import assert from 'node:assert/strict';
import * as PH from '../js/physics.js';
import * as EL from '../js/elastic.js';
const { DEFAULT_PARAMS, createState, step, advance, observables } = PH;
// v2 tests rely on the 'rigid' default; the library default is now 'elastic'. Wrappers keep the old tests unchanged.
const r2 = (p) => ({ model: 'rigid', ...(p || {}) });
const withDefaults = (p) => PH.withDefaults(r2(p));
const derive = (p) => PH.derive(r2(p));
const solveForResonance = (p, k) => PH.solveForResonance(r2(p), k);
const simulate = (p, ...a) => PH.simulate(r2(p), ...a);

const deg = Math.PI / 180;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);

function crossingFreq(samples, key = 'x') {
  const ts = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1][key], b = samples[i][key];
    if (a < 0 && b >= 0 || a > 0 && b <= 0) {
      ts.push(samples[i - 1].t + (samples[i].t - samples[i - 1].t) * a / (a - b));
    }
  }
  const n = ts.length - 1;
  return (n / 2) / (ts[n] - ts[0]);
}

test('1 regression vs lab notebook', () => {
  const d = derive({ model: 'point', phoneMass: 0.2112, phoneLength: 0.150 });
  near(d.fR, 1.5, 0.005, 'fR');
});

test('2 identity ratio^2*4*f = 1', () => {
  let seed = 12345;
  const rnd = (a, b) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return a + (b - a) * seed / 4294967296; };
  for (let i = 0; i < 20; i++) {
    const d = derive({ model: 'point', phoneMass: rnd(0.1, 0.4), springK: rnd(5, 50), springL0: rnd(0.05, 0.4), cordLength: rnd(0, 0.3), gravity: rnd(9.7, 9.9), nutsPerSide: Math.floor(rnd(0, 10)) });
    near(d.ratio * d.ratio * 4 * d.fDeSousa, 1, 1e-12);
  }
});

test('3 static equilibrium', () => {
  const p = withDefaults({ model: 'point',  x0: 0, alpha0: 0, beta0: 0 });
  const d = derive(p); const s = createState(p, d);
  advance(s, p, d, 10);
  const e = Math.hypot(s.q[0], s.q[1], s.q[2] + d.Req);
  assert.ok(e < 1e-9, `err ${e}`);
});

test('4 energy conservation', () => {
  const p = withDefaults({ model: 'point',  dampingModel: 'none', x0: 0.02, alpha0: 5 * deg, beta0: 1 * deg });
  const { samples } = simulate(p, 60, 0.001, 10);
  const E0 = samples[0].Emech;
  for (const o of samples) {
    assert.ok(!o.slack);
    assert.ok(Math.abs(o.Emech - E0) / E0 < 1e-6);
    assert.ok(Math.abs(o.Erel - o.Emech) < 1e-9 * Math.max(1, Math.abs(o.Emech)), `Erel-Emech ${o.Erel - o.Emech}`);
  }
});

test('5 pure vertical small-amplitude', () => {
  const p = withDefaults({ model: 'point',  dampingModel: 'none', alpha0: 0, beta0: 0, x0: 0.005 });
  const { derived, samples } = simulate(p, 20);
  const f = crossingFreq(samples);
  near(f / derived.fR, 1, 0.005, 'freq ratio');
  for (const o of samples) assert.ok(Math.abs(o.alpha) < 1e-12 && Math.abs(o.beta) < 1e-12);
});

test('6 small pure swing', () => {
  const p = withDefaults({ model: 'point',  dampingModel: 'none', x0: 0, alpha0: 2 * deg, beta0: 0 });
  const { derived, samples } = simulate(p, 30);
  near(crossingFreq(samples, 'alpha') / derived.fS, 1, 0.01, 'swing freq ratio');
});

test('7 linear damping decreases energy', () => {
  const p = withDefaults({ model: 'point',  dampingModel: 'linear' });
  const { samples } = simulate(p, 60);
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i].Emech <= samples[i - 1].Emech + 1e-12);
  assert.ok(samples[samples.length - 1].Emech < 0.9 * samples[0].Emech);
  const q = simulate({ model: 'point', dampingModel: 'quadratic' }, 30).samples;
  assert.ok(q[q.length - 1].Emech < q[0].Emech);
});

test('8 solveForResonance', () => {
  const base = withDefaults({ model: 'point',  nutsPerSide: 10 });
  const c = solveForResonance(base, 'cordLength');
  assert.ok(c.feasible); near(derive(c.params).ratio, 1, 1e-9); near(c.achievedRatio, 1, 1e-9);
  near(derive(c.params).fDeSousa, 0.25, 1e-9);
  const k = solveForResonance(base, 'springK');
  assert.ok(k.feasible); near(derive(k.params).ratio, 1, 1e-9);
  assert.equal(base.springK, DEFAULT_PARAMS.springK);
  // nuts: pick a config below resonance without nuts but reachable: need k*R0 > 3 mG g -> use stiff spring
  const stiff = withDefaults({ model: 'point',  springK: 60 });
  const n = solveForResonance(stiff, 'nutsPerSide');
  assert.ok(n.feasible && Number.isInteger(n.value) && n.value > 0);
  for (const m of [n.value - 1, n.value + 1]) {
    const r = derive({ ...stiff, nutsPerSide: m }).ratio;
    assert.ok(Math.abs(n.achievedRatio - 1) <= Math.abs(r - 1) + 1e-12);
  }
  // infeasible: heavy defaults -> too much mass for cord
  const heavy = withDefaults({ model: 'point',  springK: 60 });
  const hc = solveForResonance(heavy, 'cordLength');
  assert.equal(hc.feasible, false); assert.ok(hc.value < 0);
  assert.equal(solveForResonance({ model: 'point', springK: 5 }, 'nutsPerSide').feasible, false);
});

test('9 autoparametric resonance', () => {
  const base = withDefaults({ model: 'point',  nutsPerSide: 10, dampingModel: 'none', x0: 0.03, alpha0: 0.5 * deg, beta0: 0 });
  const r = solveForResonance(base, 'cordLength');
  assert.ok(r.feasible);
  const { samples } = simulate(r.params, 60);
  const a0 = samples[0].ampS;
  const max = Math.max(...samples.map(o => o.ampS));
  console.log(`  [test 9] ampS initial=${a0.toFixed(5)} rad, max=${max.toFixed(5)} rad (${(max * 180 / Math.PI).toFixed(2)} deg), growth x${(max / a0).toFixed(1)}`);
  assert.ok(max >= 10 * a0);
});

test('10 slack', () => {
  const p = withDefaults({ model: 'point',  x0: 0.2 });
  const d = derive(p);
  assert.ok(p.x0 > d.staticStretch);
  assert.ok(d.warnings.some(w => /slack/.test(w)));
  const { samples } = simulate(p, 20);
  assert.ok(samples.some(o => o.slack === true));
  for (const o of samples) for (const val of [...o.q, ...o.v, o.Emech, o.alpha, o.ampS]) assert.ok(Number.isFinite(val));
});

test('benchmark', () => {
  const p = withDefaults({ model: 'point', }); const d = derive(p); const s = createState(p, d);
  const N = 100000; const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) step(s, p, d, 0.0005);
  const sec = Number(process.hrtime.bigint() - t0) / 1e9;
  console.log(`  [bench] ${N} steps in ${sec.toFixed(3)} s = ${Math.round(N / sec)} steps/s`);
});

test('defaults derived', () => {
  const d = derive({ model: 'point' });
  console.log('  [defaults]', JSON.stringify({ M: d.M, d: d.d, Req: d.Req, fR: d.fR, fS: d.fS, ratio: d.ratio, fDeSousa: d.fDeSousa }));
});

// ======================= v2: rigid-body model =======================
const R_ = (q) => { // rotation matrix rows from quat
  const [w, x, y, z] = q;
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]];
};
const bodyY = (q) => { const R = R_(q); return [R[0][1], R[1][1], R[2][1]]; };
const bodyZ = (q) => { const R = R_(q); return [R[0][2], R[1][2], R[2][2]]; };
const CASE5 = { caseMass: 0.045, attachmentOffset: 0.06, nutsPerSide: 5 };

test('R0 rigid derived values', () => {
  for (const [name, extra] of [['iPhone17 bare', {}], ['case+5 nuts off=0.06', CASE5]]) {
    const d = derive(extra);
    console.log(`  [R3 ${name}] M=${d.M.toFixed(4)} d=${d.d.toFixed(4)} Req=${d.Req.toFixed(4)} fR=${d.fR.toFixed(4)} fS=${d.fS.toFixed(4)} fS2=${d.fS2.toFixed(4)} fSy=${d.fSy.toFixed(4)} fSy2=${d.fSy2.toFixed(4)} ratio=${d.ratio.toFixed(4)} I=${d.inertia.map(v => v.toExponential(4))}`);
    assert.equal(d.model, 'rigid');
  }
});

test('R1 rigid static equilibrium', () => {
  const p = withDefaults({ x0: 0, alpha0: 0, beta0: 0, alignPhone: 1 });
  const d = derive(p); const s = createState(p, d);
  advance(s, p, d, 10);
  const e = Math.hypot(s.q[0], s.q[1], s.q[2] + d.Req);
  assert.ok(e < 1e-8, `pos err ${e}`);
  const y = bodyY(s.quat), z = bodyZ(s.quat);
  near(y[2], 1, 1e-8); near(y[0], 0, 1e-8); near(y[1], 0, 1e-8);
  near(z[1], -1, 1e-8); near(z[0], 0, 1e-8); near(z[2], 0, 1e-8);
});

test('R2 rigid energy conservation', () => {
  for (const extra of [{}, CASE5]) {
    const p = withDefaults({ ...extra, dampingModel: 'none', x0: 0.02, alpha0: 5 * deg, beta0: 1 * deg, alignPhone: 0, tiltX0: 3 * deg, spin0: 0.5 });
    const { samples } = simulate(p, 60, 0.001, 10);
    const E0 = samples[0].Emech;
    let maxd = 0;
    for (const o of samples) {
      assert.ok(!o.slack);
      maxd = Math.max(maxd, Math.abs(o.Emech - E0) / E0);
      assert.ok(Math.abs(o.Erel - o.Emech) <= 1e-9 * Math.abs(o.Emech) + 1e-15);
    }
    console.log(`  [R2] E0=${E0.toExponential(3)} max rel drift=${maxd.toExponential(2)}`);
    assert.ok(maxd < 1e-6);
  }
});

// Linear 2-DOF eigenvector (theta1 spring angle, theta2 body angle) for a plane, mode 'low'|'high'
function modeShape(d, p, I, which) {
  const a = d.Leq, m1 = p.springMass / 3, m1g = p.springMass / 2, M = d.M, b = d.d, g = p.gravity;
  const m11 = (m1 + M) * a * a, m12 = M * a * b, m22 = M * b * b + I, k11 = (m1g + M) * g * a, k22 = M * g * b;
  const A = m11 * m22 - m12 * m12, B = -(k11 * m22 + k22 * m11), C = k11 * k22;
  const disc = Math.sqrt(B * B - 4 * A * C);
  const lam = which === 'low' ? (-B - disc) / (2 * A) : (-B + disc) / (2 * A);
  // (k11 - lam m11) u1 - lam m12 u2 = 0
  const u1 = lam * m12, u2 = k11 - lam * m11;
  return [u1, u2];
}

function freqOf(samples, fn) {
  const ts = [];
  let prev = fn(samples[0]);
  for (let i = 1; i < samples.length; i++) {
    const b = fn(samples[i]);
    if ((prev < 0 && b >= 0) || (prev > 0 && b <= 0)) ts.push(samples[i - 1].t + (samples[i].t - samples[i - 1].t) * prev / (prev - b));
    prev = b;
  }
  const n = ts.length - 1;
  return (n / 2) / (ts[n] - ts[0]);
}

test('R3 rigid linearised frequencies', () => {
  for (const [name, extra] of [['bare', {}], ['case5', CASE5]]) {
    const base = withDefaults({ ...extra, dampingModel: 'none' });
    const d = derive(base);
    // (a) vertical bounce
    {
      const p = { ...base, alpha0: 0, beta0: 0, x0: 0.003 };
      const { samples, derived } = simulate(p, 20);
      near(freqOf(samples, o => o.x) / derived.fR, 1, 0.005, `${name} fR`);
    }
    // (b),(c) mode shapes in the X-Z plane. theta1 = spring angle (alpha-like), theta2 = body angle.
    for (const [which, fkey, tol] of [['low', 'fS', 0.01], ['high', 'fS2', 0.015]]) {
      const [u1, u2] = modeShape(d, base, d.inertia[2], which);
      const amp = 0.01 / Math.max(Math.abs(u1), Math.abs(u2));
      const th1 = u1 * amp, th2 = u2 * amp;
      // spring angle th1 -> attach direction; COM below attach: q = a_vec - d*body_down
      // body down direction angle th2; attach at Leq*(sin th1, -cos th1)
      const ax = d.Leq * Math.sin(th1), az = -d.Leq * Math.cos(th1);
      const qx = ax + d.d * Math.sin(th2), qz = az - d.d * Math.cos(th2);
      const p = { ...base, icMode: 'cartesian', dX0: qx, dY0: 0, dZ0: qz + d.Req, alignPhone: 0, tiltX0: th2 };
      // equilibrium offset: remove second-order z; fine for 0.01 rad
      const { samples } = simulate(p, 30, 0.001, 5);
      const f = freqOf(samples, o => o.q[0]);
      console.log(`  [R3 ${name}] ${fkey}=${d[fkey].toFixed(4)} measured=${f.toFixed(4)}`);
      near(f / d[fkey], 1, tol, `${name} ${fkey}`);
    }
  }
});

test('R4 point-mass limit', () => {
  const common = { dampingModel: 'none', x0: 0.03, alpha0: 4 * deg, beta0: 0 };
  const tiny = withDefaults({ ...common, model: 'rigid', phoneLength: 1e-3, phoneWidth: 1e-3, phoneThickness: 1e-3, attachmentOffset: 0 });
  const pt = withDefaults({ ...common, model: 'point', phoneLength: 1e-3, phoneWidth: 1e-3, phoneThickness: 1e-3, attachmentOffset: 0 });
  const dr = derive(tiny), dp = derive(pt);
  const sr = createState(tiny, dr), sp = createState(pt, dp);
  let maxd = 0;
  for (let i = 0; i < 20000; i++) {
    step(sr, tiny, dr, 0.001); step(sp, pt, dp, 0.001);
    if (i % 20 === 0) maxd = Math.max(maxd, Math.hypot(sr.q[0] - sp.q[0], sr.q[1] - sp.q[1], sr.q[2] - sp.q[2]));
  }
  console.log(`  [R4] max COM deviation ${maxd.toExponential(2)} m`);
  assert.ok(maxd < 1e-4);
});

test('R5 rigid solveForResonance', () => {
  const base = withDefaults({ ...CASE5 });
  for (const knob of ['cordLength', 'springK']) {
    const r = solveForResonance(base, knob);
    assert.ok(r.feasible, `${knob} ${r.note}`);
    near(derive(r.params).ratio, 1, 1e-9, knob); near(r.achievedRatio, 1, 1e-9);
    console.log(`  [R5] ${knob} = ${r.value}`);
  }
  assert.equal(base.cordLength, DEFAULT_PARAMS.cordLength);
  const stiff = withDefaults({ springK: 22 }); // above 2:1 bare, so a few nuts reach it (k = 19 only had a nonphysical ~133-nut crossing)
  const n = solveForResonance(stiff, 'nutsPerSide');
  assert.ok(n.feasible && Number.isInteger(n.value) && n.value > 0);
  assert.equal(solveForResonance(withDefaults({ springK: 60 }), 'nutsPerSide').feasible, false);
  for (const m of [n.value - 1, n.value + 1]) {
    if (m < 0) continue;
    assert.ok(Math.abs(n.achievedRatio - 1) <= Math.abs(derive({ ...stiff, nutsPerSide: m }).ratio - 1) + 1e-12);
  }
  const inf = solveForResonance(withDefaults({ springK: 60 }), 'cordLength');
  assert.equal(inf.feasible, false);
  assert.equal(solveForResonance({ springK: 5 }, 'nutsPerSide').feasible, false);
});

test('R6 rigid autoparametric sanity', () => {
  const base = withDefaults({ ...CASE5, dampingModel: 'none', x0: 0.03, alpha0: 0.5 * deg, beta0: 0 });
  const r = solveForResonance(base, 'cordLength');
  assert.ok(r.feasible);
  const { samples } = simulate({ ...r.params, x0: 0.03, alpha0: 0.5 * deg }, 60);
  const a0 = samples[0].ampS, max = Math.max(...samples.map(o => o.ampS));
  const maxEr = Math.max(...samples.map(o => o.Erot / o.Emech)), maxTilt = Math.max(...samples.map(o => Math.abs(o.tilt)));
  console.log(`  [R6] ampS ${a0.toFixed(5)} -> ${max.toFixed(5)} rad, growth x${(max / a0).toFixed(1)}, max Erot/Emech=${maxEr.toFixed(4)}, max|tilt|=${(maxTilt / deg).toFixed(2)} deg, ratio=${derive(r.params).ratio}`);
  assert.ok(max >= 10 * a0);
});

test('R7 cartesian IC', () => {
  for (const model of ['point', 'rigid']) {
    const p = withDefaults({ model, icMode: 'cartesian', dX0: 0.05, dY0: 0, dZ0: 0.01, alignPhone: 1 });
    const d = derive(p); const s = createState(p, d);
    near(s.q[0], 0.05, 1e-12); near(s.q[1], 0, 1e-12); near(s.q[2], -d.Req + 0.01, 1e-12);
    const o = observables(s, p, d);
    const y = bodyY(o.quat), n = Math.hypot(...s.q);
    for (let i = 0; i < 3; i++) near(y[i], -s.q[i] / n, 1e-9);
    const z = bodyZ(o.quat);
    near(z[0] * y[0] + z[1] * y[1] + z[2] * y[2], 0, 1e-9);
    near(o.tilt, 0, 1e-9);
  }
});

test('R8 rigid slack', () => {
  const p = withDefaults({ dampingModel: 'none', x0: 0.25, alpha0: 3 * deg, alignPhone: 0, tiltX0: 2 * deg });
  const { samples } = simulate(p, 20, 0.0005, 20);
  assert.ok(samples.some(o => o.slack));
  const E0 = samples[0].Emech; let maxd = 0;
  for (const o of samples) {
    for (const val of [...o.q, ...o.v, ...o.attach, ...o.quat, ...o.omega, o.Emech, o.tilt]) assert.ok(Number.isFinite(val));
    maxd = Math.max(maxd, Math.abs(o.Emech - E0) / E0);
  }
  console.log(`  [R8] slack energy drift ${maxd.toExponential(2)}`);
  assert.ok(maxd < 1e-4);
});

test('benchmark both models', () => {
  for (const model of ['point', 'rigid']) {
    const p = withDefaults({ model }); const d = derive(p); const s = createState(p, d);
    const N = 200000; const t0 = process.hrtime.bigint();
    for (let i = 0; i < N; i++) step(s, p, d, 0.0005);
    const sec = Number(process.hrtime.bigint() - t0) / 1e9;
    console.log(`  [bench ${model}] ${Math.round(N / sec)} steps/s`);
  }
});

// ======================= v3: elastic helical-spring model =======================
const E = (extra) => PH.withDefaults({ model: 'elastic', kCalibration: 'unloaded', ...(extra || {}) });
const SEGV = [0, 0, 0], SEGA = [0, 0, 0], SEGB = [0, 0, 0];
const heli = () => {
  const mat = EL.MATERIALS.steel, c = EL.calibrate(18.95, 0.0063, 0.022, 0.19, mat);
  const h = EL.helixProps(c.dw, c.n, 0.022, 0.19, mat);
  return { h, S: EL.makeSegment(h, 12) };
};
const crossF = (ts, vs) => { // mean frequency from zero crossings
  const t = [];
  for (let i = 1; i < vs.length; i++) if (vs[i - 1] < 0 && vs[i] >= 0 || vs[i - 1] > 0 && vs[i] <= 0) t.push(ts[i - 1] + (ts[i] - ts[i - 1]) * vs[i - 1] / (vs[i - 1] - vs[i]));
  return ((t.length - 1) / 2) / (t[t.length - 1] - t[0]);
};
function run(p, T, key, every = 5) {
  const d = PH.derive(p), s = createState(p, d), n = Math.round(T / d.dt), ts = [], vs = [];
  for (let i = 0; i <= n; i++) {
    if (i % every === 0) { const o = observables(s, p, d); ts.push(s.t); vs.push(typeof key === 'function' ? key(o) : o[key]); }
    step(s, p, d, d.dt);
  }
  return { d, ts, vs, s };
}

test('E1 segment W=dU/dLs, K=dU/dpsi vs finite differences', () => {
  const { S } = heli(); let worst = 0;
  for (const [f, psi] of [[1, 0], [2, 0.3], [4, -0.5], [6, 0.8], [0.9, 0.1], [7, 0]]) {
    const L = S.Ls0 * f, e = 1e-7;
    EL.segmentEnergy(S, L, psi, SEGV);
    EL.segmentEnergy(S, L + e * S.l, psi, SEGA); EL.segmentEnergy(S, L - e * S.l, psi, SEGB);
    const W = (SEGA[0] - SEGB[0]) / (2 * e * S.l);
    EL.segmentEnergy(S, L, psi + e, SEGA); EL.segmentEnergy(S, L, psi - e, SEGB);
    const K = (SEGA[0] - SEGB[0]) / (2 * e);
    worst = Math.max(worst, Math.abs(W - SEGV[1]) / (Math.abs(W) + 1e-6), Math.abs(K - SEGV[2]) / (Math.abs(K) + 1e-8));
  }
  console.log(`  [E1] worst relative derivative error ${worst.toExponential(2)}`);
  assert.ok(worst < 1e-6);
});

test('E2 Love/Timoshenko compliance and close-coiled limits', () => {
  const mat = EL.MATERIALS.steel;
  for (const a0deg of [7.15, 1]) {
    const D = 0.022, n = 20, L0 = n * TWO(D, a0deg);
    const h = EL.helixProps(0.0008, n, D, L0, mat), N = 12, S = EL.makeSegment(h, N);
    const g = (L, p) => { EL.segmentEnergy(S, L, p, SEGV); return [SEGV[1], SEGV[2]]; };
    const e = 1e-6, L = S.Ls0;
    const [w1, k1] = g(L + e * S.l, 0), [w2, k2] = g(L - e * S.l, 0), [w3, k3] = g(L, e), [w4, k4] = g(L, -e);
    const H = [[(w1 - w2) / (2 * e * S.l), (w3 - w4) / (2 * e)], [(k1 - k2) / (2 * e * S.l), (k3 - k4) / (2 * e)]];
    const det = H[0][0] * H[1][1] - H[0][1] * H[1][0];
    const comp = [H[1][1] / det, -H[0][1] / det, H[0][0] / det];
    const R0 = D / 2, s = Math.sin(h.alpha0), c = Math.cos(h.alpha0), ls = h.ell / N;
    const ed = ls * R0 * R0 * (c * c / h.C + s * s / h.B), eb = ls * R0 * s * c * (1 / h.C - 1 / h.B), ec = ls * (s * s / h.C + c * c / h.B);
    const errs = [Math.abs(comp[0] / ed - 1), Math.abs(comp[1] / eb - 1), Math.abs(comp[2] / ec - 1)];
    console.log(`  [E2 alpha0=${(h.alpha0 / deg).toFixed(2)}] rel err delta/W, cross, phi/K = ${errs.map(v => v.toExponential(1))}`);
    assert.ok(Math.max(...errs) < 1e-3);
    const kc = mat.G * 0.0008 ** 4 / (8 * D ** 3 * n), kt = mat.E * 0.0008 ** 4 / (64 * D * n);
    console.log(`  [E2] kLin/k_close=${(h.kLin / kc).toFixed(5)} kTwist/kt_close=${(h.kTwist / kt).toFixed(5)}`);
    if (a0deg < 2) { assert.ok(Math.abs(h.kLin / kc - 1) < 1e-2); assert.ok(Math.abs(h.kTwist / kt - 1) < 1e-2); }
  }
});
function TWO(D, a0deg) { return 2 * Math.PI * (D / 2) * Math.tan(a0deg * deg); }

test('E3 fromK calibration', () => {
  const d = PH.derive(E());
  const { h } = heli();
  near(d.kLin / 18.95, 1, 1e-6, 'kLin'); near(d.springMassModel / 0.0063, 1, 1e-6, 'mass');
  console.log(`  [E3] dw=${(d.wireDiameter * 1e3).toFixed(4)} mm n=${d.activeTurns.toFixed(3)} alpha0=${(d.helixAngle0 / deg).toFixed(3)} deg`);
  console.log(`  [defaults] ` + ['kLin', 'kTangentEq', 'kTwist', 'couplingWT', 'Leq', 'Req', 'yawEq', 'fR', 'fS', 'fS2', 'fSy', 'fSy2', 'fTwist', 'fSurge', 'ratio', 'dt', 'fRTextbook', 'kShear', 'kBend'].map(k => `${k}=${d[k].toPrecision(5)}`).join(' '));
  // whole-spring small deflection stiffness from Hessian of the segment model (series of N segments)
  const { S } = heli();
  const e = 1e-6, g = (L, p) => { EL.segmentEnergy(S, L, p, SEGV); return [SEGV[1], SEGV[2]]; };
  const [w1, k1] = g(S.Ls0 + e * S.l, 0), [w2, k2] = g(S.Ls0 - e * S.l, 0), [w3, k3] = g(S.Ls0, e), [w4, k4] = g(S.Ls0, -e);
  const a = (w1 - w2) / (2 * e * S.l), b = (w3 - w4) / (2 * e), c = (k3 - k4) / (2 * e), bc = (k1 - k2) / (2 * e * S.l);
  const kseg = a - b * bc / c;
  near(kseg / 12 / 18.95, 1, 1e-6, 'model Hessian k');
});

test('E4 static equilibrium', () => {
  const p = E({ dampingModel: 'none', x0: 0, alpha0: 0, beta0: 0 });
  const d = PH.derive(p), s = createState(p, d), y0 = Float64Array.from(s.y);
  advance(s, p, d, 5);
  let md = 0; for (let b = 0; b < d.el.nf; b++) for (let k = 0; k < 3; k++) md = Math.max(md, Math.abs(s.y[13 * b + k] - y0[13 * b + k]));
  const com = Math.hypot(s.q[0], s.q[1], s.q[2] + d.Req);
  console.log(`  [E4] Leq=${d.Leq.toFixed(6)} Req=${d.Req.toFixed(6)} yawEq=${d.yawEq.toFixed(5)} rad  seg top=${d.LsEq[0].toFixed(6)} bottom=${d.LsEq[11].toFixed(6)}  node disp ${md.toExponential(1)} COM move ${com.toExponential(1)}`);
  assert.ok(md < 1e-6 && com < 1e-6);
  assert.ok(d.LsEq[0] > d.LsEq[11]);
});

test('E5 energy conservation (elastic, 30 s)', () => {
  const p = E({ dampingModel: 'none', x0: 0.03, alpha0: 5 * deg, beta0: 1 * deg });
  const d = PH.derive(p), s = createState(p, d), E0 = observables(s, p, d).Emech;
  let mx = 0;
  for (let k = 0; k < 30; k++) { advance(s, p, d, 1); mx = Math.max(mx, Math.abs(observables(s, p, d).Emech - E0) / E0); }
  console.log(`  [E5] max |dE|/E0 over 30 s = ${mx.toExponential(2)} (dt=${d.dt})`);
  assert.ok(mx < 1e-5);
});

test('E5b analytic forces = -grad(energy) (rotations, shear, twist)', () => {
  const p = E({ dampingModel: 'none', x0: 0.03, alpha0: 5 * deg, beta0: 3 * deg, tiltX0: 0, alignPhone: 0, spin0: 0.5 });
  const d = PH.derive(p), s = createState(p, d), cx = d.el;
  advance(s, p, d, 0.05);
  const n = 6 * (cx.nf + 1), g = new Float64Array(n), yt = new Float64Array(cx.ny), gp = new Float64Array(n);
  EL.gradMinimal(s.y, cx, g);
  // energy V(y) = U + gravity
  const V = (y) => { const e = EL.energyParts(y, cx); return e.U + e.Vg; };
  let worst = 0, scale = 0;
  for (let j = 0; j < n; j++) scale = Math.max(scale, Math.abs(g[j]));
  for (let j = 0; j < n; j++) {
    const hh = 1e-6; yt.set(s.y);
    const pert = (sgn) => { const o = 13 * Math.floor(j / 6), k = j % 6, y = Float64Array.from(s.y);
      if (k < 3) y[o + k] += sgn * hh; else { const e = [Math.cos(hh / 2), 0, 0, 0]; e[1 + k - 3] = sgn * Math.sin(hh / 2);
        const q = [y[o + 6], y[o + 7], y[o + 8], y[o + 9]]; y[o + 6] = q[0] * e[0] - q[1] * e[1] - q[2] * e[2] - q[3] * e[3];
        y[o + 7] = q[0] * e[1] + q[1] * e[0] + q[2] * e[3] - q[3] * e[2]; y[o + 8] = q[0] * e[2] - q[1] * e[3] + q[2] * e[0] + q[3] * e[1];
        y[o + 9] = q[0] * e[3] + q[1] * e[2] - q[2] * e[1] + q[3] * e[0]; } return y; };
    const fd = (V(pert(1)) - V(pert(-1))) / (2 * hh);
    worst = Math.max(worst, Math.abs(fd - g[j]) / (scale + 1e-12));
  }
  console.log(`  [E5b] worst gradient error / max|grad| = ${worst.toExponential(2)}`);
  assert.ok(worst < 1e-5);
});

test('E6 distributed mass: heavy spring bounce vs continuum', () => {
  const M = 0.177, ms = 0.5 * M; // NB: ms/M = 0.5 keeps the geometry physical (3*M would close the coils)
  const p = E({ springMass: ms, springSegments: 24, dampingModel: 'none', x0: 0.004, alpha0: 0, beta0: 0 });
  const r = run(p, 12, 'x', 10);
  const f = crossF(r.ts, r.vs), d = r.d;
  let lo = 0, hi = Math.PI / 2 - 1e-9; for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (m * Math.tan(m) < ms / M) lo = m; else hi = m; }
  const kk = d.kLin, fExact = lo * Math.sqrt(kk / ms) / (2 * Math.PI), fTb = Math.sqrt(kk / (M + ms / 3)) / (2 * Math.PI);
  console.log(`  [E6] measured ${f.toFixed(4)} Hz, continuum ${fExact.toFixed(4)} (${((f / fExact - 1) * 100).toFixed(2)}%), textbook m/3 ${fTb.toFixed(4)} (${((fTb / fExact - 1) * 100).toFixed(2)}%), fR(linear) ${d.fR.toFixed(4)} warn=${d.warnings}`);
  assert.ok(Math.abs(f / fExact - 1) < 0.015);
  // the m/3 rule is itself accurate to O((ms/M)^2); the simulation must be at least as close to the exact result
  assert.ok(Math.abs(f / fExact - 1) < Math.abs(fTb / fExact - 1));
});

test('E7 torsion frequency', () => {
  const p = E({ dampingModel: 'none', x0: 0, alpha0: 0, beta0: 0, spin0: 0.5 });
  const r = run(p, 12, 'yaw', 10);
  const f = crossF(r.ts, r.vs);
  console.log(`  [E7] yaw measured ${f.toFixed(4)} Hz vs fTwist ${r.d.fTwist.toFixed(4)}`);
  assert.ok(Math.abs(f / r.d.fTwist - 1) < 0.02);
});

test('E8 modes vs simulation', () => {
  let p = E({ dampingModel: 'none', x0: 0.002, alpha0: 0, beta0: 0 });
  let r = run(p, 15, 'x', 10);
  const fR = crossF(r.ts, r.vs);
  p = E({ dampingModel: 'none', x0: 0, alpha0: 0.3 * deg, beta0: 0 });
  r = run(p, 40, 'alpha', 20);
  const fS = crossF(r.ts, r.vs);
  console.log(`  [E8] bounce ${fR.toFixed(4)} vs fR ${r.d.fR.toFixed(4)}; swing ${fS.toFixed(4)} vs fS ${r.d.fS.toFixed(4)}`);
  assert.ok(Math.abs(fR / r.d.fR - 1) < 0.01);
  assert.ok(Math.abs(fS / r.d.fS - 1) < 0.01);
});

test('E9 Wilberforce sanity', () => {
  const base = E({ dampingModel: 'none', x0: 0.02, alpha0: 0, beta0: 0 });
  const d0 = PH.derive(base);
  console.log(`  [E9] couplingWT=${d0.couplingWT.toExponential(3)} N/rad, defaults fR=${d0.fR.toFixed(3)} fTwist=${d0.fTwist.toFixed(3)}`);
  let lo = 0, hi = 0.8; // extraMass: fR decreases, fTwist constant
  const f = (m) => { const d = PH.derive({ ...base, extraMass: m }); return d.fR - d.fTwist; };
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
  const em = (lo + hi) / 2, tuned = { ...base, extraMass: em }, dT = PH.derive(tuned);
  const maxYaw = (pp, T) => { const r = run(pp, T, (o) => Math.abs(o.yaw), 20); return Math.max(...r.vs); };
  const yDet = maxYaw(base, 20), yRes = maxYaw(tuned, 20);
  console.log(`  [E9] extraMass=${em.toFixed(4)} kg: fR=${dT.fR.toFixed(4)} fTwist=${dT.fTwist.toFixed(4)}; max |yaw| from pure bounce: detuned ${yDet.toExponential(2)} rad, tuned ${yRes.toExponential(2)} rad`);
  assert.ok(yRes > 3 * yDet);
});

test('E10 cord / slack', () => {
  const p = E({ cordLength: 0.1, x0: 0.12, dampingModel: 'none', alpha0: 2 * deg });
  const d = PH.derive(p);
  const res = {};
  for (const [label, fac] of [['derived.dt', 1], ['derived.dt/2.5', 0.4]]) {
    const s = createState(p, d), E0 = observables(s, p, d).Emech;
    let mx = 0, slack = false;
    for (let k = 0; k < 100; k++) {
      advance(s, p, d, 0.1, d.dt * fac);
      const o = observables(s, p, d);
      for (const v of [...o.q, o.Emech, o.yaw]) assert.ok(Number.isFinite(v));
      mx = Math.max(mx, Math.abs(o.Emech - E0) / E0); slack = slack || o.slack;
    }
    res[label] = mx;
    console.log(`  [E10] cord 0.1 m, x0 0.12 (slack=${slack}), step ${label}=${(d.dt * fac).toExponential(2)}: energy drift over 10 s ${mx.toExponential(2)}`);
  }
  assert.ok(res['derived.dt/2.5'] < 1e-3);
  assert.ok(res['derived.dt'] < 5e-2);
});

test('E11 performance', () => {
  let t0 = process.hrtime.bigint();
  const p = E({ springSegments: 12 }); PH.derive({ ...p, springK: 18.9501 });
  const dms = Number(process.hrtime.bigint() - t0) / 1e6;
  const d = PH.derive(p), s = createState(p, d);
  const n = 20000; t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) step(s, p, d, d.dt);
  const sec = Number(process.hrtime.bigint() - t0) / 1e9;
  console.log(`  [E11] derive ${dms.toFixed(0)} ms; ${Math.round(n / sec)} steps/s; real-time factor ${(n * d.dt / sec).toFixed(1)}x (dt=${d.dt})`);
  assert.ok(dms < 300);
  assert.ok(n * d.dt / sec >= 8);
});

test('E12 springMass -> 0 limit approaches rigid fR', () => {
  // fromK cannot make a 1e-6 kg spring with D=22 mm (it needs < 1 turn); use 'direct' geometry with a near-massless wire material
  const mk = E({ springGeometry: 'direct', wireMaterial: 'custom', wireE: 200e9, wireG: 79.3e9, wireRho: 1e-3 });
  const de = PH.derive(mk), dr = PH.derive({ ...DEFAULT_PARAMS, model: 'rigid', springK: de.kTangentEq, springMass: de.springMassModel }); // the stretched spring is stiffer: compare at the tangent stiffness at equilibrium
  console.log(`  [E12] model spring mass ${de.springMassModel.toExponential(2)} kg, kLin ${de.kLin.toFixed(3)}`);
  console.log(`  [E12] elastic fR ${de.fR.toFixed(5)} vs rigid fR ${dr.fR.toFixed(5)} (${((de.fR / dr.fR - 1) * 100).toFixed(3)}%)`);
  assert.ok(Math.abs(de.fR / dr.fR - 1) < 0.005, 'see print');
});

test('E13 other models: new observables and dt', () => {
  for (const model of ['point', 'rigid', 'elastic']) {
    const p = E({ model }); const d = PH.derive(p), s = createState(p, d), o = observables(s, p, d);
    assert.ok(d.dt > 0 && o.spring.nodes.length === 3 * o.spring.phase.length && Number.isFinite(o.yaw));
    assert.ok('twistTotal' in o && 'EspringKin' in o && 'EspringEl' in o);
  }
});

test('E14 loaded calibration (kRefLoad)', () => {
  const d = PH.derive(PH.withDefaults({ model: 'elastic' }));
  console.log(`  [E14 defaults] dw=${(d.wireDiameter * 1e3).toFixed(4)} mm n=${d.activeTurns.toFixed(3)} a0=${(d.helixAngle0 / deg).toFixed(3)} kLin=${d.kLin.toFixed(4)} kTangentRef=${d.kTangentRef.toFixed(6)} kTangentEq=${d.kTangentEq.toFixed(4)} fR=${d.fR.toFixed(4)} fS=${d.fS.toFixed(4)} fTwist=${d.fTwist.toFixed(4)} ratio=${d.ratio.toFixed(4)} warn=${d.warnings}`);
  near(d.kTangentRef / 18.95, 1, 1e-6, 'kTangentRef');
  const lab = { model: 'elastic', phoneMass: 0.2112, phoneLength: 0.150 };
  const dl = PH.derive(PH.withDefaults(lab));
  console.log(`  [E14 lab] dw=${(dl.wireDiameter * 1e3).toFixed(4)} mm n=${dl.activeTurns.toFixed(3)} a0=${(dl.helixAngle0 / deg).toFixed(3)} kLin=${dl.kLin.toFixed(4)} kTangentRef=${dl.kTangentRef.toFixed(6)} kTangentEq=${dl.kTangentEq.toFixed(4)} fR=${dl.fR.toFixed(4)} fS=${dl.fS.toFixed(4)} fTwist=${dl.fTwist.toFixed(4)} ratio=${dl.ratio.toFixed(4)}`);
  near(dl.fR / 1.50026, 1, 3e-3, 'lab fR');
  // geometry independent of phone/nut masses
  const d2 = PH.derive(PH.withDefaults({ model: 'elastic', nutsPerSide: 5 }));
  assert.equal(d2.wireDiameter, d.wireDiameter);
  // cord real-time factor
  const p = PH.withDefaults({ model: 'elastic', cordLength: 0.1 }), dc = PH.derive(p), s = createState(p, dc);
  const t0 = process.hrtime.bigint(); for (let i = 0; i < 20000; i++) step(s, p, dc, dc.dt);
  const sec = Number(process.hrtime.bigint() - t0) / 1e9;
  console.log(`  [E14 cord] dt=${dc.dt.toExponential(2)} real-time factor ${(20000 * dc.dt / sec).toFixed(1)}x`);
});

test('E15 elastic solveForResonance robust', () => {
  const p = PH.withDefaults({ model: 'elastic' });
  let r = PH.solveForResonance(p, 'springK');
  console.log(`  [E15] springK -> ${r.value} feasible=${r.feasible} ratio=${r.achievedRatio} derives=${r.derives} ${r.ms} ms`);
  assert.ok(r.feasible && Math.abs(r.achievedRatio - 1) < 1e-6 && Math.abs(r.value / 18.95 - 1) < 0.15);
  r = PH.solveForResonance({ ...p, caseMass: 0.045, attachmentOffset: 0.06, nutsPerSide: 5 }, 'cordLength');
  console.log(`  [E15] cordLength (case+5 nuts) -> ${r.value} feasible=${r.feasible} ratio=${r.achievedRatio} derives=${r.derives} ${r.ms} ms ${r.note}`);
  assert.ok(r.feasible && Math.abs(r.achievedRatio - 1) < 1e-6);
  r = PH.solveForResonance(p, 'nutsPerSide');
  console.log(`  [E15] nuts -> ${r.value} feasible=${r.feasible} derives=${r.derives} ${r.ms} ms ${r.note}`);
  r = PH.solveForResonance({ ...p, springL0: 0.19, extraMass: 5 }, 'springK');
  console.log(`  [E15] infeasible-case value=${r.value} feasible=${r.feasible}`);
});

// ======================= phone sensors: acc, accSensor, gyroSensor =======================
{
  const MODELS = ['point', 'rigid', 'elastic'];
  const mk = (model, extra) => PH.withDefaults({ model, kCalibration: 'unloaded', ...(extra || {}) });
  const clone = (s) => structuredClone(s);
  const stepBy = (s, p, d, h) => { step(s, p, d, h); return s; };
  const qconj = (a) => [a[0], -a[1], -a[2], -a[3]];
  const qm = (a, b) => [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];

  test('S1 static equilibrium: acc = 0, accelerometer = +g along body Y', () => {
    for (const model of MODELS) {
      const p = mk(model, { x0: 0, alpha0: 0, beta0: 0, alignPhone: 1, dampingModel: 'none' });
      const d = PH.derive(p); const s = createState(p, d);
      if (model !== 'elastic') advance(s, p, d, 0.01);
      const o = observables(s, p, d);
      for (let i = 0; i < 3; i++) near(o.acc[i], 0, 1e-8, `${model} acc${i}`);
      near(o.accSensor[0], 0, 1e-6, model); near(o.accSensor[1], p.gravity, 1e-6, model); near(o.accSensor[2], 0, 1e-6, model);
      for (let i = 0; i < 3; i++) near(o.gyroSensor[i], 0, 1e-8, model);
    }
  });

  test('S2 acc equals the central finite difference of v; S3 gyro equals the orientation derivative', () => {
    for (const model of MODELS) {
      const p = mk(model, { x0: 0.05, alpha0: 0.08, beta0: 0.04, dampingModel: model === 'point' ? 'quadratic' : 'linear' });
      const d = PH.derive(p), s = createState(p, d);
      for (let k = 0; k < 400; k++) step(s, p, d, d.dt); // 0.4 s of motion
      const h = 1e-4, o = observables(s, p, d);
      const sp = stepBy(clone(s), p, d, h), sm = stepBy(clone(s), p, d, -h);
      let scale = 0;
      for (let i = 0; i < 3; i++) scale = Math.max(scale, Math.abs(o.acc[i]));
      for (let i = 0; i < 3; i++) near(o.acc[i], (sp.v[i] - sm.v[i]) / (2 * h), 1e-4 * Math.max(scale, 1), `${model} acc${i}`);
      // specific force consistency: accSensor = R^T (acc + g ez)
      const R = R_(o.quat);
      const w = [o.acc[0], o.acc[1], o.acc[2] + p.gravity];
      for (let i = 0; i < 3; i++) near(o.accSensor[i], R[0][i] * w[0] + R[1][i] * w[1] + R[2][i] * w[2], 1e-9, `${model} sensor${i}`);
      // gyro: body-frame rotation between t-h and t+h
      const qOf = (st) => (model === 'point' ? observables(st, p, d).quat : st.quat);
      const dq = qm(qconj(qOf(sm)), qOf(sp));
      const sgn = dq[0] < 0 ? -1 : 1;
      let gs = 0; for (let i = 0; i < 3; i++) gs = Math.max(gs, Math.abs(o.gyroSensor[i]));
      for (let i = 0; i < 3; i++) near(o.gyroSensor[i], sgn * dq[i + 1] / h, 1e-4 * Math.max(gs, 1) + 1e-6, `${model} gyro${i}`);
    }
  });
}
