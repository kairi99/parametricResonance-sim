import { DEFAULT_PARAMS, withDefaults, derive, createState, advance, observables, solveForResonance } from './physics.js';
import { buildControls } from './ui.js';
import { StripChart, XYChart, ScanChart } from './charts.js';

const $ = id => document.getElementById(id);
const R2D = 180 / Math.PI;
const SAMPLE_DT = 1 / 60;       // sim-time sampling interval
const MAX_ROWS = 200000;

// ---------- error banner ----------
function showError(e) {
  const b = $('error-banner'); b.hidden = false;
  b.textContent += (b.textContent ? '\n' : '') + (e && e.stack ? e.stack : String(e));
  console.error(e);
}
window.addEventListener('error', ev => {
  // Opaque "Script error." comes from scripts the page cannot inspect (e.g. ones injected by
  // mobile Safari/Chrome); our own same-origin modules always report a real error object.
  if (!ev.error && /^Script error\.?$/.test(ev.message)) { console.warn('ignored opaque error', ev); return; }
  showError(ev.error || ev.message);
});
window.addEventListener('unhandledrejection', ev => showError(ev.reason));

// ---------- state ----------
const LAB = { phoneMass: 0.2112, phoneLength: 0.150, caseMass: 0, attachmentOffset: 0, cordLength: 0, springK: 18.95, springL0: 0.19, springMass: 0.0063 };
const IPHONE = { phoneMass: DEFAULT_PARAMS.phoneMass, phoneLength: DEFAULT_PARAMS.phoneLength, phoneWidth: DEFAULT_PARAMS.phoneWidth, phoneThickness: DEFAULT_PARAMS.phoneThickness };
const CASE_DEFAULT = { mass: 0.045, off: 0.060 }; // 60 mm: 20 mm horn + eyebolt shank long enough for ~6 nuts
let lastCase = { ...CASE_DEFAULT };

const STRING_VALUES = {
  model: ['elastic', 'rigid', 'point'], icMode: ['polar', 'cartesian'], dampingModel: ['none', 'linear', 'quadratic'],
  springGeometry: ['fromK', 'direct'], kCalibration: ['loaded', 'unloaded'], wireMaterial: ['steel', 'stainless', 'custom'], springHand: ['right', 'left'],
  topTwist: ['locked', 'free'], eyeTwist: ['locked', 'free'],
};
const isRigidLike = m => m === 'rigid' || m === 'elastic';
function paramsFromURL() {
  const q = new URLSearchParams(location.search), p = {};
  for (const k of Object.keys(DEFAULT_PARAMS)) {
    if (!q.has(k)) continue;
    if (typeof DEFAULT_PARAMS[k] === 'string') { const ok = STRING_VALUES[k]; if (!ok || ok.includes(q.get(k))) p[k] = q.get(k); }
    else { const v = parseFloat(q.get(k)); if (isFinite(v)) p[k] = v; }
  }
  return p;
}
let params = withDefaults(paramsFromURL());
const sim = { speed: 1, window: 30, trail: true, equilibrium: true, playing: true };
let derived = derive(params);
let state = null, obs = null, scene = null;
let rows = [], sampleAcc = 0, restartTimer = null;

// ---------- charts ----------
const C = { cyan: '#22d3ee', amber: '#fbbf24', pink: '#f472b6', violet: '#a78bfa', white: '#e2e8f0', green: '#34d399' };
// First chart: four selectable views, all recorded in parallel (only the selected one is drawn).
const VIEWS = {
  disp: { label: 'Displacements', axes: [{ label: 'x (cm)', minSpan: 0.5 }, { label: 'α, β (deg)', minSpan: 0.5 }],
    series: [{ name: 'x', color: C.cyan, axis: 0 }, { name: 'α', color: C.amber, axis: 1 }, { name: 'β', color: C.pink, axis: 1 }, { name: 'γ', color: C.green, axis: 1 }, { name: 'ψ yaw', color: C.violet, axis: 1 }] },
  acc: { label: 'Accelerations (world)', axes: [{ label: 'a (m/s²)', minSpan: 0.2 }],
    series: [{ name: 'a_x', color: C.cyan }, { name: 'a_y', color: C.amber }, { name: 'a_z', color: C.pink }] },
  sensor: { label: 'Phone accelerometer', axes: [{ label: 'x,y,z with g (m/s²)', minSpan: 0.2 }],
    series: [{ name: 'x', color: C.cyan }, { name: 'y', color: C.amber }, { name: 'z', color: C.pink }] },
  gyro: { label: 'Phone gyroscope', axes: [{ label: 'ω (rad/s)', minSpan: 0.05 }],
    series: [{ name: 'x', color: C.cyan }, { name: 'y', color: C.amber }, { name: 'z', color: C.pink }] },
};
const viewCharts = {};
for (const [k, v] of Object.entries(VIEWS)) viewCharts[k] = new StripChart($('ch-disp'), { title: '', window: sim.window, axes: v.axes, series: v.series });
let view1 = new URLSearchParams(location.search).get('chart1');
if (!(view1 in VIEWS)) view1 = 'disp';
let chDisp = viewCharts[view1];
const chEnergy = new StripChart($('ch-energy'), { title: 'Energy exchange', window: sim.window,
  axes: [{ label: 'E (mJ)', includeZero: true, minSpan: 0.05 }],
  series: [{ name: 'E_r', color: C.cyan }, { name: 'E_s', color: C.amber }, { name: 'E_c', color: C.violet }, { name: 'E_rot', color: C.green }, { name: 'E_rel', color: C.white, dash: [4, 3] }, { name: 'E_spring,kin', color: C.pink }] });
