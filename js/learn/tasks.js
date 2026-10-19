// Guided task definitions (Predict -> Act -> Observe -> Explain). No DOM dependency.
import { solveForResonance } from '../physics.js?v=8644c0b';

const D2R = Math.PI / 180;
const fin = Number.isFinite;
const runs = c => [...(c.probes?.history || []), c.probes?.run].filter(Boolean);
const evs = (c, type) => (c.events || []).filter(e => e.type === type);

// task 6: runs at the exact-2:1 'case' configuration with finite exchange time
const caseRuns = c => runs(c).filter(r => fin(r.tExchange) && Math.abs((r.meta?.derived?.ratio ?? NaN) - 1) < 0.01);
const near = (r, cm) => Math.abs(Math.abs(r.x0) * 100 - cm) <= 0.3;

// task 10: f_s per model for an unchanged spring/phone configuration
const fsByModel = new Map();
let fsSig = '';
function trackFs(c) {
  const p = c.params || {}, d = c.derived || {};
  if (!c.setupApplied) { fsByModel.clear(); return; }
  const sig = [p.phoneMass, p.caseMass, p.nutsPerSide, p.nutMass, p.extraMass, p.springK, p.springL0, p.springMass, p.cordLength, p.attachmentOffset, p.gravity].join('|');
  if (sig !== fsSig) { fsByModel.clear(); fsSig = sig; }
  if (fin(d.fS) && (d.model === undefined || d.model === p.model)) fsByModel.set(p.model, d.fS);
}
const fsDiff = () => {
  const a = fsByModel.get('elastic'), b = fsByModel.get('point');
  return fin(a) && fin(b) ? { value: 100 * (a / b - 1), unit: '%' } : undefined;
};

