import { DEFAULT_PARAMS, withDefaults, derive, createState, advance, observables, solveForResonance } from './physics.js';
import { buildControls } from './ui.js';
import { StripChart, XYChart } from './charts.js';

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
window.addEventListener('error', ev => showError(ev.error || ev.message));
window.addEventListener('unhandledrejection', ev => showError(ev.reason));

// ---------- state ----------
const LAB = { phoneMass: 0.2112, phoneLength: 0.150, caseMass: 0, attachmentOffset: 0, cordLength: 0, springK: 18.95, springL0: 0.19, springMass: 0.0063 };
const IPHONE = { phoneMass: DEFAULT_PARAMS.phoneMass, phoneLength: DEFAULT_PARAMS.phoneLength, phoneWidth: DEFAULT_PARAMS.phoneWidth, phoneThickness: DEFAULT_PARAMS.phoneThickness };
const CASE_DEFAULT = { mass: 0.045, off: 0.060 }; // 60 mm: 20 mm horn + eyebolt shank long enough for ~6 nuts
let lastCase = { ...CASE_DEFAULT };

const STRING_VALUES = { model: ['rigid', 'point'], icMode: ['polar', 'cartesian'], dampingModel: ['none', 'linear', 'quadratic'] };
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
const chDisp = new StripChart($('ch-disp'), { title: 'Displacements', window: sim.window,
  axes: [{ label: 'x (cm)', minSpan: 0.5 }, { label: 'α, β (deg)', minSpan: 0.5 }],
  series: [{ name: 'x', color: C.cyan, axis: 0 }, { name: 'α', color: C.amber, axis: 1 }, { name: 'β', color: C.pink, axis: 1 }, { name: 'γ', color: C.green, axis: 1 }] });
const chEnergy = new StripChart($('ch-energy'), { title: 'Energy exchange', window: sim.window,
  axes: [{ label: 'E (mJ)', includeZero: true, minSpan: 0.05 }],
  series: [{ name: 'E_r', color: C.cyan }, { name: 'E_s', color: C.amber }, { name: 'E_c', color: C.violet }, { name: 'E_rot', color: C.green }, { name: 'E_rel', color: C.white, dash: [4, 3] }] });
const chXY = new XYChart($('ch-xy'), { title: 'Footprint (top view)', unit: 'cm', window: sim.window });
const chDiag = new StripChart($('ch-diag'), { title: 'Resonance diagnostics', window: sim.window,
  axes: [{ label: 'Δφ (rad)', fixed: [-Math.PI, Math.PI] }, { label: 'amplitude (cm)', includeZero: true, minSpan: 0.2 }],
  series: [{ name: 'Δφ', color: C.green, axis: 0, dots: true }, { name: 'amp_r', color: C.cyan, axis: 1 }, { name: 'amp_s·R', color: C.amber, axis: 1 }] });
const allCharts = [chDisp, chEnergy, chXY, chDiag];

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
    <button data-model="rigid">Rigid body (realistic)</button><button data-model="point">Point mass (methods doc)</button>
  </div>
  <p class="model-note" id="model-note"></p>
  <select id="preset" class="sel" title="Load a preset configuration">
    <option value="bare">iPhone 17, bare (default)</option>
    <option value="lab">Lab dataset (detuned, ratio ≈ 0.92)</option>
    <option value="case">iPhone 17 + case at exact 2:1</option>
    <option value="custom" disabled>Custom</option>
  </select>
  <div class="tgrid" style="margin-top:8px">
    <div>M <b id="t-M"></b></div><div>d <b id="t-d"></b></div>
    <div>R_eq <b id="t-Req"></b></div><div>stretch <b id="t-st"></b></div>
    <div>f_r <b id="t-fr"></b></div><div>f_s (swing) <b id="t-fs"></b></div>
    <div>f_r/2f_s <b id="t-ratio"></b></div><div>de Sousa f <b id="t-f"></b></div>
    <div style="grid-column:span 2">detuning <b id="t-det"></b></div>
    <div class="rigid-only sec">f_rock <b id="t-fs2"></b></div><div class="rigid-only sec">f_y lo/up <b id="t-fsy"></b></div>
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
if ([...new URLSearchParams(location.search).keys()].some(k => k in DEFAULT_PARAMS)) $('preset').value = 'custom';
const fmt = (v, d) => (typeof v === 'number' && isFinite(v)) ? v.toFixed(d) : '–';
function updateTuning() {
  const d = derived;
  $('t-M').textContent = fmt(d.M * 1000, 1) + ' g';
  $('t-d').textContent = fmt(d.d * 1000, 1) + ' mm';
  $('t-Req').textContent = fmt(d.Req * 100, 2) + ' cm';
  $('t-st').textContent = fmt(d.staticStretch * 100, 2) + ' cm';
  $('t-fr').textContent = fmt(d.fR, 4) + ' Hz';
  $('t-fs').textContent = fmt(d.fS, 4) + ' Hz';
  const rigid = params.model === 'rigid';
  tuning.querySelectorAll('.rigid-only').forEach(e => { e.style.display = rigid ? '' : 'none'; });
  $('t-fs2').textContent = fmt(d.fS2, 4) + ' Hz';
  $('t-fsy').textContent = fmt(d.fSy, 3) + ' / ' + fmt(d.fSy2, 3);
  const I = d.inertia || [];
  $('t-inertia').textContent = 'Inertia [Ix, Iy, Iz] = [' + I.map(v => fmt(v * 1e7, 0)).join(', ') + '] g·cm²';
  $('t-ratio').textContent = fmt(d.ratio, 4);
  $('t-f').textContent = fmt(d.fDeSousa, 4);
  $('t-det').textContent = fmt(d.detuningPct, 2) + ' %';
  const pos = Math.min(1, Math.max(0, (d.ratio - 0.8) / 0.4)) * 100;
  const mk = $('g-mark'); mk.style.left = pos + '%'; mk.classList.toggle('ok', Math.abs(d.ratio - 1) <= 0.01);
  $('warns').innerHTML = (d.warnings || []).map(w => `<li>${String(w).replace(/</g, '&lt;')}</li>`).join('');
  ui.setInfo('M', fmt(d.M * 1000, 1) + ' g');
}