const chXY = new XYChart($('ch-xy'), { title: 'Footprint (top view)', unit: 'cm', window: sim.window });
const chDiag = new StripChart($('ch-diag'), { title: 'Resonance diagnostics', window: sim.window,
  axes: [{ label: 'Δφ (rad)', fixed: [-Math.PI, Math.PI] }, { label: 'amplitude (cm)', includeZero: true, minSpan: 0.2 }],
  series: [{ name: 'Δφ', color: C.green, axis: 0, dots: true }, { name: 'amp_r', color: C.cyan, axis: 1 }, { name: 'amp_s·R', color: C.amber, axis: 1 }] });
const allCharts = [...Object.values(viewCharts), chEnergy, chXY, chDiag];
const sel1 = $('sel-chart1');
sel1.innerHTML = Object.entries(VIEWS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('');
sel1.value = view1;
sel1.addEventListener('change', () => { view1 = sel1.value; chDisp = viewCharts[view1]; chDisp.ranges = [null, null]; drawCharts(); });

// ---------- toast ----------
let toastTimer = null;
function toast(msg, warn = false) {
  const t = $('toast'); t.textContent = msg; t.className = warn ? 'warn' : ''; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 5000);
}

// ---------- tuning panel ----------
const tuning = $('tuning');
tuning.innerHTML = `
  <h3>Tuning</h3>
  <div class="seg model-seg" id="model-seg">
    <button data-model="elastic" title="Elastic spring (most realistic)">Elastic spring</button><button data-model="rigid">Rigid body</button><button data-model="point">Point mass</button>
  </div>
  <p class="model-note" id="model-note"></p>
  <select id="preset" class="sel" title="Load a preset configuration">
    <option value="bare">iPhone 17, bare (default)</option>
    <option value="lab">Lab dataset (detuned, ratio ≈ 0.92)</option>
    <option value="case">iPhone 17 + case at exact 2:1</option>
    <option value="custom" disabled>Custom</option>
  </select>
  <div id="t-compute" hidden><span class="spin"></span>computing spring model…</div>
  <div class="tgrid" style="margin-top:8px">
    <div>M <b id="t-M"></b></div><div>d <b id="t-d"></b></div>
    <div>R_eq <b id="t-Req"></b></div><div>stretch <b id="t-st"></b></div>
    <div>f_r <b id="t-fr"></b></div><div>f_s (swing) <b id="t-fs"></b></div>
    <div>f_r/2f_s <b id="t-ratio"></b></div><div>de Sousa f <b id="t-f"></b></div>
    <div style="grid-column:span 2">detuning <b id="t-det"></b></div>
    <div class="rigid-only sec">f_rock <b id="t-fs2"></b></div><div class="rigid-only sec">f_y lo/up <b id="t-fsy"></b></div>
    <div class="el-only sec">f_twist <b id="t-ftw"></b></div><div class="el-only sec">f_surge <b id="t-fsu"></b></div>
    <div class="el-only sec">f_r textbook <b id="t-frtb"></b></div><div class="el-only sec">yaw_eq <b id="t-yaw"></b></div>
  </div>
  <div class="rigid-only inertia" id="t-inertia"></div>
  <div class="gauge"><div class="band" style="left:47.5%;width:5%"></div><div class="mid"></div><div class="mark" id="g-mark"></div></div>
  <div class="glab"><span>0.80</span><span>0.90</span><span>1.00</span><span>1.10</span><span>1.20</span></div>
  <div class="btnrow">
    <button class="btn sm accent" data-knob="cordLength">Tune to 2:1 with cord</button>
    <button class="btn sm accent" data-knob="nutsPerSide">…with nuts</button>
    <button class="btn sm accent" data-knob="springK">…with spring k</button>
  </div>
  <ul class="warns" id="warns"></ul>`;
