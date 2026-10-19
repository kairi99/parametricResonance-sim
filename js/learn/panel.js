// Guided-tasks panel (Predict -> Act -> Observe -> Explain). DOM only; all state lives in the engine.
import { t, pick, getLang, setLang, onLangChange } from './i18n.js?v=8644c0b';
import { MIN_EXPLANATION } from './engine.js?v=8644c0b';

const NAME_KEY = 'pr-learn-name';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NUM_RE = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;
export const parseNum = s => { const x = String(s).trim().replace(',', '.'); return NUM_RE.test(x) ? parseFloat(x) : NaN; };
const fmtVal = (v, unit, dec) => (Number.isFinite(v) ? v.toFixed(dec ?? 2) : '–') + (unit ? ' ' + esc(unit) : '');

export function createLearnPanel({ root, engine, app }) {
  const btn = document.getElementById('btn-learn');
  let memName = '';
  const store = {
    get() { try { return localStorage.getItem(NAME_KEY) ?? memName; } catch { return memName; } },
    set(v) { memName = v; try { localStorage.setItem(NAME_KEY, v); } catch { /* storage unavailable */ } },
  };
  let draft = { id: null, text: '', choice: null }, lookIdx = 0, saveTimer = null, pending = null, selfChange = false;

  root.setAttribute('role', 'complementary');
  root.innerHTML = '<div class="lp-head"></div><div class="lp-body"></div><div class="lp-foot"></div>';
  const head = root.firstChild, body = head.nextSibling, foot = root.lastChild;

  function flush() {
    if (!pending) return;
    clearTimeout(saveTimer); saveTimer = null;
    const { id, text } = pending; pending = null;
    selfChange = true; try { engine.setExplanation(id, text); } finally { selfChange = false; }
  }

  // ---------- header / footer ----------
  function renderHead() {
    const { done, total } = engine.progress(), lang = getLang();
    head.innerHTML = `<h2>${esc(t('learn'))}</h2><span class="lp-prog">${esc(t('progress', { n: done, m: total }))}</span>
      <div class="seg" role="group" aria-label="Language"><button data-act="lang" data-l="es" aria-pressed="${lang === 'es'}" class="${lang === 'es' ? 'on' : ''}">ES</button><button data-act="lang" data-l="en" aria-pressed="${lang === 'en'}" class="${lang === 'en' ? 'on' : ''}">EN</button></div>
      <button class="lp-x" data-act="close" aria-label="${esc(t('close'))}" title="${esc(t('close'))}">×</button>`;
    root.setAttribute('aria-label', t('tasks'));
    if (btn) { btn.textContent = t('learn'); btn.title = t('tasks'); }
  }
  function renderFoot() {
    foot.innerHTML = `<input type="text" aria-label="${esc(t('studentName'))}" placeholder="${esc(t('studentName'))}" value="${esc(store.get())}" data-name autocomplete="name">
      <button class="btn sm" data-act="report">${esc(t('report'))}</button><button class="btn sm" data-act="resetAll">${esc(t('resetAll'))}</button>`;
  }

  // ---------- body ----------
  function renderList() {
    const levels = [...new Set(engine.tasks.map(k => k.level))].sort();
    return `<p class="lp-concept">${esc(t('tasks'))}</p>` + levels.map(lv => `<div class="lp-lvl">${esc(t('levels')[lv] || '')}</div>` +
      engine.tasks.filter(k => k.level === lv).map(k => {
        const x = pick(k.text) || {};
        return `<button class="lp-row${engine.rec(k.id).done ? ' done' : ''}" data-act="open" data-id="${esc(k.id)}"><b>${x.title ?? esc(k.id)}</b><span>${x.concept ?? ''}</span></button>`;
      }).join('')).join('');
  }
  function fmtPrediction(task, x, r) {
    const p = task.predict || {};
    if (r.prediction == null) return '–';
    return p.kind === 'choice' ? (x.options?.[r.prediction] ?? r.prediction) : fmtVal(r.prediction, p.unit, p.decimals);
  }
  function renderTask(task) {
    const x = pick(task.text) || {}, r = engine.rec(task.id), p = task.predict || {}, step = r.step;
    if (draft.id !== task.id) { draft = { id: task.id, text: '', choice: null }; lookIdx = 0; }
    let h = `<button class="lp-back" data-act="back">← ${esc(t('back'))}</button>
      <h3 class="lp-title">${x.title ?? ''}</h3><div><span class="lp-tag">${esc(t('levels')[task.level] || '')}</span></div>
      <p class="lp-concept">${x.concept ?? ''}</p>
      <ol class="lp-steps" aria-label="${esc(t('tasks'))}">${t('steps').map((s, i) => `<li class="${i < step ? 'ok' : i === step ? 'cur' : ''}"${i === step ? ' aria-current="step"' : ''}>${esc(s)}</li>`).join('')}</ol>`;
    if (step >= 1) h += `<p class="lp-hint">${esc(t('yourPrediction'))}: <b>${fmtPrediction(task, x, r)}</b></p>`;
    const hintBox = !x.hint ? '' : r.hintUsed ? `<div class="lp-hintbox"><b>${esc(t('hint'))}:</b> ${x.hint}</div>`
      : step <= 1 ? `<div class="btnrow"><button class="btn sm" data-act="hint">${esc(t('showHint'))}</button><span class="lp-hint">${esc(t('hintNote'))}</span></div>` : '';
    if (step === 0) {
      h += `<div class="lp-text">${x.predict ?? ''}</div>`;
      if (p.kind === 'choice') {
        h += `<div class="lp-opts" role="group">${(x.options || []).map((o, i) => `<button data-act="choice" data-i="${i}" aria-pressed="${draft.choice === i}">${o}</button>`).join('')}</div>`;
      } else {
        h += `<div class="lp-pred"><input type="text" inputmode="decimal" autocomplete="off" aria-label="${esc(t('yourValue'))}" placeholder="${esc(t('yourValue'))}" data-num value="${esc(draft.text)}"><span class="u">${esc(p.unit || '')}</span></div>`;
      }
      const ok = p.kind === 'choice' ? draft.choice != null : Number.isFinite(parseNum(draft.text));
      h += `<button class="btn accent" data-act="commit"${ok ? '' : ' disabled'}>${esc(t('commit'))}</button>` + hintBox;
    } else if (step === 1) {
      h += `<div class="lp-text">${x.act ?? ''}</div>`;
      const cur = app.getCtx().params.model;
      if (task.model) h += `<p class="${cur !== task.model ? 'lp-warn' : 'lp-hint'}">${esc(cur !== task.model ? t('wrongModel') : t('modelHint', { m: task.model }))}</p>`;
      h += `<div class="btnrow"><button class="btn accent" data-act="setup">${esc(t('startTask'))}</button>${task.look?.length ? `<button class="btn" data-act="look">${esc(t('lookHere'))}</button>` : ''}</div>
        <p class="lp-hint">${esc(t('waiting'))}</p>` + hintBox;
    } else if (step === 2) {
      h += `<div class="lp-done" role="status">✓ ${esc(t('done'))}</div><div class="lp-text">${x.observe ?? ''}</div>
        <button class="btn accent" data-act="explain">${esc(t('showExplanation'))}</button>`;
    } else {
      let ref = r.measured, label = t('measuredValue');
      if (!ref) {
        label = t('expected');
        try { ref = task.expected?.(app.getCtx()); } catch { ref = null; }
        if (!ref && p.kind === 'choice' && x.options) ref = { text: x.options[p.answer] };
      }
      // the student's own explanation comes first; the model explanation, the expected answer of a
      // choice task and the teacher note unlock only after it is submitted (and locked)
      const sub = r.submitted, n = String(r.explanation).trim().length;
      if (!sub && p.kind === 'choice' && !r.measured) ref = null;
      h += `<dl class="lp-dl"><dt>${esc(t('yourPrediction'))}</dt><dd>${fmtPrediction(task, x, r)}</dd>`;
      if (ref) h += `<dt>${esc(label)}</dt><dd>${ref.text != null ? ref.text : fmtVal(ref.value, ref.unit, p.decimals)}</dd>`;
      h += `</dl>${hintBox}<label class="lp-hint" for="lp-expl">${esc(t('yourExplanation'))}</label>
        <textarea id="lp-expl" data-expl placeholder="${esc(t('explanationPlaceholder'))}"${sub ? ' readonly' : ''}>${esc(r.explanation)}</textarea>`;
      if (!sub) h += `<p class="lp-hint">${esc(t('lockedNote'))}</p><div class="btnrow"><button class="btn accent" data-act="submit"${n >= MIN_EXPLANATION ? '' : ' disabled'}>${esc(t('submit'))}</button>
        <span class="lp-hint" data-need${n >= MIN_EXPLANATION ? ' hidden' : ''}>${esc(t('submitNeed', { n: MIN_EXPLANATION }))}</span></div>`;
      else {
        h += `<h4 class="lp-sub">${esc(t('modelExplanation'))}</h4><div class="lp-text">${x.explain ?? ''}</div>`;
        if (x.teacher) h += `<details class="lp-teacher"><summary>${esc(t('teacher'))}</summary><div class="lp-text">${x.teacher}</div></details>`;
      }
      h += `<div class="btnrow"><button class="btn sm" data-act="resetTask">${esc(t('resetTask'))}</button></div>`;
    }
    return h;
  }
  function render() {
    flush();
    renderHead();
    const id = engine.active, task = id && engine.get(id);
    body.innerHTML = task ? renderTask(task) : renderList();
    app.typeset?.(body);
  }

  // ---------- events ----------
  root.addEventListener('click', ev => {
    const el = ev.target.closest('[data-act]'); if (!el || !root.contains(el)) return;
    const id = engine.active, act = el.dataset.act;
    switch (act) {
      case 'close': api.hide(); break;
      case 'lang': setLang(el.dataset.l); break;
      case 'open': engine.open(el.dataset.id); body.scrollTop = 0; break;
      case 'back': flush(); engine.close(); break;
      case 'choice': {
        draft.choice = +el.dataset.i;
        body.querySelectorAll('[data-act=choice]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.i === draft.choice)));
        body.querySelector('[data-act=commit]').disabled = false; break;
      }
      case 'commit': {
        const task = engine.get(id), v = task.predict?.kind === 'choice' ? draft.choice : parseNum(draft.text);
        engine.commitPrediction(id, v); break;
      }
      case 'setup': {
        const task = engine.get(id); el.disabled = true;
        Promise.resolve(app.applySetup(task)).then(() => engine.markStarted(id)).catch(e => console.error(e)).finally(() => { el.disabled = false; });
        break;
      }
      case 'look': { const look = engine.get(id).look || []; if (look.length) { app.reveal(look[lookIdx % look.length]); lookIdx++; } break; }
      case 'explain': engine.toExplain(id); break;
      case 'hint': engine.useHint(id); break;
      case 'submit': flush(); engine.submit(id); break;
      case 'resetTask': engine.reset(id); draft = { id: null, text: '', choice: null }; break;
      case 'resetAll': if (confirm(t('resetAll') + '?')) { engine.resetAll(); draft = { id: null, text: '', choice: null }; } break;
      case 'report': {
        const lang = getLang(), html = engine.reportHTML({ name: store.get(), lang, pick });
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        a.download = lang === 'es' ? 'informe_tareas.html' : 'task_report.html';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); break;
      }
    }
  });
  root.addEventListener('input', ev => {
    const el = ev.target;
    if (el.matches('[data-num]')) {
      draft.text = el.value;
      const b = body.querySelector('[data-act=commit]'); if (b) b.disabled = !Number.isFinite(parseNum(el.value));
    } else if (el.matches('[data-expl]')) {
      pending = { id: engine.active, text: el.value };
      clearTimeout(saveTimer); saveTimer = setTimeout(flush, 300);
      const ok = el.value.trim().length >= MIN_EXPLANATION, b = body.querySelector('[data-act=submit]');
      if (b) { b.disabled = !ok; body.querySelector('[data-need]').hidden = ok; }
    } else if (el.matches('[data-name]')) store.set(el.value);
  });
  root.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { api.hide(); btn?.focus(); }
    else if (ev.key === 'Enter' && ev.target.matches('[data-num]')) { ev.preventDefault(); const b = body.querySelector('[data-act=commit]'); if (b && !b.disabled) b.click(); }
  });
  root.addEventListener('focusout', ev => { if (ev.target.matches('[data-expl]')) flush(); });

  engine.onChange(() => { if (!selfChange && !root.hidden) render(); else if (!root.hidden) renderHead(); });
  onLangChange(() => { renderFoot(); if (!root.hidden) render(); else renderHead(); });

  const api = {
    show() { root.hidden = false; btn?.setAttribute('aria-expanded', 'true'); render(); },
    hide() { flush(); root.hidden = true; btn?.setAttribute('aria-expanded', 'false'); },
    toggle() { root.hidden ? api.show() : api.hide(); },
    openTask(id) { if (root.hidden) api.show(); engine.open(id); },
  };
  renderFoot(); renderHead();
  return api;
}
