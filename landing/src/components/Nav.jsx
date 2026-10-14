import { useState } from 'react';
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from 'motion/react';
import { List, X, ArrowUpRight } from '@phosphor-icons/react';
import { goTo } from '../lib/lenis.js';

const APP_URL = import.meta.env.VITE_APP_URL || '/app/';      // the planner: the plot is entered there, in one place

/* Morphing scroll navbar: full-width at the top, a blurred floating pill after you scroll, a compact pill while
   you scroll down, expanded again on scroll up, with a reading-progress line. (Behaviour inspired by the
   "Morphing Scroll Navbar" pattern on 21st.dev, written from scratch.) */
const LINKS = [
  { id: 'how', label: 'How it works' },
  { id: 'results', label: 'Results' },
];
const REPO = 'https://github.com/AhmedRaza-2/naqsha-prototype';
const HERO_INK = { color: '#3a2f2c' };
const HERO_SOFT = { color: 'rgb(58 47 44 / 0.78)' };

function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="M9 23V9h14M9 16h8v7" fill="none" stroke="var(--accent-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Nav() {
  const { scrollY, scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 28, mass: 0.4 });
  const [mode, setMode] = useState('top'); // top | float | compact
  const [open, setOpen] = useState(false);

  useMotionValueEvent(scrollY, 'change', (y) => {
    const prev = scrollY.getPrevious() ?? 0;
    if (y < 48) setMode('top');
    else if (y > prev + 3 && y > 320) { setMode('compact'); setOpen(false); }
    else if (y < prev - 3) setMode('float');
  });

  const top = mode === 'top';
  const compact = mode === 'compact';

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-40 flex flex-col items-center px-3 pt-3 md:px-5">
      <nav
        aria-label="Primary"
        className={`pointer-events-auto relative flex h-14 w-full items-center justify-between gap-3 overflow-hidden rounded-full pl-4 pr-2 transition-[max-width,background-color,border-color,box-shadow] duration-500 ease-out-expo ${
          top
            ? 'max-w-7xl border border-transparent'
            : `border border-line bg-glass shadow-[0_10px_30px_-18px_rgba(58,47,44,0.45)] backdrop-blur-xl ${compact ? 'max-w-[20.5rem] md:max-w-[17.5rem]' : 'max-w-3xl'}`
        }`}
      >
        <a
          href="#top"
          onClick={(e) => { e.preventDefault(); goTo('top', { duration: 2.4 }); }}
          className="flex items-center gap-2.5 text-[1.02rem] font-semibold tracking-tight text-ink"
          style={top ? HERO_INK : undefined}
        >
          <Mark /> Naqsha
        </a>

        <AnimatePresence initial={false}>
          {!compact && (
            <motion.ul
              key="links"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
              className="hidden items-center gap-1 md:flex"
            >
              {LINKS.map((l) => (
                <li key={l.id}>
                  <button type="button" onClick={() => goTo(l.id, { duration: 1.4 })} className="rounded-full px-4 py-2 text-sm text-soft transition-colors hover:text-ink" style={top ? HERO_SOFT : undefined}>
                    {l.label}
                  </button>
                </li>
              ))}
              <li>
                <a href={REPO} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm text-soft transition-colors hover:text-ink" style={top ? HERO_SOFT : undefined}>
                  Source <ArrowUpRight size={14} weight="bold" />
                </a>
              </li>
            </motion.ul>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-1">
          <a
            href={APP_URL}
            className="inline-flex h-10 items-center whitespace-nowrap rounded-full bg-accent px-4 text-sm font-medium text-accent-ink md:px-5 transition-transform duration-300 ease-out-expo hover:-translate-y-px active:translate-y-px active:scale-[0.98]"
          >
            Plan my house
          </a>
          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="grid size-10 place-items-center rounded-full text-ink md:hidden"
            style={top ? HERO_INK : undefined}
          >
            {open ? <X size={20} /> : <List size={20} />}
          </button>
        </div>

        {!top && <motion.div aria-hidden="true" style={{ scaleX: progress }} className="absolute inset-x-5 bottom-0 h-[2px] origin-left bg-accent" />}
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}
            className="pointer-events-auto mt-2 w-full max-w-3xl rounded-surface border border-line bg-glass p-2 backdrop-blur-xl md:hidden"
          >
            {LINKS.map((l) => (
              <button key={l.id} type="button" onClick={() => { setOpen(false); goTo(l.id, { duration: 1.4 }); }} className="block w-full rounded-full px-4 py-3 text-left text-base text-ink">
                {l.label}
              </button>
            ))}
            <a href={REPO} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-full px-4 py-3 text-base text-ink">
              Source <ArrowUpRight size={16} weight="bold" />
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
