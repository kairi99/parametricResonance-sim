// Running measurements fed from every simulator sample (no DOM dependency).
const MAX_HISTORY = 8;
const ACC_WINDOW = 1; // s

function newRun(meta) {
  const m = meta || {};
  return {
    t0: NaN, tElapsed: 0, samples: 0,
    meta: { params: { ...(m.params || {}) }, derived: { ...(m.derived || {}) }, model: m.model },
    x0: NaN, alpha0: NaN, beta0: NaN, ampR0: NaN, ampS0: NaN,
    Tbounce: NaN, Tswing: NaN, piMin: NaN, piMax: NaN, tExchange: NaN, tPi03: NaN,
    maxAlpha: 0, maxX: 0, accY: NaN, accMeanAll: [NaN, NaN, NaN], last: null,
  };
}

// mean period from upward zero crossings (interpolated); needs >= 3 crossings
function period(c) {
  return c.length >= 3 ? (c[c.length - 1] - c[0]) / (c.length - 1) : NaN;
}

export function createProbes() {
  let run = newRun(), cx = [], ca = [], cb = [], prev = null, accWin = [], accSum = [0, 0, 0], accN = 0, maxB = 0;
  const probes = {
    history: [],
    get run() { return run; },
    reset(meta) {
      if (run.samples > 0) { probes.history.push(run); if (probes.history.length > MAX_HISTORY) probes.history.shift(); }
      run = newRun(meta); cx = []; ca = []; cb = []; prev = null; accWin = []; accSum = [0, 0, 0]; accN = 0; maxB = 0;
    },
    push(obs) {
      const r = run, t = obs.t;
      if (r.samples === 0) {
        r.t0 = t; r.x0 = obs.x; r.alpha0 = obs.alpha; r.beta0 = obs.beta; r.ampR0 = obs.ampR; r.ampS0 = obs.ampS;
      }
      r.samples++; r.tElapsed = t - r.t0; r.last = obs;
      const p = obs.partitionR;
      if (Number.isFinite(p)) {
        if (!(p >= r.piMin)) r.piMin = p;
        if (!(p <= r.piMax)) r.piMax = p;
        if (Number.isNaN(r.tExchange) && p < 0.5) r.tExchange = t - r.t0;
        if (Number.isNaN(r.tPi03) && p < 0.3) r.tPi03 = t - r.t0;
      }
      if (Math.abs(obs.alpha) > r.maxAlpha) r.maxAlpha = Math.abs(obs.alpha);
      if (Math.abs(obs.beta) > maxB) maxB = Math.abs(obs.beta);
      if (Math.abs(obs.x) > r.maxX) r.maxX = Math.abs(obs.x);
      if (prev) {
        const cross = (c, a, b) => { if (a < 0 && b >= 0) c.push(prev.t + (t - prev.t) * (-a) / (b - a)); };
        cross(cx, prev.x, obs.x); cross(ca, prev.alpha, obs.alpha); cross(cb, prev.beta, obs.beta);
      }
      prev = { t, x: obs.x, alpha: obs.alpha, beta: obs.beta };
      r.Tbounce = period(cx);
      r.Tswing = r.maxAlpha < 1e-4 ? period(cb) : period(ca);
      const a = obs.accSensor;
      if (a && a.length >= 3) {
        accWin.push([t, a[1]]);
        while (accWin.length > 1 && accWin[0][0] < t - ACC_WINDOW) accWin.shift();
        let s = 0; for (const w of accWin) s += w[1];
        r.accY = s / accWin.length;
        accN++; for (let i = 0; i < 3; i++) accSum[i] += a[i];
        r.accMeanAll = accSum.map(v => v / accN);
      }
    },
  };
  return probes;
}
