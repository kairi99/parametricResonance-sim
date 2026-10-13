// Elastic (spring) pendulum physics engine. Dependency-free ES module (browser + Node).
// SI units. Pivot at origin, +Z up. q = COM position relative to pivot.

import { deriveElastic, createElasticState, stepElastic, observablesElastic, unwrapYaw, phoneSensors, worldToBody } from './elastic.js';

export const DEFAULT_PARAMS = {
  phoneMass: 0.177,
  phoneLength: 0.1496,
  phoneWidth: 0.0715,
  phoneThickness: 0.00795,
  caseMass: 0.0,
  attachmentOffset: 0.0,
  nutsPerSide: 0,
  nutMass: 0.0056,
  extraMass: 0.0,
  springK: 18.95,
  springL0: 0.19,
  springMass: 0.0063,
  cordLength: 0.0,
  gravity: 9.767,
  dampingModel: 'linear',
  cR: 0.0032,
  cT: 0.0024,
  dR: 0.0104,
  dT: 0.0094,
  x0: 0.04,
  alpha0: 2 * Math.PI / 180,
  beta0: 0.5 * Math.PI / 180,
  vx0: 0, vy0: 0, vz0: 0,
  model: 'elastic',
  springGeometry: 'fromK', coilDiameter: 0.022, wireMaterial: 'steel', wireE: 200e9, wireG: 79.3e9, wireRho: 7850,
  wireDiameter: 0.00082, activeTurns: 22, springHand: 'right', initialTension: 0, springSegments: 12,
  kCalibration: 'loaded', kRefLoad: 0.2112, topTwist: 'locked', eyeTwist: 'locked', cTwist: 1e-6,
  cRot: 2e-5,
  dRot: 2e-6,
  icMode: 'polar',
  dX0: 0, dY0: 0, dZ0: 0,
  alignPhone: 1,
  tiltX0: 0, tiltY0: 0,
  spin0: 0, rock0: 0,
};

export function withDefaults(params) {
  return { ...DEFAULT_PARAMS, ...(params || {}) };
}

// Assembly inertia about its COM in body axes (X width, Y length, Z thickness).
function assemblyInertia(p) {
  const L = p.phoneLength, W = p.phoneWidth, T = p.phoneThickness;
  const m = p.phoneMass;
  let Ix = m / 12 * (L * L + T * T), Iy = m / 12 * (W * W + T * T), Iz = m / 12 * (W * W + L * L);
  if (p.caseMass > 0) {
    const cx = W + 0.0052, cy = L + 0.0052, cz = T + 0.002, mc = p.caseMass;
    Ix += mc / 12 * (cy * cy + cz * cz);
    Iy += mc / 12 * (cx * cx + cz * cz);
    Iz += mc / 12 * (cx * cx + cy * cy);
  }
  if (p.nutsPerSide > 0) {
    const yn = L / 2 + 0.020 + p.nutsPerSide * 0.0065 / 2;
    const mn = p.nutsPerSide * p.nutMass; // each stack, point mass on the long axis
    Ix += 2 * mn * yn * yn;
    Iz += 2 * mn * yn * yn;
  }
  return [Ix, Iy, Iz];
}

// Linearised 2-DOF (spring angle, body angle) modes for one plane. Returns [fLow, fHigh] in Hz.
function planeModes(a, m1, m1g, M, b, I, g) {
  const m11 = (m1 + M) * a * a, m12 = M * a * b, m22 = M * b * b + I;
  const k11 = (m1g + M) * g * a, k22 = M * g * b;
  const A = m11 * m22 - m12 * m12;
  const B = -(k11 * m22 + k22 * m11);
  const C = k11 * k22;
  const disc = Math.sqrt(Math.max(B * B - 4 * A * C, 0));
  const l1 = (-B - disc) / (2 * A), l2 = (-B + disc) / (2 * A);
  return [Math.sqrt(Math.max(l1, 0)) / (2 * Math.PI), Math.sqrt(Math.max(l2, 0)) / (2 * Math.PI)];
}

