// Elastic helical-spring model (v3). Dependency-free ES module (browser + Node).
// SI units, pivot at origin, +Z up.
//
// Model: spring = N segments between nodes 0..N. Node 0 fixed (hook). Nodes 1..N-1 are rigid "coil" bodies
// (position + orientation quaternion, body frame d3 = spring axis pointing DOWN, from node i toward node i+1).
// Each segment is an inextensible Kirchhoff wire bent into a uniform helix (Love, Treatise on Elasticity,
// 4th ed., Sec. 270-271): U_helix(Ls, psi) = ls [ B/2 (kappa-kappa0)^2 + C/2 (tau-tau0)^2 ],
//   sin a = Ls/ls, N' = ns + psi/2pi, kappa = 2 pi N' cos a / ls, tau = 2 pi N' sin a / ls.
// (Same as the spec's R-form: R = ls cos a/(2 pi N'), kappa = cos^2 a/R, tau = sin a cos a/R.)
// Small-deflection compliance reproduces the Love / Timoshenko open-coiled result (verified numerically in tests).
// Bending between node frames: Haringx equivalent-beam rigidity; k_b = 2BC/(ls(B+C)) per segment (derived here:
//   uniform moment M on a coil: energy/length-of-wire = M^2/4 (1/B+1/C) => EI* = 2 L B C /(l (B+C)); matches spec).
// Shear stiffness (DERIVED, not looked up): a transverse force F on a coil with lever arm R sin(phi) loads the
//   wire with moment F R sin(phi): 1/S = (l R0^2 /(2 L0)) (cos^2 a0/B + sin^2 a0/C); per segment k_sh = N S / L0.
//   Wire shear/normal-force terms are ~1e-3 of this and neglected. (Haringx 1949 treats the same effect with the
//   spring loaded; the unloaded value is used here.)
// Rotations: node frames q_i; strains use SO(3) log map of q_a^T q_b; forces/torques are exact energy gradients.

const PI = Math.PI, TWO_PI = 2 * Math.PI;

export const MATERIALS = {
  steel: { E: 200e9, G: 79.3e9, rho: 7850 },
  stainless: { E: 193e9, G: 69e9, rho: 8000 },
};

export function materialProps(p) {
  if (p.wireMaterial === 'custom') return { E: p.wireE, G: p.wireG, rho: p.wireRho };
  return MATERIALS[p.wireMaterial] || MATERIALS.steel;
}

// Whole-spring helix properties for wire diameter dw, n active turns, coil diameter D, free length L0.
export function helixProps(dw, n, D, L0, mat) {
  const R0 = D / 2, a0 = Math.atan((L0 / n) / (TWO_PI * R0));
  const s = Math.sin(a0), c = Math.cos(a0);
  const ell = TWO_PI * n * R0 / c;
  const I4 = dw ** 4;
  const B = mat.E * PI * I4 / 64, C = mat.G * PI * I4 / 32;
  const mass = mat.rho * PI * dw * dw / 4 * ell;
  // compliance matrix of the whole spring (delta, phi) = [[a,b],[b,cc]] (W,K)  [Love; Timoshenko]
  const a = ell * R0 * R0 * (c * c / C + s * s / B);
  const b = ell * R0 * s * c * (1 / C - 1 / B);
  const cc = ell * (s * s / C + c * c / B);
  const det = a * cc - b * b;
  return { dw, n, D, R0, L0, alpha0: a0, ell, B, C, mass, kLin: 1 / a, kTwist: 1 / cc, kLocked: cc / det,
    coupling: -b / det, compA: a, compB: b, compC: cc };
}

// Solve (dw, n) so that kLin == kT and wire mass == mT.
export function calibrate(kT, mT, D, L0, mat) {
  const d0 = Math.pow(32 * kT * D * D * mT / (mat.G * mat.rho * PI * PI), 1 / 6);
  const n0 = 4 * mT / (mat.rho * PI * PI * d0 * d0 * D);
  let u = Math.log(d0), v = Math.log(n0), ok = false;
  const res = (u_, v_) => {
    const h = helixProps(Math.exp(u_), Math.exp(v_), D, L0, mat);
    return [Math.log(h.kLin / kT), Math.log(h.mass / mT)];
  };
  for (let it = 0; it < 60; it++) {
    const r = res(u, v);
    if (!(Math.abs(r[0]) < 1e30)) break;
    if (Math.max(Math.abs(r[0]), Math.abs(r[1])) < 1e-13) { ok = true; break; }
    const e = 1e-6, ru = res(u + e, v), rv = res(u, v + e);
    const j11 = (ru[0] - r[0]) / e, j21 = (ru[1] - r[1]) / e, j12 = (rv[0] - r[0]) / e, j22 = (rv[1] - r[1]) / e;
    const det = j11 * j22 - j12 * j21;
    if (!det) break;
    let du = -(j22 * r[0] - j12 * r[1]) / det, dv = -(-j21 * r[0] + j11 * r[1]) / det;
    const m = Math.max(Math.abs(du), Math.abs(dv));
    if (m > 0.5) { du *= 0.5 / m; dv *= 0.5 / m; }
    u += du; v += dv;
  }
  if (!ok) return { ok: false, dw: d0, n: n0 };
  return { ok: true, dw: Math.exp(u), n: Math.exp(v) };
}

// Whole-spring tangent axial stiffness (free twist) at the static hanging equilibrium under end load Mload (kg),
// including the spring's own weight distribution (each segment carries the load below it).
export function tangentAtLoad(h, N, Mload, g, opts = {}) {
  const S = makeSegment(h, N, opts), ms = h.mass, a = [0, 0, 0], b = [0, 0, 0];
  let inv = 0;
  for (let i = 0; i < N; i++) {
    const load = Mload + ms / (2 * N) + (N - 1 - i) * ms / N;
    const [L, ps] = solveSegmentEq(S, g * load);
    const e1 = 1e-8 * S.l, e2 = 1e-7;
    segmentEnergy(S, L + e1, ps, a); segmentEnergy(S, L - e1, ps, b);
    const s11 = (a[1] - b[1]) / (2 * e1), s21 = (a[2] - b[2]) / (2 * e1);
    segmentEnergy(S, L, ps + e2, a); segmentEnergy(S, L, ps - e2, b);
    const s22 = (a[2] - b[2]) / (2 * e2);
    inv += 1 / (s11 - s21 * s21 / s22);
  }
  return 1 / inv;
}

// 'loaded' calibration: wire mass = mT and tangent stiffness at hanging load Mref*g equals kT.
// Depends only on (kT, mT, D, L0, mat, Mref, g); a fixed 24-segment discretisation is used.
export function calibrateLoaded(kT, mT, D, L0, mat, Mref, g, opts = {}) {
  const NC = 24;
  const geo = (dw) => {
    const ell = 4 * mT / (mat.rho * PI * dw * dw);
    if (ell <= L0 * 1.0000001) return null;
    return helixProps(dw, Math.sqrt(ell * ell - L0 * L0) / (TWO_PI * D / 2), D, L0, mat);
  };
  const f = (dw) => { const h = geo(dw); return h ? Math.log(tangentAtLoad(h, NC, Mref, g, opts) / kT) : 1; };
  let lo = 1e-5, hi = Math.sqrt(4 * mT / (mat.rho * PI * L0)) * (1 - 1e-6);
  if (!(f(lo) < 0) || !(f(hi) > 0)) return { ok: false };
  let u = Math.log(lo), v = Math.log(hi);
  for (let i = 0; i < 70; i++) { const m = 0.5 * (u + v); if (f(Math.exp(m)) < 0) u = m; else v = m; if (v - u < 1e-13) break; }
  const dw = Math.exp(0.5 * (u + v)), h = geo(dw);
  return { ok: true, dw, n: h.n };
}

// Segment parameter block (all N segments identical).
export function makeSegment(h, N, opts = {}) {
  const l = h.ell / N, ns = h.n / N, s0 = Math.sin(h.alpha0), c0 = Math.cos(h.alpha0);
  const kSeg = N * h.kLin, kTw = N * h.kTwist;
  const S = {
    N, l, ns, B: h.B, C: h.C, dw: h.dw,
    kap0: c0 * c0 / h.R0, tau0: s0 * c0 / h.R0,
    Lc: ns * h.dw, kc: 50 * kSeg, Fi: opts.initialTension || 0,
    Lmax: l * Math.sqrt(1 - 1e-4), kp: 1e3 * kSeg,
    psiMin: -0.95 * TWO_PI * ns, kpt: 1e3 * kTw,
    Ls0: h.L0 / N,
    kb: 2 * h.B * h.C / (l * (h.B + h.C)),
    ksh: N / h.L0 * 2 * h.L0 / (h.ell * h.R0 * h.R0 * (c0 * c0 / h.B + s0 * s0 / h.C)),
    sh: opts.hand === 'left' ? -1 : 1,
  };
  S.ksh = N * (2 / (h.ell * h.R0 * h.R0 * (c0 * c0 / h.B + s0 * s0 / h.C)));
  return S;
}