const resonance = $('resonance');
resonance.innerHTML = `
  <summary>Find the real resonance (nonlinear simulation)</summary>
  <div class="row2"><label for="rs-knob">Knob</label>
    <select id="rs-knob"><option value="cordLength">Cord length</option><option value="nutsPerSide">Nuts per side</option><option value="springK">Spring constant k</option></select></div>
  <div class="row2"><label for="rs-T">Simulation length</label><input type="number" id="rs-T" min="10" max="300" step="5" value="90"><span style="color:var(--dim)">s per run</span></div>
  <div class="btnrow"><button class="btn sm accent" id="rs-go">Search</button><button class="btn sm" id="rs-cancel" disabled>Cancel</button><button class="btn sm" id="rs-apply" disabled>Apply</button></div>
  <div class="progress"><i id="rs-prog"></i></div>
  <div id="scan-box"><canvas id="ch-scan"></canvas></div>
  <div class="res-out" id="rs-out">Runs the full nonlinear model from the current start condition for each knob value and picks the fastest complete energy exchange.</div>
  <div class="btnrow"><button class="btn sm" id="nl-go">Measure nonlinear frequencies at this start amplitude</button></div>
  <div class="res-out" id="nl-out"></div>
  <p class="res-why">Why it differs from f_r = 2 f_s: that condition holds only for infinitesimal amplitudes; at the real start amplitude the spring stiffens or softens, the pendulum period depends on swing angle, and the coupling is nonlinear, so the frequencies shift and the best-tuned knob value moves.</p>`;
const chScan = new ScanChart($('ch-scan'));
if ([...new URLSearchParams(location.search).keys()].some(k => k in DEFAULT_PARAMS)) $('preset').value = 'custom';
const fmt = (v, d) => (typeof v === 'number' && isFinite(v)) ? v.toFixed(d) : '–';
function updateTuning() {
  const d = derived, el = params.model === 'elastic';
  $('t-M').textContent = fmt(d.M * 1000, 1) + ' g';
  $('t-d').textContent = fmt(d.d * 1000, 1) + ' mm';
  $('t-Req').textContent = fmt(d.Req * 100, 2) + ' cm';
  $('t-st').textContent = fmt(d.staticStretch * 100, 2) + ' cm';
  $('t-fr').textContent = fmt(d.fR, 4) + ' Hz';
  $('t-fs').textContent = fmt(d.fS, 4) + ' Hz';
  const rigid = isRigidLike(params.model);
  tuning.querySelectorAll('.rigid-only').forEach(e => { e.style.display = rigid ? '' : 'none'; });
  tuning.querySelectorAll('.el-only').forEach(e => { e.style.display = el ? '' : 'none'; });
  $('t-fs2').textContent = fmt(d.fS2, 4) + ' Hz';
  $('t-fsy').textContent = fmt(d.fSy, 3) + ' / ' + fmt(d.fSy2, 3);
  $('t-ftw').textContent = fmt(d.fTwist, 3) + ' Hz';
  $('t-fsu').textContent = fmt(d.fSurge, 2) + ' Hz';
  $('t-frtb').textContent = fmt(d.fRTextbook, 4) + ' Hz';
  $('t-yaw').textContent = fmt((d.yawEq || 0) * R2D, 2) + '°';
  const I = d.inertia || [];
  $('t-inertia').textContent = 'Inertia [Ix, Iy, Iz] = [' + I.map(v => fmt(v * 1e7, 0)).join(', ') + '] g·cm²';
  $('t-ratio').textContent = fmt(d.ratio, 4);
  $('t-f').textContent = fmt(d.fDeSousa ?? d.fS / d.fR, 4);
  $('t-det').textContent = fmt(d.detuningPct ?? (d.ratio - 1) * 100, 2) + ' %';
  const pos = Math.min(1, Math.max(0, (d.ratio - 0.8) / 0.4)) * 100;
  const mk = $('g-mark'); mk.style.left = pos + '%'; mk.classList.toggle('ok', Math.abs(d.ratio - 1) <= 0.01);
  $('warns').innerHTML = (d.warnings || []).map(w => `<li>${String(w).replace(/</g, '&lt;')}</li>`).join('');
  ui.setInfo('M', fmt(d.M * 1000, 1) + ' g');
  if (el) {
    const r = (k, v) => `<div class="r"><span>${k}</span><b>${v}</b></div>`;
    ui.setBox('springBox', [
      r('wire Ø', fmt(d.wireDiameter * 1e3, 3) + ' mm'), r('active turns', fmt(d.activeTurns, 2)),
      r('helix angle α0', fmt(d.helixAngle0 * R2D, 2) + '°'), r('wire length', fmt(d.wireLength * 100, 1) + ' cm'),
      r('k_lin (unloaded)', fmt(d.kLin, 3) + ' N/m'), r('k_tangent (eq.)', fmt(d.kTangentEq, 3) + ' N/m'),
      r('k_tangent (ref. load)', fmt(d.kTangentRef, 3) + ' N/m'), r('', ''),
      r('k_twist', fmt(d.kTwist * 1e3, 3) + ' mN·m/rad'), r('coupling W–ψ', fmt(d.couplingWT * 1e3, 3) + ' mN/rad'),
      r('model spring mass', fmt(d.springMassModel * 1e3, 2) + ' g'), r('time step dt', fmt(d.dt * 1e3, 3) + ' ms'),
    ].join(''));
  }
}

