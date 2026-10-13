import test from 'node:test';
import assert from 'node:assert/strict';
import { derive, solveForResonance } from '../js/physics.js';
import { transferMetric, searchResonance, nonlinearFrequencies, createMessageHandler } from '../js/resonance.js';

const deg = Math.PI / 180;
const base = { model: 'point', dampingModel: 'none', x0: 0.04, alpha0: 0.5 * deg, beta0: 0 };

test('R1 transferMetric at linear resonance vs far off', () => {
  const lin = solveForResonance(base, 'cordLength');
  assert.ok(lin.feasible);
  const on = transferMetric({ ...base, cordLength: lin.value }, { T: 60 });
  assert.ok(on.eta > 0.9, `eta ${on.eta}`);
  assert.ok(on.partitionTrace.length <= 300);
  const off = transferMetric({ ...base, cordLength: lin.value + 0.2 }, { T: 60 });
  assert.ok(off.eta < 0.3, `eta ${off.eta}`);
});

test('R2 searchResonance: best in window, not worse than linear, scan sorted', () => {
  const r = searchResonance(base, 'cordLength', { T: 40, nScan: 11 });
  const lv = r.linear.evaluated;
  const linEntry = r.scan.find((s) => s.value === lv);
  assert.ok(linEntry);
  assert.ok(r.best.eta >= linEntry.eta - 0.02 - 1e-9);
  assert.ok(r.best.value >= Math.max(0, lv - 0.15) - 1e-9 && r.best.value <= lv + 0.15 + 1e-9);
  for (let i = 1; i < r.scan.length; i++) assert.ok(r.scan[i].value >= r.scan[i - 1].value);
  const maxEta = Math.max(...r.scan.map((s) => s.eta));
  assert.ok(r.best.eta >= maxEta - 0.02 - 1e-9);
});

test('R2b nutsPerSide scans integers only', () => {
  const r = searchResonance({ ...base, cordLength: 0.05 }, 'nutsPerSide', { T: 20 });
  for (const s of r.scan) assert.equal(s.value, Math.round(s.value));
});

test('R3 nonlinearFrequencies: tiny amplitude matches derive, swing softens at large amplitude', () => {
  const p = { ...base, cordLength: 0.01, x0: 1e-4, alpha0: 1e-3 * 0.5 };
  const dv = derive(p);
  const f = nonlinearFrequencies(p);
  assert.ok(Math.abs(f.fR / dv.fR - 1) < 0.005, `${f.fR} vs ${dv.fR}`);
  assert.ok(Math.abs(f.fS / dv.fS - 1) < 0.005, `${f.fS} vs ${dv.fS}`);
  const big = nonlinearFrequencies({ ...p, alpha0: 0.5 });
  assert.ok(big.fS < f.fS, `${big.fS} !< ${f.fS}`);
});

test('R4 cancellation returns quickly with cancelled flag', () => {
  let calls = 0;
  const t = Date.now();
  const r = searchResonance(base, 'cordLength', { T: 90, shouldStop: () => ++calls > 0 && calls > 3 });
  assert.equal(r.cancelled, true);
  assert.ok(Date.now() - t < 5000);
  const r2 = searchResonance(base, 'cordLength', { T: 90, shouldStop: () => true });
  assert.equal(r2.cancelled, true);
});

test('R5 worker protocol', async () => {
  const msgs = [];
  const h = createMessageHandler((m) => msgs.push(m));
  await h({ id: 1, task: 'linear', params: base, knob: 'cordLength' });
  assert.equal(msgs.at(-1).type, 'result');
  assert.ok(msgs.at(-1).data.feasible);
  await h({ id: 2, task: 'search', params: base, knob: 'cordLength', opts: { T: 15, nScan: 5 } });
  assert.ok(msgs.some((m) => m.id === 2 && m.type === 'progress'));
  const res = msgs.filter((m) => m.id === 2 && m.type === 'result');
  assert.equal(res.length, 1);
  assert.ok(res[0].data.best);
  await h({ id: 3, task: 'nlfreq', params: base });
  assert.ok(msgs.at(-1).data.fR > 0);
  await h({ id: 4, task: 'bogus' });
  assert.equal(msgs.at(-1).type, 'error');
  // cancel: start a long search, then cancel
  msgs.length = 0;
  const run = h({ id: 5, task: 'search', params: base, knob: 'cordLength', opts: { T: 60 } });
  await new Promise((r) => setTimeout(r, 20));
  await h({ id: 5, task: 'cancel' });
  await run;
  const r5 = msgs.filter((m) => m.id === 5 && m.type === 'result');
  assert.equal(r5.length, 1);
  assert.equal(r5[0].data.cancelled, true);
  // same-id replacement cancels previous
  msgs.length = 0;
  const a = h({ id: 6, task: 'search', params: base, knob: 'cordLength', opts: { T: 60 } });
  await new Promise((r) => setTimeout(r, 20));
  const b = h({ id: 6, task: 'linear', params: base, knob: 'cordLength' });
  await Promise.all([a, b]);
  assert.equal(msgs.filter((m) => m.id === 6 && m.type === 'result').length, 1);
});

test('R6 infeasible linear estimate: centre on current value, no garbage best', () => {
  // stiff spring: linear cord would be negative -> infeasible
  const p = { ...base, springK: 200, cordLength: 0.1 };
  const r = searchResonance(p, 'cordLength', { T: 20, nScan: 7, refineIters: 2 });
  assert.equal(r.linear.feasible, false);
  assert.ok(Number.isNaN(r.linear.value));
  assert.equal(r.feasible, false);
  assert.match(r.note, /current value/);
  for (const s of r.scan) assert.ok(Math.abs(s.value - 0.1) <= 0.15 + 1e-9);
  for (const s of r.scan) assert.equal(typeof s.valid, 'boolean');
  if (r.best) assert.equal(r.best.valid, true);
});
