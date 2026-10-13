import { useSyncExternalStore } from 'react';

/* The hero only moves when the visitor scrolls, so the walk-in plays by default, whatever the OS animation setting says.
   Anyone who wants less movement can switch it off in the footer (remembered), or open the page with ?motion=off. */
const KEY = 'naqsha-motion';
const listeners = new Set();

function stored() {
  const q = new URLSearchParams(location.search).get('motion');
  if (q === 'on' || q === 'off') return q;
  try { return localStorage.getItem(KEY) || 'on'; } catch { return 'on'; }
}

function apply(mode) {
  document.documentElement.dataset.motion = mode;
}

export function setMotion(mode) {
  try { localStorage.setItem(KEY, mode); } catch { /* storage blocked: ignore */ }
  apply(mode);
  listeners.forEach((l) => l());
}

/** reduced === true only when the visitor chose "Reduce motion". */
export function useMotion() {
  const mode = useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, stored, () => 'on');
  apply(mode);
  return { reduced: mode === 'off', mode };
}
