// Language state shared by the whole app (no DOM dependency). Strings come from two kinds of tables:
//  - addStrings({es:{key:..}, en:{key:..}})  keyed texts (learn panel);
//  - addPairs([[english, spanish], ...])     the English text itself is the key; t(english) -> Spanish when lang is es.
const KEY = 'pr-lang';
const dict = { es: {}, en: {} };
const pairs = new Map();
let lang = null;
const listeners = new Set();

export function addStrings(s) { for (const l of ['es', 'en']) Object.assign(dict[l], s[l]); }
export function addPairs(list) { for (const [en, es] of list) pairs.set(en, es); }

function detect() {
  try { const q = new URLSearchParams(location.search).get('lang'); if (q === 'es' || q === 'en') return q; } catch (e) { /* no location */ }
  try { const s = localStorage.getItem(KEY); if (s === 'es' || s === 'en') return s; } catch (e) { /* no storage */ }
  try { if (typeof navigator !== 'undefined' && /^es/i.test(navigator.language || '')) return 'es'; } catch (e) { /* ignore */ }
  return 'en';
}

export function getLang() { return lang || (lang = detect()); }

export function setLang(l) {
  if (l !== 'es' && l !== 'en') return;
  lang = l;
  try { localStorage.setItem(KEY, l); } catch (e) { /* ignore */ }
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = l;
  for (const fn of [...listeners]) fn(l);
}

export function onLangChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

const subst = (s, vars) => (vars && typeof s === 'string' ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

export function t(key, vars) {
  const l = getLang();
  let s = dict[l][key];
  if (s === undefined && l === 'es') s = pairs.get(key);
  if (s === undefined) s = dict.en[key];
  if (s === undefined) s = key;
  return subst(s, vars);
}

export function pick(obj) {
  if (!obj) return obj;
  const v = obj[getLang()];
  return v !== undefined ? v : obj.en;
}