// Segment energy and analytic derivatives: o[0]=U, o[1]=W=dU/dLs, o[2]=K=dU/dpsi (includes contact,
// initial-tension and range-guard penalties). Fully extended wire (cos a -> 0) and fully unwound turns are
// guarded by stiff quadratic penalties.
export function segmentEnergy(S, Ls, psi, o) {
  const l = S.l;
  let U = 0, W = 0, K = 0, L = Ls, ps = psi;
  if (L > S.Lmax) { const e = L - S.Lmax; U += 0.5 * S.kp * e * e; W += S.kp * e; L = S.Lmax; }
  if (ps < S.psiMin) { const e = ps - S.psiMin; U += 0.5 * S.kpt * e * e; K += S.kpt * e; ps = S.psiMin; }
  const s = L / l, c = Math.sqrt(1 - s * s);
  const Np = S.ns + ps / TWO_PI;
  const kap = TWO_PI * Np * c / l, tau = TWO_PI * Np * s / l;
  const dk = kap - S.kap0, dt = tau - S.tau0;
  U += l * (0.5 * S.B * dk * dk + 0.5 * S.C * dt * dt);
  const f = TWO_PI * Np / (l * l);
  W += l * (S.B * dk * (-s / c) * f + S.C * dt * f);
  K += S.B * dk * c + S.C * dt * s;
  if (L < S.Lc) { const e = S.Lc - L; U += 0.5 * S.kc * e * e; W -= S.kc * e; }
  else if (S.Fi) { U += S.Fi * (L - S.Lc); W += S.Fi; }
  o[0] = U; o[1] = W; o[2] = K;
  return o;
}

// ======================================================================================================
// Dynamics. State y (Float64Array): blocks of 13 = [pos(3) vel(3) quat(4) omega_body(3)] for the free nodes
// 1..N-1 (and node N if cordLength>0), then the phone block (inertial COM c of assembly + node-N half mass,
// as in the v2 rigid model), then optional bearing DOFs [angle, rate] (top hook / eyebolt when twist is 'free').
// Eye frame of the phone: d1 = body X, d2 = body Z, d3 = -body Y  (quaternion QOFF = Rx(+90deg)).
// ======================================================================================================
const SQH = Math.SQRT1_2;
const QC = [0, 1, 0, 0]; // Rc = Rx(180): node frames at rest (d1=X, d2=-Y, d3=-Z)

function qmul(a, b, o) {
  o[0] = a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3];
  o[1] = a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2];
  o[2] = a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1];
  o[3] = a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0];
  return o;
}
const qz = (a) => [Math.cos(a / 2), 0, 0, Math.sin(a / 2)];
function quatMat(w, x, y, z, R, o) {
  R[o] = 1 - 2 * (y * y + z * z); R[o + 1] = 2 * (x * y - w * z); R[o + 2] = 2 * (x * z + w * y);
  R[o + 3] = 2 * (x * y + w * z); R[o + 4] = 1 - 2 * (x * x + z * z); R[o + 5] = 2 * (y * z - w * x);
  R[o + 6] = 2 * (x * z - w * y); R[o + 7] = 2 * (y * z + w * x); R[o + 8] = 1 - 2 * (x * x + y * y);
}

export function buildContext(p, h, S, base, N) {
  const ms = h.mass, cord = p.cordLength > 0;
  const nf = N - 1 + (cord ? 1 : 0);
  const bt = p.topTwist === 'free', bb = !cord && p.eyeTwist === 'free';
  const M = base.M, d = base.d;
  const m1 = cord ? 0 : ms / (2 * N), Mt = M + m1;
  const s1 = m1 * d / Mt, s2 = M * d / Mt, dI = M * m1 * d * d / Mt;
  const I = base.inertia;
  const cx = {
    N, nf, cord, bt, bb, S, sh: S.sh, g: p.gravity, M, m1, Mt, s1, s2, d,
    Jx: I[0] + dI, Jy: I[1], Jz: I[2] + dI, ms, R0: h.R0,
    mass: new Float64Array(nf), Jt: new Float64Array(nf), Ja: new Float64Array(nf),
    Jb: ms / (2 * N) * h.R0 * h.R0, kcord: 2000, cordLen: p.cordLength,
    idxBt: 13 * (nf + 1), idxBb: 13 * (nf + 1) + (bt ? 2 : 0),
    ny: 13 * (nf + 1) + 2 * ((bt ? 1 : 0) + (bb ? 1 : 0)),
    qCeil: [1, 0, 0, 0],
    dm: 0, cdA: 0, cdT: 0, cT: 0, cRot: 0, dRN: 0, dT: 0, dRot: 0, damp: 0,
  };
  const hseg = h.L0 / N;
  for (let b = 0; b < nf; b++) {
    const m = (b + 1 === N) ? ms / (2 * N) : ms / N;
    cx.mass[b] = m; cx.Jt[b] = m * (h.R0 * h.R0 / 2 + hseg * hseg / 12); cx.Ja[b] = m * h.R0 * h.R0;
  }
  cx.Rm = new Float64Array(9 * (nf + 1)); cx.Qn = new Float64Array(4 * (nf + 1));
  cx.X = new Float64Array(3 * (N + 1)); cx.V = new Float64Array(3 * (N + 1));
  cx.G = new Float64Array(3 * (N + 1)); cx.T = new Float64Array(3 * (N + 1));
  cx.Ga = new Float64Array(3); cx.Tp = new Float64Array(3); cx.gb = new Float64Array(2);
  cx.psi = new Float64Array(N); cx.Ls = new Float64Array(N);
  cx.U = 0; cx.sc = new Float64Array(3);
  cx.k1 = new Float64Array(cx.ny); cx.k2 = new Float64Array(cx.ny); cx.k3 = new Float64Array(cx.ny);
  cx.k4 = new Float64Array(cx.ny); cx.yt = new Float64Array(cx.ny);
  cx.tmp = { th: [0, 0, 0], D: new Float64Array(9) };
  return cx;
}

export const CORD_DELTA = 1e-3; // m
function cordStretch(F, kc) { return F >= 0.5 * kc * CORD_DELTA ? F / kc + 0.5 * CORD_DELTA : Math.sqrt(2 * CORD_DELTA * Math.max(F, 0) / kc); }
const SEG = new Float64Array(3);
const QE = [0, 0, 0, 0], QR = [0, 0, 0, 0];

