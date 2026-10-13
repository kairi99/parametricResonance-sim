// Schema-driven control panel.
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const isQuad = p => p.dampingModel === 'quadratic';
const isLin = p => p.dampingModel === 'linear';
const isRigid = p => p.model === 'rigid' || p.model === 'elastic';   // phone is a rigid body (rigid + elastic models)
const isElastic = p => p.model === 'elastic';
const elDirect = p => isElastic(p) && p.springGeometry === 'direct';
const elFromK = p => isElastic(p) && p.springGeometry !== 'direct';
const elCustom = p => isElastic(p) && p.wireMaterial === 'custom';
const kVisible = p => !elDirect(p);
const isPolar = p => p.icMode !== 'cartesian';
const isCart = p => p.icMode === 'cartesian';
const rigidLin = p => isRigid(p) && isLin(p);
const rigidQuad = p => isRigid(p) && isQuad(p);
const rigidFree = p => isRigid(p) && !p.alignPhone;

const ROT_TIP = 'Rotational damping of the phone (air drag on rotation); not yet calibrated against data.';

/** store: 'params' (SI physical params), 'sim' (UI/sim settings), 'virtual' (handled by main). scale: SI -> display. */
export const SCHEMA = [
  { id: 'ic', title: 'Start position', open: true, controls: [
    { type: 'note', text: 'Tip: drag the phone in the 3D view to set its start position.' },
    { key: 'icMode', type: 'seg', options: [['polar', 'Polar'], ['cartesian', 'Cartesian']], tip: 'Describe the start position by stretch + angles, or by Cartesian offsets from equilibrium.' },
    { key: 'x0', label: 'Radial stretch x0', unit: 'cm', scale: 100, min: -10, max: 10, step: 0.1, showIf: isPolar, tip: 'Initial displacement from the static equilibrium length.' },
    { key: 'alpha0', label: 'Swing angle α0', unit: '°', scale: R2D, min: -30, max: 30, step: 0.1, showIf: isPolar, tip: 'Initial swing angle in the XZ plane.' },
    { key: 'beta0', label: 'Transverse angle β0', unit: '°', scale: R2D, min: -15, max: 15, step: 0.1, showIf: isPolar, tip: 'Initial transverse angle in the YZ plane.' },
    { key: 'dX0', label: 'ΔX', unit: 'cm', scale: 100, min: -30, max: 30, step: 0.1, showIf: isCart, tip: 'Offset of the phone centre from equilibrium, X.' },
    { key: 'dY0', label: 'ΔY', unit: 'cm', scale: 100, min: -30, max: 30, step: 0.1, showIf: isCart, tip: 'Offset of the phone centre from equilibrium, Y.' },
    { key: 'dZ0', label: 'ΔZ (up +)', unit: 'cm', scale: 100, min: -30, max: 30, step: 0.1, showIf: isCart, tip: 'Offset of the phone centre from equilibrium, Z (up positive).' },
    { key: 'alignPhone', type: 'checkbox', bool01: true, label: 'Phone aligned with spring', showIf: isRigid, tip: 'Start with the phone long axis along the pivot-to-centre line; untick to set an initial tilt.' },
    { key: 'tiltX0', label: 'Phone tilt X', unit: '°', scale: R2D, min: -45, max: 45, step: 0.1, showIf: rigidFree, tip: 'Initial tilt of the phone long axis in the X–Z plane (+ = bottom toward +X).' },
    { key: 'tiltY0', label: 'Phone tilt Y', unit: '°', scale: R2D, min: -45, max: 45, step: 0.1, showIf: rigidFree, tip: 'Initial tilt of the phone long axis in the Y–Z plane (+ = bottom toward +Y).' },
    { key: 'rock0', label: 'Rocking rate', unit: '°/s', scale: R2D, min: -200, max: 200, step: 1, showIf: isRigid, tip: 'Initial angular velocity in the swing (X–Z) plane.' },
    { key: 'spin0', label: 'Spin rate', unit: '°/s', scale: R2D, min: -360, max: 360, step: 1, showIf: isRigid, tip: 'Initial angular velocity about the phone long axis.' },
    { type: 'sub', title: 'Initial velocity', controls: [
      { key: 'vx0', label: 'v_x0', unit: 'cm/s', scale: 100, min: -50, max: 50, step: 0.1, tip: 'Initial velocity of the phone centre, X.' },
      { key: 'vy0', label: 'v_y0', unit: 'cm/s', scale: 100, min: -50, max: 50, step: 0.1, tip: 'Initial velocity of the phone centre, Y.' },
      { key: 'vz0', label: 'v_z0', unit: 'cm/s', scale: 100, min: -50, max: 50, step: 0.1, tip: 'Initial velocity of the phone centre, Z (up positive).' },
    ]},
    { type: 'buttons', buttons: [
      { label: 'Pure bounce', action: 'icBounce' }, { label: 'Pure swing', action: 'icSwing' }, { label: 'Mixed', action: 'icMixed' },
      { label: 'Rocking only', action: 'icRock' }, { label: 'Sideways pull', action: 'icPull' }] },
  ]},
  { id: 'phone', title: 'Phone', open: true, controls: [
    { key: 'phoneMass', label: 'Mass', unit: 'g', scale: 1000, min: 50, max: 400, step: 0.1, tip: 'Mass of the bare phone.' },
    { key: 'phoneLength', label: 'Length', unit: 'mm', scale: 1000, min: 100, max: 200, step: 0.1, tip: 'Long edge of the phone.' },
    { key: 'phoneWidth', label: 'Width', unit: 'mm', scale: 1000, min: 50, max: 100, step: 0.1, tip: 'Short edge of the phone.' },
    { key: 'phoneThickness', label: 'Thickness', unit: 'mm', scale: 1000, min: 5, max: 15, step: 0.01, tip: 'Phone thickness.' },
    { type: 'buttons', buttons: [{ label: 'Reset to iPhone 17', action: 'resetPhone' }] },
  ]},
  { id: 'case', title: 'Case & ballast', controls: [
    { key: 'caseEnabled', store: 'virtual', type: 'checkbox', label: '3D-printed case with horns', tip: 'Adds case mass and moves the attachment point (defaults 45 g, 60 mm).' },
    { key: 'caseMass', label: 'Case mass', unit: 'g', scale: 1000, min: 0, max: 150, step: 0.1, tip: 'Mass of the printed case.' },
    { key: 'attachmentOffset', label: 'Attachment offset', unit: 'mm', scale: 1000, min: 0, max: 100, step: 0.1, tip: 'Distance from phone COM to the spring attachment point.' },
    { key: 'nutsPerSide', label: 'Nuts per side', unit: '', scale: 1, min: 0, max: 20, step: 1, int: true, tip: 'M8 hex nuts on each horn (equal count both sides).' },
    { key: 'nutMass', label: 'Nut mass', unit: 'g', scale: 1000, min: 1, max: 20, step: 0.1, tip: 'Mass of one nut.' },
    { key: 'extraMass', label: 'Extra mass at COM', unit: 'g', scale: 1000, min: 0, max: 300, step: 0.5, tip: 'Additional ballast at the centre of mass.' },
    { type: 'info', id: 'M', label: 'Total hanging mass M' },
  ]},
  { id: 'spring', title: 'Spring & cord', controls: [
    { key: 'springGeometry', type: 'seg', options: [['fromK', 'From k & mass'], ['direct', 'Wire & turns']], showIf: isElastic, tip: 'Elastic model: either solve the wire diameter and turn count from k and the spring mass, or enter them directly.' },
    { key: 'springK', label: 'Spring constant k', unit: 'N/m', scale: 1, min: 2, max: 80, step: 0.01, showIf: kVisible, tip: 'Measured spring constant. Elastic model: by default this is the tangent stiffness at the reference load below (k from a bounce frequency or a Hooke test is measured under load).' },
    { key: 'kCalibration', type: 'seg', options: [['loaded', 'k measured under load'], ['unloaded', 'k of unloaded spring']], showIf: p => isElastic(p) && p.springGeometry !== 'direct', tip: 'An open-coiled spring stiffens slightly as it stretches, so say whether k was measured with a load hanging (bounce frequency, Hooke test) or is the unloaded small-deflection value.' },
    { key: 'kRefLoad', label: 'Load when k was measured', unit: 'g', scale: 1000, min: 10, max: 1000, step: 0.1, showIf: p => isElastic(p) && p.springGeometry !== 'direct' && p.kCalibration !== 'unloaded', tip: 'Hanging mass during the k measurement (default 211.2 g: the lab dataset, where k = 18.95 N/m was inferred from the bounce frequency). The spring geometry depends on this, not on the current phone/case/nuts.' },
    { key: 'springL0', label: 'Free length L0', unit: 'cm', scale: 100, min: 5, max: 50, step: 0.1, tip: 'Unstretched (active) spring length.' },
    { key: 'springMass', label: 'Spring mass', unit: 'g', scale: 1000, min: 0, max: 50, step: 0.1, showIf: kVisible, tip: 'Spring mass (the elastic model distributes it along the coils).' },
    { key: 'cordLength', label: 'Cord length', unit: 'cm', scale: 100, min: 0, max: 60, step: 0.1, tip: 'Massless inextensible cord between spring and phone (can go slack).' },
    { key: 'coilDiameter', label: 'Coil diameter D', unit: 'mm', scale: 1000, min: 8, max: 60, step: 0.1, showIf: isElastic, tip: 'Mean coil diameter.' },
    { key: 'wireMaterial', type: 'select', label: 'Wire material', options: [['steel', 'Steel (E 200, G 79.3 GPa)'], ['stainless', 'Stainless (E 193, G 69 GPa)'], ['custom', 'Custom']], showIf: isElastic, tip: 'Wire material (Young and shear moduli, density).' },
    { key: 'wireE', label: 'Young modulus E', unit: 'GPa', scale: 1e-9, min: 10, max: 400, step: 1, showIf: elCustom, tip: 'Custom wire Young modulus.' },
    { key: 'wireG', label: 'Shear modulus G', unit: 'GPa', scale: 1e-9, min: 5, max: 200, step: 0.5, showIf: elCustom, tip: 'Custom wire shear modulus.' },
    { key: 'wireRho', label: 'Density ρ', unit: 'kg/m³', scale: 1, min: 1000, max: 20000, step: 10, showIf: elCustom, tip: 'Custom wire density.' },
    { key: 'wireDiameter', label: 'Wire diameter', unit: 'mm', scale: 1000, min: 0.2, max: 3, step: 0.01, showIf: elDirect, tip: 'Wire diameter (direct mode).' },
    { key: 'activeTurns', label: 'Active turns n', unit: '', scale: 1, min: 3, max: 80, step: 0.1, showIf: elDirect, tip: 'Number of active turns (direct mode).' },
    { key: 'springHand', type: 'seg', options: [['right', 'Right-handed'], ['left', 'Left-handed']], showIf: isElastic, tip: 'Winding sense of the helix.' },
    { key: 'initialTension', label: 'Initial tension', unit: 'N', scale: 1, min: 0, max: 2, step: 0.01, showIf: isElastic, tip: 'Pre-tension of a close-wound spring (phenomenological constant extra tension).' },
    { key: 'springSegments', label: 'Segments N', unit: '', scale: 1, min: 6, max: 40, step: 1, int: true, showIf: isElastic, tip: 'Number of spring segments in the discretisation (more = more accurate and slower).' },
    { key: 'topTwist', type: 'seg', options: [['locked', 'Top twist locked'], ['free', 'Top twist free']], showIf: isElastic, tip: 'Whether the top hook prevents the spring from twisting about its axis.' },
    { key: 'eyeTwist', type: 'seg', options: [['locked', 'Eye twist locked'], ['free', 'Eye twist free']], showIf: isElastic, tip: 'Whether the eyebolt transmits twist between spring and phone.' },
    { key: 'cTwist', label: 'Twist damping c_twist', unit: '×10⁻⁶ N·m·s/rad', scale: 1e6, min: 0, max: 100, step: 0.01, showIf: isElastic, tip: 'Internal torsional dissipation of the whole spring.' },
    { type: 'box', id: 'springBox', title: 'Derived spring', showIf: isElastic },
  ]},
  { id: 'damping', title: 'Damping', controls: [
    { key: 'dampingModel', type: 'select', label: 'Model', options: [['none', 'None'], ['linear', 'Linear'], ['quadratic', 'Quadratic']], tip: 'Velocity-dependent damping law.' },
    { key: 'cR', label: 'c_R (radial)', unit: '×10⁻³ kg/s', scale: 1000, min: 0, max: 30, step: 0.1, showIf: isLin, tip: 'Linear radial damping coefficient.' },
    { key: 'cT', label: 'c_T (transverse)', unit: '×10⁻³ kg/s', scale: 1000, min: 0, max: 30, step: 0.1, showIf: isLin, tip: 'Linear transverse damping coefficient.' },
    { key: 'dR', label: 'd_R (radial)', unit: '×10⁻³ SI', scale: 1000, min: 0, max: 60, step: 0.1, showIf: isQuad, tip: 'Quadratic radial damping coefficient.' },
    { key: 'dT', label: 'd_T (transverse)', unit: '×10⁻³ SI', scale: 1000, min: 0, max: 60, step: 0.1, showIf: isQuad, tip: 'Quadratic transverse damping coefficient.' },
    { key: 'cRot', label: 'c_rot (rotation)', unit: '×10⁻⁵ N·m·s', scale: 1e5, min: 0, max: 50, step: 0.1, showIf: rigidLin, tip: ROT_TIP },
    { key: 'dRot', label: 'd_rot (rotation)', unit: '×10⁻⁶ N·m·s²', scale: 1e6, min: 0, max: 50, step: 0.1, showIf: rigidQuad, tip: ROT_TIP },
  ]},
  { id: 'env', title: 'Environment', controls: [
    { key: 'gravityPreset', store: 'virtual', type: 'select', label: 'Gravity preset', options: [['lab', 'Lab (9.767)'], ['std', 'Standard (9.80665)'], ['moon', 'Moon (1.62)'], ['custom', 'Custom']], tip: 'Quick gravity presets.' },
    { key: 'gravity', label: 'g', unit: 'm/s²', scale: 1, min: 1, max: 25, step: 0.001, tip: 'Gravitational acceleration.' },
  ]},
  { id: 'sim', title: 'Simulation', open: true, controls: [
    { type: 'buttons', buttons: [{ label: 'Pause', action: 'togglePlay', id: 'playBtn' }, { label: 'Reset', action: 'reset' }] },
    { key: 'speed', store: 'sim', label: 'Speed', unit: '×', scale: 1, min: 0.1, max: 5, step: 0.1, tip: 'Simulated seconds per real second.' },
    { key: 'window', store: 'sim', label: 'Chart window', unit: 's', scale: 1, min: 10, max: 120, step: 5, tip: 'Length of the scrolling chart window.' },
    { key: 'trail', store: 'sim', type: 'checkbox', label: 'Show trail', tip: 'Draw the path of the phone in 3D.' },
    { key: 'equilibrium', store: 'sim', type: 'checkbox', label: 'Show equilibrium marker', tip: 'Mark the static equilibrium position.' },
    { type: 'buttons', buttons: [{ label: 'Export CSV', action: 'exportCsv' }, { label: 'Copy share link', action: 'share' }] },
  ]},
];