export function derive(params) {
  const p = withDefaults(params);
  const M = p.phoneMass + p.caseMass + 2 * p.nutsPerSide * p.nutMass + p.extraMass;
  const d = p.phoneLength / 2 + p.attachmentOffset;
  const mEff = M + p.springMass / 3;
  const mG = M + p.springMass / 2;
  const Lnat = p.springL0 + p.cordLength;
  const R0 = Lnat + d;
  const staticStretch = mG * p.gravity / p.springK;
  const Leq = Lnat + staticStretch;
  const Req = R0 + staticStretch;
  const omegaR = Math.sqrt(p.springK / mEff);
  const fR = omegaR / (2 * Math.PI);
  const fDeSousa = mG * p.gravity / (p.springK * Req);
  const inertia = assemblyInertia(p);

  if (p.model === 'elastic') {
    const ed = deriveElastic(p, { M, d, inertia });
    const w = ed.warnings;
    if (!Number.isInteger(p.nutsPerSide) || p.nutsPerSide < 0) w.push('nutsPerSide must be a non-negative integer.');
    for (const k of ['phoneMass', 'phoneLength', 'phoneWidth', 'phoneThickness', 'nutMass', 'springK', 'springL0', 'springMass', 'gravity', 'coilDiameter'])
      if (!(p[k] > 0)) w.push(`${k} must be > 0.`);
    if (p.caseMass < 0 || p.extraMass < 0 || p.cordLength < 0 || p.attachmentOffset < 0) w.push('caseMass, extraMass, cordLength and attachmentOffset must be >= 0.');
    if (Math.abs(p.alpha0) > 30 * Math.PI / 180) w.push('|alpha0| > 30 deg: small-angle analysis degrades.');
    if (p.x0 > ed.Leq - ed.Lnat) w.push('x0 exceeds the static stretch: spring/cord may go slack at the top of the bounce.');
    return ed;
  }

  // rigid-body constants: assembly + inertial spring share m1 at the attachment point form one rigid body
  const m1 = p.springMass / 3, Mt = M + m1;
  const s1 = m1 * d / Mt, s2 = M * d / Mt; // inertial COM is s1 above assembly COM, s2 below the attachment
  const dI = M * m1 * d * d / Mt;          // parallel-axis addition (X and Z axes)
  const rig = { M, m1, mg2: p.springMass / 2, Mt, s1, s2, Jx: inertia[0] + dI, Jy: inertia[1], Jz: inertia[2] + dI, Lnat, Leq };

  let omegaS, fS, fS2, fSy, fSy2;
  if (p.model === 'point') {
    omegaS = Math.sqrt(mG * p.gravity / (mEff * Req));
    fS = omegaS / (2 * Math.PI);
    fS2 = NaN; fSy = fS; fSy2 = NaN;
  } else {
    [fS, fS2] = planeModes(Leq, m1, p.springMass / 2, M, d, inertia[2], p.gravity);
    [fSy, fSy2] = planeModes(Leq, m1, p.springMass / 2, M, d, inertia[0], p.gravity);
    omegaS = 2 * Math.PI * fS;
  }
  const ratio = fR / (2 * fS);
  const detuningPct = (ratio - 1) * 100;
  const periodR = 1 / fR;
  const periodS = 1 / fS;

  const warnings = [];
  if (p.x0 > staticStretch) warnings.push('x0 exceeds the static stretch: cord/spring will go slack at the top of the bounce.');
  if (!Number.isInteger(p.nutsPerSide) || p.nutsPerSide < 0) warnings.push('nutsPerSide must be a non-negative integer.');
  const positives = ['phoneMass', 'phoneLength', 'phoneWidth', 'phoneThickness', 'nutMass', 'springK', 'springL0', 'springMass', 'gravity'];
  for (const k of positives) if (!(p[k] > 0)) warnings.push(`${k} must be > 0.`);
  if (p.caseMass < 0 || p.extraMass < 0 || p.cordLength < 0 || p.attachmentOffset < 0) warnings.push('caseMass, extraMass, cordLength and attachmentOffset must be >= 0.');
  if (Math.abs(p.alpha0) > 30 * Math.PI / 180) warnings.push('|alpha0| > 30 deg: small-angle analysis degrades.');
  if (staticStretch + Math.abs(p.x0) + p.springL0 > 2.5 * p.springL0) warnings.push("Spring total length at max stretch exceeds 2.5*L0: may exceed the spring's elastic range.");
  // Case hardware: the top nut stack sits on the eyebolt shank between the 20 mm horn and the eye,
  // so the attachment offset must be at least horn + stack (M8 nut ~6.5 mm thick).
  const minOffset = 0.020 + 0.0065 * p.nutsPerSide;
  if (p.nutsPerSide > 0 && p.attachmentOffset < minOffset) warnings.push(`Top nut stack does not fit below the eyebolt eye: attachment offset should be at least ${(minOffset * 1000).toFixed(0)} mm for ${p.nutsPerSide} nuts per side.`);

  return { dt: 1e-3, fTwist: NaN, fSurge: NaN, kLin: p.springK, yawEq: 0, model: p.model, M, d, mEff, mG, Lnat, Leq, R0, staticStretch, Req, omegaR, omegaS, fR, fS, fS2, fSy, fSy2, ratio, fDeSousa, detuningPct, periodR, periodS, inertia, rig, warnings };
}

// ---- orientation helpers ----
// Quaternion [w,x,y,z] (body->world) with body +Y = (yx,yy,yz) and body +Z = component of world -Y perpendicular to it.
function frameQuat(yx, yy, yz, out) {
  const n = Math.hypot(yx, yy, yz);
  yx /= n; yy /= n; yz /= n;
  let zx = yy * yx, zy = -1 + yy * yy, zz = yy * yz; // (0,-1,0) + yy*Y
  let zn = Math.hypot(zx, zy, zz);
  if (zn < 1e-9) { zx = 1 - yx * yx; zy = -yx * yy; zz = -yx * yz; zn = Math.hypot(zx, zy, zz); }
  zx /= zn; zy /= zn; zz /= zn;
  const xx = yy * zz - yz * zy, xy = yz * zx - yx * zz, xz = yx * zy - yy * zx; // X = Y x Z
  const r00 = xx, r10 = xy, r20 = xz, r01 = yx, r11 = yy, r21 = yz, r02 = zx, r12 = zy, r22 = zz;
  const t = r00 + r11 + r22;
  let w, x, y, z;
  if (t > 0) {
    const S = Math.sqrt(t + 1) * 2; w = S / 4; x = (r21 - r12) / S; y = (r02 - r20) / S; z = (r10 - r01) / S;
  } else if (r00 > r11 && r00 > r22) {
    const S = Math.sqrt(1 + r00 - r11 - r22) * 2; w = (r21 - r12) / S; x = S / 4; y = (r01 + r10) / S; z = (r02 + r20) / S;
  } else if (r11 > r22) {
    const S = Math.sqrt(1 + r11 - r00 - r22) * 2; w = (r02 - r20) / S; x = (r01 + r10) / S; y = S / 4; z = (r12 + r21) / S;
  } else {
    const S = Math.sqrt(1 + r22 - r00 - r11) * 2; w = (r10 - r01) / S; x = (r02 + r20) / S; y = (r12 + r21) / S; z = S / 4;
  }
  const qn = Math.hypot(w, x, y, z);
  out[0] = w / qn; out[1] = x / qn; out[2] = y / qn; out[3] = z / qn;
  return out;
}

const Rm = new Float64Array(9); // scratch rotation matrix, row-major, body->world
function rotMatrix(qt, R, o) {
  const w = qt[o], x = qt[o + 1], y = qt[o + 2], z = qt[o + 3];
  const s = 2 / (w * w + x * x + y * y + z * z);
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  R[0] = 1 - s * (yy + zz); R[1] = s * (xy - wz); R[2] = s * (xz + wy);
  R[3] = s * (xy + wz); R[4] = 1 - s * (xx + zz); R[5] = s * (yz - wx);
  R[6] = s * (xz - wy); R[7] = s * (yz + wx); R[8] = 1 - s * (xx + yy);
  return R;
}