// ---------- UI ----------
const MODEL_NOTE = {
  elastic: 'Phone hangs from a simulated helical spring with distributed mass: it sags, bends, twists (yaw) and couples stretch with twist.',
  rigid: 'Phone is a 3D rigid body hanging from the eyebolt — it can rock and spin as well as bounce and swing.',
  point: 'Phone as a point mass at its centre of mass (the model of the methods document).',
};
function syncModel() {
  const m = params.model, rl = isRigidLike(m), el = m === 'elastic';
  tuning.querySelectorAll('#model-seg button').forEach(b => b.classList.toggle('on', b.dataset.model === m));
  $('model-note').textContent = MODEL_NOTE[m] || '';
  viewCharts.disp.setSeriesVisible(3, rl); viewCharts.disp.setSeriesVisible(4, rl); chEnergy.setSeriesVisible(3, rl); chEnergy.setSeriesVisible(5, el);
  viewCharts.disp.axes[1].label = rl ? 'α, β, γ, ψ (deg)' : 'α, β (deg)';
  chEnergy.series[2].name = el ? 'E_c (+ spring internal)' : 'E_c';
}
tuning.querySelectorAll('#model-seg button').forEach(b => b.addEventListener('click', () => {
  if (params.model === b.dataset.model) return;
  setParams({ model: b.dataset.model }); resetSearchUI(); refreshUI(); restart();
}));
const virt = () => ({
  caseEnabled: params.caseMass > 0 || params.attachmentOffset > 0,
  gravityPreset: Math.abs(params.gravity - 9.767) < 1e-6 ? 'lab' : Math.abs(params.gravity - 9.80665) < 1e-6 ? 'std' : Math.abs(params.gravity - 1.62) < 1e-6 ? 'moon' : 'custom',
});
function refreshUI() { ui.refresh(params, sim, virt()); syncModel(); }
function setParams(patch) { params = withDefaults({ ...params, ...patch }); }

const IC_KEYS = new Set(Object.keys({ icMode: 0, x0: 0, alpha0: 0, beta0: 0, dX0: 0, dY0: 0, dZ0: 0, alignPhone: 0, tiltX0: 0, tiltY0: 0, spin0: 0, rock0: 0, vx0: 0, vy0: 0, vz0: 0 }));
const D2R = Math.PI / 180;
const IC_BASE = { icMode: 'polar', x0: 0, alpha0: 0, beta0: 0, dX0: 0, dY0: 0, dZ0: 0, alignPhone: 1, tiltX0: 0, tiltY0: 0, spin0: 0, rock0: 0, vx0: 0, vy0: 0, vz0: 0 };
function applyIC(patch) { setParams({ ...IC_BASE, ...patch }); refreshUI(); restart(); }
const actions = {
  resetPhone() { setParams(IPHONE); refreshUI(); restart(); },
  icBounce() { applyIC({ x0: 0.04, alpha0: 0.5 * D2R }); },
  icSwing() { applyIC({ alpha0: 10 * D2R }); },
  icMixed() { applyIC({ x0: 0.03, alpha0: 5 * D2R, beta0: 1 * D2R }); },
  icRock() {
    if (!isRigidLike(params.model)) { setParams({ model: 'elastic' }); toast('Rocking needs a rigid-body phone — switched to the elastic model.'); }
    applyIC({ alignPhone: 0, tiltX0: 8 * D2R });
  },
  icPull() { applyIC({ icMode: 'cartesian', dX0: 0.08 }); },
  togglePlay() { sim.playing = !sim.playing; syncPlayLabels(); },
  reset() { restart(); },
  exportCsv, share,
};
const ui = buildControls($('controls'), {
  actions,
  onChange(store, key, value) {
    if (store === 'sim') {
      sim[key] = value;
      if (key === 'window') allCharts.forEach(c => c.setWindow(value));
      if (key === 'trail') scene?.setTrail(!!value);
      if (key === 'equilibrium') scene?.setShowEquilibrium(!!value);
      return;
    }
    if (store === 'virtual') {
      if (key === 'caseEnabled') {
        if (value) setParams({ caseMass: lastCase.mass, attachmentOffset: lastCase.off });
        else setParams({ caseMass: 0, attachmentOffset: 0 });
      } else if (key === 'gravityPreset') {
        const g = { lab: 9.767, std: 9.80665, moon: 1.62 }[value]; if (g) setParams({ gravity: g });
      }
      refreshUI(); scheduleRestart(); return;
    }
    if (key === 'caseMass' && value > 0) lastCase.mass = value;
    if (key === 'attachmentOffset' && value > 0) lastCase.off = value;
    setParams({ [key]: value });
    if (!IC_KEYS.has(key)) $('preset').value = 'custom';
    if (key === 'dampingModel') ui.updateVisibility(params);
    if (key === 'caseMass' || key === 'attachmentOffset' || key === 'gravity') refreshUI();
    scheduleRestart();
  },
});
function syncPlayLabels() {
  const t = sim.playing ? 'Pause' : 'Play';
  ui.setButtonLabel('playBtn', t); $('vp-play').textContent = t;
}

