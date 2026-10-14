// Warms the browser cache with the layout model (about 16 MB) while the visitor reads the form, so the planner,
// which is served from the same site, opens with the model already downloaded. Skipped on data-saver connections.
let started = false;

export function prefetchModel(appUrl) {
  if (started || !appUrl.startsWith('/')) return;           // only when the planner is on this site
  const c = navigator.connection;
  if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))) return;
  started = true;
  (async () => {
    try {
      const base = `${appUrl.replace(/\/$/, '')}/models/`;
      const m = await (await fetch(`${base}manifest.json`, { cache: 'no-cache' })).json();
      const v = `?v=${m.version || 0}`;
      for (const u of [`${base}layout.onnx${v}`, `${base}ort/ort-wasm-simd-threaded.wasm${v}`, `${base}vocab.json${v}`]) {
        await (await fetch(u, { cache: 'force-cache', priority: 'low' })).arrayBuffer();
      }
    } catch { started = false; /* offline or blocked: the planner will download it itself */ }
  })();
}