export function createState(params, derived) {
  const p = withDefaults(params);
  const dv = derived || derive(p);
  let q;
  if (p.icMode === 'cartesian') {
    q = [p.dX0, p.dY0, -dv.Req + p.dZ0];
  } else {
    const R = dv.Req + p.x0;
    const ux = Math.tan(p.alpha0), uy = Math.tan(p.beta0), uz = -1;
    const n = Math.hypot(ux, uy, uz);
    q = [R * ux / n, R * uy / n, R * uz / n];
  }
  const quat = [1, 0, 0, 0], omega = [0, 0, 0];
  if (p.model !== 'point') {
    if (p.alignPhone >= 0.5) {
      const n = Math.hypot(q[0], q[1], q[2]);
      frameQuat(-q[0] / n, -q[1] / n, -q[2] / n, quat);
    } else {
      frameQuat(-Math.tan(p.tiltX0), -Math.tan(p.tiltY0), 1, quat);
    }
    const R = rotMatrix(quat, Rm, 0);
    // world angular velocity = spin0 * (body +Y) + rock0 * (0,-1,0); body components = R^T w
    const wx = p.spin0 * R[1], wy = p.spin0 * R[4] - p.rock0, wz = p.spin0 * R[7];
    omega[0] = R[0] * wx + R[3] * wy + R[6] * wz;
    omega[1] = R[1] * wx + R[4] * wy + R[7] * wz;
    omega[2] = R[2] * wx + R[5] * wy + R[8] * wz;
  }
  if (p.model === 'elastic') return createElasticState(p, dv, { q, v: [p.vx0, p.vy0, p.vz0], quat, omega });
  return { t: 0, q, v: [p.vx0, p.vy0, p.vz0], quat, omega };
}

// ---- RK4 (scratch buffers at module scope; step is not re-entrant but is synchronous) ----
const acc = [0, 0, 0];
const K = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // k1..k4 (position derivs = velocities, then accels)
const qs = [0, 0, 0], vs = [0, 0, 0];

// writes acceleration into `acc`
function accel(qx, qy, qz, vx, vy, vz, p, dv) {
  const ell = Math.sqrt(qx * qx + qy * qy + qz * qz);
  const inv = ell > 0 ? 1 / ell : 0;
  const ex = qx * inv, ey = qy * inv, ez = qz * inv;
  const ext = ell - dv.R0;
  const Fs = ext > 0 ? -p.springK * ext : 0;
  let Fx = Fs * ex, Fy = Fs * ey, Fz = Fs * ez - dv.mG * p.gravity;
  const model = p.dampingModel;
  if (model === 'linear' || model === 'quadratic') {
    const vr = vx * ex + vy * ey + vz * ez;
    const tx = vx - vr * ex, ty = vy - vr * ey, tz = vz - vr * ez;
    let a, b;
    if (model === 'linear') { a = p.cR; b = p.cT; }
    else {
      a = p.dR * Math.abs(vr);
      b = p.dT * Math.sqrt(tx * tx + ty * ty + tz * tz);
    }
    Fx -= a * vr * ex + b * tx;
    Fy -= a * vr * ey + b * ty;
    Fz -= a * vr * ez + b * tz;
  }
  const im = 1 / dv.mEff;
  acc[0] = Fx * im; acc[1] = Fy * im; acc[2] = Fz * im;
}

function stepPoint(state, p, dv, dt) {
  const q = state.q, v = state.v;
  const h2 = dt / 2;
  // k1
  accel(q[0], q[1], q[2], v[0], v[1], v[2], p, dv);
  K[0] = v[0]; K[1] = v[1]; K[2] = v[2]; K[3] = acc[0]; K[4] = acc[1]; K[5] = acc[2];
  // k2
  for (let i = 0; i < 3; i++) { qs[i] = q[i] + h2 * K[i]; vs[i] = v[i] + h2 * K[3 + i]; }
  accel(qs[0], qs[1], qs[2], vs[0], vs[1], vs[2], p, dv);
  K[6] = vs[0]; K[7] = vs[1]; K[8] = vs[2]; K[9] = acc[0]; K[10] = acc[1]; K[11] = acc[2];
  // k3 (reuse slots in a second pass: accumulate directly)
  const s0 = K[0] + 2 * K[6], s1 = K[1] + 2 * K[7], s2 = K[2] + 2 * K[8];
  const a0 = K[3] + 2 * K[9], a1 = K[4] + 2 * K[10], a2 = K[5] + 2 * K[11];
  qs[0] = q[0] + h2 * K[6]; qs[1] = q[1] + h2 * K[7]; qs[2] = q[2] + h2 * K[8];
  vs[0] = v[0] + h2 * K[9]; vs[1] = v[1] + h2 * K[10]; vs[2] = v[2] + h2 * K[11];
  accel(qs[0], qs[1], qs[2], vs[0], vs[1], vs[2], p, dv);
  const k3q0 = vs[0], k3q1 = vs[1], k3q2 = vs[2];
  const k3v0 = acc[0], k3v1 = acc[1], k3v2 = acc[2];
  // k4
  qs[0] = q[0] + dt * k3q0; qs[1] = q[1] + dt * k3q1; qs[2] = q[2] + dt * k3q2;
  vs[0] = v[0] + dt * k3v0; vs[1] = v[1] + dt * k3v1; vs[2] = v[2] + dt * k3v2;
  accel(qs[0], qs[1], qs[2], vs[0], vs[1], vs[2], p, dv);
  const f = dt / 6;
  q[0] += f * (s0 + 2 * k3q0 + vs[0]);
  q[1] += f * (s1 + 2 * k3q1 + vs[1]);
  q[2] += f * (s2 + 2 * k3q2 + vs[2]);
  v[0] += f * (a0 + 2 * k3v0 + acc[0]);
  v[1] += f * (a1 + 2 * k3v1 + acc[1]);
  v[2] += f * (a2 + 2 * k3v2 + acc[2]);
  state.t += dt;
  return state;
}