// Potential-energy pass: fills cx.G (dU/dx), cx.T (dU/d(body-frame rotation increment)), cx.Ga, cx.Tp, cx.gb, cx.U,
// cx.psi, cx.Ls. With damp=true, dashpot terms are added to W and K (dissipative generalised forces).
function evalPotential(y, cx, damp) {
  const N = cx.N, nf = cx.nf, S = cx.S, sh = cx.sh;
  const Rm = cx.Rm, Qn = cx.Qn, X = cx.X, V = cx.V, G = cx.G, T = cx.T;
  for (let b = 0; b <= nf; b++) {
    const o = 13 * b, inv = 1 / Math.sqrt(y[o + 6] ** 2 + y[o + 7] ** 2 + y[o + 8] ** 2 + y[o + 9] ** 2);
    const w = y[o + 6] * inv, x = y[o + 7] * inv, yy = y[o + 8] * inv, z = y[o + 9] * inv;
    Qn[4 * b] = w; Qn[4 * b + 1] = x; Qn[4 * b + 2] = yy; Qn[4 * b + 3] = z;
    quatMat(w, x, yy, z, Rm, 9 * b);
  }
  const pb = 13 * nf, rp = 9 * nf;
  const yhx = Rm[rp + 1], yhy = Rm[rp + 4], yhz = Rm[rp + 7];
  const ax = y[pb] + cx.s2 * yhx, ay = y[pb + 1] + cx.s2 * yhy, az = y[pb + 2] + cx.s2 * yhz;
  X[0] = X[1] = X[2] = 0;
  for (let j = 1; j < N; j++) { const o = 13 * (j - 1); X[3 * j] = y[o]; X[3 * j + 1] = y[o + 1]; X[3 * j + 2] = y[o + 2]; }
  if (cx.cord) { const o = 13 * (N - 1); X[3 * N] = y[o]; X[3 * N + 1] = y[o + 1]; X[3 * N + 2] = y[o + 2]; }
  else { X[3 * N] = ax; X[3 * N + 1] = ay; X[3 * N + 2] = az; }
  G.fill(0); T.fill(0); cx.Tp[0] = cx.Tp[1] = cx.Tp[2] = 0; cx.gb[0] = cx.gb[1] = 0;
  // phone world angular velocity (for attach velocity)
  let wwx = 0, wwy = 0, wwz = 0;
  if (damp) {
    V[0] = V[1] = V[2] = 0;
    for (let j = 1; j < N; j++) { const o = 13 * (j - 1); V[3 * j] = y[o + 3]; V[3 * j + 1] = y[o + 4]; V[3 * j + 2] = y[o + 5]; }
    const wb0 = y[pb + 10], wb1 = y[pb + 11], wb2 = y[pb + 12];
    wwx = Rm[rp] * wb0 + Rm[rp + 1] * wb1 + Rm[rp + 2] * wb2;
    wwy = Rm[rp + 3] * wb0 + Rm[rp + 4] * wb1 + Rm[rp + 5] * wb2;
    wwz = Rm[rp + 6] * wb0 + Rm[rp + 7] * wb1 + Rm[rp + 8] * wb2;
    if (cx.cord) { const o = 13 * (N - 1); V[3 * N] = y[o + 3]; V[3 * N + 1] = y[o + 4]; V[3 * N + 2] = y[o + 5]; }
    else {
      V[3 * N] = y[pb + 3] + cx.s2 * (wwy * yhz - wwz * yhy);
      V[3 * N + 1] = y[pb + 4] + cx.s2 * (wwz * yhx - wwx * yhz);
      V[3 * N + 2] = y[pb + 5] + cx.s2 * (wwx * yhy - wwy * yhx);
    }
  }
  let U = 0;
  const th = cx.tmp.th, Dm = cx.tmp.D;
  for (let i = 0; i < N; i++) {
    const fa = i === 0 ? 1 : i;           // frame node
    const ba = fa - 1, ra = 9 * ba;
    const dx0 = X[3 * i + 3] - X[3 * i], dx1 = X[3 * i + 4] - X[3 * i + 1], dx2 = X[3 * i + 5] - X[3 * i + 2];
    const g0 = Rm[ra] * dx0 + Rm[ra + 3] * dx1 + Rm[ra + 6] * dx2;
    const g1 = Rm[ra + 1] * dx0 + Rm[ra + 4] * dx1 + Rm[ra + 7] * dx2;
    const g2 = Rm[ra + 2] * dx0 + Rm[ra + 5] * dx1 + Rm[ra + 8] * dx2;
    const kind = i === 0 ? 0 : ((i <= N - 2 || cx.cord) ? 1 : 2); // 0 top, 1 mid, 2 bottom(eye)
    let tx = 0, ty = 0, tz = 0, cJ = 0, gp0 = 0, gp1 = 0, gp2 = 0;
    // relative rotation quaternion
    let rw, rx, ry, rz;
    if (kind === 1) {
      const qa = 4 * ba, qb = 4 * (ba + 1);
      const aw = Qn[qa], ax_ = Qn[qa + 1], ay_ = Qn[qa + 2], az_ = Qn[qa + 3], bw = Qn[qb], bx = Qn[qb + 1], by = Qn[qb + 2], bz = Qn[qb + 3];
      rw = aw * bw + ax_ * bx + ay_ * by + az_ * bz;
      rx = aw * bx - bw * ax_ - (ay_ * bz - az_ * by);
      ry = aw * by - bw * ay_ - (az_ * bx - ax_ * bz);
      rz = aw * bz - bw * az_ - (ax_ * by - ay_ * bx);
    } else if (kind === 0) {
      const c = cx.qCeil, qb = 4 * ba, bw = Qn[qb], bx = Qn[qb + 1], by = Qn[qb + 2], bz = Qn[qb + 3];
      const aw = c[0], ax_ = c[1], ay_ = c[2], az_ = c[3];
      rw = aw * bw + ax_ * bx + ay_ * by + az_ * bz;
      rx = aw * bx - bw * ax_ - (ay_ * bz - az_ * by);
      ry = aw * by - bw * ay_ - (az_ * bx - ax_ * bz);
      rz = aw * bz - bw * az_ - (ax_ * by - ay_ * bx);
    } else {
      const qp = 4 * nf, pw = Qn[qp], px = Qn[qp + 1], py = Qn[qp + 2], pz = Qn[qp + 3];
      const be0 = pw * SQH - px * SQH, be1 = pw * SQH + px * SQH, be2 = SQH * py + SQH * pz, be3 = SQH * pz - SQH * py;
      const qa = 4 * ba, aw = Qn[qa], ax_ = Qn[qa + 1], ay_ = Qn[qa + 2], az_ = Qn[qa + 3];
      rw = aw * be0 + ax_ * be1 + ay_ * be2 + az_ * be3;
      rx = aw * be1 - be0 * ax_ - (ay_ * be3 - az_ * be2);
      ry = aw * be2 - be0 * ay_ - (az_ * be1 - ax_ * be3);
      rz = aw * be3 - be0 * az_ - (ax_ * be2 - ay_ * be1);
    }
    if (rw < 0) { rw = -rw; rx = -rx; ry = -ry; rz = -rz; }
    let psi;
    if (kind === 1) {
      const vn = Math.sqrt(rx * rx + ry * ry + rz * rz);
      let ang, f;
      if (vn < 1e-9) { f = 2 / rw; ang = 2 * vn / rw; } else { ang = 2 * Math.atan2(vn, rw); f = ang / vn; }
      tx = f * rx; ty = f * ry; tz = f * rz;
      cJ = ang < 0.05 ? 1 / 12 + ang * ang / 720 : 1 / (ang * ang) - 0.5 / (ang * Math.tan(0.5 * ang));
      psi = sh * tz;
    } else {
      const den = rw * rw + rz * rz;
      gp0 = (rz * rx - rw * ry) / den; gp1 = (rw * rx + rz * ry) / den; gp2 = 1;
      const pg = 2 * Math.atan2(rz, rw);
      let bear = 0;
      if (kind === 0 && cx.bt) bear = y[cx.idxBt];
      if (kind === 2 && cx.bb) bear = y[cx.idxBb];
      psi = sh * (pg - bear);
    }
    const Ls = g2;
    segmentEnergy(S, Ls, psi, SEG);
    let Weff = SEG[1], Keff = SEG[2];
    U += SEG[0] + 0.5 * S.ksh * (g0 * g0 + g1 * g1);
    if (kind === 1) U += 0.5 * S.kb * (tx * tx + ty * ty);
    cx.psi[i] = psi; cx.Ls[i] = Ls;
    if (damp) {
      const oa = 13 * ba;
      const w0 = y[oa + 10], w1 = y[oa + 11], w2 = y[oa + 12];
      const dv0 = V[3 * i + 3] - V[3 * i], dv1 = V[3 * i + 4] - V[3 * i + 1], dv2 = V[3 * i + 5] - V[3 * i + 2];
      const Lsd = Rm[ra + 2] * dv0 + Rm[ra + 5] * dv1 + Rm[ra + 8] * dv2 - (w0 * g1 - w1 * g0);
      let psid = 0;
      if (kind === 1) {
        // Dm = Delta (b-frame -> a-frame) from qrel
        const vv = rw, a_ = rx, b_ = ry, c_ = rz;
        const ob = 13 * (ba + 1);
        const e0 = y[ob + 10], e1 = y[ob + 11], e2 = y[ob + 12];
        const r2 = 2 * (a_ * c_ - vv * b_) * e0 + 2 * (b_ * c_ + vv * a_) * e1 + (1 - 2 * (a_ * a_ + b_ * b_)) * e2;
        psid = sh * (r2 - w2);
      } else if (kind === 0) {
        psid = sh * (gp0 * w0 + gp1 * w1 + gp2 * w2 - (cx.bt ? y[cx.idxBt + 1] : 0));
      } else {
        const we0 = y[pb + 10], we1 = y[pb + 12], we2 = -y[pb + 11]; // Roff^T w
        const Dg0 = (1 - 2 * (ry * ry + rz * rz)) * gp0 + 2 * (rx * ry - rw * rz) * gp1 + 2 * (rx * rz + rw * ry) * gp2;
        const Dg1 = 2 * (rx * ry + rw * rz) * gp0 + (1 - 2 * (rx * rx + rz * rz)) * gp1 + 2 * (ry * rz - rw * rx) * gp2;
        const Dg2 = 2 * (rx * rz - rw * ry) * gp0 + 2 * (ry * rz + rw * rx) * gp1 + (1 - 2 * (rx * rx + ry * ry)) * gp2;
        psid = sh * (gp0 * we0 + gp1 * we1 + gp2 * we2 - (Dg0 * w0 + Dg1 * w1 + Dg2 * w2) - (cx.bb ? y[cx.idxBb + 1] : 0));
      }
      Weff += (cx.dm === 2 ? cx.dRN * Math.abs(Lsd) : cx.cdA) * Lsd;
      Keff += cx.cdT * psid;
    }
    // gradient wrt chord strain
    const fg0 = S.ksh * g0, fg1 = S.ksh * g1, fg2 = Weff;
    const fw0 = Rm[ra] * fg0 + Rm[ra + 1] * fg1 + Rm[ra + 2] * fg2;
    const fw1 = Rm[ra + 3] * fg0 + Rm[ra + 4] * fg1 + Rm[ra + 5] * fg2;
    const fw2 = Rm[ra + 6] * fg0 + Rm[ra + 7] * fg1 + Rm[ra + 8] * fg2;
    const i3 = 3 * i, j3 = 3 * i + 3;
    G[j3] += fw0; G[j3 + 1] += fw1; G[j3 + 2] += fw2;
    G[i3] -= fw0; G[i3 + 1] -= fw1; G[i3 + 2] -= fw2;
    const ta = 3 * fa;
    T[ta] += fg1 * g2 - fg2 * g1; T[ta + 1] += fg2 * g0 - fg0 * g2; T[ta + 2] += fg0 * g1 - fg1 * g0;
    if (kind === 1) {
      const q0 = S.kb * tx, q1 = S.kb * ty, q2 = sh * Keff;
      // h = q - 1/2 th x q + c th x (th x q)
      const cx1 = ty * q2 - tz * q1, cy1 = tz * q0 - tx * q2, cz1 = tx * q1 - ty * q0;
      const dx_ = ty * cz1 - tz * cy1, dy_ = tz * cx1 - tx * cz1, dz_ = tx * cy1 - ty * cx1;
      const h0 = q0 - 0.5 * cx1 + cJ * dx_, h1 = q1 - 0.5 * cy1 + cJ * dy_, h2 = q2 - 0.5 * cz1 + cJ * dz_;
      const tb = 3 * (i + 1);
      T[tb] += h0; T[tb + 1] += h1; T[tb + 2] += h2;
      // Delta h
      T[ta] -= (1 - 2 * (ry * ry + rz * rz)) * h0 + 2 * (rx * ry - rw * rz) * h1 + 2 * (rx * rz + rw * ry) * h2;
      T[ta + 1] -= 2 * (rx * ry + rw * rz) * h0 + (1 - 2 * (rx * rx + rz * rz)) * h1 + 2 * (ry * rz - rw * rx) * h2;
      T[ta + 2] -= 2 * (rx * rz - rw * ry) * h0 + 2 * (ry * rz + rw * rx) * h1 + (1 - 2 * (rx * rx + ry * ry)) * h2;
    } else if (kind === 0) {
      const sk = sh * Keff;
      T[ta] += sk * gp0; T[ta + 1] += sk * gp1; T[ta + 2] += sk * gp2;
      if (cx.bt) cx.gb[0] -= sk;
    } else {
      const sk = sh * Keff;
      const Dg0 = (1 - 2 * (ry * ry + rz * rz)) * gp0 + 2 * (rx * ry - rw * rz) * gp1 + 2 * (rx * rz + rw * ry) * gp2;
      const Dg1 = 2 * (rx * ry + rw * rz) * gp0 + (1 - 2 * (rx * rx + rz * rz)) * gp1 + 2 * (ry * rz - rw * rx) * gp2;
      const Dg2 = 2 * (rx * rz - rw * ry) * gp0 + 2 * (ry * rz + rw * rx) * gp1 + (1 - 2 * (rx * rx + ry * ry)) * gp2;
      T[ta] -= sk * Dg0; T[ta + 1] -= sk * Dg1; T[ta + 2] -= sk * Dg2;
      cx.Tp[0] += sk * gp0; cx.Tp[1] += -sk * gp2; cx.Tp[2] += sk * gp1; // Roff * g
      if (cx.bb) cx.gb[1] -= sk;
    }
  }
  // attach-point gradient
  const Ga = cx.Ga;
  if (!cx.cord) { Ga[0] = G[3 * N]; Ga[1] = G[3 * N + 1]; Ga[2] = G[3 * N + 2]; }
  else {
    Ga[0] = Ga[1] = Ga[2] = 0;
    const dx = ax - X[3 * N], dy = ay - X[3 * N + 1], dz = az - X[3 * N + 2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz), ext = len - cx.cordLen;
    if (ext > 0) {
      // C1-smoothed tension-only onset over CORD_DELTA (reduces RK4 kink error at slack/taut transitions)
      const dl = CORD_DELTA, kcd = cx.kcord;
      let Fc, Uc;
      if (ext < dl) { Fc = kcd * ext * ext / (2 * dl); Uc = kcd * ext * ext * ext / (6 * dl); }
      else { Fc = kcd * (ext - 0.5 * dl); Uc = kcd * (0.5 * ext * ext - 0.5 * dl * ext + dl * dl / 6); }
      const f = Fc / len;
      U += Uc;
      Ga[0] = f * dx; Ga[1] = f * dy; Ga[2] = f * dz;
      G[3 * N] -= f * dx; G[3 * N + 1] -= f * dy; G[3 * N + 2] -= f * dz;
    }
  }
  cx.U = U;
}

