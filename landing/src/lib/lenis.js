import Lenis from 'lenis';

let lenis = null;

/** Smooth scrolling on top of the native scroll position (so Motion's useScroll keeps working). */
export function startLenis() {
  if (lenis) return lenis;
  lenis = new Lenis({ autoRaf: true, lerp: 0.1, wheelMultiplier: 1, smoothWheel: true });
  return lenis;
}

export function stopLenis() {
  lenis?.destroy();
  lenis = null;
}

/** Scroll to an element id. Slow on purpose when it has to cross the hero, so the camera flies through the door. */
export function goTo(id, { duration = 1.6, offset = 0 } = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  if (lenis) lenis.scrollTo(el, { duration, offset, easing: (t) => 1 - Math.pow(1 - t, 3) });
  else el.scrollIntoView({ behavior: 'auto', block: 'start' });
}