export function step(state, params, derived, dt) {
  if (params.model === 'elastic') return stepElastic(state, params, derived, dt);
  if (params.model === 'point') return stepPoint(state, params, derived, dt);
  return stepRigid(state, params, derived, dt);
}

// ---- Rigid-body model ----
// Integrated variables: c = inertial COM of (assembly + m1 = springMass/3 placed at the attachment point),
// vc, quat (body->world), omega (body frame). Rigid body mass Mt = M + m1; inertia about c is diag(Jx,Jy,Jz)
// (assembly inertia + parallel-axis M*m1*d^2/Mt about X and Z). With yh = world image of body +Y:
//   assembly COM q = c - s1*yh, attachment a = c + s2*yh, s1 = m1 d/Mt, s2 = M d/Mt.
// Forces: spring/cord tension at a; gravity M*g at q and (springMass/2)*g at a; damping per spec.
// Mechanical energy (its negative gradient gives exactly these forces and torques):
//   Emech = 1/2 Mt|vc|^2 + 1/2 w.J.w + 1/2 k max(|a|-Lnat,0)^2 + M g q_z + (springMass/2) g a_z - E_eq,
//   E_eq  = 1/2 k (mG g/k)^2 - M g Req - (springMass/2) g Leq   (value at the hanging equilibrium).
const NY = 13; // c(0-2) vc(3-5) quat(6-9) omega_body(10-12)
const Y0 = new Float64Array(NY), YT = new Float64Array(NY);
const KA = new Float64Array(NY), KB = new Float64Array(NY), KC = new Float64Array(NY), KD = new Float64Array(NY);
const Rs = new Float64Array(9);

function rigidDeriv(y, out, p, dv) {
  const rg = dv.rig;
  rotMatrix(y, Rs, 6);
  const R = Rs;
  const yx = R[1], yy = R[4], yz = R[7];
  const wb0 = y[10], wb1 = y[11], wb2 = y[12];
  const wx = R[0] * wb0 + R[1] * wb1 + R[2] * wb2;
  const wy = R[3] * wb0 + R[4] * wb1 + R[5] * wb2;
  const wz = R[6] * wb0 + R[7] * wb1 + R[8] * wb2;
  const s1 = rg.s1, s2 = rg.s2;
  const ax = y[0] + s2 * yx, ay = y[1] + s2 * yy, az = y[2] + s2 * yz;
  const qx = y[0] - s1 * yx, qy = y[1] - s1 * yy, qz = y[2] - s1 * yz;
  // omega_w x yh
  const cx = wy * yz - wz * yy, cy = wz * yx - wx * yz, cz = wx * yy - wy * yx;
  const vax = y[3] + s2 * cx, vay = y[4] + s2 * cy, vaz = y[5] + s2 * cz;
  const vqx = y[3] - s1 * cx, vqy = y[4] - s1 * cy, vqz = y[5] - s1 * cz;
  const L = Math.sqrt(ax * ax + ay * ay + az * az);
  const il = L > 0 ? 1 / L : 0;
  const ex = ax * il, ey = ay * il, ez = az * il;
  const ext = L - rg.Lnat;
  const Fs = ext > 0 ? -p.springK * ext : 0;
  let Fax = Fs * ex, Fay = Fs * ey, Faz = Fs * ez - rg.mg2 * p.gravity;
  let Fqx = 0, Fqy = 0, Fqz = -rg.M * p.gravity;
  let tdx = 0, tdy = 0, tdz = 0; // rotational damping torque (world)
  const dm = p.dampingModel;
  if (dm === 'linear' || dm === 'quadratic') {
    const vr = vax * ex + vay * ey + vaz * ez;
    const lq = Math.sqrt(qx * qx + qy * qy + qz * qz);
    const iq = lq > 0 ? 1 / lq : 0;
    const gx = qx * iq, gy = qy * iq, gz = qz * iq;
    const vt = vqx * gx + vqy * gy + vqz * gz;
    const tx = vqx - vt * gx, ty = vqy - vt * gy, tz = vqz - vt * gz;
    let a, b, cr;
    if (dm === 'linear') { a = p.cR; b = p.cT; cr = p.cRot; }
    else {
      a = p.dR * Math.abs(vr);
      b = p.dT * Math.sqrt(tx * tx + ty * ty + tz * tz);
      cr = p.dRot * Math.sqrt(wx * wx + wy * wy + wz * wz);
    }
    Fax -= a * vr * ex; Fay -= a * vr * ey; Faz -= a * vr * ez;
    Fqx -= b * tx; Fqy -= b * ty; Fqz -= b * tz;
    tdx = -cr * wx; tdy = -cr * wy; tdz = -cr * wz;
  }
  const imt = 1 / rg.Mt;
  out[0] = y[3]; out[1] = y[4]; out[2] = y[5];
  out[3] = (Fax + Fqx) * imt; out[4] = (Fay + Fqy) * imt; out[5] = (Faz + Fqz) * imt;
  // torque about c (world): (s2 yh) x Fa + (-s1 yh) x Fq + damping
  const ux = s2 * Fax - s1 * Fqx, uy = s2 * Fay - s1 * Fqy, uz = s2 * Faz - s1 * Fqz;
  const twx = yy * uz - yz * uy + tdx, twy = yz * ux - yx * uz + tdy, twz = yx * uy - yy * ux + tdz;
  // to body frame: R^T tau
  const t0 = R[0] * twx + R[3] * twy + R[6] * twz;
  const t1 = R[1] * twx + R[4] * twy + R[7] * twz;
  const t2 = R[2] * twx + R[5] * twy + R[8] * twz;
  const Jx = rg.Jx, Jy = rg.Jy, Jz = rg.Jz;
  out[10] = (t0 - (wb1 * Jz * wb2 - wb2 * Jy * wb1)) / Jx;
  out[11] = (t1 - (wb2 * Jx * wb0 - wb0 * Jz * wb2)) / Jy;
  out[12] = (t2 - (wb0 * Jy * wb1 - wb1 * Jx * wb0)) / Jz;
  // quaternion rate: 1/2 q (x) (0, omega_b)
  const q0 = y[6], q1 = y[7], q2 = y[8], q3 = y[9];
  out[6] = 0.5 * (-q1 * wb0 - q2 * wb1 - q3 * wb2);
  out[7] = 0.5 * (q0 * wb0 + q2 * wb2 - q3 * wb1);
  out[8] = 0.5 * (q0 * wb1 + q3 * wb0 - q1 * wb2);
  out[9] = 0.5 * (q0 * wb2 + q1 * wb1 - q2 * wb0);
}