// ---------- web workers (resonance search, linear tuning for the elastic model) ----------
const plain = p => JSON.parse(JSON.stringify(p));
const workers = {};   // name -> { w, pending: Map(id -> {resolve,reject,onProgress}) }
let nextId = 1;
function getWorker(name) {
  if (workers[name]) return workers[name];
  const w = new Worker(new URL('./resonance-worker.js', import.meta.url), { type: 'module' });
  const rec = { w, pending: new Map() };
  w.onmessage = ev => {
    const m = ev.data, pnd = rec.pending.get(m.id); if (!pnd) return;
    if (m.type === 'progress') pnd.onProgress?.(m.fraction, m.partial);
    else { rec.pending.delete(m.id); if (m.type === 'result') pnd.resolve(m.data); else pnd.reject(new Error(m.message)); }
  };
  w.onerror = ev => { const err = new Error(ev.message || 'worker error'); for (const p of rec.pending.values()) p.reject(err); rec.pending.clear(); delete workers[name]; };
  workers[name] = rec; return rec;
}
function runTask(name, task, p, knob, opts, onProgress) {
  const rec = getWorker(name), id = nextId++;
  const promise = new Promise((resolve, reject) => { rec.pending.set(id, { resolve, reject, onProgress }); });
  rec.w.postMessage({ id, task, params: plain(p), knob, opts });
  return { id, promise, cancel() {
    rec.w.postMessage({ id, task: 'cancel' });
    // a busy worker cannot read the message until its current simulation ends; hard-stop if it does not answer
    setTimeout(() => { if (rec.pending.has(id)) { const pn = rec.pending.get(id); rec.pending.delete(id); rec.w.terminate(); if (workers[name] === rec) delete workers[name]; pn.reject(new Error('cancelled')); } }, 1500);
  } };
}

// Linear 2:1 solve: worker for the elastic model (slow), direct call otherwise.
async function solveLinear(p, knob) {
  if (p.model !== 'elastic') return solveForResonance(p, knob);
  return runTask('lin', 'linear', p, knob, {}, null).promise;
}
let tuneBusy = false;
function setTuneBusy(b) {
  tuneBusy = b;
  tuning.querySelectorAll('[data-knob]').forEach(x => { x.disabled = b; });
  $('preset').disabled = b;
  $('t-compute').hidden = !b && !computingDerive;
  $('t-compute').lastChild.textContent = b ? 'solving 2:1 resonance…' : 'computing spring model…';
}

$('preset').addEventListener('change', async e => {
  const v = e.target.value;
  const model = params.model;
  resetSearchUI();
  if (v === 'bare') params = withDefaults({ model });
  else if (v === 'lab') params = withDefaults({ ...LAB, model });
  else {
    const p = withDefaults({ caseMass: CASE_DEFAULT.mass, attachmentOffset: CASE_DEFAULT.off, nutsPerSide: 5, model });
    setTuneBusy(true);
    try {
      const r = await solveLinear(p, 'cordLength');
      params = r.feasible ? withDefaults(r.params) : p;
      toast(r.note || 'Tuned with cord length', !r.feasible);
    } catch (err) { showError(err); params = p; }
    setTuneBusy(false);
  }
  refreshUI(); restart();
});
tuning.querySelectorAll('[data-knob]').forEach(b => b.addEventListener('click', async () => {
  if (tuneBusy) return;
  setTuneBusy(true);
  try {
    const r = await solveLinear(params, b.dataset.knob);
    if (r.feasible) { params = withDefaults(r.params); $('preset').value = 'custom'; resetSearchUI(); refreshUI(); restart(); toast(r.note || `Tuned: ratio ${fmt(r.achievedRatio, 4)}`); }
    else toast(r.note || 'No feasible solution with this knob.', true);
  } catch (e) { showError(e); }
  setTuneBusy(false);
}));

