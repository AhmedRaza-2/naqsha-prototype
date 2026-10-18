// Copies the planner (repo root: index.html, styles.css, js/, models/) into public/app so Vercel serves it next to the
// landing page on the same origin. Same origin means the landing page can download the model while the visitor reads,
// and the planner then finds it in the browser cache. Run before `vite build` / `vercel deploy`.
import { cpSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, '..', 'public', 'app');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'styles.css']) cpSync(join(root, f), join(out, f));
for (const d of ['js', 'models', 'vendor', 'fonts', 'assets']) {
  if (existsSync(join(root, d))) cpSync(join(root, d), join(out, d), { recursive: true, filter: (p) => !p.endsWith('.fp32.onnx') });
}
// the planner downloads layout.onnx?v=<version>; the stamp is the file's own hash (as ml/export_onnx.py writes it), so a
// replaced model can never ship under the old stamp and be served from a visitor's cache
const man = join(out, 'models', 'manifest.json');
if (existsSync(man)) {
  const m = JSON.parse(readFileSync(man, 'utf8'));
  const onnx = readFileSync(join(out, 'models', 'layout.onnx'));
  const version = createHash('sha1').update(onnx).digest('hex').slice(0, 10);
  if (m.version !== version || m.onnx !== onnx.length) {
    console.warn(`models/manifest.json was stale (${m.version}, ${m.onnx} bytes): shipping ${version}, ${onnx.length} bytes`);
    writeFileSync(man, JSON.stringify({ ...m, onnx: onnx.length, version }));
  }
}
console.log('planner copied to', out);