function stepRigid(state, p, dv, dt) {
  const rg = dv.rig;
  const q = state.q, v = state.v, qt = state.quat, om = state.omega;
  rotMatrix(qt, Rs, 0);
  const yx = Rs[1], yy = Rs[4], yz = Rs[7];
  const wx = Rs[0] * om[0] + Rs[1] * om[1] + Rs[2] * om[2];
  const wy = Rs[3] * om[0] + Rs[4] * om[1] + Rs[5] * om[2];
  const wz = Rs[6] * om[0] + Rs[7] * om[1] + Rs[8] * om[2];
  const y = Y0;
  y[0] = q[0] + rg.s1 * yx; y[1] = q[1] + rg.s1 * yy; y[2] = q[2] + rg.s1 * yz;
  y[3] = v[0] + rg.s1 * (wy * yz - wz * yy); y[4] = v[1] + rg.s1 * (wz * yx - wx * yz); y[5] = v[2] + rg.s1 * (wx * yy - wy * yx);
  y[6] = qt[0]; y[7] = qt[1]; y[8] = qt[2]; y[9] = qt[3];
  y[10] = om[0]; y[11] = om[1]; y[12] = om[2];
  const h2 = dt / 2;
  rigidDeriv(y, KA, p, dv);
  for (let i = 0; i < NY; i++) YT[i] = y[i] + h2 * KA[i];
  rigidDeriv(YT, KB, p, dv);
  for (let i = 0; i < NY; i++) YT[i] = y[i] + h2 * KB[i];
  rigidDeriv(YT, KC, p, dv);
  for (let i = 0; i < NY; i++) YT[i] = y[i] + dt * KC[i];
  rigidDeriv(YT, KD, p, dv);
  const f = dt / 6;
  for (let i = 0; i < NY; i++) y[i] += f * (KA[i] + 2 * KB[i] + 2 * KC[i] + KD[i]);
  const qn = 1 / Math.sqrt(y[6] * y[6] + y[7] * y[7] + y[8] * y[8] + y[9] * y[9]);
  qt[0] = y[6] * qn; qt[1] = y[7] * qn; qt[2] = y[8] * qn; qt[3] = y[9] * qn;
  om[0] = y[10]; om[1] = y[11]; om[2] = y[12];
  rotMatrix(qt, Rs, 0);
  const nx = Rs[1], ny = Rs[4], nz = Rs[7];
  const nwx = Rs[0] * om[0] + Rs[1] * om[1] + Rs[2] * om[2];
  const nwy = Rs[3] * om[0] + Rs[4] * om[1] + Rs[5] * om[2];
  const nwz = Rs[6] * om[0] + Rs[7] * om[1] + Rs[8] * om[2];
  q[0] = y[0] - rg.s1 * nx; q[1] = y[1] - rg.s1 * ny; q[2] = y[2] - rg.s1 * nz;
  v[0] = y[3] - rg.s1 * (nwy * nz - nwz * ny); v[1] = y[4] - rg.s1 * (nwz * nx - nwx * nz); v[2] = y[5] - rg.s1 * (nwx * ny - nwy * nx);
  state.t += dt;
  return state;
}

export function advance(state, params, derived, duration, maxDt = 0.001) {
  if (!(duration > 0)) return state;
  if (params.model === 'elastic' && derived.dt < maxDt) maxDt = derived.dt;
  const n = Math.max(1, Math.ceil(duration / maxDt - 1e-9));
  const dt = duration / n;
  for (let i = 0; i < n; i++) step(state, params, derived, dt);
  return state;
}

function wrapPi(a) {
  const TWO = 2 * Math.PI;
  a = a - TWO * Math.floor((a + Math.PI) / TWO); // [-pi, pi)
  return a === -Math.PI ? Math.PI : a;
}

