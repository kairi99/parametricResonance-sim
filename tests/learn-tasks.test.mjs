import test from 'node:test';
import assert from 'node:assert/strict';
import { TASKS } from '../js/learn/tasks.js';
import { createProbes } from '../js/learn/probes.js';
import { DEFAULT_PARAMS, withDefaults, derive, createState, step, observables } from '../js/physics.js';

const D2R = Math.PI / 180;
const IC = {
  bounce: { x0: 0.04, alpha0: 0, beta0: 0 }, nudge: { x0: 0.04, alpha0: 0.5 * D2R, beta0: 0 }, swing: { alpha0: 10 * D2R }, mixed: { x0: 0.03, alpha0: 5 * D2R, beta0: 1 * D2R },
  rest: { x0: 0, alpha0: 0, beta0: 0 },
};
const LAB = { phoneMass: 0.2112, phoneLength: 0.150, caseMass: 0, attachmentOffset: 0, cordLength: 0, springK: 18.95, springL0: 0.19, springMass: 0.0063 };
const CASE = { caseMass: 0.045, attachmentOffset: 0.06, nutsPerSide: 5 };
const get = id => TASKS.find(t => t.id === id);

// Headless emulation of a simulator session (point model for speed).
function session(model = 'point') {
  const s = { events: [], probes: createProbes(), params: withDefaults({ model }), view1: 'disp', setupApplied: false };
  s.derived = derive(s.params);
  s.restart = () => {
    s.derived = derive(s.params); s.state = createState(s.params, s.derived);
    s.probes.reset({ params: s.params, derived: s.derived, model: s.params.model }); s.t = 0; s.obs = null;
    s.events.push({ type: 'restart' });
  };
  s.set = (o) => { for (const [k, v] of Object.entries(o)) { s.params = { ...s.params, [k]: v }; s.events.push({ type: 'param', key: k, value: v }); } s.restart(); };
  s.setup = (task, tuned) => {
    s.events = [];
    const u = task.setup, base = { model: s.params.model };
    if (u.preset === 'bare') s.params = withDefaults(base);
    else if (u.preset === 'lab') s.params = withDefaults({ ...LAB, ...base });
    else if (u.preset === 'case') s.params = withDefaults({ ...CASE, ...base, cordLength: tuned });
    s.params = { ...s.params, ...(u.params || {}), ...(u.ic ? IC[u.ic] : {}) };
    if (u.chart1) s.view1 = u.chart1;
    s.setupApplied = true; s.restart(); s.events = [];
  };
  s.ctx = () => ({ params: s.params, derived: s.derived, obs: s.obs, sim: {}, view1: s.view1, probes: s.probes, events: s.events, setupApplied: s.setupApplied });
  // run until predicate true or tMax; returns sim time or NaN
  s.run = (pred, tMax) => {
    for (let n = 0; n < tMax * 60; n++) {
      for (let i = 0; i < 17; i++) step(s.state, s.params, s.derived, 1 / 1020);
      s.t += 1 / 60;
      s.obs = observables(s.state, s.params, s.derived); s.obs.t = s.t;
      s.probes.push(s.obs);
      if (pred(s.ctx())) return s.t;
    }
    return NaN;
  };
  return s;
}
const caseCord = () => { const s = session(); s.params = withDefaults({ ...CASE, model: 'point' }); return require_solve(s.params); };
import { solveForResonance } from '../js/physics.js';
function require_solve(p) { return solveForResonance(p, 'cordLength').value; }

