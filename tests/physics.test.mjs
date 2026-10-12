import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PARAMS, withDefaults, derive, createState, step, advance, observables, solveForResonance, simulate,
} from '../js/physics.js';

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
  const stiff = withDefaults({ springK: 19 });
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