export function observables(state, params, derived) {
  const p = withDefaults(params), dv = derived;
  if (p.model === 'elastic') return observablesElastic(state, p, dv);
  const rigid = p.model !== 'point';
  const [X, Y, Z] = state.q;
  const [vx, vy, vz] = state.v;
  const k = p.springK, mEff = dv.mEff, mG = dv.mG, g = p.gravity, Req = dv.Req;
  const ell = Math.sqrt(X * X + Y * Y + Z * Z);
  const ux = X / ell, uy = Y / ell, uz = Z / ell;
  const alpha = Math.atan2(X, -Z);
  const beta = Math.atan2(Y, -Z);
  const alphaDot = (-Z * vx + X * vz) / (X * X + Z * Z);
  const betaDot = (-Z * vy + Y * vz) / (Y * Y + Z * Z);
  const xDotCm = vx * ux + vy * uy + vz * uz;
  const udx = (vx - xDotCm * ux) / ell, udy = (vy - xDotCm * uy) / ell, udz = (vz - xDotCm * uz) / ell;
  const ud2 = udx * udx + udy * udy + udz * udz;
  const Es = 0.5 * mEff * Req * Req * ud2 + mG * g * Req * (1 + uz);
  let x, xDot, Er, Ec, Emech, Erot = 0, slack, springLength, attach, quat, tilt = 0, tiltY = 0, omega = [0, 0, 0];
  if (!rigid) {
    x = ell - Req; xDot = xDotCm;
    Er = 0.5 * mEff * xDot * xDot + 0.5 * k * x * x;
    Ec = 0.5 * mEff * (ell * ell - Req * Req) * ud2 + mG * g * x * (1 + uz);
    const ext = Math.max(ell - dv.R0, 0);
    Emech = 0.5 * mEff * (vx * vx + vy * vy + vz * vz) + 0.5 * k * ext * ext + mG * g * Z
      - (0.5 * k * dv.staticStretch * dv.staticStretch - mG * g * Req);
    slack = ell < dv.R0;
    springLength = Math.max(ell - p.cordLength - dv.d, p.springL0);
    const s = 1 - dv.d / ell;
    attach = [X * s, Y * s, Z * s];
    quat = frameQuat(-ux, -uy, -uz, [1, 0, 0, 0]);
  } else {
    const rg = dv.rig;
    quat = [state.quat[0], state.quat[1], state.quat[2], state.quat[3]];
    omega = [state.omega[0], state.omega[1], state.omega[2]];
    const R = rotMatrix(quat, new Float64Array(9), 0);
    const yx = R[1], yy = R[4], yz = R[7];
    attach = [X + dv.d * yx, Y + dv.d * yy, Z + dv.d * yz];
    const L = Math.hypot(attach[0], attach[1], attach[2]);
    const ex = attach[0] / L, ey = attach[1] / L, ez = attach[2] / L;
    // attachment velocity = v_q + w x (d yh)
    const wx = R[0] * omega[0] + R[1] * omega[1] + R[2] * omega[2];
    const wy = R[3] * omega[0] + R[4] * omega[1] + R[5] * omega[2];
    const wz = R[6] * omega[0] + R[7] * omega[1] + R[8] * omega[2];
    const vax = vx + dv.d * (wy * yz - wz * yy), vay = vy + dv.d * (wz * yx - wx * yz), vaz = vz + dv.d * (wx * yy - wy * yx);
    x = L - dv.Leq;
    xDot = vax * ex + vay * ey + vaz * ez;
    Er = 0.5 * mEff * xDot * xDot + 0.5 * k * x * x;
    const I = dv.inertia;
    Erot = 0.5 * (I[0] * omega[0] * omega[0] + I[1] * omega[1] * omega[1] + I[2] * omega[2] * omega[2]);
    // see the Emech comment above the rigid integrator; KE = 1/2 M |v_q|^2 + 1/2 m1 |v_a|^2 + 1/2 w.I.w
    const ext = Math.max(L - dv.Lnat, 0);
    const KE = 0.5 * rg.M * (vx * vx + vy * vy + vz * vz) + 0.5 * rg.m1 * (vax * vax + vay * vay + vaz * vaz) + Erot;
    const Eeq = 0.5 * k * dv.staticStretch * dv.staticStretch - rg.M * g * Req - rg.mg2 * g * dv.Leq;
    Emech = KE + 0.5 * k * ext * ext + rg.M * g * Z + rg.mg2 * g * attach[2] - Eeq;
    Ec = Emech - Er - Es - Erot;
    slack = L < dv.Lnat;
    springLength = slack ? p.springL0 : Math.max(L - p.cordLength, p.springL0);
    const thP = Math.atan2(-yx, yz), thS = Math.atan2(ex, -ez);
    const phP = Math.atan2(-yy, yz), phS = Math.atan2(ey, -ez);
    tilt = wrapPi(thP - thS); tiltY = wrapPi(phP - phS);
  }
  let sens;
  if (rigid) {
    const R = rotMatrix(quat, new Float64Array(9), 0), rg = dv.rig, y = Y0;
    const yx = R[1], yy = R[4], yz = R[7];
    const wx = R[0] * omega[0] + R[1] * omega[1] + R[2] * omega[2];
    const wy = R[3] * omega[0] + R[4] * omega[1] + R[5] * omega[2];
    const wz = R[6] * omega[0] + R[7] * omega[1] + R[8] * omega[2];
    y[0] = X + rg.s1 * yx; y[1] = Y + rg.s1 * yy; y[2] = Z + rg.s1 * yz;
    y[3] = vx + rg.s1 * (wy * yz - wz * yy); y[4] = vy + rg.s1 * (wz * yx - wx * yz); y[5] = vz + rg.s1 * (wx * yy - wy * yx);
    y[6] = quat[0]; y[7] = quat[1]; y[8] = quat[2]; y[9] = quat[3];
    y[10] = omega[0]; y[11] = omega[1]; y[12] = omega[2];
    rigidDeriv(y, KA, p, dv);
    sens = phoneSensors(KA[3], KA[4], KA[5], [KA[10], KA[11], KA[12]], omega, R, rg.s1, g);
  } else {
    accel(X, Y, Z, vx, vy, vz, p, dv);
    const a0 = acc[0], a1 = acc[1], a2 = acc[2];
    const R = rotMatrix(quat, new Float64Array(9), 0);
    // body frame: Y = -u, Z = normalised (-e_y + Y_y Y), X = Y x Z; w = (Ydot.Z, Zdot.X, Xdot.Y)
    const ny = [-ux, -uy, -uz];
    const ndot = [-udx, -udy, -udz];
    const zr = [ny[1] * ny[0], -1 + ny[1] * ny[1], ny[1] * ny[2]];
    const zn = Math.hypot(zr[0], zr[1], zr[2]);
    let gyro = [0, 0, 0];
    if (zn > 1e-6) {
      const zrd = [ndot[1] * ny[0] + ny[1] * ndot[0], 2 * ny[1] * ndot[1], ndot[1] * ny[2] + ny[1] * ndot[2]];
      const Xv = [R[0], R[3], R[6]], Zv = [R[2], R[5], R[8]];
      gyro = [
        ndot[0] * Zv[0] + ndot[1] * Zv[1] + ndot[2] * Zv[2],
        (zrd[0] * Xv[0] + zrd[1] * Xv[1] + zrd[2] * Xv[2]) / zn,
        -(Xv[0] * ndot[0] + Xv[1] * ndot[1] + Xv[2] * ndot[2]),
      ];
    }
    sens = { acc: [a0, a1, a2], accSensor: worldToBody(a0, a1, a2 + g, R), gyroSensor: gyro };
  }
  const Erel = Er + Es + Ec + Erot;
  const sum = Er + Es;
  const partitionR = sum > 1e-14 ? Er / sum : NaN;
  const phiR = Math.atan2(-xDot / dv.omegaR, x);
  const phiS = Math.atan2(-alphaDot / dv.omegaS, alpha);
  const dPhi = wrapPi(phiR - 2 * phiS);
  const ampR = Math.sqrt(x * x + (xDot / dv.omegaR) ** 2);
  const ampS = Math.sqrt(alpha * alpha + (alphaDot / dv.omegaS) ** 2);
  return {
    t: state.t, q: [X, Y, Z], v: [vx, vy, vz],
    ell, x, xDot, alpha, beta, alphaDot, betaDot,
    slack, springLength,
    Er, Es, Ec, Erel, Emech, Erot, partitionR, phiR, phiS, dPhi, ampR, ampS,
    attach, quat, tilt, tiltY, omega,
    acc: sens.acc, accSensor: sens.accSensor, gyroSensor: sens.gyroSensor,
    spring: { nodes: new Float64Array([0, 0, 0, attach[0], attach[1], attach[2]]), phase: new Float64Array([0, 2 * Math.PI * 22]) },
    yaw: rigid ? unwrapYaw(state, rotMatrix(quat, new Float64Array(9), 0)) : 0, twistTotal: 0, EspringKin: 0, EspringEl: 0,
  };
}

