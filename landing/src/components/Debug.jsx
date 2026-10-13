import { useEffect, useState } from 'react';

/* Open the page with ?debug to see why the 3D hero is not rendering. Send a screenshot of this box. */
export default function Debug() {
  const [info, setInfo] = useState({});
  useEffect(() => {
    const read = () => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      const canvas = document.querySelector('#top canvas');
      setInfo({
        webgl: gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'available') : 'NOT AVAILABLE',
        canvas: canvas ? `${canvas.width}x${canvas.height}` : 'none yet',
        status: document.querySelector('[role=status]')?.textContent || 'ready or hidden',
        screen: `${innerWidth}x${innerHeight} @${devicePixelRatio}x`,
        scrollY: Math.round(scrollY),
        reduceMotion: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'ON (system asks for reduced motion)' : 'off',
        motion: document.documentElement.dataset.motion || 'on',
        contextLost: !!window.__naqsha?.contextLost,
        errors: window.__naqshaErrors?.length ? window.__naqshaErrors.join(' | ') : 'none',
        browser: navigator.userAgent.match(/(Chrome|Firefox|Edg|Safari)\/[\d.]+/g)?.join(' ') || navigator.userAgent.slice(0, 60),
      });
    };
    read();
    const id = setInterval(read, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <pre className="fixed bottom-3 left-3 z-[100] max-w-[min(92vw,34rem)] overflow-auto whitespace-pre-wrap rounded-surface bg-black/85 p-3 font-mono text-[11px] leading-snug text-white">
      {Object.entries(info).map(([k, v]) => `${k.padEnd(12)} ${v}`).join('\n')}
    </pre>
  );
}