// ---------- resonance search panel ----------
const KNOB = { cordLength: { label: 'cord length (cm)', scale: 100, dec: 1, unit: 'cm' }, nutsPerSide: { label: 'nuts per side', scale: 1, dec: 0, unit: '' }, springK: { label: 'spring k (N/m)', scale: 1, dec: 2, unit: 'N/m' } };
let search = null, searchResult = null, nlTask = null;
function knobFmt(knob, v) { const k = KNOB[knob]; return (v * k.scale).toFixed(k.dec) + (k.unit ? ' ' + k.unit : ''); }
function setScanAxis() { const k = KNOB[$('rs-knob').value]; chScan.setAxis(k.label, k.scale, k.dec); }
function resetSearchUI() {
  search?.cancel(); search = null; searchResult = null;
  chScan.clear(); setScanAxis(); chScan.draw();
  $('rs-prog').style.width = '0'; $('rs-go').disabled = false; $('rs-cancel').disabled = true; $('rs-apply').disabled = true;
  $('rs-out').textContent = 'Runs the full nonlinear model from the current start condition for each knob value and picks the fastest complete energy exchange.';
}
$('rs-knob').addEventListener('change', () => { if (!search) resetSearchUI(); });
$('rs-go').addEventListener('click', async () => {
  if (search) return;
  const knob = $('rs-knob').value, T = Math.min(300, Math.max(10, parseFloat($('rs-T').value) || 90));
  searchResult = null; chScan.clear(); setScanAxis();
  $('rs-go').disabled = true; $('rs-cancel').disabled = false; $('rs-apply').disabled = true;
  $('rs-out').innerHTML = '<span class="spin"></span>searching…';
  const my = search = runTask('search', 'search', params, knob, { T }, (fr, partial) => {
    $('rs-prog').style.width = (fr * 100).toFixed(0) + '%';
    if (partial) { chScan.set(Array.isArray(partial) ? partial : partial.scan, null, null); chScan.draw(); }
  });
  try {
    const r = await my.promise; searchResult = { ...r, knob };
    chScan.set(r.scan, r.linear?.value, r.best); chScan.draw();
    $('rs-prog').style.width = '100%';
    const b = r.best;
    if (b && isFinite(b.value)) {
      $('rs-out').innerHTML = `Best ${KNOB[knob].label.replace(/ \(.*/, '')}: <b>${knobFmt(knob, b.value)}</b> (linear estimate ${r.linear ? knobFmt(knob, r.linear.value) : '–'})<br>
        η = <b>${fmt(b.eta, 3)}</b>, exchange time <b>${fmt(b.tExchange, 1)} s</b><br>
        ratio f_r/2f_s: linear <b>${fmt(b.ratioLinear, 4)}</b>, measured <b>${fmt(b.ratioMeas, 4)}</b>${r.note ? '<br>' + String(r.note).replace(/</g, '&lt;') : ''}`;
      $('rs-apply').disabled = false;
    } else $('rs-out').textContent = my.cancelled ? 'Search cancelled.' : (r.note || 'No result.');
  } catch (e) { if (e.message !== 'cancelled') { showError(e); $('rs-out').textContent = 'Search failed: ' + e.message; } else $('rs-out').textContent = 'Search cancelled.'; }
  if (search === my) search = null;
  $('rs-go').disabled = false; $('rs-cancel').disabled = true;
});
$('rs-cancel').addEventListener('click', () => { if (search) search.cancelled = true; search?.cancel(); $('rs-out').textContent = 'Cancelling…'; });
$('rs-apply').addEventListener('click', () => {
  if (!searchResult?.best) return;
  const { knob, best } = searchResult;
  setParams({ [knob]: best.value }); $('preset').value = 'custom'; refreshUI(); restart();
  toast(`Applied ${knob} = ${knobFmt(knob, best.value)}`);
});
$('nl-go').addEventListener('click', async () => {
  if (nlTask) return;
  $('nl-go').disabled = true; $('nl-out').innerHTML = '<span class="spin"></span>measuring…';
  const my = nlTask = runTask('search', 'nlfreq', params, null, { T: 60 }, null);
  try {
    const r = await my.promise, d = derived;
    $('nl-out').innerHTML = `f_r: <b>${fmt(r.fR, 4)}</b> Hz (linear ${fmt(d.fR, 4)})<br>f_s: <b>${fmt(r.fS, 4)}</b> Hz (linear ${fmt(d.fS, 4)})<br>f_r/2f_s: <b>${fmt(r.ratio, 4)}</b> (linear ${fmt(d.ratio, 4)})`;
  } catch (e) { $('nl-out').textContent = 'Failed: ' + e.message; showError(e); }
  nlTask = null; $('nl-go').disabled = false;
});