function bisect(f, lo, hi) {
  let flo = f(lo);
  for (let i = 0; i < 300; i++) {
    const mid = 0.5 * (lo + hi), fm = f(mid);
    if (Math.abs(fm) < 1e-13 || hi - lo < 1e-15) return mid;
    if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
  }
  return 0.5 * (lo + hi);
}

function bisectN(f, lo, hi, maxIter = 38) {
  let flo = f(lo);
  for (let i = 0; i < maxIter; i++) {
    const mid = 0.5 * (lo + hi), fm = f(mid);
    if (Math.abs(fm) < 1e-9 || hi - lo < 1e-9 * (Math.abs(hi) + 1e-12)) return mid;
    if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
  }
  return 0.5 * (lo + hi);
}

function solveRigid(p, knob) {
  const elastic = p.model === 'elastic';
  const bisect_ = elastic ? bisectN : bisect;
  const out = (value, np, feasible, note) => ({ value, params: np, achievedRatio: derive(np).ratio, feasible, note });
  const f = (key) => (v) => derive({ ...p, [key]: v }).ratio - 1;
  if (knob === 'cordLength' || knob === 'springK') {
    const [lo, hi] = knob === 'cordLength' ? [0, 3] : [0.5, 500];
    const flo = f(knob)(lo), fhi = f(knob)(hi);
    if (flo === 0) return out(lo, { ...p, [knob]: lo }, true, 'Exact 2:1 resonance.');
    if (fhi === 0) return out(hi, { ...p, [knob]: hi }, true, 'Exact 2:1 resonance.');
    if ((flo < 0) === (fhi < 0)) {
      const best = Math.abs(flo) < Math.abs(fhi) ? lo : hi;
      return out(best, { ...p }, false, `No exact 2:1 resonance for ${knob} in [${lo}, ${hi}] (ratio ${(flo + 1).toFixed(3)} .. ${(fhi + 1).toFixed(3)}).`);
    }
    const v = bisect_(f(knob), lo, hi);
    return out(v, { ...p, [knob]: v }, true, `Exact 2:1 resonance with this ${knob} (rigid-body model).`);
  }
  if (knob === 'nutsPerSide') {
    let best = 0, bestErr = Infinity, rMin = Infinity, rMax = -Infinity;
    const tryN = (n) => {
      const r = derive({ ...p, nutsPerSide: n }).ratio - 1;
      rMin = Math.min(rMin, r); rMax = Math.max(rMax, r);
      if (Math.abs(r) < bestErr) { bestErr = Math.abs(r); best = n; }
    };
    if (!elastic) for (let n = 0; n <= 200; n++) tryN(n);
    else {
      for (let n = 0; n <= 200; n += 10) tryN(n);
      const c = best; for (let n = Math.max(0, c - 9); n <= Math.min(200, c + 9); n++) tryN(n);
    }
    const feasible = rMin <= 0 && rMax >= 0; // ratio is not monotone in n; feasible if the scan brackets 1
    if (feasible) return out(best, { ...p, nutsPerSide: best }, true, `Best integer nuts per side is ${best} (ratio error ${(bestErr * 100).toFixed(3)}%).`);
    return out(best, { ...p }, false, 'No number of nuts (0..200) reaches 2:1 resonance with these parameters.');
  }
  return { value: NaN, params: { ...p }, achievedRatio: derive(p).ratio, feasible: false, note: `Unknown knob '${knob}'.` };
}

