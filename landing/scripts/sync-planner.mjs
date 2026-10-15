// Copies the planner (repo root: index.html, styles.css, js/, models/) into public/app so Vercel serves it next to the
// landing page on the same origin. Same origin means the landing page can download the model while the visitor reads,
// and the planner then finds it in the browser cache. Run before `vite build` / `vercel deploy`.
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const out = join(here, '..', 'public', 'app');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'styles.css']) cpSync(join(root, f), join(out, f));
for (const d of ['js', 'models', 'vendor', 'fonts']) {
  if (existsSync(join(root, d))) cpSync(join(root, d), join(out, d), { recursive: true, filter: (p) => !p.endsWith('.fp32.onnx') });
}
console.log('planner copied to', out);
