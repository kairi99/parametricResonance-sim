// Cache-busting for the published copy: appends ?v=<version> to every relative module, worker, fetch
// and stylesheet reference, so a browser never mixes cached files from two releases.
// Usage: node tools/stamp-version.mjs <site-dir> <version>     (idempotent; run on the copy, not on the source)
import fs from 'node:fs';
import path from 'node:path';

const [dir, version] = process.argv.slice(2);
if (!dir || !/^[\w.-]+$/.test(version || '')) { console.error('usage: stamp-version.mjs <site-dir> <version>'); process.exit(1); }
const tag = u => u.replace(/\?v=[\w.-]+$/, '') + '?v=' + version;
// from './x.js'  import('./x.js')  new URL('./x.js'  fetch('help/es.html')  — relative targets only
const JS_RE = /((?:\bfrom\s+|\bimport\s*\(\s*|\bnew URL\(\s*|\bfetch\(\s*))(['"])((?:\.\.?\/|help\/)[^'"?]+\.(?:js|html)(?:\?v=[\w.-]+)?)\2/g;
const HTML_RE = /((?:src|href)=")(\.\/(?:js|css)\/[^"?]+\.(?:js|css)(?:\?v=[\w.-]+)?)"/g;

let files = 0, refs = 0;
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!['tests', 'dev', 'tools', '.git'].includes(e.name)) walk(p); continue; }
    const isJs = e.name.endsWith('.js'), isHtml = p === path.join(dir, 'index.html');
    if (!isJs && !isHtml) continue;
    const src = fs.readFileSync(p, 'utf8');
    const out = isJs ? src.replace(JS_RE, (m, a, q, u) => (refs++, a + q + tag(u) + q))
      : src.replace(HTML_RE, (m, a, u) => (refs++, a + tag(u) + '"'));
    if (out !== src) { fs.writeFileSync(p, out); files++; }
  }
}
walk(dir);
console.log(`stamped ${refs} references in ${files} files with v=${version}`);
