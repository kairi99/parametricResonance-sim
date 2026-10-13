// Nonlinear, simulation-based resonance search. Pure ES module (browser + Node); model-agnostic,
// uses only the public physics API. See spec_v3 section 3.
import { withDefaults, derive, createState, advance, observables, solveForResonance } from './physics.js';

const SAMPLE_DT = 0.05; // 20 Hz observable sampling

function dtOf(dv) { return dv && dv.dt > 0 ? dv.dt : 1e-3; }

// mean frequency from zero crossings of series v(t) over [0, tEnd]
function crossingFreq(ts, vs, tEnd) {
  const c = [];
  for (let i = 1; i < ts.length && ts[i - 1] <= tEnd; i++) {
    const a = vs[i - 1], b = vs[i];
    if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) c.push(ts[i - 1] + (ts[i] - ts[i - 1]) * a / (a - b));
  }
  if (c.length < 3) return NaN;
  return ((c.length - 1) / 2) / (c[c.length - 1] - c[0]);
}

function decimate(arr, max) {
  if (arr.length <= max) return arr.slice();
  const out = [], step = (arr.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
  return out;
}

/**
 * Simulate from the user's start condition and measure the exchange between bounce and swing.
 * Early stop: only after the partition deviation has reached a peak (> 0.2) and fallen back by
 * >= 30 % of that peak (so slow exchanges are never cut off), or at T.
 */
export function transferMetric(params, opts = {}) {
  const p = withDefaults(params);
  const T = opts.T ?? 90;
  const shouldStop = opts.shouldStop;
  const dv = opts.derived || derive(p);
  const maxDt = dtOf(dv);
  const state = createState(p, dv);
  const ts = [], pis = [], xs = [], als = [];
  let pi0 = NaN, peak = 0, cancelled = false;
  const nMax = Math.round(T / SAMPLE_DT);
  for (let i = 0; i <= nMax; i++) {
    if (i > 0) advance(state, p, dv, SAMPLE_DT, maxDt);
    const o = observables(state, p, dv);
    const s = o.Er + o.Es;
    const pi = s > 1e-14 ? o.Es / s : 0;
    if (i === 0) pi0 = pi;
    ts.push(state.t); pis.push(pi); xs.push(o.x); als.push(o.alpha);
    const dev = Math.abs(pi - pi0);
    if (dev > peak) peak = dev;
    if (!Number.isFinite(pi)) break;
    if (peak > 0.2 && dev <= 0.7 * peak) break; // peak passed and partition came back by 30 %
    if (shouldStop && i % 20 === 0 && shouldStop()) { cancelled = true; break; }
  }
  let eta = 0;
  for (const pi of pis) eta = Math.max(eta, Math.abs(pi - pi0));
  let tExchange = ts[ts.length - 1];
  for (let i = 0; i < pis.length; i++) if (Math.abs(pis[i] - pi0) >= 0.9 * eta) { tExchange = ts[i]; break; }
  const fRmeas = crossingFreq(ts, xs, tExchange);
  const fSmeas = crossingFreq(ts, als, tExchange);
  return {
    eta, tExchange, fRmeas, fSmeas, ratioMeas: fRmeas / (2 * fSmeas),
    partitionTrace: decimate(pis.map((pi, i) => [ts[i], pi]), 300), cancelled,
  };
}

/** Backbone frequencies at the start amplitudes: pure-bounce and pure-swing runs. */
export function nonlinearFrequencies(params, opts = {}) {
  const p = withDefaults(params);
  const dv0 = derive(p);
  const o0 = observables(createState(p, dv0), p, dv0);
  const base = { ...p, icMode: 'polar', beta0: 0, vx0: 0, vy0: 0, vz0: 0, dampingModel: 'none', alignPhone: 1, tiltX0: 0, tiltY0: 0, spin0: 0, rock0: 0 };
  const periods = opts.periods ?? 20;
  const run = (pp, key, fLin) => {
    const dv = derive(pp);
    const dur = periods / (fLin > 0 ? fLin : 1);
    const dt = 0.005, n = Math.round(dur / dt), maxDt = dtOf(dv);
    const st = createState(pp, dv), ts = [], vs = [];
    for (let i = 0; i <= n; i++) {
      if (i > 0) advance(st, pp, dv, dt, maxDt);
      const o = observables(st, pp, dv);
      ts.push(st.t); vs.push(o[key]);
      if (opts.shouldStop && i % 50 === 0 && opts.shouldStop()) break;
    }
    return crossingFreq(ts, vs, Infinity);
  };
  const fR = run({ ...base, x0: o0.x, alpha0: 0 }, 'x', dv0.fR);
  const fS = run({ ...base, x0: 0, alpha0: o0.alpha }, 'alpha', dv0.fS);
  return { fR, fS, ratio: fR / (2 * fS) };
}

const better = (a, b) => a.eta > b.eta + 1e-12 || (Math.abs(a.eta - b.eta) <= 1e-12 && a.tExchange < b.tExchange);

function pickBest(scan) {
  const valid = scan.filter((s) => s.valid);
  if (!valid.length) return null;
  const maxEta = Math.max(...valid.map((s) => s.eta));
  let best = null;
  for (const s of valid) if (s.eta >= maxEta - 0.02 && (!best || better({ eta: 1, tExchange: s.tExchange }, { eta: 1, tExchange: best.tExchange }))) best = s;
  return best;
}

/** Generator core: yields after each simulation (so async drivers can yield to the event loop). */
function* searchGen(params, knob, opts, onProgress) {
  const p = withDefaults(params);
  const T = opts.T ?? 90;
  const shouldStop = opts.shouldStop;
  const elastic = p.model === 'elastic'; // slow model: coarser default scan
  const nScan = opts.nScan ?? (elastic ? 9 : 21);
  const refineIters = opts.refineIters ?? (elastic ? 4 : 8);
  const lin = solveForResonance(p, knob);
  const cur = p[knob];
  const linOk = !!lin.feasible && Number.isFinite(lin.value);
  let center = linOk ? lin.value : cur;
  const integer = knob === 'nutsPerSide';
  const lowClip = knob === 'springK' ? 0.5 : 0;
  center = Math.max(center, lowClip);
  let halfW = knob === 'cordLength' ? 0.15 : knob === 'springK' ? 0.25 * center : 10;
  if (opts.window != null) halfW = opts.window;
  const values = [];
  if (integer) {
    const c = Math.round(center);
    for (let v = Math.max(0, c - 10); v <= c + 10; v++) values.push(v);
  } else {
    const lo = Math.max(lowClip, center - halfW), hi = center + halfW;
    for (let i = 0; i < nScan; i++) values.push(lo + (hi - lo) * i / (nScan - 1));
    if (!values.some((v) => Math.abs(v - center) < 1e-12)) values.push(center);
  }
  const total = values.length + (integer ? 0 : refineIters);
  const scan = [];
  let cancelled = false, done = 0;
  const sorted = () => scan.slice().sort((a, b) => a.value - b.value);
  const evalAt = (v) => {
    const pp = { ...p, [knob]: v };
    const dv = derive(pp);
    // once a good exchange is known, don't spend the full T on clearly slower candidates
    let goodT = Infinity;
    for (const q of scan) if (q.valid && q.eta > 0.9) goodT = Math.min(goodT, q.tExchange);
    const Tc = Math.min(T, 2.5 * goodT + 10);
    const m = transferMetric(pp, { T: Tc, shouldStop, derived: dv });
    if (m.cancelled) { cancelled = true; return null; }
    let valid = true, why = '';
    if (!Number.isFinite(dv.ratio)) { valid = false; why = 'non-finite linear ratio'; }
    else if ((dv.warnings || []).some((w) => /slack/i.test(w))) { valid = false; why = 'slack at start'; }
    else if (!Number.isFinite(m.ratioMeas)) { valid = false; why = 'no measurable oscillation'; }
    else if (dv.fS > 0 && m.tExchange < 1 / dv.fS) { valid = false; why = 'exchange faster than one swing period'; }
    const e = { value: v, eta: m.eta, tExchange: m.tExchange, ratioLinear: dv.ratio, ratioMeas: Number.isFinite(m.ratioMeas) ? m.ratioMeas : null, valid };
    if (!valid) e.invalidReason = why;
    scan.push(e);
    done++;
    if (onProgress) onProgress(Math.min(1, done / total), sorted());
    return e;
  };
  const linearEntryValue = center;
  for (const v of values) {
    if (shouldStop && shouldStop()) { cancelled = true; break; }
    if (!evalAt(v) && cancelled) break;
    yield;
  }
  if (!cancelled && !integer) {
    // golden-section refinement around the best scan point (score trades eta against exchange time)
    const score = (e) => (e.valid ? e.eta - 0.1 * e.tExchange / T : -Infinity);
    const s0 = sorted();
    let bi = 0;
    for (let i = 1; i < s0.length; i++) if (score(s0[i]) > score(s0[bi])) bi = i;
    let a = s0[Math.max(0, bi - 1)].value, b = s0[Math.min(s0.length - 1, bi + 1)].value;
    if (b - a > 0) {
      const gr = (Math.sqrt(5) - 1) / 2;
      let c = b - gr * (b - a), d = a + gr * (b - a);
      let ec = evalAt(c); yield;
      let ed = ec && evalAt(d); yield;
      for (let i = 2; i < refineIters && ec && ed; i++) {
        if (shouldStop && shouldStop()) { cancelled = true; break; }
        if (score(ec) > score(ed)) { b = d; d = c; ed = ec; c = b - gr * (b - a); ec = evalAt(c); }
        else { a = c; c = d; ec = ed; d = a + gr * (b - a); ed = evalAt(d); }
        yield;
      }
      if (!ec || !ed) cancelled = true;
    }
  }
  const sc = sorted();
  const linEntry = sc.find((s) => s.value === linearEntryValue) || null;
  const curRatio = (() => { try { return derive(p).ratio; } catch (e) { return NaN; } })();
  const out = { linear: linOk ? { value: lin.value, ratio: lin.achievedRatio, feasible: true, evaluated: linearEntryValue }
    : { value: NaN, ratio: curRatio, feasible: false, evaluated: linearEntryValue }, scan: sc, cancelled };
  const centreNote = linOk ? '' : `No feasible linear 2:1 estimate for ${knob} (${lin.note || 'infeasible'}); scanned around the current value ${Number(cur).toFixed(4)} instead. `;
  if (!sc.length) return { ...out, best: null, params: p, feasible: false, note: 'Cancelled before any simulation completed.' };
  const best = pickBest(sc);
  if (!best) return { ...out, best: null, params: p, feasible: false, note: centreNote + 'No valid resonance found: every scanned value was rejected (slack, unphysical or non-oscillating motion).' };
  const d = best.value - lin.value;
  out.best = best;
  out.params = { ...p, [knob]: best.value };
  out.feasible = linOk;
  out.note = centreNote + (cancelled ? 'Cancelled; partial result. ' : '') +
    `Best ${knob} = ${best.value.toFixed(integer ? 0 : 4)} (eta ${best.eta.toFixed(3)}, ${best.tExchange.toFixed(1)} s); linear 2:1 estimate ${Number.isFinite(lin.value) ? lin.value.toFixed(4) : 'n/a'}` +
    `${linEntry ? `, eta there ${linEntry.eta.toFixed(3)}` : ''}${Number.isFinite(d) ? `; shift ${d >= 0 ? '+' : ''}${d.toFixed(4)}` : ''}. ` + (linOk ? (lin.note || '') : '');
  return out;
}

export function searchResonance(params, knob, opts = {}, onProgress) {
  const g = searchGen(params, knob, opts, onProgress);
  for (;;) { const r = g.next(); if (r.done) return r.value; }
}

/** Same as searchResonance but yields to the event loop between simulations (lets a worker receive 'cancel'). */
export async function searchResonanceAsync(params, knob, opts = {}, onProgress, yieldFn = () => new Promise((r) => setTimeout(r, 0))) {
  const g = searchGen(params, knob, opts, onProgress);
  for (;;) { const r = g.next(); if (r.done) return r.value; await yieldFn(); }
}

/**
 * Worker protocol logic, kept here so it is testable in Node.
 * Returns an async handler(msg). `post(message)` sends to the main thread.
 */
export function createMessageHandler(post) {
  const running = new Map(); // id -> token
  return async function handleMessage(msg) {
    const { id, task } = msg || {};
    if (task === 'cancel') {
      const ids = id == null ? [...running.keys()] : [id];
      for (const i of ids) {
        const t = running.get(i);
        if (t) { t.cancelled = true; post({ id: i, type: 'result', data: { cancelled: true } }); t.silent = true; }
      }
      return;
    }
    const prev = running.get(id);
    if (prev) { prev.cancelled = true; prev.silent = true; }
    const token = { cancelled: false, silent: false };
    running.set(id, token);
    const shouldStop = () => token.cancelled;
    try {
      let data;
      if (task === 'search') {
        data = await searchResonanceAsync(msg.params, msg.knob, { ...(msg.opts || {}), shouldStop }, (fraction, partial) => {
          if (!token.cancelled) post({ id, type: 'progress', fraction, partial });
        });
      } else if (task === 'nlfreq') {
        data = nonlinearFrequencies(msg.params, { ...(msg.opts || {}), shouldStop });
      } else if (task === 'linear') {
        data = solveForResonance(msg.params, msg.knob);
      } else {
        throw new Error(`Unknown task '${task}'`);
      }
      if (!token.silent) post({ id, type: 'result', data });
    } catch (e) {
      if (!token.silent) post({ id, type: 'error', message: String(e && e.message || e) });
    } finally {
      if (running.get(id) === token) running.delete(id);
    }
  };
}
