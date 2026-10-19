// Guided-task state machine, persistence and printable report (no DOM dependency).
const KEY = 'pr-learn-v1';

const blank = () => ({ step: 0, prediction: null, explanation: '', measured: null, done: false, tStart: null, tDone: null, hintUsed: false, hintStep: null, tHint: null, submitted: false, tSubmit: null });
export const MIN_EXPLANATION = 15; // characters needed before the explanation can be submitted

export function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtNum(v, decimals) {
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(decimals ?? 3);
}

export function createEngine({ tasks, storage, now = () => Date.now() }) {
  const byId = new Map(tasks.map(tk => [tk.id, tk]));
  const listeners = new Set();
  const warned = new Set();
  let data = { active: null, recs: {} };

  try {
    const raw = storage && storage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw);
      if (j && typeof j === 'object') data = { active: byId.has(j.active) ? j.active : null, recs: j.recs && typeof j.recs === 'object' ? j.recs : {} };
    }
  } catch (e) { /* corrupt storage: start fresh */ }

  const save = () => { try { storage && storage.setItem(KEY, JSON.stringify(data)); } catch (e) { /* quota / unavailable */ } };
  const emit = () => { save(); for (const fn of [...listeners]) fn(); };
  const need = id => { const tk = byId.get(id); if (!tk) throw new Error('Unknown task: ' + id); return tk; };

  function rec(id) {
    need(id);
    return data.recs[id] || (data.recs[id] = blank());
  }

  const engine = {
    tasks,
    get(id) { return byId.get(id); },
    rec,
    get active() { return data.active; },
    open(id) { need(id); data.active = id; rec(id); emit(); },
    close() { data.active = null; emit(); },
    commitPrediction(id, value) {
      const tk = need(id), r = rec(id), p = tk.predict || {};
      if (r.step !== 0) return false;
      if (p.kind === 'choice') {
        const opts = p.options || tk.text?.en?.options || tk.text?.es?.options;
        const n = Array.isArray(opts) ? opts.length : Infinity;
        if (!Number.isInteger(value) || value < 0 || value >= n) return false;
      } else if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      r.prediction = value; r.step = 1; emit();
      return true;
    },
    markStarted(id) { const r = rec(id); r.tStart = now(); emit(); },
    tick(ctx) {
      const id = data.active;
      if (!id) return false;
      const tk = byId.get(id), r = rec(id);
      if (r.step !== 1) return false;
      let ok = false;
      try { ok = !!tk.success(ctx); } catch (e) {
        ok = false;
        if (!warned.has(id)) { warned.add(id); console.warn('learn: success predicate failed for', id, e); }
      }
      if (!ok) return false;
      let m = null;
      try { m = (tk.measured && tk.measured(ctx)) ?? null; } catch (e) { m = null; }
      r.step = 2; r.done = true; r.tDone = now(); r.measured = m;
      emit();
      return true;
    },
    toExplain(id) { const r = rec(id); if (r.step !== 2) return false; r.step = 3; emit(); return true; },
    setExplanation(id, text) { const r = rec(id); if (r.submitted) return false; r.explanation = String(text ?? ''); emit(); return true; },
    // the hint is offered before the task is done; using it is recorded (and when) for the teacher
    useHint(id) { const r = rec(id); if (r.hintUsed || r.step > 1) return false; r.hintUsed = true; r.hintStep = r.step; r.tHint = now(); emit(); return true; },
    // submitting locks the student's explanation and unlocks the model explanation and the teacher note
    submit(id) {
      const r = rec(id);
      if (r.step !== 3 || r.submitted || String(r.explanation).trim().length < MIN_EXPLANATION) return false;
      r.submitted = true; r.tSubmit = now(); emit(); return true;
    },
    reset(id) { need(id); data.recs[id] = blank(); emit(); },
    resetAll() { data = { active: null, recs: {} }; emit(); },
    progress() {
      let done = 0;
      for (const tk of tasks) if (data.recs[tk.id] && data.recs[tk.id].done) done++;
      return { done, total: tasks.length };
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    reportHTML({ name, lang = 'en', pick } = {}) {
      const es = lang === 'es';
      const L = es
        ? { title: 'Informe de tareas guiadas', student: 'Estudiante', date: 'Fecha', level: 'Nivel', levels: ['', 'Introducción', 'Básica', 'Reto'], pred: 'Predicción', meas: 'Medido', exp: 'Esperado', expl: 'Explicación del estudiante', none: 'Sin explicación.', hint: 'Pista', hintNo: 'no usada', hintYes: ['usada antes de predecir', 'usada durante la actividad'], sub: 'Enviada', notSub: 'sin enviar', na: 'No intentada', started: 'Iniciada', doneAt: 'Completada', prog: 'completadas', open: 'En curso', locale: 'es' }
        : { title: 'Guided tasks report', student: 'Student', date: 'Date', level: 'Level', levels: ['', 'Intro', 'Core', 'Challenge'], pred: 'Prediction', meas: 'Measured', exp: 'Expected', expl: "Student's explanation", none: 'No explanation.', hint: 'Hint', hintNo: 'not used', hintYes: ['used before predicting', 'used during the activity'], sub: 'Submitted', notSub: 'not submitted', na: 'Not attempted', started: 'Started', doneAt: 'Completed', prog: 'done', open: 'In progress', locale: 'en' };
      const pk = pick || (o => (o && (o[lang] ?? o.en)));
      const when = ms => { try { return new Date(ms).toLocaleString(L.locale); } catch (e) { return ''; } };
      const val = (v, unit, dec) => `${fmtNum(v, dec)}${unit ? ' ' + escapeHTML(unit) : ''}`;
      const pr = engine.progress();
      const items = tasks.map(tk => {
        const r = data.recs[tk.id], txt = pk(tk.text) || {}, p = tk.predict || {};
        const head = `<h2>${escapeHTML(String(txt.title ?? tk.id).replace(/<[^>]*>/g, ''))} <span class="lv">${escapeHTML(L.levels[tk.level] || '')}</span></h2>`;
        if (!r || (r.step === 0 && r.prediction === null && !r.explanation)) return `<section>${head}<p class="na">${L.na}</p></section>`;
        let predS = '—';
        if (r.prediction !== null && r.prediction !== undefined) {
          predS = p.kind === 'choice'
            ? escapeHTML((txt.options || [])[r.prediction] ?? r.prediction)
            : val(r.prediction, p.unit, p.decimals);
        }
        let ref = '';
        if (r.measured && Number.isFinite(r.measured.value)) ref = `<dt>${L.meas}</dt><dd>${val(r.measured.value, r.measured.unit, p.decimals)}</dd>`;
        else if (p.kind === 'choice' && r.done) ref = `<dt>${L.exp}</dt><dd>${escapeHTML((txt.options || [])[p.answer] ?? p.answer)}</dd>`;
        const times = [r.tStart ? `${L.started}: ${escapeHTML(when(r.tStart))}` : '', r.tDone ? `${L.doneAt}: ${escapeHTML(when(r.tDone))}` : ''].filter(Boolean).join(' · ');
        const ex = r.explanation ? `<p class="ex">${escapeHTML(r.explanation).replace(/\n/g, '<br>')}</p>` : `<p class="na">${L.none}</p>`;
        const hint = r.hintUsed ? `<b class="hu">${L.hintYes[r.hintStep === 0 ? 0 : 1]}</b>` : L.hintNo;
        const sub = r.submitted ? `${L.sub}: ${escapeHTML(when(r.tSubmit))}` : L.notSub;
        return `<section>${head}<p class="st">${r.done ? '✓' : L.open}${times ? ' · ' + times : ''}</p>` +
          `<dl><dt>${L.pred}</dt><dd>${predS}</dd>${ref}<dt>${L.hint}</dt><dd>${hint}</dd></dl><h3>${L.expl} <span class="lv">${sub}</span></h3>${ex}</section>`;
      }).join('\n');
      return `<!DOCTYPE html>
<html lang="${es ? 'es' : 'en'}"><head><meta charset="utf-8"><title>${L.title}</title>
<style>
body{font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif;color:#111;background:#fff;max-width:760px;margin:24px auto;padding:0 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 4px}h3{font-size:13px;margin:10px 0 2px;color:#444}
.meta{color:#444;margin-bottom:16px}.lv{font-size:11px;font-weight:600;border:1px solid #888;border-radius:8px;padding:0 6px;margin-left:6px;color:#444}
section{border-top:1px solid #ccc;padding:10px 0;break-inside:avoid}.st{margin:0;color:#444;font-size:12px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;margin:6px 0}dt{font-weight:600}dd{margin:0}
.hu{color:#a33}.ex{white-space:normal;margin:2px 0;padding:6px 8px;background:#f4f4f4;border-radius:4px}.na{color:#777;font-style:italic;margin:2px 0}
@media print{body{margin:0}}
</style></head><body>
<h1>${L.title}</h1>
<div class="meta">${L.student}: <b>${escapeHTML(name || '—')}</b> · ${L.date}: ${escapeHTML(when(now()))} · ${pr.done}/${pr.total} ${L.prog}</div>
${items}
</body></html>`;
    },
  };
  return engine;
}