// Robust resonance solver for the elastic model (derive() per evaluation is expensive: count evaluations).
function solveElastic(p, knob) {
  let nd = 0;
  const t0 = Date.now();
  const rr = (v) => {
    nd++;
    try { const r = derive({ ...p, [knob]: v }).ratio - 1; return Number.isFinite(r) ? r : NaN; } catch (e) { return NaN; }
  };
  const fin = (value, feasible, note) => {
    const np = feasible ? { ...p, [knob]: value } : { ...p };
    return { value, params: np, achievedRatio: derive(np).ratio, feasible, note, derives: nd, ms: Date.now() - t0 };
  };
  const bis = (lo, hi, flo, iters) => {
    for (let i = 0; i < iters; i++) {
      const mid = 0.5 * (lo + hi), fm = rr(mid);
      if (!Number.isFinite(fm)) { hi = mid; continue; }
      if (Math.abs(fm) < 1e-10 || Math.abs(hi - lo) < 1e-12 * (1 + Math.abs(hi))) return mid;
      if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
    }
    return 0.5 * (lo + hi);
  };
  const fail = (msg) => fin(NaN, false, msg);
  if (knob === 'springK' || knob === 'cordLength') {
    // candidate bracket list: springK = geometric expansion around the current value; cordLength = grid on [0, 3] m
    let pts;
    if (knob === 'springK') {
      const k = p.springK; pts = [];
      for (const f of [1, 1.25, 1.6, 2, 3, 4, 8]) { pts.push(k / f); if (f > 1) pts.push(k * f); }
      pts.sort((a, b) => a - b);
    } else { pts = []; for (let c = 0; c <= 3.0001; c += 0.1) pts.push(Math.min(c, 3)); }
    const vals = [];
    for (const v of pts) vals.push([v, rr(v)]);
    const ok = vals.filter((e) => Number.isFinite(e[1]));
    if (ok.length < 2) return fail(`No finite resonance ratio for ${knob} in the search range.`);
    // sign change closest to the current value (springK) or smallest cord (cordLength)
    let best = null;
    const ref = knob === 'springK' ? p.springK : 0;
    for (let i = 0; i + 1 < ok.length; i++) {
      if (ok[i][1] === 0) { best = [ok[i], ok[i]]; break; }
      if ((ok[i][1] < 0) !== (ok[i + 1][1] < 0)) {
        const dist = Math.min(Math.abs(ok[i][0] - ref), Math.abs(ok[i + 1][0] - ref));
        if (!best || dist < best[2]) best = [ok[i], ok[i + 1], dist];
      }
    }
    if (!best) return fail(`No exact 2:1 resonance for ${knob} in [${ok[0][0].toPrecision(3)}, ${ok[ok.length - 1][0].toPrecision(3)}] (ratio ${(ok[0][1] + 1).toFixed(3)} .. ${(ok[ok.length - 1][1] + 1).toFixed(3)}).`);
    const v = best[0] === best[1] ? best[0][0] : bis(best[0][0], best[1][0], best[0][1], 45);
    return fin(v, true, `Exact 2:1 resonance with this ${knob} (elastic model).`);
  }
  if (knob === 'nutsPerSide') {
    // Physically sensible range only: each stack (6.5 mm per M8 nut) must stay a short ballast, not a
    // second pendulum. Beyond ~30 nuts per side (a ~20 cm stack, ~170 g) the ratio can come back to 1
    // for reasons that have nothing to do with a real setup (huge rotary inertia of the stacks).
    const NMAX = 30;
    const r = new Map();
    const get = (n) => { if (!r.has(n)) r.set(n, rr(n)); return r.get(n); };
    for (let n = 0; n <= NMAX; n += 3) get(n);
    let br = null;
    for (let n = 0; n < NMAX; n += 3) {
      const a = get(n), b = get(n + 3);
      if (Number.isFinite(a) && Number.isFinite(b) && (a < 0) !== (b < 0)) { br = n; break; }
    }
    if (br === null) {
      const r0 = get(0) + 1, rN = get(NMAX) + 1;
      return fail(`No number of nuts (0..${NMAX} per side) reaches 2:1 resonance: the ratio goes from ${r0.toFixed(4)} to ${rN.toFixed(4)}. ` +
        (r0 < 1 && rN < r0 ? 'Adding mass moves the system further below 2:1; shorten the cord or use a stiffer spring instead.' : 'Try another knob.'));
    }
    let lo = br, hi = br + 3;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if ((get(m) < 0) === (get(lo) < 0)) lo = m; else hi = m; }
    const n = Math.abs(get(lo)) <= Math.abs(get(hi)) ? lo : hi;
    return fin(n, true, `Best integer nuts per side is ${n} (ratio error ${(Math.abs(get(n)) * 100).toFixed(3)}%).`);
  }
  return fail(`Unknown knob '${knob}'.`);
}

export function solveForResonance(params, knob) {
  const p = withDefaults(params);
  if (p.model === 'elastic') return solveElastic(p, knob);
  if (p.model !== 'point') return solveRigid(p, knob);
  const dv = derive(p);
  const g = p.gravity;
  const out = (value, np, feasible, note) => ({
    value, params: np, achievedRatio: derive(np).ratio, feasible, note,
  });
  if (knob === 'cordLength') {
    const s = 3 * dv.mG * g / p.springK - p.springL0 - dv.d;
    const np = { ...p, cordLength: s };
    if (s >= 0) return out(s, np, true, 'Exact 2:1 resonance with this cord length.');
    return out(s, { ...p }, false, 'Would need a negative cord length; the system is already below resonance (k*R0 < 3*mG*g with no cord). Add mass or use a different knob.');
  }
  if (knob === 'nutsPerSide') {
    const mGt = p.springK * dv.R0 / (3 * g);
    const Mt = mGt - p.springMass / 2;
    const nExact = (Mt - (p.phoneMass + p.caseMass + p.extraMass)) / (2 * p.nutMass);
    const n = Math.round(nExact);
    if (n >= 0) {
      const np = { ...p, nutsPerSide: n };
      return out(n, np, true, `Exact solution is ${nExact.toFixed(3)} nuts per side; rounded to ${n}.`);
    }
    return out(n, { ...p }, false, 'Would need negative ballast; the system is already below resonance even without nuts.');
  }
  if (knob === 'springK') {
    const k = 3 * dv.mG * g / dv.R0;
    return out(k, { ...p, springK: k }, true, 'Exact 2:1 resonance with this spring constant.');
  }
  return { value: NaN, params: { ...p }, achievedRatio: dv.ratio, feasible: false, note: `Unknown knob '${knob}'.` };
}

export function simulate(params, duration, dt, sampleEvery = 10) {
  const p = withDefaults(params);
  const derived = derive(p);
  if (dt === undefined) dt = derived.dt;
  const state = createState(p, derived);
  const samples = [observables(state, p, derived)];
  const n = Math.round(duration / dt);
  for (let i = 1; i <= n; i++) {
    step(state, p, derived, dt);
    if (i % sampleEvery === 0) samples.push(observables(state, p, derived));
  }
  return { derived, samples };
}