function deriv(y, out, cx) {
  evalPotential(y, cx, cx.dm !== 0);
  const N = cx.N, nf = cx.nf, G = cx.G, T = cx.T, g = cx.g;
  for (let b = 0; b < nf; b++) {
    const o = 13 * b, j3 = 3 * (b + 1), m = cx.mass[b], Jt = cx.Jt[b], Ja = cx.Ja[b];
    out[o] = y[o + 3]; out[o + 1] = y[o + 4]; out[o + 2] = y[o + 5];
    out[o + 3] = -G[j3] / m; out[o + 4] = -G[j3 + 1] / m; out[o + 5] = -G[j3 + 2] / m - g;
    const w0 = y[o + 10], w1 = y[o + 11], w2 = y[o + 12], q0 = y[o + 6], q1 = y[o + 7], q2 = y[o + 8], q3 = y[o + 9];
    out[o + 6] = 0.5 * (-q1 * w0 - q2 * w1 - q3 * w2);
    out[o + 7] = 0.5 * (q0 * w0 + q2 * w2 - q3 * w1);
    out[o + 8] = 0.5 * (q0 * w1 + q3 * w0 - q1 * w2);
    out[o + 9] = 0.5 * (q0 * w2 + q1 * w1 - q2 * w0);
    out[o + 10] = (-T[j3] - (Ja - Jt) * w1 * w2) / Jt;
    out[o + 11] = (-T[j3 + 1] - (Jt - Ja) * w2 * w0) / Jt;
    out[o + 12] = -T[j3 + 2] / Ja;
  }
  // phone
  const pb = 13 * nf, R = cx.Rm, rp = 9 * nf;
  const wb0 = y[pb + 10], wb1 = y[pb + 11], wb2 = y[pb + 12];
  const yx = R[rp + 1], yy = R[rp + 4], yz = R[rp + 7];
  const wx = R[rp] * wb0 + R[rp + 1] * wb1 + R[rp + 2] * wb2;
  const wy = R[rp + 3] * wb0 + R[rp + 4] * wb1 + R[rp + 5] * wb2;
  const wz = R[rp + 6] * wb0 + R[rp + 7] * wb1 + R[rp + 8] * wb2;
  const s1 = cx.s1, s2 = cx.s2, Ga = cx.Ga;
  let Fax = -Ga[0], Fay = -Ga[1], Faz = -Ga[2] - cx.m1 * g;
  let Fqx = 0, Fqy = 0, Fqz = -cx.M * g;
  let tdx = 0, tdy = 0, tdz = 0;
  if (cx.dm !== 0) {
    const cxv = wy * yz - wz * yy, cyv = wz * yx - wx * yz, czv = wx * yy - wy * yx;
    const vqx = y[pb + 3] - s1 * cxv, vqy = y[pb + 4] - s1 * cyv, vqz = y[pb + 5] - s1 * czv;
    const qx = y[pb] - s1 * yx, qy = y[pb + 1] - s1 * yy, qzz = y[pb + 2] - s1 * yz;
    const lq = Math.sqrt(qx * qx + qy * qy + qzz * qzz), iq = lq > 0 ? 1 / lq : 0;
    const gx = qx * iq, gy = qy * iq, gz = qzz * iq;
    const vt = vqx * gx + vqy * gy + vqz * gz;
    const tx = vqx - vt * gx, ty = vqy - vt * gy, tz = vqz - vt * gz;
    let bcoef, cr;
    if (cx.dm === 1) { bcoef = cx.cT; cr = cx.cRot; }
    else { bcoef = cx.dT * Math.sqrt(tx * tx + ty * ty + tz * tz); cr = cx.dRot * Math.sqrt(wx * wx + wy * wy + wz * wz); }
    Fqx -= bcoef * tx; Fqy -= bcoef * ty; Fqz -= bcoef * tz;
    tdx = -cr * wx; tdy = -cr * wy; tdz = -cr * wz;
  }
  const imt = 1 / cx.Mt;
  out[pb] = y[pb + 3]; out[pb + 1] = y[pb + 4]; out[pb + 2] = y[pb + 5];
  out[pb + 3] = (Fax + Fqx) * imt; out[pb + 4] = (Fay + Fqy) * imt; out[pb + 5] = (Faz + Fqz) * imt;
  const ux = s2 * Fax - s1 * Fqx, uy = s2 * Fay - s1 * Fqy, uz = s2 * Faz - s1 * Fqz;
  const twx = yy * uz - yz * uy + tdx, twy = yz * ux - yx * uz + tdy, twz = yx * uy - yy * ux + tdz;
  const t0 = R[rp] * twx + R[rp + 3] * twy + R[rp + 6] * twz - cx.Tp[0];
  const t1 = R[rp + 1] * twx + R[rp + 4] * twy + R[rp + 7] * twz - cx.Tp[1];
  const t2 = R[rp + 2] * twx + R[rp + 5] * twy + R[rp + 8] * twz - cx.Tp[2];
  const Jx = cx.Jx, Jy = cx.Jy, Jz = cx.Jz;
  out[pb + 10] = (t0 - (wb1 * Jz * wb2 - wb2 * Jy * wb1)) / Jx;
  out[pb + 11] = (t1 - (wb2 * Jx * wb0 - wb0 * Jz * wb2)) / Jy;
  out[pb + 12] = (t2 - (wb0 * Jy * wb1 - wb1 * Jx * wb0)) / Jz;
  const q0 = y[pb + 6], q1 = y[pb + 7], q2 = y[pb + 8], q3 = y[pb + 9];
  out[pb + 6] = 0.5 * (-q1 * wb0 - q2 * wb1 - q3 * wb2);
  out[pb + 7] = 0.5 * (q0 * wb0 + q2 * wb2 - q3 * wb1);
  out[pb + 8] = 0.5 * (q0 * wb1 + q3 * wb0 - q1 * wb2);
  out[pb + 9] = 0.5 * (q0 * wb2 + q1 * wb1 - q2 * wb0);
  if (cx.bt) { out[cx.idxBt] = y[cx.idxBt + 1]; out[cx.idxBt + 1] = -cx.gb[0] / cx.Jb; }
  if (cx.bb) { out[cx.idxBb] = y[cx.idxBb + 1]; out[cx.idxBb + 1] = -cx.gb[1] / cx.Jb; }
}

