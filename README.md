# Smartphone Elastic Pendulum — 3D Simulator

**Live:** https://kairi99.github.io/parametricResonance-sim/

A browser-based 3D simulator of a smartphone hanging from a coil spring (optionally via a cord, optionally in a 3D-printed case whose horns carry M8 nut ballast). The bounce (radial) and swing modes are coupled; at f_r = 2 f_s (de Sousa parameter f = 0.25) energy flows back and forth between bouncing and swinging (2:1 autoparametric resonance). Live charts show the displacements, the energy exchange E_r / E_s / E_c, the horizontal footprint and resonance diagnostics.

Three selectable models (a discretised **elastic helical spring** with the rigid phone — the most realistic and the default —, the rigid body on an ideal spring, or the point-mass model of the methods document), a nonlinear simulation-based **resonance search**, and drag-to-place start positions. The help dialog (?) contains the equations of motion (KaTeX) and the real-time algorithm.

Plain ES modules, no build step. Three.js is loaded from jsDelivr through an import map (internet needed).

## Run locally

```sh
cd simulator
python3 tools/serve.py 8000
# open http://localhost:8000/   (?lang=es for Spanish)
```

ES modules do not load from `file://`, so a server is needed. `tools/serve.py` is a static server that disables browser caching. With plain `python3 -m http.server` the browser may keep old copies of some modules after an edit and fail with errors such as "setLabels is not a function"; if that happens, hard-reload (Ctrl+Shift+R). The server listens on all interfaces, so a phone on the same Wi-Fi can open `http://<computer-ip>:8000/`.

## Deploy to GitHub Pages

The site is plain static files (no build step). "Deploy from a branch" can only publish the repository root or a `/docs` folder, so pick one of:

1. **Simplest — dedicated repo:** make the *contents* of `simulator/` the root of a new repository (e.g. `elastic-pendulum-sim`), push, then Settings → Pages → Source: "Deploy from a branch" → `main` / `/ (root)`. URL: `https://<user>.github.io/elastic-pendulum-sim/`.
2. **Inside a larger repo:** rename/copy `simulator/` to `docs/`, then Settings → Pages → `main` / `/docs`.
3. **Keep the `simulator/` folder name:** Settings → Pages → Source: "GitHub Actions", and add a workflow that uploads `simulator/` with `actions/upload-pages-artifact` (`path: simulator`) followed by `actions/deploy-pages`.

`.nojekyll` is already present, and all paths are relative, so the site works from any sub-path. Three.js is loaded from the jsDelivr CDN, so the page needs internet access.

### Auto-sync (how the live site is published)

The live site is option 1: the public repo `kairi99/parametricResonance-sim` holds a copy of this folder and serves it with Pages. **Edit the simulator in the private repo's `simulator/` folder only** — the workflow `.github/workflows/sync-simulator.yml` runs on every push to `main` that touches `simulator/`, runs the physics tests, and (only if they pass) mirrors the folder into the public repo, which republishes the site within about a minute. Changes made directly in the public repo are overwritten by the next sync. The published copy is stamped with `node tools/stamp-version.mjs <dir> <short-sha>`, which appends `?v=<sha>` to every module, worker, fetch and stylesheet URL so returning visitors never combine cached files from two releases (the source stays unstamped; do the same when syncing by hand). It can also be run by hand from the Actions tab ("Run workflow").

One-time setup (a write deploy key on the public repo, its private half as the secret `SIM_DEPLOY_KEY` in the private repo):

```sh
ssh-keygen -t ed25519 -N "" -C "parametricResonance sync" -f /tmp/sim_sync_key
gh repo deploy-key add /tmp/sim_sync_key.pub -R kairi99/parametricResonance-sim --allow-write --title "sync from parametricResonance"
gh secret set SIM_DEPLOY_KEY -R kairi99/parametricResonance < /tmp/sim_sync_key
rm -f /tmp/sim_sync_key /tmp/sim_sync_key.pub
```