// ---------- CSV / share ----------
function exportCsv() {
  const head = `# model=${params.model}\n# params=${JSON.stringify(params)}\nt,X,Y,Z,x,alpha,beta,Er,Es,Ec,Erel,Emech,dPhi,partitionR,tilt,tiltY,Erot,qw,qx,qy,qz,attachX,attachY,attachZ,yaw,twistTotal,EspringKin,EspringEl,ax,ay,az,accX,accY,accZ,gyroX,gyroY,gyroZ\n`;
  const blob = new Blob([head + rows.map(r => r.join(',')).join('\n') + '\n'], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'elastic_pendulum.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Exported ${rows.length} rows`);
}
function share() {
  const q = new URLSearchParams();
  for (const k of Object.keys(DEFAULT_PARAMS)) q.set(k, String(params[k]));
  q.set('chart1', view1);
  const url = location.origin + location.pathname + '?' + q.toString();
  history.replaceState(null, '', '?' + q.toString());
  (navigator.clipboard?.writeText(url) ?? Promise.reject()).then(() => toast('Share link copied'), () => toast('Link set in the address bar: ' + url));
}

// ---------- restart ----------
let computingDerive = false;
function scheduleRestart() {
  clearTimeout(restartTimer);
  const el = params.model === 'elastic';
  if (el) { computingDerive = true; $('t-compute').hidden = false; }
  restartTimer = setTimeout(restart, el ? 200 : 50);
}
function sample() {
  obs = observables(state, params, derived);
  const o = obs;
  viewCharts.disp.push(o.t, [o.x * 100, o.alpha * R2D, o.beta * R2D, (o.tilt || 0) * R2D, (o.yaw || 0) * R2D]);
  viewCharts.acc.push(o.t, o.acc); viewCharts.sensor.push(o.t, o.accSensor); viewCharts.gyro.push(o.t, o.gyroSensor);
  chEnergy.push(o.t, [o.Er * 1e3, o.Es * 1e3, o.Ec * 1e3, (o.Erot || 0) * 1e3, o.Erel * 1e3, (o.EspringKin || 0) * 1e3]);
  chXY.push(o.t, o.q[0] * 100, o.q[1] * 100);
  chDiag.push(o.t, [o.dPhi, o.ampR * 100, o.ampS * derived.Req * 100]);
  if (rows.length < MAX_ROWS) rows.push([o.t, o.q[0], o.q[1], o.q[2], o.x, o.alpha, o.beta, o.Er, o.Es, o.Ec, o.Erel, o.Emech, o.dPhi, o.partitionR, o.tilt ?? 0, o.tiltY ?? 0, o.Erot ?? 0, ...(o.quat || [1, 0, 0, 0]), ...(o.attach || [0, 0, 0]), o.yaw ?? 0, o.twistTotal ?? 0, o.EspringKin ?? 0, o.EspringEl ?? 0, ...o.acc, ...o.accSensor, ...o.gyroSensor].map(v => +(+v).toPrecision(8)));
}
function restart() {
  clearTimeout(restartTimer); restartTimer = null;
  try {
    derived = derive(params); computingDerive = false; if (!tuneBusy) $('t-compute').hidden = true;
    scene?.rebuild(params, derived);
    state = createState(params, derived);
    allCharts.forEach(c => c.clear()); scene?.clearTrail();
    rows = []; sampleAcc = 0;
    sample();
    updateTuning();
    if (scene?.setStartMarker) scene.setStartMarker(obs.q);
    pushScene(); updateReadout(); drawCharts();
  } catch (e) { computingDerive = false; $('t-compute').hidden = true; showError(e); }
}

// ---------- drag-to-place ----------
let dragResume = true, dragging = false;
function placeAt(q) {
  const Req = derived.Req, r4 = v => Math.round(v * 1e4) / 1e4, cl = v => Math.max(-0.3, Math.min(0.3, v));
  setParams({ icMode: 'cartesian', dX0: r4(cl(q[0])), dY0: r4(cl(q[1])), dZ0: r4(cl(q[2] + Req)) });
  refreshUI();
}
function reinitLight() {
  state = createState(params, derived);
  allCharts.forEach(c => c.clear()); scene?.clearTrail();
  rows = []; sampleAcc = 0;
  sample(); pushScene(); updateReadout(); drawCharts();
}
function setupPlacement() {
  if (!scene?.setPlacementHandlers) return;
  scene.setPlacementHandlers({
    onStart() { dragResume = sim.playing; dragging = true; sim.playing = false; syncPlayLabels(); },
    onDrag(q) { try { placeAt(q); reinitLight(); } catch (e) { showError(e); } },
    onEnd(q) {
      dragging = false;
      try { if (q) placeAt(q); restart(); } catch (e) { showError(e); }
      sim.playing = dragResume; syncPlayLabels();
    },
  });
}

// ---------- readout ----------
function updateReadout() {
  const o = obs; if (!o) return;
  const f = (v, d) => v.toFixed(d);
  const m = params.model, rigid = isRigidLike(m), el = m === 'elastic';
  const pr = isFinite(o.partitionR) ? Math.min(1, Math.max(0, o.partitionR)) : 0;
  const slow = sim.playing && effSpeed < sim.speed * 0.95;
  const html = `
    <div class="row"><span class="k">model</span><span>${{ elastic: 'Elastic spring', rigid: 'Rigid body', point: 'Point mass' }[m]}</span></div>
    <div class="row"><span class="k">t</span><span>${f(o.t, 2)} s</span></div>
    <div class="row"><span class="k">x</span><span>${f(o.x * 100, 2)} cm</span></div>
    <div class="row"><span class="k">α</span><span>${f(o.alpha * R2D, 2)}°</span></div>
    <div class="row"><span class="k">β</span><span>${f(o.beta * R2D, 2)}°</span></div>
    ${rigid ? `<div class="row"><span class="k">γ tilt</span><span>${f((o.tilt || 0) * R2D, 2)}°</span></div>
    <div class="row"><span class="k" style="color:#a78bfa">ψ yaw</span><span>${f((o.yaw || 0) * R2D, 2)}°</span></div>` : ''}
    <div class="row"><span class="k" style="color:#22d3ee">E_r</span><span>${f(o.Er * 1e3, 3)} mJ</span></div>
    <div class="row"><span class="k" style="color:#fbbf24">E_s</span><span>${f(o.Es * 1e3, 3)} mJ</span></div>
    <div class="row"><span class="k" style="color:#a78bfa">${el ? 'E_c (+spring)' : 'E_c'}</span><span>${f(o.Ec * 1e3, 3)} mJ</span></div>
    ${rigid ? `<div class="row"><span class="k" style="color:#34d399">E_rot</span><span>${f((o.Erot || 0) * 1e3, 3)} mJ</span></div>` : ''}
    ${el ? `<div class="row"><span class="k" style="color:#f472b6">E_spring,kin</span><span>${f((o.EspringKin || 0) * 1e3, 3)} mJ</span></div>` : ''}
    <div class="row"><span class="k">π_r</span><span>${f(pr * 100, 0)} %</span></div>
    <div class="pbar"><i style="width:${pr * 100}%"></i></div>
    <div class="row"><span class="k">speed</span><span>${sim.speed.toFixed(1)}×${sim.playing ? '' : ' (paused)'}</span></div>
    ${slow ? `<div style="color:#fbbf24">running at ${effSpeed.toFixed(2)}× real time</div>` : ''}
    ${o.slack ? '<span class="badge">SLACK</span>' : ''}`;
  if (html !== lastReadoutHtml) { lastReadoutHtml = html; $('readout').innerHTML = html; }
}
let lastReadoutHtml = '';
function pushScene() {
  if (!scene || !obs) return;
  scene.update({ q: obs.q, attach: obs.attach, quat: obs.quat, spring: obs.spring, ell: obs.ell, slack: obs.slack, springLength: obs.springLength, tilt: obs.tilt, params, derived });
}
function drawCharts() { allCharts.forEach(c => { if (c.canvas !== viewCharts.disp.canvas || c === chDisp) c.draw(); }); }
// Loop redraw: skip charts whose data did not change since their last draw (identical output, less work).
function drawChartsIfDirty() { allCharts.forEach(c => { if (c.canvas !== viewCharts.disp.canvas || c === chDisp) c.drawIfDirty(); }); }

// ---------- main loop ----------
let lastT = performance.now(), lastChart = 0;
let effSpeed = 1;            // measured simulated seconds per real second (smoothed)
const FRAME_BUDGET_MS = 12;  // max physics wall time per animation frame
function frame(now) {
  requestAnimationFrame(frame);
  try {
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    if (sim.playing && state) {
      sampleAcc += dt * sim.speed;
      const t0 = performance.now(), simBefore = state.t ?? 0;
      let n = 0, advanced = 0, cut = false;
      while (sampleAcc >= SAMPLE_DT && n++ < 600) {
        advance(state, params, derived, SAMPLE_DT, derived.dt ?? 0.001);
        sampleAcc -= SAMPLE_DT; advanced += SAMPLE_DT;
        sample();
        if (performance.now() - t0 > FRAME_BUDGET_MS) { cut = true; break; }
      }
      if (n >= 600 || cut) sampleAcc = Math.min(sampleAcc, SAMPLE_DT);   // drop what we cannot compute: effective speed falls
      if (dt > 0) {
        const inst = advanced / dt;
        effSpeed += (Math.min(inst, sim.speed) - effSpeed) * 0.1;
        if (!cut && inst >= sim.speed * 0.9) effSpeed += (sim.speed - effSpeed) * 0.3;
      }
    } else effSpeed = sim.speed;
    pushScene();
    updateReadout();
    if (now - lastChart > 40) { lastChart = now; drawChartsIfDirty(); }
  } catch (e) { showError(e); sim.playing = false; syncPlayLabels(); }
}

// ---------- help dialog + KaTeX (lazy, CDN) ----------
const KATEX = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/';
let katexPromise = null;
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('failed ' + src)); document.head.appendChild(s); }); }
function renderHelpMath() {
  if (!katexPromise) {
    katexPromise = (async () => {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = KATEX + 'katex.min.css'; document.head.appendChild(l);
      await loadScript(KATEX + 'katex.min.js');
      await loadScript(KATEX + 'contrib/auto-render.min.js');
    })();
  }
  katexPromise.then(() => {
    window.renderMathInElement($('help'), { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '\\(', right: '\\)', display: false }], throwOnError: false });
    $('help').dataset.math = 'ok';
  }, e => { katexPromise = null; $('help').dataset.math = 'raw'; console.warn('KaTeX unavailable, showing LaTeX source', e); });
}

// ---------- init ----------
async function init() {
  $('btn-help').onclick = () => { $('help').showModal(); if ($('help').dataset.math !== 'ok') renderHelpMath(); };
  $('btn-panel').onclick = () => { document.body.classList.toggle('panel-hidden'); setTimeout(onResize, 0); };
  $('vp-play').onclick = actions.togglePlay;
  $('vp-reset').onclick = actions.reset;
  $('vp-cam').onclick = () => scene?.resetCamera();
  const onResize = () => { scene?.resize(); drawCharts(); };
  window.addEventListener('resize', onResize);
  new ResizeObserver(onResize).observe($('viewport'));
  if (new URLSearchParams(location.search).has('paused')) sim.playing = false;
  refreshUI(); syncPlayLabels(); setScanAxis();
  try {
    const { createScene } = await import('./scene.js');
    scene = createScene($('viewport'), {});
    setupPlacement();
    scene.setTrail(sim.trail); scene.setShowEquilibrium(sim.equilibrium);
  } catch (e) { showError(e); }
  restart();
  lastT = performance.now();
  requestAnimationFrame(frame);
}
init().catch(showError);
