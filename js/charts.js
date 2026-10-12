// Lightweight real-time canvas 2D charts (no dependencies).
const FONT = '10.5px ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const GRID = 'rgba(138,154,192,0.14)';
const AXIS = '#8a9ac0';

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
function fmtTick(v, step) {
  if (Math.abs(v) < step * 1e-6) return '0';
  const dec = Math.max(0, -Math.floor(Math.log10(step)) );
  return v.toFixed(Math.min(dec, 6));
}
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const W = Math.max(1, Math.round(w * dpr)), H = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/** Axis range with hysteresis: grows at once, shrinks only when data uses < 55% of the span. */
function updateRange(cur, lo, hi, minSpan) {
  if (!isFinite(lo) || !isFinite(hi)) return cur || [-1, 1];
  if (hi - lo < minSpan) { const c = (hi + lo) / 2; lo = c - minSpan / 2; hi = c + minSpan / 2; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const step = niceStep((hi - lo) / 5);
  const nlo = Math.floor(lo / step) * step, nhi = Math.ceil(hi / step) * step;
  if (!cur) return [nlo, nhi];
  const needGrow = lo < cur[0] || hi > cur[1];
  const needShrink = (nhi - nlo) < 0.55 * (cur[1] - cur[0]);
  return (needGrow || needShrink) ? [nlo, nhi] : cur;
}

export class StripChart {
  /**
   * opts: { title, series:[{name,color,axis:0|1,dots?,dash?}], axes:[{label, fixed?:[lo,hi], includeZero?, minSpan?}, {...}], window }
   */
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.title = opts.title || '';
    this.series = opts.series;
    this.axes = opts.axes;
    this.windowSec = opts.window || 30;
    this.cap = 9000;
    this.t = new Float64Array(this.cap);
    this.v = this.series.map(() => new Float32Array(this.cap));
    this.head = 0; this.count = 0;
    this.ranges = [null, null];
  }
  setWindow(s) { this.windowSec = s; this.ranges = [null, null]; }
  setSeriesVisible(i, vis) { if (this.series[i]) { this.series[i].hidden = !vis; this.ranges = [null, null]; } }
  clear() { this.head = 0; this.count = 0; this.ranges = [null, null]; }
  push(t, values) {
    const idx = (this.head + this.count) % this.cap;
    if (this.count < this.cap) this.count++; else this.head = (this.head + 1) % this.cap;
    this.t[idx] = t;
    for (let i = 0; i < this.v.length; i++) this.v[i][idx] = values[i];
  }
  draw() {
    const { ctx, w, h } = setupCanvas(this.canvas);
    ctx.clearRect(0, 0, w, h);
    const two = this.axes.length > 1 && this.series.some(s => s.axis === 1 && !s.hidden);
    const m = { l: 46, r: two ? 46 : 10, t: 34, b: 20 };
    const pw = w - m.l - m.r, ph = h - m.t - m.b;
    if (pw < 20 || ph < 20) return;
    const tMax = this.count ? this.t[(this.head + this.count - 1) % this.cap] : 0;
    const tMin = Math.max(0, tMax - this.windowSec);
    const t0 = tMin, t1 = tMin + this.windowSec;
    // find visible start
    let start = 0;
    { let lo = 0, hi = this.count; // first index with t >= tMin
      while (lo < hi) { const mid = (lo + hi) >> 1; if (this.t[(this.head + mid) % this.cap] < tMin) lo = mid + 1; else hi = mid; }
      start = lo; }
    // ranges
    for (let a = 0; a < (two ? 2 : 1); a++) {
      const ax = this.axes[a];
      if (ax.fixed) { this.ranges[a] = ax.fixed; continue; }
      let lo = ax.includeZero ? 0 : Infinity, hi = ax.includeZero ? 0 : -Infinity;
      this.series.forEach((s, si) => {
        if (s.hidden || (s.axis || 0) !== a) return;
        const arr = this.v[si];
        for (let i = start; i < this.count; i++) { const y = arr[(this.head + i) % this.cap]; if (y < lo) lo = y; if (y > hi) hi = y; }
      });
      if (lo === Infinity) { lo = -1; hi = 1; }
      this.ranges[a] = updateRange(this.ranges[a], lo, hi, ax.minSpan || 1e-6);
    }
    const X = t => m.l + (t - t0) / (t1 - t0) * pw;
    ctx.font = FONT; ctx.textBaseline = 'middle';
    // title
    ctx.fillStyle = '#dbe4f5'; ctx.textAlign = 'left'; ctx.font = '600 11.5px system-ui,sans-serif';
    ctx.fillText(this.title, m.l - 36, 10);
    ctx.font = FONT;
    // x grid / ticks
    const xs = niceStep(this.windowSec / 5);
    ctx.textAlign = 'center'; ctx.strokeStyle = GRID; ctx.fillStyle = AXIS; ctx.lineWidth = 1;
    for (let tt = Math.ceil(t0 / xs) * xs; tt <= t1 + 1e-9; tt += xs) {
      const x = Math.round(X(tt)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke();
      if (x < w - m.r - 26) ctx.fillText(fmtTick(tt, xs), x, h - 8);
    }
    ctx.textAlign = 'right'; ctx.fillText('t (s)', w - 2, h - 8);
    // y axes
    for (let a = 0; a < (two ? 2 : 1); a++) {
      const [lo, hi] = this.ranges[a]; const span = hi - lo;
      const step = niceStep(span / 5);
      const Y = y => m.t + ph - (y - lo) / span * ph;
      ctx.textAlign = a === 0 ? 'right' : 'left';
      ctx.fillStyle = a === 0 ? '#dbe4f5' : AXIS;
      const col = this.series.find(s => !s.hidden && (s.axis || 0) === a)?.color || AXIS;
      for (let y = Math.ceil(lo / step - 1e-9) * step; y <= hi + step * 1e-6; y += step) {
        const yy = Math.round(Y(y)) + 0.5;
        if (a === 0) { ctx.strokeStyle = Math.abs(y) < step * 1e-6 ? 'rgba(138,154,192,0.4)' : GRID; ctx.beginPath(); ctx.moveTo(m.l, yy); ctx.lineTo(m.l + pw, yy); ctx.stroke(); }
        ctx.fillStyle = AXIS;
        ctx.fillText(fmtTick(y, step), a === 0 ? m.l - 4 : m.l + pw + 4, yy);
      }
      ctx.fillStyle = col; ctx.textAlign = a === 0 ? 'left' : 'right';
      ctx.fillText(this.axes[a].label, a === 0 ? 4 : w - 4, 24);
      this._Y = this._Y || []; this._Y[a] = Y;
    }
    ctx.strokeStyle = 'rgba(138,154,192,0.35)'; ctx.strokeRect(m.l + 0.5, m.t + 0.5, pw, ph);
    // data
    ctx.save(); ctx.beginPath(); ctx.rect(m.l, m.t, pw, ph); ctx.clip();
    this.series.forEach((s, si) => {
      if (s.hidden) return;
      const arr = this.v[si]; const [lo, hi] = this.ranges[s.axis || 0]; const span = hi - lo;
      const Y = y => m.t + ph - (y - lo) / span * ph;
      ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = 1.5;
      if (s.dots) {
        for (let i = start; i < this.count; i++) {
          const k = (this.head + i) % this.cap; ctx.fillRect(X(this.t[k]) - 1, Y(arr[k]) - 1, 2.2, 2.2);
        }
      } else {
        ctx.setLineDash(s.dash || []); ctx.beginPath();
        for (let i = start; i < this.count; i++) {
          const k = (this.head + i) % this.cap; const x = X(this.t[k]), y = Y(arr[k]);
          if (i === start) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke(); ctx.setLineDash([]);
      }
    });
    ctx.restore();
    // legend
    ctx.textAlign = 'left'; let lx = m.l + 6;
    this.series.forEach(s => {
      if (s.hidden) return;
      ctx.fillStyle = s.color; ctx.fillRect(lx, m.t + 5, 10, 3);
      ctx.fillStyle = '#dbe4f5'; ctx.fillText(s.name, lx + 14, m.t + 7);
      lx += 14 + ctx.measureText(s.name).width + 10;
    });
  }
}

export class XYChart {
  constructor(canvas, opts) {
    this.canvas = canvas; this.title = opts.title; this.unit = opts.unit || '';
    this.windowSec = opts.window || 30;
    this.cap = 9000;
    this.t = new Float64Array(this.cap); this.x = new Float32Array(this.cap); this.y = new Float32Array(this.cap);
    this.head = 0; this.count = 0; this.half = null;
  }
  setWindow(s) { this.windowSec = s; }
  clear() { this.head = 0; this.count = 0; this.half = null; }
  push(t, x, y) {
    const idx = (this.head + this.count) % this.cap;
    if (this.count < this.cap) this.count++; else this.head = (this.head + 1) % this.cap;
    this.t[idx] = t; this.x[idx] = x; this.y[idx] = y;
  }
  draw() {
    const { ctx, w, h } = setupCanvas(this.canvas);
    ctx.clearRect(0, 0, w, h);
    const m = { l: 10, r: 10, t: 22, b: 16 };
    const side = Math.min(w - m.l - m.r, h - m.t - m.b);
    if (side < 30) return;
    const cx = w / 2, cy = m.t + (h - m.t - m.b) / 2;
    const tMax = this.count ? this.t[(this.head + this.count - 1) % this.cap] : 0;
    const tMin = tMax - this.windowSec;
    let ext = 0.3;
    for (let i = 0; i < this.count; i++) {
      const k = (this.head + i) % this.cap; if (this.t[k] < tMin) continue;
      ext = Math.max(ext, Math.abs(this.x[k]), Math.abs(this.y[k]));
    }
    const target = ext * 1.15;
    if (!this.half || target > this.half || target < 0.55 * this.half) this.half = niceStep(target / 2.5) * Math.ceil(target / niceStep(target / 2.5));
    const half = this.half, sc = side / 2 / half;
    ctx.font = FONT; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#dbe4f5'; ctx.textAlign = 'left'; ctx.font = '600 11.5px system-ui,sans-serif';
    ctx.fillText(this.title, 8, 10); ctx.font = FONT;
    const step = niceStep(half / 2);
    ctx.strokeStyle = GRID; ctx.lineWidth = 1; ctx.fillStyle = AXIS;
    for (let v = -Math.floor(half / step) * step; v <= half + 1e-9; v += step) {
      const gx = Math.round(cx + v * sc) + 0.5, gy = Math.round(cy - v * sc) + 0.5;
      ctx.strokeStyle = Math.abs(v) < 1e-9 ? 'rgba(138,154,192,0.45)' : GRID;
      ctx.beginPath(); ctx.moveTo(gx, cy - side / 2); ctx.lineTo(gx, cy + side / 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - side / 2, gy); ctx.lineTo(cx + side / 2, gy); ctx.stroke();
      ctx.textAlign = 'center'; if (Math.abs(v) > 1e-9) ctx.fillText(fmtTick(v, step), gx, cy + side / 2 + 8);
    }
    ctx.strokeStyle = 'rgba(138,154,192,0.35)'; ctx.strokeRect(cx - side / 2 + 0.5, cy - side / 2 + 0.5, side, side);
    ctx.textAlign = 'right'; ctx.fillText(`X, Y (${this.unit})`, w - 6, 10);
    // trail in 4 chunks of increasing alpha
    ctx.save(); ctx.beginPath(); ctx.rect(cx - side / 2, cy - side / 2, side, side); ctx.clip();
    const idxs = [];
    for (let i = 0; i < this.count; i++) { const k = (this.head + i) % this.cap; if (this.t[k] >= tMin) idxs.push(k); }
    const n = idxs.length, chunks = 5;
    ctx.lineWidth = 1.4; ctx.lineJoin = 'round';
    for (let c = 0; c < chunks; c++) {
      const a = Math.floor(c * n / chunks), b = Math.min(n - 1, Math.floor((c + 1) * n / chunks));
      if (b <= a) continue;
      ctx.strokeStyle = `rgba(34,211,238,${0.18 + 0.82 * (c + 1) / chunks})`;
      ctx.beginPath();
      for (let i = a; i <= b; i++) { const k = idxs[i]; const px = cx + this.x[k] * sc, py = cy - this.y[k] * sc; if (i === a) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
      ctx.stroke();
    }
    if (n) {
      const k = idxs[n - 1]; const px = cx + this.x[k] * sc, py = cy - this.y[k] * sc;
      ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(px, py, 4, 0, 7); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.fillStyle = '#8a9ac0'; ctx.beginPath(); ctx.arc(cx, cy, 2, 0, 7); ctx.fill();
    ctx.restore();
  }
}