function decimals(step) { const s = String(step); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }

/**
 * onChange(store, key, value_SI);  actions: { name: fn }
 * returns { refresh(params, sim), setInfo(id, text), setButtonLabel(id, text), updateVisibility(params) }
 */
export function buildControls(container, handlers) {
  const ctls = {};   // key -> {def, range, num, row, el}
  const infos = {}, btns = {}, boxes = {};
  const rows = [];   // for showIf
  function addControls(list, body) {
    for (const c of list) {
      const row = document.createElement('div'); row.className = 'ctl';
      if (c.tip) row.title = c.tip;
      if (c.type === 'sub') {
        row.className = 'sub';
        const d = document.createElement('details'); d.innerHTML = `<summary>${c.title}</summary>`;
        const b = document.createElement('div'); b.className = 'body'; d.appendChild(b); row.appendChild(d);
        addControls(c.controls, b);
      } else if (c.type === 'note') {
        row.className = 'note'; row.textContent = c.text;
      } else if (c.type === 'seg') {
        row.className = 'seg';
        const btnsEl = {};
        for (const [v, t] of c.options) {
          const b = document.createElement('button'); b.textContent = t; b.dataset.v = v;
          b.addEventListener('click', () => handlers.onChange(c.store || 'params', c.key, v));
          row.appendChild(b); btnsEl[v] = b;
        }
        ctls[c.key] = { def: c, seg: btnsEl };
      } else if (c.type === 'buttons') {
        row.className = 'btnrow';
        for (const b of c.buttons) {
          const btn = document.createElement('button'); btn.className = 'btn sm'; btn.textContent = b.label;
          btn.addEventListener('click', () => handlers.actions[b.action]?.());
          if (b.id) btns[b.id] = btn;
          row.appendChild(btn);
        }
      } else if (c.type === 'box') {
        row.className = 'dbox'; row.innerHTML = `<div class="dbox-t">${c.title}</div><div class="dbox-b mono"></div>`; boxes[c.id] = row.lastChild;
      } else if (c.type === 'info') {
        row.className = 'info'; row.innerHTML = `<span>${c.label}</span><b>–</b>`; infos[c.id] = row.lastChild;
      } else if (c.type === 'checkbox') {
        row.classList.add('check');
        row.innerHTML = `<label><input type="checkbox"> ${c.label}</label>`;
        const el = row.querySelector('input');
        el.addEventListener('change', () => handlers.onChange(c.store || 'params', c.key, c.bool01 ? (el.checked ? 1 : 0) : el.checked));
        ctls[c.key] = { def: c, el };
      } else if (c.type === 'select') {
        row.innerHTML = `<div class="lab"><span>${c.label}</span></div>`;
        const el = document.createElement('select');
        el.innerHTML = c.options.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
        el.addEventListener('change', () => handlers.onChange(c.store || 'params', c.key, el.value));
        row.appendChild(el); ctls[c.key] = { def: c, el };
      } else {
        const dec = decimals(c.step);
        row.innerHTML = `<div class="lab"><span>${c.label}</span><span class="u">${c.unit}</span></div><div class="inp"><input type="range"><input type="number"></div>`;
        const range = row.querySelector('[type=range]'), num = row.querySelector('[type=number]');
        for (const el of [range, num]) { el.min = c.min; el.max = c.max; el.step = c.step; }
        const emit = v => {
          if (!isFinite(v)) return;
          v = Math.min(c.max, Math.max(c.min, v));
          if (c.int) v = Math.round(v);
          handlers.onChange(c.store || 'params', c.key, v / c.scale);
        };
        range.addEventListener('input', () => { num.value = (+range.value).toFixed(dec); emit(+range.value); });
        num.addEventListener('change', () => {
          let v = parseFloat(num.value); if (!isFinite(v)) return;
          v = Math.min(c.max, Math.max(c.min, v)); num.value = v.toFixed(dec); range.value = v; emit(v);
        });
        ctls[c.key] = { def: c, range, num, dec };
      }
      if (c.showIf) rows.push({ row, c });
      body.appendChild(row);
      if (c.key) ctls[c.key] = Object.assign(ctls[c.key] || {}, { row });
    }
  }
  for (const g of SCHEMA) {
    const det = document.createElement('details');
    det.className = 'group'; det.open = !!g.open;
    det.innerHTML = `<summary>${g.title}</summary>`;
    const body = document.createElement('div'); body.className = 'body'; det.appendChild(body);
    addControls(g.controls, body);
    container.appendChild(det);
  }
  function updateVisibility(params) { for (const { row, c } of rows) row.style.display = c.showIf(params) ? '' : 'none'; }
  return {
    refresh(params, sim, virt = {}) {
      for (const [key, ctl] of Object.entries(ctls)) {
        const c = ctl.def;
        const src = c.store === 'sim' ? sim : c.store === 'virtual' ? virt : params;
        const val = src[key];
        if (val === undefined) continue;
        if (c.type === 'seg') for (const [v, b] of Object.entries(ctl.seg)) b.classList.toggle('on', v === val);
        else if (c.type === 'checkbox') ctl.el.checked = !!val;
        else if (c.type === 'select') ctl.el.value = val;
        else { const d = val * c.scale; ctl.range.value = d; ctl.num.value = d.toFixed(ctl.dec); }
      }
      updateVisibility(params);
    },
    setBox(id, html) { if (boxes[id]) boxes[id].innerHTML = html; },
    setInfo(id, text) { if (infos[id]) infos[id].textContent = text; },
    setButtonLabel(id, text) { if (btns[id]) btns[id].textContent = text; },
    updateVisibility,
  };
}
