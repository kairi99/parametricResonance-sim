import test from 'node:test';
import assert from 'node:assert/strict';
import { t, pick, setLang, getLang, onLangChange, STRINGS } from '../js/learn/i18n.js';
import { createProbes } from '../js/learn/probes.js';
import { createEngine } from '../js/learn/engine.js';

const fakeStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m }; };

test('i18n: languages, fallback, substitution', () => {
  assert.equal(Object.keys(STRINGS.es).sort().join(), Object.keys(STRINGS.en).sort().join());
  let n = 0; const off = onLangChange(() => n++);
  setLang('es'); assert.equal(getLang(), 'es'); assert.equal(t('learn'), 'Aprender');
  assert.equal(t('progress', { n: 2, m: 10 }), '2 de 10 completadas');
  assert.equal(pick({ es: 'a', en: 'b' }), 'a'); assert.equal(pick({ en: 'b' }), 'b');
  setLang('en'); assert.equal(t('progress', { n: 2, m: 10 }), '2 of 10 done');
  assert.equal(t('nope'), 'nope'); assert.equal(pick({ es: 'a', en: 'b' }), 'b');
  off(); setLang('es'); assert.equal(n, 2); setLang('en');
});

function feed(p, fn, T, dt = 1 / 60) {
  for (let i = 0; i * dt <= T; i++) p.push({ t: 5 + i * dt, ...fn(i * dt) });
}

test('probes: periods from analytic signals', () => {
  const p = createProbes(); p.reset({ params: { a: 1 }, derived: {}, model: 'point' });
  const Tb = 0.7, Ts = 1.4;
  feed(p, t => ({ x: 0.04 * Math.cos(2 * Math.PI * t / Tb), alpha: 0.05 * Math.cos(2 * Math.PI * t / Ts), beta: 0, partitionR: 0.5 + 0.5 * Math.cos(2 * Math.PI * t / 6), ampR: 1, ampS: 2, accSensor: [0, 3, 9.8] }), 10);
  const r = p.run;
  assert.ok(Math.abs(r.Tbounce - Tb) / Tb < 0.005);
  assert.ok(Math.abs(r.Tswing - Ts) / Ts < 0.005);
  assert.ok(r.piMin < 0.01 && r.piMax > 0.99);
  assert.ok(Math.abs(r.tExchange - 1.5) < 0.05);
  assert.ok(r.tPi03 > r.tExchange);
  assert.equal(r.t0, 5); assert.ok(Math.abs(r.accY - 3) < 1e-9); assert.ok(Math.abs(r.accMeanAll[2] - 9.8) < 1e-9);
  assert.equal(r.x0, 0.04);
});

test('probes: swing falls back to beta; NaN when unmeasurable; history', () => {
  const p = createProbes(); p.reset({});
  assert.ok(Number.isNaN(p.run.Tbounce));
  feed(p, t => ({ x: 0, alpha: 0, beta: 0.02 * Math.sin(2 * Math.PI * t / 1.2 + 0.3), partitionR: NaN, ampR: 0, ampS: 0, accSensor: [0, 0, 0] }), 8);
  assert.ok(Math.abs(p.run.Tswing - 1.2) < 0.01);
  for (let i = 0; i < 12; i++) { p.reset({}); p.push({ t: 0, x: 0, alpha: 0, beta: 0, partitionR: 1, ampR: 0, ampS: 0, accSensor: [0, 0, 0] }); }
  assert.equal(p.history.length, 8);
});

const TASKS = [
  { id: 'n', level: 1, predict: { kind: 'number', unit: 's', decimals: 2 }, success: c => c.ok, measured: () => ({ value: 1.234, unit: 's' }),
    text: { es: { title: 'Número', options: [] }, en: { title: 'Number', options: [] } } },
  { id: 'c', level: 2, predict: { kind: 'choice', answer: 1, options: [] }, success: () => { throw new Error('boom'); },
    text: { es: { title: 'Opción', options: ['a', 'b'] }, en: { title: 'Choice', options: ['a', 'b'] } } },
  { id: 'u', level: 3, predict: { kind: 'number', unit: '' }, success: () => false, text: { es: { title: 'Sin abrir' }, en: { title: 'Untouched' } } },
];
TASKS[1].predict.options = ['a', 'b'];

