// 3D scene module for the elastic-pendulum smartphone simulator.
// Physics frame (+Z up, pivot at origin) -> three: x=X, y=Z, z=-Y. 1 unit = 1 m.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const TRAIL_N = 600;
const CORD_SEG = 24;
const HORN_R = 0.01, HORN_LEN = 0.02, WALL = 0.0026, BUMP_CLEAR = 0.002;
const NUT_T = 0.0065, NUT_AF = 0.013, ROD_R = 0.004, EYE_R = 0.006, EYE_TUBE = 0.0016;
const SPRING_COIL_R = 0.011, SPRING_WIRE_R = 0.00041, SPRING_TURNS = 22;
const SPRING_SIDES = 6, SPRING_PER_TURN = 40, SPRING_MAX_SAMPLES = 1500, SPRING_LEAD = 0.02, SPRING_RAMP = 0.02;

export function createScene(container, options = {}) {
  const showCom = options.showCom !== false;
  let trailEnabled = options.trail !== false;
  let showEq = options.showEquilibrium !== false;

  // ---------- renderer / scene / camera ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.7;

  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x1e293b, 0.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(0.9, 1.2, 1.6);
  sun.target.position.set(0, -0.4, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -1.2, right: 1.2, top: 1.2, bottom: -1.2, near: 0.1, far: 6 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.002;
  scene.add(sun, sun.target);

  // ---------- materials ----------
  const mat = {
    plate: new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.5, roughness: 0.6 }),
    rod: new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.9, roughness: 0.35 }),
    spring: new THREE.MeshStandardMaterial({ color: 0xd6dae0, metalness: 1.0, roughness: 0.22 }),
    cord: new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0, roughness: 0.8 }),
    body: new THREE.MeshStandardMaterial({ color: 0x4b5563, metalness: 0.85, roughness: 0.38 }),
    screen: new THREE.MeshPhysicalMaterial({ color: 0x05070a, metalness: 0.2, roughness: 0.08, clearcoat: 1 }),
    lens: new THREE.MeshStandardMaterial({ color: 0x0a0a0c, metalness: 0.6, roughness: 0.1 }),
    lensRing: new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 1, roughness: 0.3 }),
    bump: new THREE.MeshStandardMaterial({ color: 0x374151, metalness: 0.8, roughness: 0.35 }),
    pla: new THREE.MeshPhysicalMaterial({ color: 0xf97316, roughness: 0.45, transparent: true, opacity: 0.75 }),
    plaSolid: new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xb4bac2, metalness: 1, roughness: 0.32 }),
    stripeF: new THREE.MeshBasicMaterial({ color: 0x22e07a }),
    stripeB: new THREE.MeshBasicMaterial({ color: 0xff3df0 }),
    yawW: new THREE.MeshBasicMaterial({ color: 0xf8fafc }),
    yawO: new THREE.MeshBasicMaterial({ color: 0xff7a00 }),
    com: new THREE.MeshBasicMaterial({ color: 0xf43f5e, transparent: true, opacity: 0.85, depthTest: false }),
    eq: new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.35, depthWrite: false }),
    floor: new THREE.ShadowMaterial({ opacity: 0.35 }),
    start: new THREE.MeshBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.4, depthWrite: false }),
  };

  // ---------- static: ceiling bracket ----------
  const ceiling = new THREE.Group();
  {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.014, 0.16), mat.plate);
    plate.position.y = 0.047; plate.castShadow = true;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.04, 12), mat.rod);
    rod.position.y = 0.02;
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.008, 16), mat.rod);
    collar.position.y = 0.038;
    ceiling.add(plate, rod, collar);
    scene.add(ceiling);
  }

  // ---------- spring: one preallocated tube, updated in place every frame ----------
  mat.spring.color.setHex(0xffffff);
  mat.spring.vertexColors = true;
  const springMesh = new THREE.Mesh(new THREE.BufferGeometry(), mat.spring);
  springMesh.castShadow = true;
  springMesh.frustumCulled = false;
  scene.add(springMesh);
  let SPN = 0;                       // samples (segments) along the centreline
  let spPos, spNor, spCol, spCl, spHp, spRd, spArc, spPh;   // per-sample scratch / attribute arrays
  let spCoilR = SPRING_COIL_R, spWireR = 0.0006, spTurns = SPRING_TURNS;
  let spNodes = new Float64Array(6), spPhase = new Float64Array(2), spCum = new Float64Array(2);
  const spLastNode = [0, 0, 0];
  function allocSpring(turns) {
    spTurns = turns;
    SPN = Math.min(SPRING_MAX_SAMPLES, Math.ceil(turns * SPRING_PER_TURN * 1.15) + 40);
    const nv = (SPN + 1) * SPRING_SIDES;
    spPos = new Float32Array(nv * 3); spNor = new Float32Array(nv * 3); spCol = new Float32Array(nv * 3);
    spCl = new Float64Array((SPN + 1) * 3); spHp = new Float64Array((SPN + 1) * 3); spRd = new Float64Array((SPN + 1) * 3);
    spArc = new Float64Array(SPN + 1); spPh = new Float64Array(SPN + 1);
    const idx = new Uint32Array(SPN * SPRING_SIDES * 6);
    let o = 0;
    for (let k = 0; k < SPN; k++) for (let j = 0; j < SPRING_SIDES; j++) {
      const j1 = (j + 1) % SPRING_SIDES;
      const a = k * SPRING_SIDES + j, b = k * SPRING_SIDES + j1, c = (k + 1) * SPRING_SIDES + j, d = (k + 1) * SPRING_SIDES + j1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
    const g = springMesh.geometry;
    g.dispose();
    g.setAttribute('position', new THREE.BufferAttribute(spPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('normal', new THREE.BufferAttribute(spNor, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(spCol, 3).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
  }
  allocSpring(SPRING_TURNS);

  const smooth01 = x => x * x * (3 - 2 * x);
  // Fill the spring tube from nodes (three frame, 3M) and coil phase (M).
  function buildSpring(nd, ph, M) {
    // centripetal Catmull-Rom (Barry-Goldman) through nodes; samples uniform in chord length
    if (spCum.length < M) spCum = new Float64Array(M);
    let total = 0; spCum[0] = 0;
    for (let i = 0; i < M - 1; i++) {
      total += Math.hypot(nd[3 * i + 3] - nd[3 * i], nd[3 * i + 4] - nd[3 * i + 1], nd[3 * i + 5] - nd[3 * i + 2]) + 1e-12;
      spCum[i + 1] = total;
    }
    let seg = -1, t0 = 0, t1 = 0, t2 = 0, t3 = 0;
    let p0x = 0, p0y = 0, p0z = 0, p1x = 0, p1y = 0, p1z = 0, p2x = 0, p2y = 0, p2z = 0, p3x = 0, p3y = 0, p3z = 0;
    const sq = (ax, ay, az, bx, by, bz) => Math.sqrt(Math.hypot(bx - ax, by - ay, bz - az)) + 1e-6;
    for (let k = 0; k <= SPN; k++) {
      const s = total * k / SPN;
      let i = seg < 0 ? 0 : seg;
      while (i < M - 2 && s > spCum[i + 1]) i++;
      if (i !== seg) {
        seg = i;
        p1x = nd[3 * i]; p1y = nd[3 * i + 1]; p1z = nd[3 * i + 2];
        p2x = nd[3 * i + 3]; p2y = nd[3 * i + 4]; p2z = nd[3 * i + 5];
        if (i > 0) { p0x = nd[3 * i - 3]; p0y = nd[3 * i - 2]; p0z = nd[3 * i - 1]; }
        else { p0x = 2 * p1x - p2x; p0y = 2 * p1y - p2y; p0z = 2 * p1z - p2z; }
        if (i + 2 < M) { p3x = nd[3 * i + 6]; p3y = nd[3 * i + 7]; p3z = nd[3 * i + 8]; }
        else { p3x = 2 * p2x - p1x; p3y = 2 * p2y - p1y; p3z = 2 * p2z - p1z; }
        t0 = 0; t1 = sq(p0x, p0y, p0z, p1x, p1y, p1z); t2 = t1 + sq(p1x, p1y, p1z, p2x, p2y, p2z); t3 = t2 + sq(p2x, p2y, p2z, p3x, p3y, p3z);
      }
      const cs = spCum[i + 1] - spCum[i];
      const u = Math.min(Math.max((s - spCum[i]) / cs, 0), 1);
      const t = t1 + u * (t2 - t1);
      const a1 = (t1 - t) / (t1 - t0), a1b = 1 - a1;
      const a2 = (t2 - t) / (t2 - t1), a2b = 1 - a2;
      const a3 = (t3 - t) / (t3 - t2), a3b = 1 - a3;
      const b1 = (t2 - t) / (t2 - t0), b1b = 1 - b1;
      const b2 = (t3 - t) / (t3 - t1), b2b = 1 - b2;
      const A1x = a1 * p0x + a1b * p1x, A1y = a1 * p0y + a1b * p1y, A1z = a1 * p0z + a1b * p1z;
      const A2x = a2 * p1x + a2b * p2x, A2y = a2 * p1y + a2b * p2y, A2z = a2 * p1z + a2b * p2z;
      const A3x = a3 * p2x + a3b * p3x, A3y = a3 * p2y + a3b * p3y, A3z = a3 * p2z + a3b * p3z;
      const B1x = b1 * A1x + b1b * A2x, B1y = b1 * A1y + b1b * A2y, B1z = b1 * A1z + b1b * A2z;
      const B2x = b2 * A2x + b2b * A3x, B2y = b2 * A2y + b2b * A3y, B2z = b2 * A2z + b2b * A3z;
      spCl[3 * k] = a2 * B1x + a2b * B2x; spCl[3 * k + 1] = a2 * B1y + a2b * B2y; spCl[3 * k + 2] = a2 * B1z + a2b * B2z;
      spPh[k] = ph[i] * (1 - u) + ph[i + 1] * u;
    }
    // arc length
    spArc[0] = 0;
    for (let k = 1; k <= SPN; k++)
      spArc[k] = spArc[k - 1] + Math.hypot(spCl[3 * k] - spCl[3 * k - 3], spCl[3 * k + 1] - spCl[3 * k - 2], spCl[3 * k + 2] - spCl[3 * k - 1]);
    const A = spArc[SPN];
    // parallel transport frame -> helix points + radial directions
    let nx = 1, ny = 0, nz = 0;
    for (let k = 0; k <= SPN; k++) {
      const ka = Math.max(k - 1, 0), kb = Math.min(k + 1, SPN);
      let tx = spCl[3 * kb] - spCl[3 * ka], ty = spCl[3 * kb + 1] - spCl[3 * ka + 1], tz = spCl[3 * kb + 2] - spCl[3 * ka + 2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let dn = nx * tx + ny * ty + nz * tz;
      nx -= dn * tx; ny -= dn * ty; nz -= dn * tz;
      let nl = Math.hypot(nx, ny, nz);
      if (nl < 1e-6) { nx = 0; ny = 0; nz = 1; dn = nz * tz; nx -= dn * tx; ny -= dn * ty; nz -= dn * tz; nl = Math.hypot(nx, ny, nz) || 1; }
      nx /= nl; ny /= nl; nz /= nl;
      const bx = ty * nz - tz * ny, by = tz * nx - tx * nz, bz = tx * ny - ty * nx;
      const a = spArc[k];
      const x1 = Math.min(Math.max((a - SPRING_LEAD) / SPRING_RAMP, 0), 1), x2 = Math.min(Math.max((A - a - SPRING_LEAD) / SPRING_RAMP, 0), 1);
      const r = spCoilR * smooth01(Math.min(x1, x2));
      const cp = Math.cos(spPh[k]), sp = Math.sin(spPh[k]);
      const rx = cp * nx + sp * bx, ry = cp * ny + sp * by, rz = cp * nz + sp * bz;
      spRd[3 * k] = rx; spRd[3 * k + 1] = ry; spRd[3 * k + 2] = rz;
      spHp[3 * k] = spCl[3 * k] + r * rx; spHp[3 * k + 1] = spCl[3 * k + 1] + r * ry; spHp[3 * k + 2] = spCl[3 * k + 2] + r * rz;
    }
    // tube around the helix curve (ring frame: radial dir orthogonalised against helix tangent)
    const w = spWireR;
    for (let k = 0; k <= SPN; k++) {
      const ka = Math.max(k - 1, 0), kb = Math.min(k + 1, SPN);
      let tx = spHp[3 * kb] - spHp[3 * ka], ty = spHp[3 * kb + 1] - spHp[3 * ka + 1], tz = spHp[3 * kb + 2] - spHp[3 * ka + 2];
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      let rx = spRd[3 * k], ry = spRd[3 * k + 1], rz = spRd[3 * k + 2];
      const dn = rx * tx + ry * ty + rz * tz;
      rx -= dn * tx; ry -= dn * ty; rz -= dn * tz;
      const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
      const bx = ty * rz - tz * ry, by = tz * rx - tx * rz, bz = tx * ry - ty * rx;
      // marker paint where the coil angle passes phi = 0 (shows twist as a sideways shift of the dots)
      const c = Math.cos(spPh[k]);
      const m = c > 0.9 ? smooth01(Math.min((c - 0.9) / 0.07, 1)) : 0;
      const cr = 0.84 + 0.16 * m, cg = 0.86 - 0.66 * m, cb = 0.88 - 0.68 * m;
      for (let j = 0; j < SPRING_SIDES; j++) {
        const th = (j / SPRING_SIDES) * 6.283185307179586, ct = Math.cos(th), st = Math.sin(th);
        const ox = ct * rx + st * bx, oy = ct * ry + st * by, oz = ct * rz + st * bz;
        const v = (k * SPRING_SIDES + j) * 3;
        spPos[v] = spHp[3 * k] + w * ox; spPos[v + 1] = spHp[3 * k + 1] + w * oy; spPos[v + 2] = spHp[3 * k + 2] + w * oz;
        spNor[v] = ox; spNor[v + 1] = oy; spNor[v + 2] = oz;
        spCol[v] = cr; spCol[v + 1] = cg; spCol[v + 2] = cb;
      }
    }
    const g = springMesh.geometry.attributes;
    g.position.needsUpdate = true; g.normal.needsUpdate = true; g.color.needsUpdate = true;
  }
  const spStats = { n: 0, ms: 0 };

  // ---------- cord (instanced segments) ----------
  const cordGeo = new THREE.CylinderGeometry(0.0012, 0.0012, 1, 6, 1, true);
  const cordMesh = new THREE.InstancedMesh(cordGeo, mat.cord, CORD_SEG);
  cordMesh.frustumCulled = false;
  cordMesh.castShadow = true;
  scene.add(cordMesh);

  // ---------- phone group ----------
  const phoneGroup = new THREE.Group();
  const phoneParts = new THREE.Group();   // rebuilt on rebuild()
  phoneGroup.add(phoneParts);
  scene.add(phoneGroup);

  const comMarker = new THREE.Mesh(new THREE.SphereGeometry(0.006, 16, 12), mat.com);
  comMarker.renderOrder = 10;
  comMarker.visible = showCom;
  scene.add(comMarker);

  // ---------- equilibrium ghost ----------
  const eqGroup = new THREE.Group();
  eqGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.008, 16, 12), mat.eq));
  const eqRing = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.0015, 8, 40), mat.eq);
  eqRing.rotation.x = Math.PI / 2;
  eqGroup.add(eqRing);
  eqGroup.visible = showEq;
  scene.add(eqGroup);

  // ---------- environment: floor ----------
  const floorGroup = new THREE.Group();
  const grid = new THREE.GridHelper(2.4, 48, 0x475569, 0x1e293b);
  const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), mat.floor);
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = 0.0005;
  shadowPlane.receiveShadow = true;
  const axes = new THREE.AxesHelper(0.1);
  axes.position.set(-1.1, 0.001, 1.1);
  floorGroup.add(grid, shadowPlane, axes);
  scene.add(floorGroup);

  // ---------- trail ----------
  const trailPos = new Float32Array(TRAIL_N * 3);
  const trailCol = new Float32Array(TRAIL_N * 3);
  {
    const c0 = new THREE.Color(0x0f172a), c1 = new THREE.Color(0x38bdf8), c = new THREE.Color();
    for (let i = 0; i < TRAIL_N; i++) {
      c.copy(c0).lerp(c1, Math.pow(i / (TRAIL_N - 1), 1.3));
      trailCol.set([c.r, c.g, c.b], i * 3);
    }
  }
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3).setUsage(THREE.DynamicDrawUsage));
  trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
  trailGeo.setDrawRange(TRAIL_N, 0);
  const trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true }));
  trailLine.frustumCulled = false;
  trailLine.visible = trailEnabled;
  scene.add(trailLine);
  let trailCount = 0;

  // ---------- start marker ----------
  const startMarker = new THREE.Group();
  startMarker.add(new THREE.Mesh(new THREE.SphereGeometry(0.007, 12, 8), mat.start));
  const startRing = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.0012, 8, 40), mat.start);
  startRing.rotation.x = Math.PI / 2;
  startMarker.add(startRing);
  startMarker.visible = false;
  scene.add(startMarker);

  // ---------- state ----------
  let P = null, D = null;       // params, derived
  let floorY = -0.6;
  let built = false;

  // scratch objects
  const vE = new THREE.Vector3(), vU = new THREE.Vector3(), vN = new THREE.Vector3(), vX = new THREE.Vector3();
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), vP0 = new THREE.Vector3(), vP1 = new THREE.Vector3();
  const vD = new THREE.Vector3(), vM = new THREE.Vector3(), vS = new THREE.Vector3();
  const mBasis = new THREE.Matrix4(), qq = new THREE.Quaternion();
  const Y_AXIS = new THREE.Vector3(0, 1, 0), Z_AXIS = new THREE.Vector3(0, 0, 1), X_AXIS = new THREE.Vector3(1, 0, 0);
  const dummy = new THREE.Object3D();

  function disposeGroup(g) {
    for (const ch of [...g.children]) {
      g.remove(ch);
      ch.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
    }
  }
  function mk(geo, material, x = 0, y = 0, z = 0, shadow = true) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    return m;
  }

  // ---------- rebuild ----------
  function rebuild(params, derived) {
    P = params || P || {};
    D = derived || D || {};
    built = true;
    disposeGroup(phoneParts);
    {
      const turns = Math.max(1, D.activeTurns ?? SPRING_TURNS);
      spCoilR = (D.coilDiameter ?? 2 * SPRING_COIL_R) / 2;
      spWireR = Math.max((D.wireDiameter ?? 0.00082) / 2, 0.0006);
      if (Math.abs(turns - spTurns) > 1e-9) allocSpring(turns);
    }

    const L = P.phoneLength ?? 0.15, W = P.phoneWidth ?? 0.07, T = P.phoneThickness ?? 0.008;
    const h = L / 2;
    const attOff = P.attachmentOffset ?? 0;
    const nuts = Math.max(0, Math.round(P.nutsPerSide ?? 0));
    const hasCase = (P.caseMass ?? 0) > 0 || attOff > 0 || nuts > 0;
    const d = D.d ?? (h + attOff);
    const Req = D.Req ?? (P.springL0 ?? 0.19) + 0.1;

    // phone body
    const rad = Math.min(0.008, T * 0.45);
    phoneParts.add(mk(new RoundedBoxGeometry(W, L, T, 3, rad), mat.body));
    const screen = mk(new RoundedBoxGeometry(W - 0.004, L - 0.004, 0.0008, 2, 0.0003), mat.screen, 0, 0, T / 2, false);
    phoneParts.add(screen);
    // camera bump (back = -z)
    const bw = Math.min(0.036, W * 0.5), bh = Math.min(0.04, L * 0.28), bd = 0.0016;
    const bx = -W / 2 + bw / 2 + 0.008, by = h - bh / 2 - 0.008;
    phoneParts.add(mk(new RoundedBoxGeometry(bw, bh, bd * 2, 2, 0.0008), mat.bump, bx, by, -T / 2 - bd * 0.5));
    const lr = Math.min(0.0085, bw * 0.3);
    for (let k = 0; k < 2; k++) {
      const ly = by + (k ? -1 : 1) * bh * 0.22;
      const ring = mk(new THREE.CylinderGeometry(lr, lr, 0.0008, 24), mat.lensRing, bx, ly, -T / 2 - bd - 0.0003, false);
      ring.rotation.x = Math.PI / 2;
      const lens = mk(new THREE.CylinderGeometry(lr * 0.75, lr * 0.75, 0.0012, 24), mat.lens, bx, ly, -T / 2 - bd - 0.0004, false);
      lens.rotation.x = Math.PI / 2;
      phoneParts.add(ring, lens);
    }

    // twist markers: offset stripes on screen (green) and back (magenta), asymmetric so a half-turn is obvious
    {
      const sw = 0.007, sl = L * 0.8, sx = W * 0.22;
      phoneParts.add(mk(new THREE.BoxGeometry(sw, sl, 0.0006), mat.stripeF, sx, 0, T / 2 + 0.0009, false));
      phoneParts.add(mk(new THREE.BoxGeometry(sw, sl, 0.0006), mat.stripeB, sx, 0, -T / 2 - 0.0009, false));
    }

    let topExtent = h, bottomExtent = h, eyeY = d;
    if (hasCase) {
      const w = WALL;
      const zFront = T / 2 + 0.001, zBack = -T / 2 - BUMP_CLEAR, D_ = zFront - zBack, zc = (zFront + zBack) / 2;
      const rb = (x, y, z) => new RoundedBoxGeometry(x, y, z, 2, Math.min(0.001, Math.min(x, y, z) * 0.45));
      phoneParts.add(mk(rb(W + 2 * w, L + 2 * w, w), mat.pla, 0, 0, zBack - w / 2));
      for (const s of [-1, 1]) {
        phoneParts.add(mk(rb(w, L + 2 * w, D_), mat.pla, s * (W / 2 + w / 2), 0, zc));
        phoneParts.add(mk(rb(W, w, D_), mat.pla, 0, s * (h + w / 2), zc));
      }
      const hornTip = h + w + HORN_LEN;
      for (const s of [-1, 1]) {
        phoneParts.add(mk(new THREE.CylinderGeometry(HORN_R, HORN_R, HORN_LEN, 32), mat.plaSolid, 0, s * (h + w + HORN_LEN / 2), 0));
      }
      const stack = nuts * NUT_T;
      // top: eyebolt
      eyeY = d;   // the eye sits exactly at the physics attachment point
      const shankLen = Math.max(eyeY - EYE_R - hornTip + 0.002, 0.004);
      phoneParts.add(mk(new THREE.CylinderGeometry(ROD_R, ROD_R, shankLen, 16), mat.steel, 0, hornTip - 0.002 + shankLen / 2, 0));
      const eye = mk(new THREE.TorusGeometry(EYE_R, EYE_TUBE, 10, 28), mat.steel, 0, eyeY, 0);
      phoneParts.add(eye);
      // bottom: threaded rod
      const rodLen = stack + 0.012;
      phoneParts.add(mk(new THREE.CylinderGeometry(ROD_R, ROD_R, rodLen, 16), mat.steel, 0, -(hornTip - 0.002 + rodLen / 2), 0));
      topExtent = Math.max(eyeY + EYE_R, hornTip);
      // yaw pointer: flat bar through the attachment eye, orange arrow tip on body +x, white tip on -x
      const pw = W / 2 + 0.035;
      phoneParts.add(mk(new THREE.BoxGeometry(2 * pw, 0.004, 0.0025), mat.yawW, 0, eyeY - 0.012, 0, false));
      const tip = mk(new THREE.ConeGeometry(0.008, 0.02, 12), mat.yawO, pw + 0.008, eyeY - 0.012, 0, false);
      tip.rotation.z = -Math.PI / 2;
      phoneParts.add(tip);
      bottomExtent = hornTip + rodLen;
      // nuts
      if (nuts > 0) {
        const r = NUT_AF / Math.sqrt(3);
        const geo = new THREE.CylinderGeometry(r, r, NUT_T * 0.98, 6, 1);
        const im = new THREE.InstancedMesh(geo, mat.steel, nuts * 2);
        im.castShadow = true;
        let n = 0;
        for (const s of [1, -1]) for (let i = 0; i < nuts; i++) {
          dummy.position.set(0, s * (hornTip + NUT_T * (i + 0.5)), 0);
          dummy.rotation.set(0, i * 0.35 + (s > 0 ? 0 : 0.5), 0);
          dummy.updateMatrix();
          im.setMatrixAt(n++, dummy.matrix);
        }
        im.instanceMatrix.needsUpdate = true;
        phoneParts.add(im);
      }
    }
    phoneParts.userData = { d, eyeY, topExtent, bottomExtent, hasCase };

    // floor
    floorY = -(Req + L / 2 + 0.2);
    floorGroup.position.y = floorY;
    eqGroup.position.set(0, -Req, 0);
    sun.target.position.set(0, floorY / 2, 0);
    if (!userMovedCamera) resetCamera();
  }

  let userMovedCamera = false;
  controls.addEventListener('start', () => { userMovedCamera = true; });

  // ---------- update ----------
  function update(frame) {
    if (!built) rebuild(frame.params, frame.derived);
    const q = frame.q;
    const X = q[0], Y = q[1], Z = q[2];
    const tx = X, ty = Z, tz = -Y;
    const len = Math.hypot(tx, ty, tz);
    if (len > 1e-9) vE.set(tx / len, ty / len, tz / len); else vE.set(0, -1, 0);
    const ell = frame.ell ?? len;
    const d = phoneParts.userData.d ?? (D?.d ?? 0.075);
    const springLength = frame.springLength ?? 0.2;

    // phone orientation
    const qt = frame.quat;
    if (qt && qt.length >= 4) {
      // body->world rotation columns (physics frame), each mapped (x,y,z)->(x,z,-y)
      const w = qt[0], x = qt[1], y = qt[2], z = qt[3];
      vX.set(1 - 2 * (y * y + z * z), 2 * (x * z - w * y), -2 * (x * y + w * z));
      vU.set(2 * (x * y - w * z), 2 * (y * z + w * x), -(1 - 2 * (x * x + z * z)));
      vN.set(2 * (x * z + w * y), 1 - 2 * (x * x + y * y), -2 * (y * z - w * x));
    } else {
      // v1 fallback: local +y = toward pivot (-e_r), local +z (screen) toward world +z
      vU.copy(vE).negate();
      vN.copy(Z_AXIS).addScaledVector(vU, -Z_AXIS.dot(vU));
      if (vN.lengthSq() < 1e-6) vN.copy(X_AXIS).addScaledVector(vU, -X_AXIS.dot(vU));
      vN.normalize();
      vX.crossVectors(vU, vN);
    }
    mBasis.makeBasis(vX, vU, vN);
    phoneGroup.quaternion.setFromRotationMatrix(mBasis);
    phoneGroup.position.set(tx, ty, tz);
    comMarker.position.set(tx, ty, tz);

    // attachment point (three frame)
    const at = frame.attach;
    if (at && at.length >= 3) vB.set(at[0], at[2], -at[1]);
    else vB.copy(vE).multiplyScalar(ell - d);
    const aLen = vB.length();
    if (aLen > 1e-9) vE.copy(vB).multiplyScalar(1 / aLen);   // spring direction: pivot -> attach

    // spring tube
    {
      const t0p = performance.now();
      const fs = frame.spring;
      let M, nd, ph;
      if (fs && fs.nodes && fs.nodes.length >= 6) {
        M = fs.nodes.length / 3;
        if (spNodes.length < 3 * M) spNodes = new Float64Array(3 * M);
        const src = fs.nodes;
        for (let i = 0; i < M; i++) { spNodes[3 * i] = src[3 * i]; spNodes[3 * i + 1] = src[3 * i + 2]; spNodes[3 * i + 2] = -src[3 * i + 1]; }
        nd = spNodes; ph = fs.phase;
        if (!ph || ph.length < M) { spPhase = new Float64Array(M); for (let i = 0; i < M; i++) spPhase[i] = (i / (M - 1)) * spTurns * 6.283185307179586; ph = spPhase; }
      } else {
        M = 2;
        spNodes[0] = spNodes[1] = spNodes[2] = 0;
        spNodes[3] = vE.x * springLength; spNodes[4] = vE.y * springLength; spNodes[5] = vE.z * springLength;
        spPhase[0] = 0; spPhase[1] = spTurns * 6.283185307179586;
        nd = spNodes; ph = spPhase;
      }
      spLastNode[0] = nd[3 * M - 3]; spLastNode[1] = nd[3 * M - 2]; spLastNode[2] = nd[3 * M - 1];
      buildSpring(nd, ph, M);
      spStats.ms += performance.now() - t0p; spStats.n++;
    }

    // cord: spring lower end -> attach
    const Lc = (frame.params?.cordLength ?? P?.cordLength ?? 0);
    if (Lc > 1e-6) {
      cordMesh.visible = true;
      vA.set(spLastNode[0], spLastNode[1], spLastNode[2]);
      vD.subVectors(vB, vA);
      const chord = vD.length();
      let sag = 0;
      if (Lc > chord && chord > 1e-6) sag = Math.min(Math.sqrt(3 * chord * (Lc - chord) / 8), 0.15);
      else if (chord <= 1e-6) sag = Math.min(Lc * 0.35, 0.15);
      vM.addVectors(vA, vB).multiplyScalar(0.5);
      vS.set(0, -1, 0);
      if (chord > 1e-6) {
        const k = vS.dot(vD) / chord;
        vS.x -= k * vD.x / chord; vS.y -= k * vD.y / chord; vS.z -= k * vD.z / chord;
        if (vS.lengthSq() < 0.05) { // chord almost vertical: sag toward camera (+z) instead
          vS.copy(Z_AXIS);
          const k2 = vS.dot(vD) / chord;
          vS.x -= k2 * vD.x / chord; vS.y -= k2 * vD.y / chord; vS.z -= k2 * vD.z / chord;
        }
        vS.normalize();
      }
      vC.copy(vM).addScaledVector(vS, 2 * sag);
      vP0.copy(vA);
      for (let i = 0; i < CORD_SEG; i++) {
        const t = (i + 1) / CORD_SEG, u = 1 - t;
        vP1.set(
          u * u * vA.x + 2 * u * t * vC.x + t * t * vB.x,
          u * u * vA.y + 2 * u * t * vC.y + t * t * vB.y,
          u * u * vA.z + 2 * u * t * vC.z + t * t * vB.z);
        vS.subVectors(vP1, vP0);
        const sl = vS.length();
        dummy.position.addVectors(vP0, vP1).multiplyScalar(0.5);
        if (sl > 1e-9) dummy.quaternion.setFromUnitVectors(Y_AXIS, vS.multiplyScalar(1 / sl));
        dummy.scale.set(1, Math.max(sl, 1e-6), 1);
        dummy.updateMatrix();
        cordMesh.setMatrixAt(i, dummy.matrix);
        vP0.copy(vP1);
      }
      cordMesh.instanceMatrix.needsUpdate = true;
      dummy.scale.set(1, 1, 1);
    } else {
      cordMesh.visible = false;
    }

    // trail
    if (trailEnabled) {
      const o = (TRAIL_N - 1) * 3;
      if (trailCount === 0 ||
        Math.abs(trailPos[o] - tx) + Math.abs(trailPos[o + 1] - ty) + Math.abs(trailPos[o + 2] - tz) > 4e-4) {
        trailPos.copyWithin(0, 3);
        trailPos[o] = tx; trailPos[o + 1] = ty; trailPos[o + 2] = tz;
        if (trailCount < TRAIL_N) trailCount++;
        trailGeo.setDrawRange(TRAIL_N - trailCount, trailCount);
        trailGeo.attributes.position.needsUpdate = true;
      }
    }

    controls.update();
    renderer.render(scene, camera);
  }

  // ---------- camera ----------
  function resetCamera() {
    // Frame pivot -> just below the phone (not the whole floor gap), so the phone is big enough to grab.
    const top = 0.06, bottom = floorY + 0.14, H = top - bottom;
    const cy = (top + bottom) / 2;
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const distV = (H / 2 * 1.08) / Math.tan(fov / 2);
    const distH = (0.5 / 2) / (Math.tan(fov / 2) * camera.aspect);
    const dist = Math.max(distV, distH);
    controls.target.set(0, cy, 0);
    vS.set(0.45, 0.22, 1).normalize();
    camera.position.copy(controls.target).addScaledVector(vS, dist);
    camera.near = 0.01; camera.far = 50;
    camera.updateProjectionMatrix();
    controls.update();
    userMovedCamera = false;
  }

  function resize() {
    const w = Math.max(container.clientWidth, 1), h = Math.max(container.clientHeight, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, true);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!userMovedCamera && built) resetCamera();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(container);
  resize();
  resetCamera();

  // ---------- drag-to-place ----------
  let handlers = {}, placementEnabled = true, dragging = false, hovering = false, dragPointer = -1;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const plane = new THREE.Plane();
  const pHit = new THREE.Vector3(), pOff = new THREE.Vector3(), pTgt = new THREE.Vector3(), pDir = new THREE.Vector3();
  const qOut = [0, 0, 0];
  const el = renderer.domElement;
  el.style.touchAction = 'none';

  function setRay(e) {
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  }
  const pScr = new THREE.Vector3();
  const GRAB_RADIUS_PX = 36; // generous grab area around the COM (phone is thin, especially on touch screens)
  function overPhone(e) {
    setRay(e);
    phoneGroup.updateMatrixWorld(true);
    if (raycaster.intersectObject(phoneParts, true).length > 0) return true;
    const r = el.getBoundingClientRect();
    pScr.copy(phoneGroup.position).project(camera);
    const sx = (pScr.x + 1) / 2 * r.width + r.left, sy = (1 - pScr.y) / 2 * r.height + r.top;
    return Math.hypot(e.clientX - sx, e.clientY - sy) < GRAB_RADIUS_PX;
  }
  function setHover(on) {
    if (on === hovering) return;
    hovering = on;
    const em = on ? 0x1e3a5f : 0x000000;
    mat.body.emissive.setHex(em); mat.pla.emissive.setHex(on ? 0x5a2a05 : 0x000000);
    mat.plaSolid.emissive.setHex(on ? 0x5a2a05 : 0x000000);
  }
  function onDown(e) {
    if (!placementEnabled || dragging || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (!overPhone(e)) return;
    camera.getWorldDirection(pDir);
    plane.setFromNormalAndCoplanarPoint(pDir, phoneGroup.position);
    if (!raycaster.ray.intersectPlane(plane, pHit)) return;
    pOff.subVectors(phoneGroup.position, pHit);
    dragging = true; dragPointer = e.pointerId;
    controls.enabled = false;
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    el.style.cursor = 'grabbing';
    e.stopPropagation(); e.preventDefault();
    handlers.onStart && handlers.onStart();
  }
  function dragPos(e) {
    setRay(e);
    if (!raycaster.ray.intersectPlane(plane, pHit)) return false;
    pTgt.addVectors(pHit, pOff);
    // clamp in physics frame: X=x, Y=-z, Z=y
    let X = pTgt.x, Y = -pTgt.z, Z = Math.min(pTgt.y, -0.05);
    const Rmax = 1.5 * (D?.Req ?? 0.3);
    const r = Math.hypot(X, Y, Z);
    if (r > Rmax) { const k = Rmax / r; X *= k; Y *= k; Z *= k; }
    qOut[0] = X; qOut[1] = Y; qOut[2] = Z;
    return true;
  }
  function onMove(e) {
    if (dragging) {
      if (e.pointerId !== dragPointer) return;
      if (dragPos(e) && handlers.onDrag) handlers.onDrag(qOut.slice());
      e.preventDefault();
    } else if (placementEnabled && e.pointerType !== 'touch') {
      const on = overPhone(e);
      setHover(on);
      el.style.cursor = on ? 'grab' : '';
    }
  }
  function endDrag(e, cancel) {
    if (!dragging || e.pointerId !== dragPointer) return;
    dragging = false; dragPointer = -1;
    controls.enabled = true;
    try { el.releasePointerCapture(e.pointerId); } catch (_) {}
    el.style.cursor = hovering ? 'grab' : '';
    if (!cancel) dragPos(e);
    handlers.onEnd && handlers.onEnd(qOut.slice());
  }
  const onUp = e => endDrag(e, false), onCancel = e => endDrag(e, true);
  container.addEventListener('pointerdown', onDown, true);   // capture: runs before OrbitControls
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onCancel);
  el.addEventListener('pointerleave', () => { if (!dragging) { setHover(false); el.style.cursor = ''; } });

  function setPlacementHandlers(h) { handlers = h || {}; }
  function setPlacementEnabled(b) {
    placementEnabled = !!b;
    if (!placementEnabled) { setHover(false); el.style.cursor = ''; }
  }
  function setStartMarker(qp) {
    if (!qp) { startMarker.visible = false; return; }
    startMarker.position.set(qp[0], qp[2], -qp[1]);
    startMarker.visible = true;
  }

  function setTrail(enabled) {
    trailEnabled = !!enabled;
    trailLine.visible = trailEnabled;
  }
  function clearTrail() {
    trailCount = 0;
    trailGeo.setDrawRange(TRAIL_N, 0);
  }
  function setShowEquilibrium(enabled) { showEq = !!enabled; eqGroup.visible = showEq; }

  function dispose() {
    if (ro) ro.disconnect();
    controls.dispose();
    container.removeEventListener('pointerdown', onDown, true);
    disposeGroup(phoneParts);
    scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    Object.values(mat).forEach(m => m.dispose());
    envTex.dispose(); pmrem.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  return { update, rebuild, resize, resetCamera, setTrail, clearTrail, setShowEquilibrium, setPlacementHandlers, setPlacementEnabled, setStartMarker, dispose, springStats: spStats };
}