function normQuats(y, cx) {
  for (let b = 0; b <= cx.nf; b++) {
    const o = 13 * b + 6, n = 1 / Math.sqrt(y[o] ** 2 + y[o + 1] ** 2 + y[o + 2] ** 2 + y[o + 3] ** 2);
    y[o] *= n; y[o + 1] *= n; y[o + 2] *= n; y[o + 3] *= n;
  }
}

export function bindDamping(cx, p) {
  const m = p.dampingModel;
  cx.dm = m === 'linear' ? 1 : (m === 'quadratic' ? 2 : 0);
  cx.cdA = p.cR * cx.N; cx.dRN = p.dR * cx.N; cx.cdT = (p.cTwist || 0) * cx.N;
  cx.cT = p.cT; cx.cRot = p.cRot; cx.dT = p.dT; cx.dRot = p.dRot;
}

// sync the v2-style phone fields (assembly COM q, velocity v, quat, omega) from state.y
export function syncPhone(state, cx) {
  const y = state.y, pb = 13 * cx.nf;
  const qn = 1 / Math.sqrt(y[pb + 6] ** 2 + y[pb + 7] ** 2 + y[pb + 8] ** 2 + y[pb + 9] ** 2);
  const w = y[pb + 6] * qn, x = y[pb + 7] * qn, yy = y[pb + 8] * qn, z = y[pb + 9] * qn;
  const R = SYR; quatMat(w, x, yy, z, R, 0);
  const wb0 = y[pb + 10], wb1 = y[pb + 11], wb2 = y[pb + 12];
  const wx = R[0] * wb0 + R[1] * wb1 + R[2] * wb2, wy = R[3] * wb0 + R[4] * wb1 + R[5] * wb2, wz = R[6] * wb0 + R[7] * wb1 + R[8] * wb2;
  const nx = R[1], ny = R[4], nz = R[7], s1 = cx.s1;
  state.q[0] = y[pb] - s1 * nx; state.q[1] = y[pb + 1] - s1 * ny; state.q[2] = y[pb + 2] - s1 * nz;
  state.v[0] = y[pb + 3] - s1 * (wy * nz - wz * ny); state.v[1] = y[pb + 4] - s1 * (wz * nx - wx * nz); state.v[2] = y[pb + 5] - s1 * (wx * ny - wy * nx);
  state.quat[0] = w; state.quat[1] = x; state.quat[2] = yy; state.quat[3] = z;
  state.omega[0] = wb0; state.omega[1] = wb1; state.omega[2] = wb2;
}
const SYR = new Float64Array(9);

export function stepElastic(state, p, dv, dt) {
  const cx = dv.el, y = state.y, n = cx.ny;
  bindDamping(cx, p);
  const { k1, k2, k3, k4, yt } = cx, h2 = dt / 2;
  deriv(y, k1, cx);
  for (let i = 0; i < n; i++) yt[i] = y[i] + h2 * k1[i];
  deriv(yt, k2, cx);
  for (let i = 0; i < n; i++) yt[i] = y[i] + h2 * k2[i];
  deriv(yt, k3, cx);
  for (let i = 0; i < n; i++) yt[i] = y[i] + dt * k3[i];
  deriv(yt, k4, cx);
  const f = dt / 6;
  for (let i = 0; i < n; i++) y[i] += f * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  normQuats(y, cx);
  state.t += dt;
  syncPhone(state, cx);
  return state;
}

// energy pieces for a state vector: {KEphone, KEnodes, U, Vg}
export function energyParts(y, cx) {
  evalPotential(y, cx, false);
  let KEn = 0, Vg = 0;
  for (let b = 0; b < cx.nf; b++) {
    const o = 13 * b, m = cx.mass[b];
    KEn += 0.5 * m * (y[o + 3] ** 2 + y[o + 4] ** 2 + y[o + 5] ** 2)
      + 0.5 * cx.Jt[b] * (y[o + 10] ** 2 + y[o + 11] ** 2) + 0.5 * cx.Ja[b] * y[o + 12] ** 2;
    Vg += m * cx.g * y[o + 2];
  }
  if (cx.bt) KEn += 0.5 * cx.Jb * y[cx.idxBt + 1] ** 2;
  if (cx.bb) KEn += 0.5 * cx.Jb * y[cx.idxBb + 1] ** 2;
  const pb = 13 * cx.nf, rp = 9 * cx.nf, R = cx.Rm;
  const w0 = y[pb + 10], w1 = y[pb + 11], w2 = y[pb + 12];
  const KEp = 0.5 * cx.Mt * (y[pb + 3] ** 2 + y[pb + 4] ** 2 + y[pb + 5] ** 2) + 0.5 * (cx.Jx * w0 * w0 + cx.Jy * w1 * w1 + cx.Jz * w2 * w2);
  const yz = R[rp + 7];
  Vg += cx.g * (cx.M * (y[pb + 2] - cx.s1 * yz) + cx.m1 * (y[pb + 2] + cx.s2 * yz));
  return { KEphone: KEp, KEnodes: KEn, U: cx.U, Vg };
}

// ======================================================================================================
// Equilibrium, state construction
// ======================================================================================================
function solveSegmentEq(S, F) {
  let Ls = S.Ls0 + F / (S.N * 20), psi = 0;
  const o = [0, 0, 0], a = [0, 0, 0], b = [0, 0, 0];
  for (let it = 0; it < 80; it++) {
    segmentEnergy(S, Ls, psi, o);
    const r1 = o[1] - F, r2 = o[2];
    if (Math.abs(r1) < 1e-13 * (1 + Math.abs(F)) && Math.abs(r2) < 1e-15) break;
    const e1 = 1e-8 * S.l, e2 = 1e-7;
    segmentEnergy(S, Ls + e1, psi, a); segmentEnergy(S, Ls - e1, psi, b);
    const j11 = (a[1] - b[1]) / (2 * e1), j21 = (a[2] - b[2]) / (2 * e1);
    segmentEnergy(S, Ls, psi + e2, a); segmentEnergy(S, Ls, psi - e2, b);
    const j12 = (a[1] - b[1]) / (2 * e2), j22 = (a[2] - b[2]) / (2 * e2);
    const det = j11 * j22 - j12 * j21;
    let dL = -(j22 * r1 - j12 * r2) / det, dp = -(-j21 * r1 + j11 * r2) / det;
    const m = Math.max(Math.abs(dL) / (0.3 * S.l), Math.abs(dp) / 1);
    if (m > 1) { dL /= m; dp /= m; }
    Ls += dL; psi += dp;
  }
  return [Ls, psi];
}