// ---------- UI ----------
const MODEL_NOTE = {
  rigid: 'Phone is a 3D rigid body hanging from the eyebolt — it can rock and spin as well as bounce and swing.',
  point: 'Phone as a point mass at its centre of mass (the model of the methods document).',
};
function syncModel() {
  const m = params.model;
  tuning.querySelectorAll('#model-seg button').forEach(b => b.classList.toggle('on', b.dataset.model === m));
  $('model-note').textContent = MODEL_NOTE[m] || '';
  const rigid = m === 'rigid';
  chDisp.setSeriesVisible(3, rigid); chEnergy.setSeriesVisible(3, rigid);
  chDisp.axes[1].label = rigid ? 'α, β, γ (deg)' : 'α, β (deg)';
}
tuning.querySelectorAll('#model-seg button').forEach(b => b.addEventListener('click', () => {
  if (params.model === b.dataset.model) return;
  setParams({ model: b.dataset.model }); refreshUI(); restart();
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
    if (params.model !== 'rigid') { setParams({ model: 'rigid' }); toast('Rocking needs the rigid-body model — switched to it.'); }
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

$('preset').addEventListener('change', e => {
  const v = e.target.value;
  const model = params.model;
  if (v === 'bare') params = withDefaults({ model });
  else if (v === 'lab') params = withDefaults({ ...LAB, model });
  else {
    const p = withDefaults({ caseMass: CASE_DEFAULT.mass, attachmentOffset: CASE_DEFAULT.off, nutsPerSide: 5, model });
    const r = solveForResonance(p, 'cordLength');
    params = r.feasible ? withDefaults(r.params) : p;
    toast(r.note || 'Tuned with cord length', !r.feasible);
  }
  refreshUI(); restart();
});
tuning.querySelectorAll('[data-knob]').forEach(b => b.addEventListener('click', () => {
  try {
    const r = solveForResonance(params, b.dataset.knob);
    if (r.feasible) { params = withDefaults(r.params); $('preset').value = 'custom'; refreshUI(); restart(); toast(r.note || `Tuned: ratio ${fmt(r.achievedRatio, 4)}`); }
    else toast(r.note || 'No feasible solution with this knob.', true);
  } catch (e) { showError(e); }
}));

// ---------- CSV / share ----------
function exportCsv() {
  const head = `# model=${params.model}\n# params=${JSON.stringify(params)}\nt,X,Y,Z,x,alpha,beta,Er,Es,Ec,Erel,Emech,dPhi,partitionR,tilt,tiltY,Erot,qw,qx,qy,qz,attachX,attachY,attachZ\n`;
  const blob = new Blob([head + rows.map(r => r.join(',')).join('\n') + '\n'], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'elastic_pendulum.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`Exported ${rows.length} rows`);
}
function share() {
  const q = new URLSearchParams();
  for (const k of Object.keys(DEFAULT_PARAMS)) q.set(k, String(params[k]));
  const url = location.origin + location.pathname + '?' + q.toString();
  history.replaceState(null, '', '?' + q.toString());
  (navigator.clipboard?.writeText(url) ?? Promise.reject()).then(() => toast('Share link copied'), () => toast('Link set in the address bar: ' + url));
}

// ---------- restart ----------
function scheduleRestart() { clearTimeout(restartTimer); restartTimer = setTimeout(restart, 50); }
function sample() {
  obs = observables(state, params, derived);
  const o = obs;
  chDisp.push(o.t, [o.x * 100, o.alpha * R2D, o.beta * R2D, (o.tilt || 0) * R2D]);
  chEnergy.push(o.t, [o.Er * 1e3, o.Es * 1e3, o.Ec * 1e3, (o.Erot || 0) * 1e3, o.Erel * 1e3]);
  chXY.push(o.t, o.q[0] * 100, o.q[1] * 100);
  chDiag.push(o.t, [o.dPhi, o.ampR * 100, o.ampS * derived.Req * 100]);
  if (rows.length < MAX_ROWS) rows.push([o.t, o.q[0], o.q[1], o.q[2], o.x, o.alpha, o.beta, o.Er, o.Es, o.Ec, o.Erel, o.Emech, o.dPhi, o.partitionR, o.tilt ?? 0, o.tiltY ?? 0, o.Erot ?? 0, ...(o.quat || [1, 0, 0, 0]), ...(o.attach || [0, 0, 0])].map(v => +(+v).toPrecision(8)));
}
function restart() {
  clearTimeout(restartTimer); restartTimer = null;
  try {
    derived = derive(params);
    scene?.rebuild(params, derived);
    state = createState(params, derived);
    allCharts.forEach(c => c.clear()); scene?.clearTrail();
    rows = []; sampleAcc = 0;
    sample();
    updateTuning();
    if (scene?.setStartMarker) scene.setStartMarker(obs.q);
    pushScene(); updateReadout(); drawCharts();
  } catch (e) { showError(e); }
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
  const rigid = params.model === 'rigid';
  const pr = isFinite(o.partitionR) ? Math.min(1, Math.max(0, o.partitionR)) : 0;
  $('readout').innerHTML = `
    <div class="row"><span class="k">model</span><span>${params.model === 'rigid' ? 'Rigid body' : 'Point mass'}</span></div>
    <div class="row"><span class="k">t</span><span>${f(o.t, 2)} s</span></div>
    <div class="row"><span class="k">x</span><span>${f(o.x * 100, 2)} cm</span></div>
    <div class="row"><span class="k">α</span><span>${f(o.alpha * R2D, 2)}°</span></div>
    <div class="row"><span class="k">β</span><span>${f(o.beta * R2D, 2)}°</span></div>
    ${rigid ? `<div class="row"><span class="k">γ tilt</span><span>${f((o.tilt || 0) * R2D, 2)}°</span></div>` : ''}
    <div class="row"><span class="k" style="color:#22d3ee">E_r</span><span>${f(o.Er * 1e3, 3)} mJ</span></div>
    <div class="row"><span class="k" style="color:#fbbf24">E_s</span><span>${f(o.Es * 1e3, 3)} mJ</span></div>
    <div class="row"><span class="k" style="color:#a78bfa">E_c</span><span>${f(o.Ec * 1e3, 3)} mJ</span></div>
    ${rigid ? `<div class="row"><span class="k" style="color:#34d399">E_rot</span><span>${f((o.Erot || 0) * 1e3, 3)} mJ</span></div>` : ''}
    <div class="row"><span class="k">π_r</span><span>${f(pr * 100, 0)} %</span></div>
    <div class="pbar"><i style="width:${pr * 100}%"></i></div>
    <div class="row"><span class="k">speed</span><span>${sim.speed.toFixed(1)}×${sim.playing ? '' : ' (paused)'}</span></div>
    ${o.slack ? '<span class="badge">SLACK</span>' : ''}`;
}
function pushScene() {
  if (!scene || !obs) return;
  scene.update({ q: obs.q, attach: obs.attach, quat: obs.quat, ell: obs.ell, slack: obs.slack, springLength: obs.springLength, tilt: obs.tilt, params, derived });
}
function drawCharts() { allCharts.forEach(c => c.draw()); }

// ---------- main loop ----------
let lastT = performance.now(), lastChart = 0;
function frame(now) {
  requestAnimationFrame(frame);
  try {
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    if (sim.playing && state) {
      sampleAcc += dt * sim.speed;
      let n = 0;
      while (sampleAcc >= SAMPLE_DT && n++ < 600) {
        advance(state, params, derived, SAMPLE_DT, 0.001);
        sampleAcc -= SAMPLE_DT;
        sample();
      }
      if (n >= 600) sampleAcc = 0;
    }
    pushScene();
    updateReadout();
    if (now - lastChart > 40) { lastChart = now; drawCharts(); }
  } catch (e) { showError(e); sim.playing = false; syncPlayLabels(); }
}

// ---------- init ----------
async function init() {
  $('btn-help').onclick = () => $('help').showModal();
  $('btn-panel').onclick = () => { document.body.classList.toggle('panel-hidden'); setTimeout(onResize, 0); };
  $('vp-play').onclick = actions.togglePlay;
  $('vp-reset').onclick = actions.reset;
  $('vp-cam').onclick = () => scene?.resetCamera();
  const onResize = () => { scene?.resize(); drawCharts(); };
  window.addEventListener('resize', onResize);
  new ResizeObserver(onResize).observe($('viewport'));
  if (new URLSearchParams(location.search).has('paused')) sim.playing = false;
  refreshUI(); syncPlayLabels();
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