export const TASKS = [
  {
    id: 'bounce-period', level: 1, model: 'elastic',
    setup: { preset: 'lab', params: {}, ic: 'bounce', chart1: 'disp', speed: 1, window: 5 },
    look: ['x0', '#sel-chart1', '#preset'],
    predict: { kind: 'number', unit: 's', decimals: 2 },
    expected: c => (fin(c.derived?.fR) ? { value: 1 / c.derived.fR, unit: 's' } : undefined),
    success: c => c.setupApplied && fin(c.probes.run.Tbounce) && c.probes.run.tElapsed >= 10 && evs(c, 'ruler').some(e => e.chart === 'disp' && e.dt >= 1),
    measured: c => ({ value: c.probes.run.Tbounce, unit: 's' }),
    text: {
      es: {
        title: 'El período del rebote', concept: 'Oscilador masa-resorte',
        predict: 'Un teléfono de M = 211,2 g cuelga de un resorte de k = 18,95 N/m y masa 6,3 g. Se estira y se suelta para que rebote verticalmente. ¿Cuál es el período del rebote T<sub>r</sub>, en segundos?',
        options: [],
        act: 'Pulsa «Preparar el simulador» (preset «Datos de laboratorio», modelo de resorte elástico, rebote puro; está lejos de 2:1, así que el rebote no se mezcla con el balanceo; el gráfico muestra 5 s). Deja correr unos 10 s y pulsa «Pausa». En el gráfico de desplazamientos haz clic en una cresta de x y luego en otra cresta varias oscilaciones después: el gráfico muestra Δt. Divide Δt entre el número de oscilaciones que hay entre ambas.',
        observe: 'La elongación x oscila de forma casi sinusoidal con amplitud constante (el amortiguamiento está desactivado por defecto). Medir varias oscilaciones de una vez reduce el error: un error de clic de 0,02 s se reparte entre todas ellas. Escribe tu medición en tu explicación; el valor «Medido» lo calcula el simulador con los cruces por cero de x.',
        explain: 'Un sistema masa-resorte tiene T = 2π√(m<sub>ef</sub>/k). Como el resorte también se mueve, su masa contribuye con un tercio: m<sub>ef</sub> ≈ M + m<sub>s</sub>/3. Con los datos del enunciado da T ≈ 0,667 s (f<sub>r</sub> ≈ 1,50 Hz). El modelo elástico no usa esa aproximación: resuelve la masa del resorte repartida a lo largo de las espiras y coincide con el valor en mejor que 0,1 %.',
        teacher: '<b>Respuesta esperada:</b> T ≈ 0,667 s (1/f<sub>r</sub> del modelo; texto: 2π√((M+m<sub>s</sub>/3)/k)). <b>Errores típicos:</b> olvidar la masa del resorte (da 0,663 s, casi igual: conviene discutir por qué importa poco), confundir período con frecuencia, usar la masa en gramos. <b>Pregunta:</b> ¿por qué el período no depende de la amplitud ni de g?',
        hint: 'Piensa en un sistema masa-resorte. ¿Qué dos magnitudes fijan su período? La masa del resorte no se mueve toda igual: la parte de arriba casi no se mueve y la de abajo se mueve con el teléfono.',
      },
      en: {
        title: 'The bounce period', concept: 'Mass-spring oscillator',
        predict: 'A phone of M = 211.2 g hangs from a spring with k = 18.95 N/m and mass 6.3 g. It is pulled down and released so that it bounces vertically. What is the bounce period T<sub>r</sub>, in seconds?',
        options: [],
        act: 'Press "Set up the simulator" ("Lab dataset" preset, elastic spring model, pure bounce; it is far from 2:1, so the bounce does not mix with the swing; the chart shows 5 s). Let it run for about 10 s and press "Pause". In the displacements chart click on one crest of x and then on another crest several oscillations later: the chart shows Δt. Divide Δt by the number of oscillations between them.',
        observe: 'The stretch x oscillates almost sinusoidally with constant amplitude (damping is off by default). Measuring several oscillations at once reduces the error: a 0.02 s click error is shared among all of them. Write your measurement in your explanation; the "Measured" value is computed by the simulator from the zero crossings of x.',
        explain: 'A mass-spring system has T = 2π√(m<sub>eff</sub>/k). The spring moves too, and contributes one third of its mass: m<sub>eff</sub> ≈ M + m<sub>s</sub>/3. With the numbers given, T ≈ 0.667 s (f<sub>r</sub> ≈ 1.50 Hz). The elastic model does not use that approximation: it resolves the spring mass distributed along the coils and agrees with this value to better than 0.1 %.',
        teacher: '<b>Expected answer:</b> T ≈ 0.667 s (1/f<sub>r</sub> from the model; textbook 2π√((M+m<sub>s</sub>/3)/k)). <b>Typical mistakes:</b> forgetting the spring mass (gives 0.663 s, almost the same: worth discussing why it matters little), confusing period and frequency, using the mass in grams. <b>Discussion:</b> why does the period not depend on amplitude or on g?',
        hint: 'Think of a mass-spring system: which two quantities set its period? The spring\'s own mass does not all move equally: the top barely moves, the bottom moves with the phone.',
      },
    },
  },
  {
    id: 'cord-length', level: 1, model: null,
    setup: { preset: 'bare', params: {}, ic: 'swing', chart1: 'disp', speed: 1 },
    look: ['cordLength', '#sel-chart1'],
    predict: { kind: 'choice', answer: 0 },
    success: c => c.params.cordLength >= 0.10 && fin(c.probes.run.Tswing) && c.probes.run.tElapsed >= 10 && Math.abs(c.probes.run.alpha0) > 5 * D2R,
    measured: c => ({ value: c.probes.run.Tswing, unit: 's' }),
    text: {
      es: {
        title: 'Longitud del cordón y balanceo', concept: 'Período del péndulo',
        predict: 'El teléfono se balancea como un péndulo colgado del resorte. Si alargas el cordón entre el resorte y el teléfono, el período del balanceo T<sub>s</sub>…',
        options: ['aumenta (balanceo más lento)', 'disminuye (balanceo más rápido)', 'no cambia'],
        act: 'Pulsa «Preparar el simulador» (balanceo puro, α0 = 10°). En «Resorte y cordón» aumenta «Longitud del cordón» al menos 10 cm y deja correr 10 s para medir el período.',
        observe: 'Con el cordón largo el balanceo es más lento, mientras que el rebote vertical sigue igual de rápido. Compara el período medido T<sub>s</sub> con el que tenía el balanceo antes de alargar el cordón.',
        explain: 'Para oscilaciones pequeñas T<sub>s</sub> ≈ 2π√(R<sub>eq</sub>/g), donde R<sub>eq</sub> es la distancia del pivote al centro del teléfono: más cordón, más longitud de péndulo, período mayor (en el modelo de masa puntual f<sub>s</sub> pasa de 0,83 Hz sin cordón a 0,74 Hz con 10 cm). La frecuencia de rebote f<sub>r</sub> depende solo de k y de la masa, no del cordón. Por eso el cordón sirve para sintonizar la relación f<sub>r</sub> = 2 f<sub>s</sub>: cambia f<sub>s</sub> sin tocar f<sub>r</sub>.',
        teacher: '<b>Respuesta esperada:</b> aumenta (T<sub>s</sub> ≈ 2π√(R<sub>eq</sub>/g); fuente: modelo, f<sub>s</sub> 0,834 → 0,737 Hz con 10 cm en masa puntual). <b>Errores típicos:</b> creer que un cordón «más pesado» o más tenso acelera el balanceo; confundir R<sub>eq</sub> con la longitud libre del resorte. <b>Pregunta:</b> ¿cuánto cambiaría T<sub>s</sub> en la Luna y cambiaría f<sub>r</sub>?',
        hint: 'Para el balanceo, el teléfono se comporta como un péndulo. ¿De qué longitud depende el período de un péndulo, y cómo cambia esa longitud al añadir cordón?',
      },
      en: {
        title: 'Cord length and swing', concept: 'Pendulum period',
        predict: 'The phone swings like a pendulum hanging from the spring. If you lengthen the cord between the spring and the phone, the swing period T<sub>s</sub>…',
        options: ['gets longer (slower swing)', 'gets shorter (faster swing)', 'does not change'],
        act: 'Press "Set up the simulator" (pure swing, α0 = 10°). Under "Spring & cord" increase "Cord length" by at least 10 cm and let it run for 10 s to measure the period.',
        observe: 'With the longer cord the swing is slower, while the vertical bounce keeps its speed. Compare the measured period T<sub>s</sub> with what the swing had before you lengthened the cord.',
        explain: 'For small oscillations T<sub>s</sub> ≈ 2π√(R<sub>eq</sub>/g), where R<sub>eq</sub> is the distance from the pivot to the phone centre: more cord, longer pendulum, longer period (in the point-mass model f<sub>s</sub> goes from 0.83 Hz with no cord to 0.74 Hz with 10 cm). The bounce frequency f<sub>r</sub> depends only on k and the mass, not on the cord. That is why the cord is used to tune f<sub>r</sub> = 2 f<sub>s</sub>: it changes f<sub>s</sub> without touching f<sub>r</sub>.',
        teacher: '<b>Expected answer:</b> longer (T<sub>s</sub> ≈ 2π√(R<sub>eq</sub>/g); source: model, f<sub>s</sub> 0.834 → 0.737 Hz with 10 cm, point mass). <b>Typical mistakes:</b> thinking a heavier or tauter cord speeds up the swing; confusing R<sub>eq</sub> with the free spring length. <b>Discussion:</b> how would T<sub>s</sub> change on the Moon, and would f<sub>r</sub> change?',
        hint: 'For the swing, the phone behaves like a pendulum. Which length does a pendulum\'s period depend on, and how does the cord change it?',
      },
    },
  },
  {
    id: 'energy-exchange', level: 1, model: null,
    setup: { preset: 'case', params: {}, ic: 'nudge', chart1: 'disp', speed: 1 },
    look: ['#preset', '#ch-energy'],
    predict: { kind: 'choice', answer: 2 },
    success: c => c.setupApplied && c.probes.run.piMin < 0.3,
    measured: c => ({ value: 100 * (1 - c.probes.run.piMin), unit: '%' }),
    text: {
      es: {
        title: 'Intercambio de energía en 2:1', concept: 'Resonancia paramétrica',
        predict: 'El teléfono está sintonizado exactamente en f<sub>r</sub> = 2 f<sub>s</sub> y empieza con rebote puro (casi sin balanceo). ¿Qué ocurre con la energía de rebote E<sub>r</sub>?',
        options: ['se queda en el rebote y solo se disipa poco a poco', 'pasa al balanceo y ya no vuelve', 'pasa al balanceo y vuelve al rebote, de forma periódica'],
        act: 'Pulsa «Preparar el simulador» (preset «iPhone 17 + funda en 2:1 exacto», «Rebote + empujoncito»). Observa el gráfico de energías hasta que la fracción de energía en el rebote caiga por debajo de 0,3.',
        observe: 'La amplitud del rebote decae mientras crece la del balanceo, que casi no existía al principio. Después el proceso se invierte: la energía vuelve al rebote y el ciclo se repite.',
        explain: 'Al balancearse, la longitud efectiva del péndulo cambia con el rebote, de modo que el rebote «bombea» el balanceo con frecuencia 2 f<sub>s</sub>. Si f<sub>r</sub> = 2 f<sub>s</sub> el bombeo está en fase y el balanceo crece a costa del rebote. Cuando el balanceo es grande, el acoplamiento actúa a la inversa. Sin amortiguamiento la energía total se conserva: el intercambio es periódico, no una pérdida.',
        teacher: '<b>Respuesta esperada:</b> pasa al balanceo y vuelve, periódicamente (fuente: gráfico de energías; π<sub>r</sub> mínimo ≈ 0 en 2:1 exacto). <b>Errores típicos:</b> pensar que el balanceo «roba» energía definitivamente; atribuir el descenso del rebote al amortiguamiento. <b>Pregunta:</b> ¿qué fenómeno de dos péndulos acoplados se parece a este?',
        hint: 'Si no hay amortiguamiento, la energía total se conserva. Piensa en dos osciladores acoplados que pueden pasarse energía: ¿hay algo que impida que la energía regrese?',
      },
      en: {
        title: 'Energy exchange at 2:1', concept: 'Parametric resonance',
        predict: 'The phone is tuned exactly to f<sub>r</sub> = 2 f<sub>s</sub> and starts with a pure bounce (almost no swing). What happens to the bounce energy E<sub>r</sub>?',
        options: ['it stays in the bounce and is only slowly dissipated', 'it flows into the swing and never comes back', 'it flows into the swing and returns to the bounce, periodically'],
        act: 'Press "Set up the simulator" (preset "iPhone 17 + case at exact 2:1", "Bounce + nudge"). Watch the energy chart until the bounce share of the energy drops below 0.3.',
        observe: 'The bounce amplitude decays while the swing, almost absent at the start, grows. Later the process reverses: the energy returns to the bounce and the cycle repeats.',
        explain: 'While swinging, the effective pendulum length changes with the bounce, so the bounce "pumps" the swing at frequency 2 f<sub>s</sub>. If f<sub>r</sub> = 2 f<sub>s</sub> the pumping is in phase and the swing grows at the expense of the bounce. Once the swing is large the coupling acts the other way round. Without damping the total energy is conserved: the exchange is periodic, not a loss.',
        teacher: '<b>Expected answer:</b> flows into the swing and returns, periodically (source: energy chart; minimum π<sub>r</sub> ≈ 0 at exact 2:1). <b>Typical mistakes:</b> thinking the swing steals the energy for good; attributing the bounce decay to damping. <b>Discussion:</b> which coupled-pendulum phenomenon looks like this?',
        hint: 'With no damping, total energy is conserved. Think of two coupled oscillators that can pass energy to each other: is there anything stopping it from coming back?',
      },
    },
  },
  {
    id: 'detuned', level: 2, model: null,
    setup: { preset: 'lab', params: {}, ic: 'nudge', chart1: 'disp', speed: 1 },
    look: ['#preset', '#g-mark', '#ch-energy'],
    predict: { kind: 'choice', answer: 2 },
    success: c => c.setupApplied && c.probes.run.tElapsed >= 40,
    measured: c => ({ value: 100 * (1 - c.probes.run.piMin), unit: '%' }),
    text: {
      es: {
        title: 'Un sistema desafinado', concept: 'Detuning',
        predict: 'Con el preset del laboratorio, la relación f<sub>r</sub>/(2 f<sub>s</sub>) es ≈ 0,92 (8 % por debajo de la resonancia). Con rebote puro, ¿cuánta energía de rebote llega al balanceo?',
        options: ['casi toda', 'aproximadamente la mitad', 'casi nada'],
        act: 'Pulsa «Preparar el simulador» (preset «Datos de laboratorio», «Rebote + empujoncito»). Deja correr al menos 40 s y vigila el indicador de la relación y el gráfico de energías.',
        observe: 'El balanceo apenas crece y la energía permanece casi toda en el rebote: la fracción de energía de rebote nunca baja mucho. Compáralo con la tarea anterior.',
        explain: 'Para que el bombeo sea eficaz se necesita que el rebote y el doble de la frecuencia de balanceo coincidan. Con un 8 % de desafinación la fase relativa se desliza rápido y el balanceo recibe energía a veces y la devuelve otras, sin acumular. Por eso la resonancia es selectiva: la banda útil en torno a la relación 1 es estrecha (la zona verde del indicador). El modelo de masa puntual transfiere como máximo un 6 % y el de sólido rígido un 16 %.',
        teacher: '<b>Respuesta esperada:</b> casi nada (masa puntual: π<sub>r</sub> mínimo ≈ 0,94; rígido ≈ 0,84 en 60 s). <b>Errores típicos:</b> pensar que «cerca de 2:1» basta; confundir transferencia pequeña con ausencia de acoplamiento. <b>Pregunta:</b> ¿qué cambia si activas el amortiguamiento («Amortiguamiento»)?',
        hint: 'Un columpio crece si lo empujas al ritmo justo. ¿Qué pasa con la fase entre los empujones y el movimiento si el ritmo está un 8 % equivocado?',
      },
      en: {
        title: 'A detuned system', concept: 'Detuning',
        predict: 'With the lab preset the ratio f<sub>r</sub>/(2 f<sub>s</sub>) is ≈ 0.92 (8 % below resonance). Starting with a pure bounce, how much bounce energy reaches the swing?',
        options: ['almost all of it', 'about half', 'almost none'],
        act: 'Press "Set up the simulator" ("Lab dataset" preset, "Bounce + nudge"). Let at least 40 s run and watch the ratio gauge and the energy chart.',
        observe: 'The swing barely grows and the energy stays almost entirely in the bounce: the bounce energy share never drops much. Compare with the previous task.',
        explain: 'Effective pumping needs the bounce frequency to match twice the swing frequency. With 8 % detuning the relative phase slips quickly, so the swing gains energy at times and gives it back at others without accumulating. That is why the resonance is selective: the useful band around ratio 1 is narrow (the green zone of the gauge). The point-mass model transfers at most 6 % and the rigid-body model 16 %.',
        teacher: '<b>Expected answer:</b> almost none (point mass: minimum π<sub>r</sub> ≈ 0.94; rigid ≈ 0.84 over 60 s). <b>Typical mistakes:</b> thinking "close to 2:1" is enough; confusing small transfer with no coupling. <b>Discussion:</b> what changes if you switch damping on ("Damping")?',
        hint: 'A swing grows if you push it at the right rhythm. What happens to the phase between the pushes and the motion if the rhythm is off by 8 %?',
      },
    },
  },
  {
    id: 'tune-cord', level: 2, model: null,
    setup: { preset: null, params: { caseMass: 0.045, attachmentOffset: 0.06, nutsPerSide: 5, cordLength: 0 }, ic: 'nudge', chart1: 'disp', speed: 1 },
    look: ['cordLength', '#g-mark'],
    predict: { kind: 'number', unit: 'cm', decimals: 1 },
    expected: c => {
      if (!c.params || (c.params.model !== 'point' && c.params.model !== 'rigid')) return undefined;
      try { const r = solveForResonance(c.params, 'cordLength'); return r.feasible ? { value: r.value * 100, unit: 'cm' } : undefined; } catch (e) { return undefined; }
    },
    success: c => c.setupApplied && Math.abs(c.derived.ratio - 1) <= 0.01
      && evs(c, 'param').some(e => e.key === 'cordLength') && !evs(c, 'tuned').some(e => e.feasible),
    measured: c => ({ value: c.params.cordLength * 100, unit: 'cm' }),
    text: {
      es: {
        title: 'Sintoniza con el cordón', concept: 'Condición f_r = 2 f_s',
        predict: 'El teléfono lleva una funda de 45 g con cuernos a 60 mm del centro y 5 tuercas por lado. Sin cordón está por debajo de la resonancia 2:1. ¿Qué longitud de cordón (cm) deja la relación f<sub>r</sub>/(2 f<sub>s</sub>) en 1?',
        options: [],
        act: 'Pulsa «Preparar el simulador» (funda y tuercas, cordón = 0). Ajusta «Longitud del cordón» a mano hasta que la aguja del indicador entre en la banda central (relación entre 0,99 y 1,01). No uses el botón «Sintonizar a 2:1 con cordón»: la tarea cuenta solo el ajuste manual.',
        observe: 'Al alargar el cordón la relación sube hacia 1: f<sub>s</sub> baja y f<sub>r</sub> no cambia. En la relación 1 un rebote con un pequeño empujón ya transfiere energía al balanceo.',
        explain: 'La condición lineal f<sub>r</sub> = 2 f<sub>s</sub> con f<sub>r</sub> = (1/2π)√(k/m<sub>ef</sub>) y f<sub>s</sub> = (1/2π)√(g/R<sub>eq</sub>) (corregida por el peso del resorte) fija R<sub>eq</sub> y, con él, la longitud del cordón. Las masas añadidas bajan f<sub>r</sub> y exigen un R<sub>eq</sub> mayor: aquí hacen falta unos 10 cm de cordón. El valor exacto depende del modelo (masa puntual, sólido rígido, resorte elástico); el botón «Sintonizar a 2:1 con cordón» resuelve esta misma condición.',
        teacher: '<b>Respuesta esperada:</b> unos 10–11 cm (masa puntual ≈ 11,0 cm, rígido ≈ 10,2 cm; el elástico se mide en el simulador). <b>Errores típicos:</b> usar f<sub>r</sub> = f<sub>s</sub> en vez de 2 f<sub>s</sub>; olvidar la masa de funda y tuercas; cordón en m en vez de cm. <b>Pregunta:</b> ¿hay otras perillas que sintonicen (tuercas, k)? ¿Cuál es más fácil en el laboratorio?',
        hint: 'El cordón cambia f_s pero no f_r. Escribe f_r = 2 f_s con f_s = (1/2π)√(g/R_eq) y despeja R_eq; el cordón es la parte de R_eq que falta.',
      },
      en: {
        title: 'Tune with the cord', concept: 'The condition f_r = 2 f_s',
        predict: 'The phone has a 45 g case with horns 60 mm from the centre and 5 nuts per side. With no cord it is below the 2:1 resonance. What cord length (cm) puts the ratio f<sub>r</sub>/(2 f<sub>s</sub>) at 1?',
        options: [],
        act: 'Press "Set up the simulator" (case and nuts, cord = 0). Adjust "Cord length" by hand until the gauge needle enters the central band (ratio between 0.99 and 1.01). Do not use the "Tune to 2:1 with cord" button: the task only counts manual tuning.',
        observe: 'Lengthening the cord raises the ratio towards 1: f<sub>s</sub> falls while f<sub>r</sub> does not change. At ratio 1 a bounce with a small nudge now transfers energy to the swing.',
        explain: 'The linear condition f<sub>r</sub> = 2 f<sub>s</sub>, with f<sub>r</sub> = (1/2π)√(k/m<sub>eff</sub>) and f<sub>s</sub> = (1/2π)√(g/R<sub>eq</sub>) (corrected for the spring weight), fixes R<sub>eq</sub> and therefore the cord length. Added masses lower f<sub>r</sub>, so a longer R<sub>eq</sub> is needed: here about 10 cm of cord. The exact value depends on the model (point mass, rigid body, elastic spring); the "Tune to 2:1 with cord" button solves this same condition.',
        teacher: '<b>Expected answer:</b> about 10–11 cm (point mass ≈ 11.0 cm, rigid ≈ 10.2 cm; the elastic value is read from the simulator). <b>Typical mistakes:</b> using f<sub>r</sub> = f<sub>s</sub> instead of 2 f<sub>s</sub>; forgetting the case and nut masses; cord in m instead of cm. <b>Discussion:</b> which other knobs tune it (nuts, k)? Which is easiest in the lab?',
        hint: 'The cord changes f_s but not f_r. Write f_r = 2 f_s with f_s = (1/2π)√(g/R_eq) and solve for R_eq; the cord is the part of R_eq that is missing.',
      },
    },
  },
  {
    id: 'amplitude', level: 2, model: null,
    setup: { preset: 'case', params: { x0: 0.01, alpha0: 0.5 * D2R }, ic: null, chart1: 'disp', speed: 2 },
    look: ['x0', '#ch-energy'],
    predict: { kind: 'choice', answer: 0 },
    success: c => { const r = caseRuns(c); return r.some(x => near(x, 1)) && r.some(x => near(x, 2)); },
    measured: c => {
      const r = caseRuns(c), a = r.filter(x => near(x, 1)).pop(), b = r.filter(x => near(x, 2)).pop();
      return a && b ? { value: a.tExchange / b.tExchange, unit: '×' } : undefined;
    },
    text: {
      es: {
        title: 'Amplitud y velocidad del intercambio', concept: 'Acoplamiento no lineal',
        predict: 'En la configuración sintonizada en 2:1, el intercambio de energía tarda un cierto tiempo en vaciar el rebote. Si duplicas el estiramiento inicial (de 1 cm a 2 cm), el intercambio será…',
        options: ['más rápido', 'más lento', 'igual de rápido'],
        act: 'Pulsa «Preparar el simulador» (preset «funda en 2:1 exacto», x0 = 1 cm) y espera a que la energía de rebote caiga por debajo del 50 %. Después pon «Elongación radial x0» en 2 cm (reinicia solo) y espera de nuevo.',
        observe: 'Con 2 cm la energía abandona el rebote en menos tiempo. La tarea guarda el tiempo de intercambio de cada ejecución y los compara.',
        explain: 'El acoplamiento entre rebote y balanceo es cuadrático: el rebote modula la longitud del péndulo y el balanceo, a su vez, empuja el rebote. La tasa de crecimiento del balanceo es proporcional a la amplitud del rebote, así que el intercambio se acelera con la amplitud. No llega a ser 1/A porque el balanceo parte siempre de la misma semilla pequeña (α0 = 0,5°) y, con más amplitud, tiene que crecer hasta un valor mayor. En el modelo de masa puntual: unos 28,5 s, 20,8 s y 13,3 s para 1, 2 y 4 cm.',
        teacher: '<b>Respuesta esperada:</b> más rápido (t(π<sub>r</sub> &lt; 0,5): 28,5 s → 20,8 s → 13,3 s para 1, 2, 4 cm en masa puntual/rígido). <b>Errores típicos:</b> pensar que un sistema lineal «no depende de la amplitud» (aquí el acoplamiento es no lineal); esperar exactamente la mitad. <b>Pregunta:</b> ¿por qué el efecto sería nulo en un modelo estrictamente lineal?',
        hint: 'La fuerza que hace crecer el balanceo nace del rebote. Si el rebote es más grande, ¿el empujón que recibe el balanceo en cada ciclo es mayor, menor o igual?',
      },
      en: {
        title: 'Amplitude and exchange speed', concept: 'Nonlinear coupling',
        predict: 'In the configuration tuned to 2:1, the energy exchange takes some time to empty the bounce. If you double the initial stretch (from 1 cm to 2 cm), the exchange will be…',
        options: ['faster', 'slower', 'equally fast'],
        act: 'Press "Set up the simulator" (preset "case at exact 2:1", x0 = 1 cm) and wait until the bounce energy falls below 50 %. Then set "Radial stretch x0" to 2 cm (it restarts by itself) and wait again.',
        observe: 'With 2 cm the energy leaves the bounce in less time. The task records the exchange time of each run and compares them.',
        explain: 'The coupling between bounce and swing is quadratic: the bounce modulates the pendulum length, and the swing in turn pushes back on the bounce. The growth rate of the swing is proportional to the bounce amplitude, so the exchange speeds up with amplitude. It is not quite 1/A because the swing always starts from the same small seed (α0 = 0.5°) and, with a larger amplitude, has to grow to a larger final value. In the point-mass model: about 28.5 s, 20.8 s and 13.3 s for 1, 2 and 4 cm.',
        teacher: '<b>Expected answer:</b> faster (time to π<sub>r</sub> &lt; 0.5: 28.5 s → 20.8 s → 13.3 s for 1, 2, 4 cm in point/rigid). <b>Typical mistakes:</b> thinking a linear system "does not depend on amplitude" (here the coupling is nonlinear); expecting exactly half. <b>Discussion:</b> why would the effect vanish in a strictly linear model?',
        hint: 'The force that makes the swing grow comes from the bounce. With a bigger bounce, is the push the swing gets each cycle bigger, smaller or the same?',
      },
    },
  },
  {
    id: 'accelerometer', level: 2, model: null,
    setup: { preset: null, params: {}, ic: 'rest', chart1: 'sensor', speed: 1 },
    look: ['#sel-chart1', 'gravity'],
    predict: { kind: 'number', unit: 'm/s²', decimals: 2 },
    expected: c => (fin(c.params?.gravity) ? { value: c.params.gravity, unit: 'm/s²' } : undefined),
    success: c => c.view1 === 'sensor' && c.probes.run.tElapsed >= 3 && c.probes.run.maxX < 0.002,
    measured: c => ({ value: c.probes.run.accY, unit: 'm/s²' }),
    text: {
      es: {
        title: 'Qué mide el acelerómetro', concept: 'Fuerza específica',
        predict: 'El teléfono cuelga en reposo. El acelerómetro del teléfono (como en phyphox, «Acceleration with g») usa el eje y apuntando hacia arriba, hacia el punto de sujeción. ¿Qué valor lee el eje y, en m/s²?',
        options: [],
        act: 'Pulsa «Preparar el simulador» (teléfono en reposo; el primer gráfico cambia a «Acelerómetro del teléfono»). Espera unos 3 s y lee el eje y.',
        observe: 'El eje y marca un valor constante cercano a 9,8 m/s², positivo, y los ejes x y z están en cero. El teléfono no se mueve, y aun así «siente» aceleración.',
        explain: 'Un acelerómetro mide la fuerza específica, a − g, no la aceleración a. En reposo a = 0, así que lee −g: un vector de módulo g que apunta hacia arriba (la reacción del resorte), es decir +g sobre +Y. En caída libre leería 0. Es justo lo que registra phyphox con «Acceleration with g»; sin g, el teléfono parado marcaría cero.',
        teacher: '<b>Respuesta esperada:</b> +9,77 m/s² (= g de laboratorio; fuente: parámetro de gravedad del simulador). <b>Errores típicos:</b> responder 0 (aceleración real) o −9,8 (signo según el eje); confundir con la aceleración «Globales» del otro selector. <b>Pregunta:</b> ¿qué lee en caída libre y por qué?',
        hint: 'Un acelerómetro no puede distinguir entre estar acelerando y estar en un campo gravitatorio. ¿Qué leería si el teléfono estuviera en caída libre?',
      },
      en: {
        title: 'What the accelerometer measures', concept: 'Specific force',
        predict: 'The phone hangs at rest. The phone accelerometer (as in phyphox, "Acceleration with g") has its y axis pointing up, toward the attachment point. What does the y axis read, in m/s²?',
        options: [],
        act: 'Press "Set up the simulator" (phone at rest; the first chart switches to "Phone accelerometer"). Wait about 3 s and read the y axis.',
        observe: 'The y axis shows a constant value near 9.8 m/s², positive, while x and z are zero. The phone does not move, yet it "feels" acceleration.',
        explain: 'An accelerometer measures specific force, a − g, not the acceleration a. At rest a = 0, so it reads −g: a vector of magnitude g pointing up (the spring reaction), i.e. +g along +Y. In free fall it would read 0. This is what phyphox records with "Acceleration with g"; without g, a resting phone would read zero.',
        teacher: '<b>Expected answer:</b> +9.77 m/s² (= lab g; source: the simulator gravity parameter). <b>Typical mistakes:</b> answering 0 (true acceleration) or −9.8 (sign depends on axis); confusing it with the "World" acceleration in the other selector. <b>Discussion:</b> what does it read in free fall, and why?',
        hint: 'An accelerometer cannot tell accelerating apart from sitting in a gravitational field. What would it read if the phone were in free fall?',
      },
    },
  },
  {
    id: 'nuts', level: 3, model: null,
    setup: { preset: 'bare', params: {}, ic: 'bounce', chart1: 'disp', speed: 1 },
    look: ['nutsPerSide', '#g-mark'],
    predict: { kind: 'choice', answer: 1 },
    success: c => (c.params.nutsPerSide >= 3 && c.derived.ratio < 0.95) || evs(c, 'tuned').some(e => e.knob === 'nutsPerSide'),
    measured: c => ({ value: c.derived.ratio, unit: '' }),
    text: {
      es: {
        title: 'Tuercas como lastre', concept: 'Masa y resonancia',
        predict: 'El teléfono sin funda tiene una relación f<sub>r</sub>/(2 f<sub>s</sub>) ligeramente menor que 1. Si le añades tuercas como lastre, la relación…',
        options: ['se acerca a 1 (mejora la sintonía)', 'se aleja de 1 (empeora la sintonía)', 'no cambia'],
        act: 'Pulsa «Preparar el simulador» (iPhone 17 sin funda). En «Funda y lastre» sube «Tuercas por lado» a 3 o más y observa el indicador de relación; también puedes probar el botón «…con tuercas».',
        observe: 'La aguja del indicador se desplaza hacia la izquierda, más lejos de la banda de 2:1. Con el botón «…con tuercas» el simulador avisa de que ningún número de tuercas alcanza 2:1.',
        explain: 'f<sub>r</sub> = (1/2π)√(k/m<sub>ef</sub>) baja al aumentar la masa, mientras que f<sub>s</sub> ≈ (1/2π)√(g/R<sub>eq</sub>) casi no depende de ella (solo por el estiramiento estático y la geometría). Como el sistema ya está por debajo de 2:1, quitar frecuencia a f<sub>r</sub> lo aleja aún más: en masa puntual la relación pasa de 0,98 a 0,89 con 5 tuercas por lado y a 0,83 con 10. Para subir la relación habría que aligerar el teléfono, alargar el cordón o usar un resorte más rígido.',
        teacher: '<b>Respuesta esperada:</b> se aleja (relación 0,981 → 0,891 → 0,830 con 0, 5, 10 tuercas/lado; masa puntual). <b>Errores típicos:</b> pensar que «más masa = más inercia = más resonancia»; olvidar que f<sub>s</sub> casi no depende de la masa. <b>Pregunta:</b> ¿y si el sistema empezara por encima de 2:1?',
        hint: 'Fíjate en de qué depende cada frecuencia: f_r = (1/2π)√(k/m) y f_s ≈ (1/2π)√(g/R_eq). ¿Cuál de las dos cambia mucho al añadir masa?',
      },
      en: {
        title: 'Nuts as ballast', concept: 'Mass and resonance',
        predict: 'The bare phone has a ratio f<sub>r</sub>/(2 f<sub>s</sub>) slightly below 1. If you add nuts as ballast, the ratio…',
        options: ['moves towards 1 (better tuned)', 'moves away from 1 (worse tuned)', 'does not change'],
        act: 'Press "Set up the simulator" (bare iPhone 17). Under "Case & ballast" raise "Nuts per side" to 3 or more and watch the ratio gauge; you can also try the "…with nuts" button.',
        observe: 'The gauge needle moves to the left, further from the 2:1 band. With the "…with nuts" button the simulator warns that no number of nuts reaches 2:1.',
        explain: 'f<sub>r</sub> = (1/2π)√(k/m<sub>eff</sub>) falls as mass increases, while f<sub>s</sub> ≈ (1/2π)√(g/R<sub>eq</sub>) barely depends on it (only through the static stretch and geometry). Since the system is already below 2:1, lowering f<sub>r</sub> pushes it further away: in the point-mass model the ratio goes from 0.98 to 0.89 with 5 nuts per side and to 0.83 with 10. To raise the ratio you would have to lighten the phone, lengthen the cord or use a stiffer spring.',
        teacher: '<b>Expected answer:</b> moves away (ratio 0.981 → 0.891 → 0.830 with 0, 5, 10 nuts/side; point mass). <b>Typical mistakes:</b> thinking "more mass = more inertia = more resonance"; forgetting that f<sub>s</sub> hardly depends on mass. <b>Discussion:</b> what if the system started above 2:1?',
        hint: 'Look at what each frequency depends on: f_r = (1/2π)√(k/m) and f_s ≈ (1/2π)√(g/R_eq). Which of the two changes a lot when you add mass?',
      },
    },
  },
  {
    id: 'real-resonance', level: 3, model: null,
    setup: { preset: 'case', params: {}, ic: 'nudge', chart1: 'disp', speed: 1 },
    look: ['#resonance', '#rs-go', 'cordLength'],
    predict: { kind: 'choice', answer: 0 },
    success: c => evs(c, 'searchDone').length > 0,
    measured: c => {
      const e = evs(c, 'searchDone').pop();
      return e && fin(e.best?.ratioLinear) ? { value: e.best.ratioLinear, unit: '' } : undefined;
    },
    text: {
      es: {
        title: 'La resonancia real', concept: 'Frecuencia y amplitud',
        predict: 'Con amplitudes reales, la longitud de cordón que da el intercambio de energía más rápido tiene una relación lineal f<sub>r</sub>/(2 f<sub>s</sub>)…',
        options: ['ligeramente menor que 1', 'exactamente 1', 'ligeramente mayor que 1'],
        act: 'Pulsa «Preparar el simulador» (preset «funda en 2:1 exacto»). Abre «Buscar la resonancia real (simulación no lineal)», elige «Longitud del cordón» y pulsa «Buscar». Cuando termine, mira la relación lineal del mejor valor.',
        observe: 'El mejor valor del cordón no coincide exactamente con el de la sintonía lineal: la relación lineal del óptimo es algo inferior a 1. El gráfico del barrido muestra el pico del intercambio.',
        explain: 'La condición f<sub>r</sub> = 2 f<sub>s</sub> vale solo para amplitudes infinitesimales. Con amplitud finita el periodo del péndulo crece con el ángulo y la rigidez efectiva del resorte cambia, así que las frecuencias reales se desplazan y la sintonía óptima se mueve. Con x0 = 4 cm el óptimo cae en una relación lineal ≈ 0,993–0,995 (cordón unos 6 mm más corto que el de la sintonía lineal), y con 1 cm en ≈ 0,998: el desplazamiento crece con la amplitud.',
        teacher: '<b>Respuesta esperada:</b> ligeramente menor que 1 (relación lineal del óptimo ≈ 0,993–0,995 con x0 = 4 cm y ≈ 0,998 con 1 cm, masa puntual y rígido; la relación medida no lineal, ≈ 0,986–0,995. El óptimo es plano: conviene reportarlo como un intervalo). <b>Errores típicos:</b> creer que la resonancia lineal es exacta a cualquier amplitud; esperar un desplazamiento hacia arriba. <b>Pregunta:</b> ¿por qué el desplazamiento crece con la amplitud?',
        hint: 'El período de un péndulo real crece un poco cuando aumenta la amplitud. Si el balanceo se hace más lento al crecer, ¿el cordón ideal debería ser algo más largo o algo más corto que el de la sintonía lineal?',
      },
      en: {
        title: 'The real resonance', concept: 'Frequency and amplitude',
        predict: 'At real amplitudes, the cord length that gives the fastest energy exchange has a linear ratio f<sub>r</sub>/(2 f<sub>s</sub>)…',
        options: ['slightly below 1', 'exactly 1', 'slightly above 1'],
        act: 'Press "Set up the simulator" (preset "case at exact 2:1"). Open "Find the real resonance (nonlinear simulation)", choose "Cord length" and press "Search". When it finishes, look at the linear ratio of the best value.',
        observe: 'The best cord value does not coincide exactly with the linear tuning: the linear ratio at the optimum is a little below 1. The scan chart shows the peak of the exchange.',
        explain: 'The condition f<sub>r</sub> = 2 f<sub>s</sub> holds only for infinitesimal amplitudes. At finite amplitude the pendulum period grows with angle and the effective spring stiffness changes, so the real frequencies shift and the optimum moves. With x0 = 4 cm the optimum lies at a linear ratio ≈ 0.993–0.995 (a cord about 6 mm shorter than the linear tuning), and with 1 cm at ≈ 0.998: the shift grows with amplitude.',
        teacher: '<b>Expected answer:</b> slightly below 1 (linear ratio at the optimum ≈ 0.993–0.995 at x0 = 4 cm and ≈ 0.998 at 1 cm, point and rigid models; the measured nonlinear ratio ≈ 0.986–0.995. The optimum is flat: report it as a range). <b>Typical mistakes:</b> believing the linear resonance is exact at any amplitude; expecting a shift upward. <b>Discussion:</b> why does the shift grow with amplitude?',
        hint: 'A real pendulum\'s period grows a little with amplitude. If the swing slows down as it grows, should the ideal cord be a bit longer or a bit shorter than the linear tuning?',
      },
    },
  },
  {
    id: 'models', level: 3, model: 'elastic',
    setup: { preset: 'bare', params: {}, ic: null, chart1: 'disp', speed: 1 },
    look: ['#model-seg', '#t-fs'],
    predict: { kind: 'number', unit: '%', decimals: 1 },
    expected: () => fsDiff(),
    success: c => { trackFs(c); return ['point', 'rigid', 'elastic'].every(m => fsByModel.has(m)); },
    measured: () => fsDiff(),
    text: {
      es: {
        title: 'Tres modelos, tres f_s', concept: 'Validez de los modelos',
        predict: 'La frecuencia de balanceo del modelo de resorte elástico, f<sub>s</sub>, ¿qué porcentaje difiere de la del modelo de masa puntual (con los mismos datos)? Escribe el cambio con signo (negativo si es menor).',
        options: [],
        act: 'Pulsa «Preparar el simulador» (iPhone 17 sin funda, modelo elástico). Con los botones «Resorte elástico», «Sólido rígido» y «Masa puntual» del panel «Sintonía» cambia a los tres modelos y lee f<sub>s</sub> en cada uno, sin tocar otros parámetros.',
        observe: 'f<sub>s</sub> baja un poco del modelo puntual al rígido y otro poco más al elástico. f<sub>r</sub> casi no cambia entre modelos.',
        explain: 'La masa puntual ignora tres efectos. El sólido rígido añade la inercia de rotación del teléfono, que baja un poco f<sub>s</sub> (≈ 0,9 % menos). El resorte elástico reparte su masa a lo largo de las espiras y se flexiona, lo que la baja hasta ≈ 1,3 % por debajo del modelo puntual. Son diferencias pequeñas, pero el intercambio de energía es muy sensible a ellas porque la resonancia es estrecha.',
        teacher: '<b>Respuesta esperada:</b> ≈ −1,3 % (f<sub>s</sub> 0,8341 → 0,8236 Hz; rígido 0,8265 Hz, −0,9 %). <b>Errores típicos:</b> esperar diferencias grandes (&gt; 10 %) o ignorar el signo. <b>Pregunta:</b> ¿por qué un 1 % de diferencia importa en la sintonía y no en una medición cotidiana?',
        hint: 'Un péndulo físico (un cuerpo extendido que rota) oscila más lento que una masa puntual a la misma distancia. ¿Esperas diferencias de decenas de por ciento o de alrededor de un 1 %?',
      },
      en: {
        title: 'Three models, three f_s', concept: 'Model validity',
        predict: 'By what percentage does the swing frequency f<sub>s</sub> of the elastic-spring model differ from that of the point-mass model (same data)? Enter the signed change (negative if lower).',
        options: [],
        act: 'Press "Set up the simulator" (bare iPhone 17, elastic model). With the "Elastic spring", "Rigid body" and "Point mass" buttons in the "Tuning" panel switch through all three models and read f<sub>s</sub> for each, without changing other parameters.',
        observe: 'f<sub>s</sub> drops a little from the point model to the rigid one and a bit more for the elastic one. f<sub>r</sub> hardly changes between models.',
        explain: 'The point mass ignores three effects. The rigid body adds the phone rotational inertia, which lowers f<sub>s</sub> slightly (≈ 0.9 % lower). The elastic spring distributes its mass along the coils and bends, bringing it to ≈ 1.3 % below the point model. The differences are small, but the energy exchange is very sensitive to them because the resonance is narrow.',
        teacher: '<b>Expected answer:</b> ≈ −1.3 % (f<sub>s</sub> 0.8341 → 0.8236 Hz; rigid 0.8265 Hz, −0.9 %). <b>Typical mistakes:</b> expecting large differences (&gt; 10 %) or ignoring the sign. <b>Discussion:</b> why does a 1 % difference matter for tuning but not for an everyday measurement?',
        hint: 'A physical pendulum (an extended body that rotates) swings more slowly than a point mass at the same distance. Do you expect differences of tens of per cent or of about 1 %?',
      },
    },
  },
];