Until the secret exists the workflow skips with a notice instead of failing.

## Chart ruler

Click two points on the first chart or the energy chart to read the time between them (Δt, bottom right); each click snaps to the nearest crest or trough of the first series (interpolated between samples), and a third click starts over. Pause first for the easiest reading; *Chart window* (down to 2 s) zooms the time axis.

"Pure bounce" starts exactly vertical, so the swing never starts by itself (an unstable equilibrium with no disturbance). "Bounce + nudge" adds the 0.5° swing seed that the energy-exchange experiments need; the nonlinear resonance search adds the same seed automatically when the start has no swing.

## Guided tasks

The **Learn / Aprender** button in the top bar opens a panel of guided tasks (English or Spanish; the ES/EN switch in the top bar translates the whole simulator, `?lang=es|en` sets it from a link). Each task follows **Predict, Act, Observe, Explain**: lock in a prediction (a number or one option), press *Set up the simulator* (loads the task's model, preset and start condition) and do what the task asks; the task completes by itself when the simulator reaches the target state. Then compare your prediction with the measured or expected value and write your own explanation. An optional hint can be opened while predicting or acting; the report records whether (and at which step) it was used. The student must submit their own explanation, which then locks, before the model explanation and the teacher note are shown.

Progress, predictions and explanations are kept in the browser (`localStorage`, key `pr-learn-v1`); the student name is stored separately. *Download report* saves a printable HTML summary and *Reset all* clears everything. Open a task directly with `?learn=<taskId>` (or `?learn=1` for the list). On narrow screens the panel is a bottom sheet that can be closed with the x button.

Code lives in `js/learn/`: `panel.js` (UI), `engine.js` (state machine and report), `probes.js` (running measurements), `i18n.js`, `tasks.js` (task definitions). The panel is loaded lazily on the first click, so nothing changes when it is never opened.

## Tests

```sh
cd simulator
node --test tests/physics.test.mjs
```

12 tests (Node ≥ 18, no dependencies): regression against the lab notebook's f_r, static equilibrium, energy conservation without damping, small-amplitude f_r and f_s, damping monotonicity, the 2:1 solver, autoparametric energy transfer at exact resonance, and cord slack.

## Files

- `index.html`, `css/style.css` — layout and styling
- `js/main.js` — wiring, fixed-timestep loop, presets, CSV export, share link
- `js/ui.js` — declarative control schema -> control panel
- `js/charts.js` — hand-rolled canvas `StripChart`, `XYChart` and `ScanChart`
- `js/physics.js`, `js/elastic.js` — physics engine (RK4); the elastic-spring model
- `js/resonance.js`, `js/resonance-worker.js` — nonlinear resonance search (runs in a Web Worker)
- `js/scene.js` — Three.js scene

## Models

Choose the model at the top of the Tuning panel (`model` parameter: `elastic` (default) | `rigid` | `point`).

- **Elastic spring (most realistic, default).** The rigid phone hangs from a helical spring that is simulated as `N` (`springSegments`, 6–40) segments with distributed mass. Each segment carries the exact strain energy of a uniform helix of inextensible wire, `U = ℓs [½B(κ−κ0)² + ½C(τ−τ0)²]` with `sinα = Ls/ℓs`, `R = ℓs cosα / 2π(ns+ψ/2π)`, `κ = cos²α/R`, `τ = sinα cosα/R`, `B = Eπd⁴/64`, `C = Gπd⁴/32` (Love's finite-deformation theory). Axial length `Ls` and winding twist `ψ` are coupled, which gives the nonlinear stretch and the extension–twist (Wilberforce) coupling; its small-deflection limit reproduces the open-coiled-spring results of Timoshenko/Love and `k = Gd⁴/(8D³n)`. Further terms: coil contact penalty, optional initial tension, inter-segment bending (`k_b = 2BC/(ℓs(B+C))`, Haringx's equivalent beam), shear of the segment chord. The hanging equilibrium (non-uniform sag, static yaw `yawEq`) and the linear modes (`fR`, `fS`, `fS2`, `fSy`, `fSy2`, `fTwist`, `fSurge`) come from Newton + eigen-analysis; the RK4 step is `derived.dt = min(1 ms, 1.5/ω_max)`. Forces and torques are exact energy gradients, so the energy is conserved without damping. Chart extras: yaw ψ, the spring's kinetic energy (its elastic energy trades large amounts against gravity at every bounce, ≈ k·stretch·x, so it is exported to the CSV but not charted), `E_c` includes the spring's internal energy. If the browser cannot keep up with real time the effective speed is lowered automatically ("running at 0.6× real time").

- **Rigid body (realistic, default).** The phone is a 3D rigid body. The inertia tensor is assembled from the phone (uniform box), the case (box), the two nut stacks (point masses on the long axis), extra mass and a lumped share of the spring mass (inertial m_spring/3 at the attachment point, gravity load m_spring/2). The eyebolt is an ideal frictionless ball joint: spring and cord (in series, tension-only) act at the attachment point and exert no moment. Equations of motion are Newton plus Euler's equations, integrated with RK4 (quaternion attitude). Damping acts along the spring line (radial), on the transverse COM motion, and rotationally (`cRot` linear / `dRot` quadratic; not yet calibrated against data). The extra rotational degree of freedom adds a rocking mode.
- **Point mass (methods document).** The v1 model: the phone is a point mass at its COM; the displayed orientation simply follows the spring line.

Linearised mode analysis (per plane, 2 DOF: spring angle θ1 and body angle θ2): link 1 has length Leq, point inertia m1 = m_spring/3 and gravity load m_spring/2 at its end; the body (mass M, inertia I about its COM) has its COM a distance d below the joint. Mass matrix [[(m1+M)a², M a b], [M a b, M b² + I]], stiffness diag[(m1g+M) g a, M g b] with a = Leq, b = d. The generalised eigenproblem gives the lower and upper swing modes; `fS` is the **lower in-plane (X–Z) mode**, the one used for the 2:1 ratio f_r/(2 f_s). `fS2` is the upper in-plane mode (rocking about the eyebolt), `fSy`/`fSy2` the out-of-plane pair. For the point model `fS` is the v1 pendulum frequency and the others are undefined.

### Elastic-model parameters

`springGeometry` (`fromK` default: solve wire diameter and turns from `springK`, `springMass`, `springL0`, `coilDiameter` and the material; or `direct`: `wireDiameter`, `activeTurns`), `kCalibration` (`loaded` default: `springK` is the spring's tangent stiffness at the hanging load `kRefLoad` = 211.2 g where it was measured — the lab dataset inferred k = 18.95 N/m from the bounce frequency with that load; `unloaded`: `springK` is the small-deflection stiffness of the unloaded spring. An open-coiled spring stiffens slightly as it stretches, so the two differ by a few per cent; with `loaded` the elastic model reproduces the measured lab bounce frequency, 1.5006 Hz vs 1.50026 Hz), `coilDiameter` (22 mm), `wireMaterial` (`steel` E 200 GPa / G 79.3 GPa / ρ 7850; `stainless` 193 / 69 / 8000; `custom` uses `wireE`, `wireG`, `wireRho`), `springHand` (`right`|`left`), `initialTension` (N, 0), `springSegments` (12), `topTwist` / `eyeTwist` (`locked`|`free`: whether the top hook / eyebolt transmit twist), `cTwist` (internal torsional damping of the whole spring, 10⁻⁶ N·m·s/rad). The "Derived spring" box shows wire Ø, turns, helix angle, wire length, `k_lin` vs `k_tangent`, `k_twist`, the extension–twist coupling, the model spring mass and `dt`. The tuning panel adds `f_twist`, `f_surge`, the textbook `f_r = √(k/(M+m_s/3))/2π` and the static yaw.

## Finding the real resonance

Linear theory says "tune to `f_r = 2 f_s`". At real amplitudes the frequencies shift and the coupling is nonlinear, so the panel **Find the real resonance (nonlinear simulation)** runs the full model (any of the three) from your actual start condition: for each value of the chosen knob (cord length, nuts per side or spring constant; ~21 values around the linear estimate, then a golden-section refinement) it simulates up to the chosen length and measures the exchange `η = max_t |π_s(t) − π_s(0)|` (`π_s = E_s/(E_r+E_s)`) and the exchange time. The best value maximises `η` and, among near-equal values, has the shortest exchange time. The chart shows `η` and `t_ex` vs the knob with the linear estimate marked; **Apply** sets the knob. **Measure nonlinear frequencies** runs a pure bounce and a pure swing at the current amplitudes and compares `f_r`, `f_s` and the ratio with the linear ones. The search runs in a Web Worker (`js/resonance-worker.js`); Cancel stops it. For the elastic model the 2:1 tuning buttons also run in the worker.

## Start position

The panel directly under Tuning sets the start state. **Drag the phone in the 3D view** to place it: the simulation pauses, the phone follows the pointer (mouse or touch), and on release it restarts from there (this switches to Cartesian mode and fills ΔX, ΔY, ΔZ). Polar mode uses stretch x0 and angles α0, β0; Cartesian uses ΔX0, ΔY0, ΔZ0 from equilibrium. Rigid only: "Phone aligned with spring" (or tilt X/Y), rocking rate and spin rate. Initial velocities vx0, vy0, vz0 are in a collapsible sub-section. Presets: Pure bounce, Pure swing, Mixed, Rocking only, Sideways pull. Reset restarts from the current start position.

## Physics model (summary)

Point-mass model: phone (COM at q, pivot at the origin, +Z up) hanging from a linear spring in series with an optional massless inextensible cord that can go slack. Total hanging mass M = phone + case + nuts (2 × nutsPerSide × nutMass) + extra mass (+ a fraction of the spring mass). The swing pendulum length is R_eq (spring at static equilibrium + cord + attachment offset d). Frequencies: f_r = (1/2π)√(k/M_eff), f_s = (1/2π)√(g/R_eq); ratio = f_r/(2 f_s); de Sousa f = f_s/f_r. Energies: E_r (radial), E_s (swing), E_c (coupling); partition π_r = E_r/(E_r+E_s). Damping is none, linear (c_R, c_T) or quadratic (d_R, d_T). Integration is RK4 with 1 ms steps. Chart/CSV samples are taken every 1/60 s of simulated time.

The "Tuning" panel shows derived values, a resonance gauge (0.8–1.2, green band ±1 %) and one-click retuning through cord length, nut count or spring constant.

## Parameters and defaults

| Parameter | Default | Range in UI |
|---|---|---|
| Phone mass | 177 g | 50–400 g |
| Length / width / thickness | 149.6 / 71.5 / 7.95 mm | 100–200 / 50–100 / 5–15 mm |
| Case mass / attachment offset | 0 / 0 (case on: 45 g / 60 mm) | 0–150 g / 0–100 mm |
| Nuts per side / nut mass | 0 / 5.6 g | 0–20 / 1–20 g |
| Extra mass at COM | 0 | 0–300 g |
| Spring k / free length L0 / mass | 18.95 N/m / 19 cm / 6.3 g | 2–80 / 5–50 cm / 0–50 g |
| Cord length | 0 | 0–60 cm |
| Damping model | none | none / linear / quadratic |
| c_R, c_T | 3.2, 2.4 ×10⁻³ kg/s | 0–30 |
| d_R, d_T | 10.4, 9.4 ×10⁻³ | 0–60 |
| g | 9.767 m/s² | 1–25 (presets: lab, standard, Moon) |
| Model (`model`) | elastic | elastic / rigid / point |
| Elastic spring: `springGeometry`, `kCalibration`, `kRefLoad`, `coilDiameter`, `wireMaterial`, `wireE/G/Rho`, `wireDiameter`, `activeTurns`, `springHand`, `initialTension`, `springSegments`, `topTwist`, `eyeTwist`, `cTwist` | fromK, loaded, 211.2 g, 22 mm, steel, –, 0.82 mm, 22, right, 0, 12, locked, locked, 1e-6 | see above |
| c_rot (`cRot`), rigid only, linear | 2×10⁻⁵ N·m·s | 0–50 ×10⁻⁵ |
| d_rot (`dRot`), rigid only, quadratic | 2×10⁻⁶ N·m·s² | 0–50 ×10⁻⁶ |
| Start mode (`icMode`) | polar | polar / cartesian |
| x0 / α0 / β0 (polar) | 4 cm / 2° / 0.5° | ±10 cm / ±30° / ±15° |
| ΔX0 / ΔY0 / ΔZ0 (cartesian) | 0 | ±30 cm |
| Phone aligned (`alignPhone`), tilt X0 / Y0 (rigid) | 1 (aligned) / 0° | ±45° |
| Rocking `rock0` / spin `spin0` (rigid) | 0 | ±200 °/s / ±360 °/s |
| Initial velocity vx0, vy0, vz0 | 0 | ±50 cm/s |
| Speed / chart window | 1× / 30 s | 0.1–5× / 10–120 s |

Any parameter change restarts the simulation at t = 0. "Copy share link" encodes all parameters in the URL query string (restored on load); `?paused` starts paused; `chart1=disp|acc|sensor|gyro` selects the first chart's view. "Export CSV" downloads the history since the last reset (two leading comment lines `# model=…` and `# params={…}`, then t, X, Y, Z, x, alpha, beta, Er, Es, Ec, Erel, Emech, dPhi, partitionR, tilt, tiltY, Erot, qw, qx, qy, qz, attachX, attachY, attachZ, yaw, twistTotal, EspringKin, EspringEl, ax, ay, az, accX, accY, accZ, gyroX, gyroY, gyroZ; SI units and radians, capped at 200 000 rows).

## Literature

A. E. H. Love, *A Treatise on the Mathematical Theory of Elasticity* (4th ed., §§270–271, helical springs, finite deformation); S. Timoshenko, *Strength of Materials* II (open-coiled helical springs); J. A. Haringx, Philips Res. Rep. 4 (1949) (equivalent-beam rigidities of helical springs); A. M. Wahl, *Mechanical Springs*; R. E. Berg & T. S. Marshall, Am. J. Phys. 59, 32 (1991) (Wilberforce pendulum); Torzo et al., *The Wilberforce pendulum: a complete analysis*; Christensen, Am. J. Phys. 72, 818 (2004) (effective mass of the resonant spring pendulum).

## Credits

Physics model from the project's methods document (de Sousa-style control parameter for the elastic pendulum). iPhone 17 dimensions (71.5 × 149.6 × 7.95 mm, 177 g) from Apple's tech specs. Three.js (MIT) via jsDelivr.

## Phone sensor views

The first chart has a selector with four views: Displacements; Accelerations (world), the exact acceleration of the phone's centre of mass (`observables().acc`, evaluated from the equations of motion, not by differencing); Phone accelerometer (`accSensor = Rᵀ(a − g_vec)`, `g_vec = (0,0,−g)`); and Phone gyroscope (`gyroSensor`, body-frame angular velocity in rad/s). Axes follow phyphox: x to the right edge, y toward the top of the phone (the spring attachment in this simulator), z out of the screen. The accelerometer reads specific force and therefore includes gravity: at rest it shows +g along the upward axis (y when hanging), comparable with phyphox "acceleration with g". All four views are recorded in parallel, so switching keeps the history; the CSV export contains `ax,ay,az,accX,accY,accZ,gyroX,gyroY,gyroZ`.