// fill y for a straight spring along unit vector u (from pivot), scale f of equilibrium segment lengths,
// world swing quaternion sq applied to equilibrium node frames
function fillSpring(y, cx, eq, f, u, sq) {
  const N = cx.N, tmp = [0, 0, 0, 0], q = [0, 0, 0, 0];
  for (let j = 1; j <= (cx.cord ? N : N - 1); j++) {
    const o = 13 * (j - 1), d = f * eq.cum[j];
    y[o] = u[0] * d; y[o + 1] = u[1] * d; y[o + 2] = u[2] * d;
    y[o + 3] = y[o + 4] = y[o + 5] = 0;
    qmul(QC, qz(eq.Phi[j] - eq.Phi[N]), tmp);
    qmul(sq, tmp, q);
    y[o + 6] = q[0]; y[o + 7] = q[1]; y[o + 8] = q[2]; y[o + 9] = q[3];
    y[o + 10] = y[o + 11] = y[o + 12] = 0;
  }
  for (let i = cx.idxBt; i < cx.ny; i++) y[i] = 0;
}

function eqState(cx, eq) {
  const y = new Float64Array(cx.ny);
  fillSpring(y, cx, eq, 1, [0, 0, -1], [1, 0, 0, 0]);
  const pb = 13 * cx.nf;
  y[pb] = 0; y[pb + 1] = 0; y[pb + 2] = -eq.Leq - cx.s2;
  y[pb + 6] = SQH; y[pb + 7] = SQH; y[pb + 8] = 0; y[pb + 9] = 0;
  return y;
}

// ---- Jacobi eigen-solver (symmetric, in place on A; returns V columns = eigenvectors) ----
export function jacobiEigen(A, n) {
  const V = new Float64Array(n * n);
  for (let i = 0; i < n; i++) V[i * n + i] = 1;
  let diag2 = 0;
  for (let i = 0; i < n; i++) diag2 += A[i * n + i] ** 2;
  for (let sweep = 0; sweep < 80; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i * n + j] ** 2;
    if (off < 1e-26 * (diag2 + 1e-300)) break;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      const apq = A[p * n + q];
      if (Math.abs(apq) < 1e-300) continue;
      const th = (A[q * n + q] - A[p * n + p]) / (2 * apq);
      const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        if (k === p || k === q) continue;
        const akp = A[k * n + p], akq = A[k * n + q];
        const np_ = c * akp - s * akq, nq_ = s * akp + c * akq;
        A[k * n + p] = np_; A[p * n + k] = np_; A[k * n + q] = nq_; A[q * n + k] = nq_;
      }
      const app = A[p * n + p], aqq = A[q * n + q];
      A[p * n + p] = app - t * apq; A[q * n + q] = aqq + t * apq; A[p * n + q] = 0; A[q * n + p] = 0;
      for (let k = 0; k < n; k++) {
        const vkp = V[k * n + p], vkq = V[k * n + q];
        V[k * n + p] = c * vkp - s * vkq; V[k * n + q] = s * vkp + c * vkq;
      }
    }
  }
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = A[i * n + i];
  return { w, V };
}

// ---- minimal-coordinate gradient of V = U + gravity (for the Hessian) ----
function nDof(cx) { return 6 * (cx.nf + 1) + (cx.bt ? 1 : 0) + (cx.bb ? 1 : 0); }

export function gradMinimal(y, cx, g) {
  evalPotential(y, cx, false);
  const nf = cx.nf;
  for (let b = 0; b < nf; b++) {
    const j3 = 3 * (b + 1), o = 6 * b;
    g[o] = cx.G[j3]; g[o + 1] = cx.G[j3 + 1]; g[o + 2] = cx.G[j3 + 2] + cx.mass[b] * cx.g;
    g[o + 3] = cx.T[j3]; g[o + 4] = cx.T[j3 + 1]; g[o + 5] = cx.T[j3 + 2];
  }
  const o = 6 * nf, R = cx.Rm, rp = 9 * nf, Ga = cx.Ga;
  g[o] = Ga[0]; g[o + 1] = Ga[1]; g[o + 2] = Ga[2] + cx.Mt * cx.g;
  const v0 = R[rp] * Ga[0] + R[rp + 3] * Ga[1] + R[rp + 6] * Ga[2];
  const v2 = R[rp + 2] * Ga[0] + R[rp + 5] * Ga[1] + R[rp + 8] * Ga[2];
  g[o + 3] = cx.Tp[0] + cx.s2 * v2; g[o + 4] = cx.Tp[1]; g[o + 5] = cx.Tp[2] - cx.s2 * v0;
  let k = o + 6;
  if (cx.bt) g[k++] = cx.gb[0];
  if (cx.bb) g[k++] = cx.gb[1];
  return g;
}

function perturb(y, cx, idx, h, out) {
  out.set(y);
  const nf = cx.nf;
  if (idx < 6 * (nf + 1)) {
    const b = Math.floor(idx / 6), k = idx % 6, o = 13 * b;
    if (k < 3) out[o + k] += h;
    else {
      const e = [Math.cos(h / 2), 0, 0, 0]; e[1 + k - 3] = Math.sin(h / 2);
      const q = [out[o + 6], out[o + 7], out[o + 8], out[o + 9]], r = [0, 0, 0, 0];
      qmul(q, e, r);
      out[o + 6] = r[0]; out[o + 7] = r[1]; out[o + 8] = r[2]; out[o + 9] = r[3];
    }
  } else {
    const j = idx - 6 * (nf + 1);
    const which = (cx.bt && j === 0) ? cx.idxBt : cx.idxBb;
    out[which] += h;
  }
  return out;
}

function linearAnalysis(cx, yEq) {
  const n = nDof(cx), nf = cx.nf;
  const K = new Float64Array(n * n), gp = new Float64Array(n), gm = new Float64Array(n), yt = new Float64Array(cx.ny);
  const hstep = 1e-6;
  for (let j = 0; j < n; j++) {
    perturb(yEq, cx, j, hstep, yt); gradMinimal(yt, cx, gp);
    perturb(yEq, cx, j, -hstep, yt); gradMinimal(yt, cx, gm);
    for (let i = 0; i < n; i++) K[i * n + j] = (gp[i] - gm[i]) / (2 * hstep);
  }
  const mass = new Float64Array(n), tag = new Uint8Array(n); // tag: 0 z,1 x,2 y,3 rx,4 ry,5 rz
  for (let b = 0; b < nf; b++) {
    const o = 6 * b;
    mass[o] = mass[o + 1] = mass[o + 2] = cx.mass[b];
    mass[o + 3] = mass[o + 4] = cx.Jt[b]; mass[o + 5] = cx.Ja[b];
    tag[o] = 1; tag[o + 1] = 2; tag[o + 2] = 0; tag[o + 3] = 3; tag[o + 4] = 4; tag[o + 5] = 5;
  }
  {
    const o = 6 * nf;
    mass[o] = mass[o + 1] = mass[o + 2] = cx.Mt; mass[o + 3] = cx.Jx; mass[o + 4] = cx.Jy; mass[o + 5] = cx.Jz;
    tag[o] = 1; tag[o + 1] = 2; tag[o + 2] = 0; tag[o + 3] = 3; tag[o + 4] = 5; tag[o + 5] = 4;
    for (let k = o + 6; k < n; k++) { mass[k] = cx.Jb; tag[k] = 5; }
  }
  const A = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++)
    A[i * n + j] = 0.5 * (K[i * n + j] + K[j * n + i]) / Math.sqrt(mass[i] * mass[j]);
  const { w, V } = jacobiEigen(A, n);
  const modes = [];
  let wmax = 0, unstable = false;
  for (let m = 0; m < n; m++) {
    if (w[m] < -1e-6) unstable = true;
    const om = Math.sqrt(Math.max(w[m], 0)); wmax = Math.max(wmax, om);
    const s = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) s[tag[i]] += V[i * n + m] ** 2;
    modes.push({ f: om / TWO_PI, Sz: s[0], Sx: s[1] + s[4], Sy: s[2] + s[3], Syaw: s[5] });
  }
  modes.sort((a, b) => a.f - b.f);
  const res = { fR: NaN, fS: NaN, fS2: NaN, fSy: NaN, fSy2: NaN, fTwist: NaN, fSurge: NaN, wmax, unstable, modes };
  const fam = [], X = [], Yy = [];
  for (const m of modes) {
    const vert = m.Sz + m.Syaw;
    if (vert >= m.Sx && vert >= m.Sy) fam.push(m);
    else if (m.Sx >= m.Sy) X.push(m); else Yy.push(m);
  }
  const bl = (m) => m.Sz / (m.Sz + m.Syaw + 1e-300);
  if (fam.length >= 2) {
    const a = fam[0], b = fam[1];
    if (bl(a) >= bl(b)) { res.fR = a.f; res.fTwist = b.f; } else { res.fR = b.f; res.fTwist = a.f; }
    for (let k = 2; k < fam.length; k++) if (bl(fam[k]) > 0.5) { res.fSurge = fam[k].f; break; }
  } else if (fam.length === 1) { res.fR = fam[0].f; }
  if (X.length) res.fS = X[0].f; if (X.length > 1) res.fS2 = X[1].f;
  if (Yy.length) res.fSy = Yy[0].f; if (Yy.length > 1) res.fSy2 = Yy[1].f;
  return res;
}

