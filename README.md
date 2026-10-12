# Smartphone Elastic Pendulum — 3D Simulator

**Live:** https://kairi99.github.io/parametricResonance-sim/

A browser-based 3D simulator of a smartphone hanging from a coil spring (optionally via a cord, optionally in a 3D-printed case whose horns carry M8 nut ballast). The bounce (radial) and swing modes are coupled; at f_r = 2 f_s (de Sousa parameter f = 0.25) energy flows back and forth between bouncing and swinging (2:1 autoparametric resonance). Live charts show the displacements, the energy exchange E_r / E_s / E_c, the horizontal footprint and resonance diagnostics.

Two selectable models (realistic rigid body, or the point-mass model of the methods document) and drag-to-place start positions.

Plain ES modules, no build step. Three.js is loaded from jsDelivr through an import map (internet needed).

## Run locally

```sh
cd simulator
python3 -m http.server 8000
# open http://localhost:8000/
```

(ES modules do not load from `file://`; use any static server.)

## Deploy to GitHub Pages

The site is plain static files (no build step). "Deploy from a branch" can only publish the repository root or a `/docs` folder, so pick one of:

1. **Simplest — dedicated repo:** make the *contents* of `simulator/` the root of a new repository (e.g. `elastic-pendulum-sim`), push, then Settings → Pages → Source: "Deploy from a branch" → `main` / `/ (root)`. URL: `https://<user>.github.io/elastic-pendulum-sim/`.
2. **Inside a larger repo:** rename/copy `simulator/` to `docs/`, then Settings → Pages → `main` / `/docs`.
3. **Keep the `simulator/` folder name:** Settings → Pages → Source: "GitHub Actions", and add a workflow that uploads `simulator/` with `actions/upload-pages-artifact` (`path: simulator`) followed by `actions/deploy-pages`.

`.nojekyll` is already present, and all paths are relative, so the site works from any sub-path. Three.js is loaded from the jsDelivr CDN, so the page needs internet access.

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
- `js/charts.js` — hand-rolled canvas `StripChart` and `XYChart`
- `js/physics.js` — physics engine (RK4)
- `js/scene.js` — Three.js scene

## Models

Choose the model at the top of the Tuning panel (`model` parameter).

- **Rigid body (realistic, default).** The phone is a 3D rigid body. The inertia tensor is assembled from the phone (uniform box), the case (box), the two nut stacks (point masses on the long axis), extra mass and a lumped share of the spring mass (inertial m_spring/3 at the attachment point, gravity load m_spring/2). The eyebolt is an ideal frictionless ball joint: spring and cord (in series, tension-only) act at the attachment point and exert no moment. Equations of motion are Newton plus Euler's equations, integrated with RK4 (quaternion attitude). Damping acts along the spring line (radial), on the transverse COM motion, and rotationally (`cRot` linear / `dRot` quadratic; not yet calibrated against data). The extra rotational degree of freedom adds a rocking mode.
- **Point mass (methods document).** The v1 model: the phone is a point mass at its COM; the displayed orientation simply follows the spring line.

Linearised mode analysis (per plane, 2 DOF: spring angle θ1 and body angle θ2): link 1 has length Leq, point inertia m1 = m_spring/3 and gravity load m_spring/2 at its end; the body (mass M, inertia I about its COM) has its COM a distance d below the joint. Mass matrix [[(m1+M)a², M a b], [M a b, M b² + I]], stiffness diag[(m1g+M) g a, M g b] with a = Leq, b = d. The generalised eigenproblem gives the lower and upper swing modes; `fS` is the **lower in-plane (X–Z) mode**, the one used for the 2:1 ratio f_r/(2 f_s). `fS2` is the upper in-plane mode (rocking about the eyebolt), `fSy`/`fSy2` the out-of-plane pair. For the point model `fS` is the v1 pendulum frequency and the others are undefined.

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
| Damping model | linear | none / linear / quadratic |
| c_R, c_T | 3.2, 2.4 ×10⁻³ kg/s | 0–30 |
| d_R, d_T | 10.4, 9.4 ×10⁻³ | 0–60 |
| g | 9.767 m/s² | 1–25 (presets: lab, standard, Moon) |
| Model (`model`) | rigid | rigid / point |
| c_rot (`cRot`), rigid only, linear | 2×10⁻⁵ N·m·s | 0–50 ×10⁻⁵ |
| d_rot (`dRot`), rigid only, quadratic | 2×10⁻⁶ N·m·s² | 0–50 ×10⁻⁶ |
| Start mode (`icMode`) | polar | polar / cartesian |
| x0 / α0 / β0 (polar) | 4 cm / 2° / 0.5° | ±10 cm / ±30° / ±15° |
| ΔX0 / ΔY0 / ΔZ0 (cartesian) | 0 | ±30 cm |
| Phone aligned (`alignPhone`), tilt X0 / Y0 (rigid) | 1 (aligned) / 0° | ±45° |
| Rocking `rock0` / spin `spin0` (rigid) | 0 | ±200 °/s / ±360 °/s |
| Initial velocity vx0, vy0, vz0 | 0 | ±50 cm/s |
| Speed / chart window | 1× / 30 s | 0.1–5× / 10–120 s |

Any parameter change restarts the simulation at t = 0. "Copy share link" encodes all parameters in the URL query string (restored on load); `?paused` starts paused. "Export CSV" downloads the history since the last reset (two leading comment lines `# model=…` and `# params={…}`, then t, X, Y, Z, x, alpha, beta, Er, Es, Ec, Erel, Emech, dPhi, partitionR, tilt, tiltY, Erot, qw, qx, qy, qz, attachX, attachY, attachZ; SI units and radians, capped at 200 000 rows).

## Credits

Physics model from the project's methods document (de Sousa-style control parameter for the elastic pendulum). iPhone 17 dimensions (71.5 × 149.6 × 7.95 mm, 177 g) from Apple's tech specs. Three.js (MIT) via jsDelivr.