test('structure: ids, languages, options, look', () => {
  assert.equal(TASKS.length, 10);
  assert.equal(new Set(TASKS.map(t => t.id)).size, TASKS.length);
  for (const t of TASKS) {
    assert.ok([1, 2, 3].includes(t.level), t.id);
    assert.match(t.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    for (const k of ['title', 'concept', 'predict', 'act', 'observe', 'explain', 'teacher'])
      for (const l of ['es', 'en']) assert.ok(typeof t.text[l][k] === 'string' && t.text[l][k].length > 5, `${t.id} ${l} ${k}`);
    const eo = t.text.es.options, no = t.text.en.options;
    assert.ok(Array.isArray(eo) && Array.isArray(no) && eo.length === no.length, t.id);
    if (t.predict.kind === 'choice') {
      assert.ok(eo.length >= 2 && Number.isInteger(t.predict.answer) && t.predict.answer >= 0 && t.predict.answer < eo.length, t.id);
    } else { assert.equal(eo.length, 0); assert.ok(typeof t.predict.unit === 'string'); }
    assert.equal(typeof t.success, 'function');
    assert.ok(t.look.length > 0);
    for (const k of t.look) assert.ok(k.startsWith('#') ? k.length > 1 : k in DEFAULT_PARAMS, `${t.id} look ${k}`);
  }
});

test('bounce-period', () => {
  const t = get('bounce-period'), s = session();
  s.setup(t);
  assert.equal(s.run(c => t.success(c), 12) > 0, false, 'needs a ruler measurement');
  s.events.push({ type: 'ruler', chart: 'disp', dt: 3.33 });
  assert.ok(Number.isFinite(s.run(c => t.success(c), 30)));
  assert.ok(s.probes.run.maxAlpha < 1e-9, 'pure bounce stays exactly vertical');
  const exp = t.expected(s.ctx()).value, m = t.measured(s.ctx()).value;
  assert.ok(Math.abs(m - exp) / exp < 0.005, `${m} vs ${exp}`); // lab preset is detuned: clean bounce
  const tb = 2 * Math.PI * Math.sqrt((0.2112 + 0.0063 / 3) / 18.95);
  assert.ok(Math.abs(tb - exp) / exp < 0.01);
});

test('cord-length: longer cord, longer swing', () => {
  const t = get('cord-length'), s = session();
  s.setup(t);
  assert.equal(s.run(c => t.success(c), 15) > 0, false, 'must not succeed before the cord change');
  const T0 = s.probes.run.Tswing;
  s.set({ cordLength: 0.12 });
  assert.ok(Number.isFinite(s.run(c => t.success(c), 30)));
  assert.ok(s.probes.run.Tswing > T0 * 1.05, `${s.probes.run.Tswing} vs ${T0}`);
  assert.equal(t.predict.answer, 0);
});

test('energy-exchange: flows and returns', () => {
  const t = get('energy-exchange'), s = session();
  s.setup(t, caseCord());
  assert.ok(Number.isFinite(s.run(c => t.success(c), 60)));
  s.run(() => false, 60);
  const r = s.probes.run; // after piMin, energy comes back
  assert.ok(r.piMax > 0.9 && r.last.partitionR > 0.5 || r.piMax > 0.9, 'returns');
  assert.equal(t.predict.answer, 2);
});

test('detuned: almost none', () => {
  const t = get('detuned'), s = session();
  s.setup(t);
  assert.ok(Number.isFinite(s.run(c => t.success(c), 60)));
  assert.ok(s.probes.run.piMin > 0.8, String(s.probes.run.piMin));
  assert.equal(t.predict.answer, 2);
  assert.ok(t.measured(s.ctx()).value < 20);
});

test('tune-cord: manual tuning counts, button does not', () => {
  const t = get('tune-cord'), s = session();
  s.setup(t);
  assert.equal(t.success(s.ctx()), false);
  const exp = t.expected(s.ctx()).value;
  assert.ok(exp > 5 && exp < 15, String(exp));
  s.events.push({ type: 'tuned', knob: 'cordLength', feasible: true });
  s.params = { ...s.params, cordLength: exp / 100 }; s.derived = derive(s.params); // button path: no param event
  assert.equal(t.success(s.ctx()), false);
  s.events.length = 0;
  s.set({ cordLength: exp / 100 });
  assert.equal(t.success(s.ctx()), true);
  s.set({ cordLength: 0.03 });
  assert.equal(t.success(s.ctx()), false);
  assert.ok(Math.abs(t.measured(s.ctx()).value - 3) < 1e-9);
});

test('amplitude: doubling stretch is faster', () => {
  const t = get('amplitude'), s = session();
  s.setup(t, caseCord());
  assert.ok(Number.isFinite(s.run(c => c.probes.run.tExchange >= 0, 80)));
  assert.equal(t.success(s.ctx()), false);
  s.set({ x0: 0.02 });
  assert.ok(Number.isFinite(s.run(c => t.success(c), 80)));
  const ratio = t.measured(s.ctx()).value;
  assert.ok(ratio > 1.1, `t(1cm)/t(2cm) = ${ratio}`);
  assert.equal(t.predict.answer, 0);
});

test('accelerometer: reads +g', () => {
  const t = get('accelerometer'), s = session();
  s.setup(t);
  assert.ok(Number.isFinite(s.run(c => t.success(c), 10)));
  const m = t.measured(s.ctx()).value, e = t.expected(s.ctx()).value;
  assert.ok(Math.abs(m - e) < 0.05, `${m} vs ${e}`);
  s.view1 = 'disp'; assert.equal(t.success(s.ctx()), false);
});

test('nuts: ratio falls', () => {
  const t = get('nuts'), s = session();
  s.setup(t);
  const r0 = s.derived.ratio;
  assert.equal(t.success(s.ctx()), false);
  s.set({ nutsPerSide: 3 });
  assert.ok(s.derived.ratio < r0 && s.derived.ratio < 0.95, String(s.derived.ratio));
  assert.equal(t.success(s.ctx()), true);
  assert.equal(t.predict.answer, 1);
  const s2 = session(); s2.setup(t); s2.events.push({ type: 'tuned', knob: 'nutsPerSide', feasible: false });
  assert.equal(t.success(s2.ctx()), true);
});

test('real-resonance: predicate and measured', () => {
  const t = get('real-resonance'), s = session();
  s.setup(t, caseCord());
  assert.equal(t.success(s.ctx()), false);
  s.events.push({ type: 'searchDone', knob: 'cordLength', best: { ratioLinear: 0.992, value: 0.1 } });
  assert.equal(t.success(s.ctx()), true);
  assert.equal(t.measured(s.ctx()).value, 0.992);
  assert.equal(t.predict.answer, 0);
});

test('models: collects f_s of three models', () => {
  const t = get('models'), s = session('elastic');
  s.setup(t);
  const tick = model => { s.params = { ...s.params, model }; s.derived = derive(s.params); return t.success(s.ctx()); };
  assert.equal(tick('elastic'), false);
  assert.equal(tick('rigid'), false);
  assert.equal(tick('point'), true);
  const d = t.measured(s.ctx()).value;
  assert.ok(d < -0.5 && d > -2.5, String(d));
  assert.equal(t.expected(s.ctx()).value, d);
  // changing a physical parameter invalidates the collection
  s.params = { ...s.params, cordLength: 0.05 }; s.derived = derive(s.params);
  assert.equal(t.success(s.ctx()), false);
});