// ======================================================================================================
// derive
// ======================================================================================================
const KEYS = ['phoneMass', 'phoneLength', 'phoneWidth', 'phoneThickness', 'caseMass', 'attachmentOffset', 'nutsPerSide',
  'nutMass', 'extraMass', 'springK', 'springL0', 'springMass', 'cordLength', 'gravity', 'springGeometry', 'coilDiameter',
  'wireMaterial', 'wireE', 'wireG', 'wireRho', 'wireDiameter', 'activeTurns', 'springHand', 'initialTension',
  'springSegments', 'kCalibration', 'kRefLoad', 'topTwist', 'eyeTwist'];
const cache = new Map();

export function deriveElastic(p, base) {
  const key = KEYS.map((k) => p[k]).join('|');
  let r = cache.get(key);
  if (!r) { r = computeDerive(p, base); cache.set(key, r); if (cache.size > 40) cache.delete(cache.keys().next().value); }
  return { ...r, warnings: r.warnings.slice() };
}

function computeDerive(p, base) {
  const warnings = [];
  const mat = materialProps(p), D = p.coilDiameter, L0 = p.springL0;
  const N = Math.max(2, Math.round(p.springSegments));
  let h;
  if (p.springGeometry === 'direct') h = helixProps(p.wireDiameter, p.activeTurns, D, L0, mat);
  else {
    let c = null;
    if (p.kCalibration !== 'unloaded') {
      c = calibrateLoaded(p.springK, p.springMass, D, L0, mat, p.kRefLoad, p.gravity, { initialTension: p.initialTension, hand: p.springHand });
      if (!c.ok) warnings.push("loaded fromK calibration failed: falling back to the unloaded definition.");
    }
    if (!c || !c.ok) c = calibrate(p.springK, p.springMass, D, L0, mat);
    if (!c.ok) warnings.push('fromK geometry solve failed: using close-coiled estimate for wire diameter and turns.');
    h = helixProps(c.dw, c.n, D, L0, mat);
  }
  if (h.alpha0 > 25 * PI / 180) warnings.push(`Helix angle ${(h.alpha0 * 180 / PI).toFixed(1)} deg > 25 deg: model accuracy degrades.`);
  if (L0 / h.n < h.dw) warnings.push('Free length shorter than the solid length of the coils (pitch < wire diameter).');
  const S = makeSegment(h, N, { initialTension: p.initialTension, hand: p.springHand });
  const cx = buildContext(p, h, S, base, N);
  const ms = h.mass, M = base.M, g = p.gravity;
  // equilibrium
  const LsEq = new Float64Array(N), psiEq = new Float64Array(N), cum = new Float64Array(N + 1), Phi = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) {
    let load = M; for (let j = i + 1; j <= N; j++) load += (j === N ? ms / (2 * N) : ms / N);
    const [L, ps] = solveSegmentEq(S, g * load);
    LsEq[i] = L; psiEq[i] = ps; cum[i + 1] = cum[i] + L; Phi[i + 1] = Phi[i] + S.sh * ps;
    if (L < S.Lc * 1.0001) warnings.push(`Coil contact at equilibrium in segment ${i + 1}.`);
    if (L > 0.9 * S.l) warnings.push(`Segment ${i + 1} nearly fully extended at equilibrium.`);
  }
  const Lsum = cum[N];
  const cordT = cx.cord ? cx.cordLen + cordStretch(g * M, cx.kcord) : 0;
  const Leq = Lsum + cordT, d = base.d, Req = Leq + d;
  const yawEq = -Phi[N];
  cx.qCeil = qmul(QC, qz(-Phi[N]), [0, 0, 0, 0]);
  const eq = { LsEq, psiEq, cum, Phi, Leq, Lsum, cordT };
  cx.eq = eq;
  const yEq = eqState(cx, eq);
  const parts = energyParts(yEq, cx);
  cx.Eeq = parts.KEphone + parts.KEnodes + parts.U + parts.Vg;
  // tangent stiffness
  let invk = 0; const o = [0, 0, 0], a = [0, 0, 0], b = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    const e1 = 1e-8 * S.l, e2 = 1e-7;
    segmentEnergy(S, LsEq[i] + e1, psiEq[i], a); segmentEnergy(S, LsEq[i] - e1, psiEq[i], b);
    const s11 = (a[1] - b[1]) / (2 * e1), s21 = (a[2] - b[2]) / (2 * e1);
    segmentEnergy(S, LsEq[i], psiEq[i] + e2, a); segmentEnergy(S, LsEq[i], psiEq[i] - e2, b);
    const s22 = (a[2] - b[2]) / (2 * e2);
    invk += 1 / (s11 - s21 * s21 / s22);
  }
  const kTangentEq = 1 / invk;
  const kTangentRef = tangentAtLoad(h, N, p.kRefLoad, g, { initialTension: p.initialTension, hand: p.springHand });
  const lin = linearAnalysis(cx, yEq);
  if (lin.unstable) warnings.push('Linearisation about the hanging equilibrium has a negative eigenvalue (unstable or buckled).');
  // with a cord, tension-only contact events excite the stiff cord/end-node modes; RK4 damps them numerically
  // unless omega*dt is small, so use a smaller step there (measured: drift 1.4e-3 -> 3.5e-5 per 3 s for 4x smaller dt)
  const dt = Math.min(1e-3, (cx.cord ? 0.4 : 1.5) / Math.max(lin.wmax, 1));
  const nodesEq = new Float64Array(3 * (N + 1));
  for (let j = 0; j <= N; j++) nodesEq[3 * j + 2] = -cum[j];
  const mEff = M + ms / 3, mG = M + ms / 2, Lnat = L0 + cx.cordLen;
  const fR = lin.fR, fS = lin.fS;
  const inertia = base.inertia;
  const out = {
    model: 'elastic', M, d, mEff, mG, Lnat, Leq, R0: Lnat + d, staticStretch: Leq - Lnat, Req,
    omegaR: TWO_PI * fR, omegaS: TWO_PI * fS, fR, fS, fS2: lin.fS2, fSy: lin.fSy, fSy2: lin.fSy2,
    fTwist: lin.fTwist, fSurge: lin.fSurge, ratio: fR / (2 * fS), fDeSousa: mG * g / (h.kLin * Req),
    detuningPct: (fR / (2 * fS) - 1) * 100, periodR: 1 / fR, periodS: 1 / fS, inertia,
    wireDiameter: h.dw, activeTurns: h.n, coilDiameter: D, helixAngle0: h.alpha0, wireLength: h.ell, B: h.B, C: h.C,
    kLin: h.kLin, kTangentRef, kLocked: h.kLocked, kTangentEq, kTwist: h.kTwist, couplingWT: h.coupling, springMassModel: ms,
    springKModel: h.kLin, yawEq, LsEq, psiEq, nodesEq, dt, wmax: lin.wmax, fRTextbook: Math.sqrt(h.kLin / mEff) / TWO_PI,
    segments: N, kShear: S.ksh, kBend: S.kb, modes: lin.modes, helix: h, el: cx, warnings,
  };
  return out;
}