test('engine: state machine', () => {
  const st = fakeStorage(), e = createEngine({ tasks: TASKS, storage: st, now: () => 1000 });
  let ch = 0; e.onChange(() => ch++);
  assert.equal(e.active, null); e.open('n'); assert.equal(e.active, 'n');
  assert.equal(e.tick({ ok: true }), false, 'no tick at step 0');
  assert.equal(e.commitPrediction('n', NaN), false); assert.equal(e.commitPrediction('n', 'x'), false);
  assert.equal(e.commitPrediction('n', 1.5), true); assert.equal(e.rec('n').step, 1);
  e.markStarted('n'); assert.equal(e.rec('n').tStart, 1000);
  assert.equal(e.tick({ ok: false }), false);
  assert.equal(e.tick({ ok: true }), true);
  const r = e.rec('n'); assert.equal(r.step, 2); assert.ok(r.done); assert.equal(r.tDone, 1000); assert.deepEqual(r.measured, { value: 1.234, unit: 's' });
  assert.equal(e.tick({ ok: true }), false);
  assert.equal(e.toExplain('n'), true); assert.equal(e.rec('n').step, 3);
  e.setExplanation('n', 'hola'); assert.equal(e.rec('n').explanation, 'hola');
  assert.deepEqual(e.progress(), { done: 1, total: 3 }); assert.ok(ch > 0);
  e.reset('n'); assert.equal(e.rec('n').step, 0); assert.deepEqual(e.progress(), { done: 0, total: 3 });
});

test('engine: choice validation and predicate exceptions', () => {
  const e = createEngine({ tasks: TASKS, storage: fakeStorage() });
  e.open('c');
  for (const v of [-1, 2, 0.5, NaN, null]) assert.equal(e.commitPrediction('c', v), false);
  assert.equal(e.commitPrediction('c', 1), true);
  const w = console.warn; let warns = 0; console.warn = () => warns++;
  try { assert.equal(e.tick({}), false); assert.equal(e.tick({}), false); } finally { console.warn = w; }
  assert.equal(warns, 1); assert.equal(e.rec('c').step, 1);
});

test('engine: persistence round trip', () => {
  const st = fakeStorage();
  const a = createEngine({ tasks: TASKS, storage: st });
  a.open('n'); a.commitPrediction('n', 2); a.setExplanation('n', 'x');
  const b = createEngine({ tasks: TASKS, storage: st });
  assert.equal(b.active, 'n'); assert.equal(b.rec('n').prediction, 2); assert.equal(b.rec('n').explanation, 'x');
  assert.ok(st.m.has('pr-learn-v1'));
  b.resetAll(); assert.equal(b.active, null); assert.equal(createEngine({ tasks: TASKS, storage: st }).rec('n').step, 0);
  st.setItem('pr-learn-v1', '{garbage'); assert.equal(createEngine({ tasks: TASKS, storage: st }).active, null);
});

test('engine: reportHTML', () => {
  const e = createEngine({ tasks: TASKS, storage: fakeStorage() });
  e.open('n'); e.commitPrediction('n', 1.5); e.tick({ ok: true }); e.toExplain('n');
  e.setExplanation('n', '<script>alert(1)</script> & más');
  e.open('c'); e.commitPrediction('c', 0);
  const pk = o => o.es;
  const h = e.reportHTML({ name: '<b>Ana</b>', lang: 'es', pick: pk });
  assert.ok(!h.includes('<script>')); assert.ok(h.includes('&lt;script&gt;')); assert.ok(h.includes('&lt;b&gt;Ana'));
  for (const s of ['Número', 'Opción', 'Sin abrir', 'No intentada', '1.50 s', '1.23 s', '<style>']) assert.ok(h.includes(s), s);
  const he = e.reportHTML({ name: 'Bob', lang: 'en', pick: o => o.en });
  assert.ok(he.includes('Not attempted') && he.includes('Untouched'));
});

test('engine: hint and submit', () => {
  const e = createEngine({ tasks: TASKS, storage: fakeStorage(), now: () => 7 });
  e.open('n');
  assert.equal(e.useHint('n'), true); assert.equal(e.useHint('n'), false, 'only once');
  assert.deepEqual([e.rec('n').hintUsed, e.rec('n').hintStep, e.rec('n').tHint], [true, 0, 7]);
  e.commitPrediction('n', 1.5); e.tick({ ok: true });
  assert.equal(e.rec('n').step, 2);
  const e2 = createEngine({ tasks: TASKS, storage: fakeStorage() }); e2.open('n'); e2.commitPrediction('n', 1); e2.tick({ ok: true });
  assert.equal(e2.useHint('n'), false, 'no hint once the task is done');
  e.open('n'); e.toExplain('n');
  assert.equal(e.submit('n'), false, 'empty explanation');
  e.setExplanation('n', 'short');
  assert.equal(e.submit('n'), false, 'too short');
  e.setExplanation('n', 'the period depends on mass and k');
  assert.equal(e.submit('n'), true); assert.equal(e.rec('n').tSubmit, 7);
  assert.equal(e.setExplanation('n', 'changed'), false); assert.equal(e.rec('n').explanation, 'the period depends on mass and k');
  const h = e.reportHTML({ name: 'A', lang: 'en', pick: o => o.en });
  assert.ok(h.includes('used before predicting') && h.includes('Submitted'));
  e.reset('n'); assert.equal(e.rec('n').hintUsed, false); assert.equal(e.rec('n').submitted, false);
});