// ======================================================================================================
// initial state
// ======================================================================================================
export function createElasticState(p, dv, ini) {
  const cx = dv.el, eq = cx.eq, N = cx.N, nf = cx.nf;
  bindDamping(cx, p);
  const y = new Float64Array(cx.ny), pb = 13 * nf;
  const qa = ini.quat;
  quatMat(qa[0], qa[1], qa[2], qa[3], SYR, 0);
  const yx = SYR[1], yy = SYR[4], yz = SYR[7];
  const wx = SYR[0] * ini.omega[0] + SYR[1] * ini.omega[1] + SYR[2] * ini.omega[2];
  const wy = SYR[3] * ini.omega[0] + SYR[4] * ini.omega[1] + SYR[5] * ini.omega[2];
  const wz = SYR[6] * ini.omega[0] + SYR[7] * ini.omega[1] + SYR[8] * ini.omega[2];
  const q = ini.q, d = cx.d;
  const A = [q[0] + d * yx, q[1] + d * yy, q[2] + d * yz];
  const Ln = Math.hypot(A[0], A[1], A[2]);
  const u = [A[0] / Ln, A[1] / Ln, A[2] / Ln];
  // with a cord the stiff cord stretch must match the tension the stretched spring will carry (else a spurious
  // high-frequency transient is launched): iterate F = W(last segment at scaled length)
  let DN = Ln;
  if (cx.cord) {
    const o3 = [0, 0, 0]; let F = cx.M * cx.g;
    for (let it = 0; it < 8; it++) {
      DN = Math.max(Ln - cx.cordLen - cordStretch(F, cx.kcord), 0.3 * eq.Lsum);
      segmentEnergy(cx.S, eq.LsEq[N - 1] * DN / eq.Lsum, eq.psiEq[N - 1], o3); F = o3[1];
    }
  }
  if (DN < 0.3 * eq.Lsum) DN = 0.3 * eq.Lsum;
  // minimal swing from (0,0,-1) to u
  const sq = [1 - u[2], -(-1) * 0 + (0 * u[2] - (-1) * u[1]) * 0, 0, 0];
  // a x u with a=(0,0,-1): (0*uz - (-1)*uy, (-1)*ux - 0*uz, 0) = (uy, -ux, 0)
  sq[0] = 1 + (-u[2]); sq[1] = u[1]; sq[2] = -u[0]; sq[3] = 0;
  const sn = Math.hypot(sq[0], sq[1], sq[2], sq[3]); for (let i = 0; i < 4; i++) sq[i] /= sn;
  fillSpring(y, cx, eq, DN / eq.Lsum, u, sq);
  y[pb] = q[0] + cx.s1 * yx; y[pb + 1] = q[1] + cx.s1 * yy; y[pb + 2] = q[2] + cx.s1 * yz;
  y[pb + 3] = ini.v[0] + cx.s1 * (wy * yz - wz * yy); y[pb + 4] = ini.v[1] + cx.s1 * (wz * yx - wx * yz); y[pb + 5] = ini.v[2] + cx.s1 * (wx * yy - wy * yx);
  y[pb + 6] = qa[0]; y[pb + 7] = qa[1]; y[pb + 8] = qa[2]; y[pb + 9] = qa[3];
  y[pb + 10] = ini.omega[0]; y[pb + 11] = ini.omega[1]; y[pb + 12] = ini.omega[2];
  const state = { t: 0, q: [0, 0, 0], v: [0, 0, 0], quat: [1, 0, 0, 0], omega: [0, 0, 0], y, model: 'elastic' };
  syncPhone(state, cx);
  return state;
}

export function equilibriumState(dv) { return eqState(dv.el, dv.el.eq); }

// ======================================================================================================
// observables (elastic)
// ======================================================================================================
function wrapPi(a) { const T = TWO_PI; a = a - T * Math.floor((a + PI) / T); return a === -PI ? PI : a; }

export function unwrapYaw(state, R) {
  const now = Math.atan2(R[3], R[0]);
  if (state._yawLast === undefined) { state._yawU = now; }
  else state._yawU += wrapPi(now - state._yawLast);
  state._yawLast = now;
  return state._yawU;
}

export function observablesElastic(state, p, dv) {
  const cx = dv.el, y = state.y, N = cx.N;
  const parts = energyParts(y, cx);
  const [X, Y, Z] = state.q, [vx, vy, vz] = state.v;
  const k = dv.kLin, mEff = dv.mEff, mG = dv.mG, g = p.gravity, Req = dv.Req;
  const ell = Math.sqrt(X * X + Y * Y + Z * Z), ux = X / ell, uy = Y / ell, uz = Z / ell;
  const alpha = Math.atan2(X, -Z), beta = Math.atan2(Y, -Z);
  const alphaDot = (-Z * vx + X * vz) / (X * X + Z * Z), betaDot = (-Z * vy + Y * vz) / (Y * Y + Z * Z);
  const xDotCm = vx * ux + vy * uy + vz * uz;
  const udx = (vx - xDotCm * ux) / ell, udy = (vy - xDotCm * uy) / ell, udz = (vz - xDotCm * uz) / ell;
  const ud2 = udx * udx + udy * udy + udz * udz;
  const Es = 0.5 * mEff * Req * Req * ud2 + mG * g * Req * (1 + uz);
  const quat = [state.quat[0], state.quat[1], state.quat[2], state.quat[3]], omega = [state.omega[0], state.omega[1], state.omega[2]];
  const R = quatMat(quat[0], quat[1], quat[2], quat[3], new Float64Array(9), 0) || null;
  const Rm = new Float64Array(9); quatMat(quat[0], quat[1], quat[2], quat[3], Rm, 0);
  const yx = Rm[1], yy = Rm[4], yz = Rm[7];
  const attach = [X + dv.d * yx, Y + dv.d * yy, Z + dv.d * yz];
  const L = Math.hypot(attach[0], attach[1], attach[2]);
  const ex = attach[0] / L, ey = attach[1] / L, ez = attach[2] / L;
  const wx = Rm[0] * omega[0] + Rm[1] * omega[1] + Rm[2] * omega[2];
  const wy = Rm[3] * omega[0] + Rm[4] * omega[1] + Rm[5] * omega[2];
  const wz = Rm[6] * omega[0] + Rm[7] * omega[1] + Rm[8] * omega[2];
  const vax = vx + dv.d * (wy * yz - wz * yy), vay = vy + dv.d * (wz * yx - wx * yz), vaz = vz + dv.d * (wx * yy - wy * yx);
  const x = L - dv.Leq, xDot = vax * ex + vay * ey + vaz * ez;
  const Er = 0.5 * mEff * xDot * xDot + 0.5 * k * x * x;
  const I = dv.inertia;
  const Erot = 0.5 * (I[0] * omega[0] ** 2 + I[1] * omega[1] ** 2 + I[2] * omega[2] ** 2);
  const Emech = parts.KEphone + parts.KEnodes + parts.U + parts.Vg - cx.Eeq;
  const Ec = Emech - Er - Es - Erot;
  let slack = false;
  if (cx.cord) {
    const o = X; // unused
    const dx = attach[0] - cx.X[3 * N], dy = attach[1] - cx.X[3 * N + 1], dz = attach[2] - cx.X[3 * N + 2];
    slack = Math.hypot(dx, dy, dz) < cx.cordLen;
  }
  const nodes = new Float64Array(3 * (N + 1)), phase = new Float64Array(N + 1);
  let acc = 0, psiSum = 0, psiEqSum = 0;
  for (let i = 0; i <= N; i++) {
    nodes[3 * i] = cx.X[3 * i]; nodes[3 * i + 1] = cx.X[3 * i + 1]; nodes[3 * i + 2] = cx.X[3 * i + 2];
    phase[i] = TWO_PI * cx.S.ns * i + acc;
    if (i < N) { acc += cx.psi[i]; psiSum += cx.psi[i]; psiEqSum += dv.psiEq[i]; }
  }
  const thP = Math.atan2(-yx, yz), thS = Math.atan2(ex, -ez);
  const phP = Math.atan2(-yy, yz), phS = Math.atan2(ey, -ez);
  const tilt = wrapPi(thP - thS), tiltY = wrapPi(phP - phS);
  const sum = Er + Es, partitionR = sum > 1e-14 ? Er / sum : NaN;
  const phiR = Math.atan2(-xDot / dv.omegaR, x), phiS = Math.atan2(-alphaDot / dv.omegaS, alpha);
  const dPhi = wrapPi(phiR - 2 * phiS);
  const ampR = Math.sqrt(x * x + (xDot / dv.omegaR) ** 2), ampS = Math.sqrt(alpha * alpha + (alphaDot / dv.omegaS) ** 2);
  const yaw = unwrapYaw(state, Rm);
  const dist = Math.hypot(cx.X[3 * N], cx.X[3 * N + 1], cx.X[3 * N + 2]);
  return {
    t: state.t, q: [X, Y, Z], v: [vx, vy, vz], ell, x, xDot, alpha, beta, alphaDot, betaDot,
    slack, springLength: dist, Er, Es, Ec, Erel: Er + Es + Ec + Erot, Emech, Erot, partitionR, phiR, phiS, dPhi, ampR, ampS,
    attach, quat, tilt, tiltY, omega,
    spring: { nodes, phase }, yaw, twistTotal: psiSum - psiEqSum,
    EspringKin: parts.KEnodes, EspringEl: parts.U,
  };
}
