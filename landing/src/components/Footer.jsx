import { ArrowUpRight } from '@phosphor-icons/react';
import { goTo } from '../lib/lenis.js';
import { setMotion, useMotion } from '../lib/motion.js';

const REPO = 'https://github.com/AhmedRaza-2/naqsha-prototype';

/* Giant wordmark footer (pattern inspired by the "Large Name Footer" family on 21st.dev, written from scratch). */
export default function Footer() {
  const { reduced } = useMotion();
  return (
    <footer className="relative overflow-hidden bg-alt pt-20 md:pt-28">
      <div className="mx-auto flex max-w-7xl flex-col justify-between gap-10 px-5 md:flex-row md:px-8">
        <p className="max-w-[40ch] text-base leading-relaxed text-soft">
          Naqsha drafts concept layouts. They are not approved drawings. Check every plan with a registered architect before you build.
        </p>
        <ul className="flex gap-2 self-start">
          <li><button type="button" onClick={() => goTo('how', { duration: 1.4 })} className="rounded-full px-4 py-2 text-sm text-ink transition-colors hover:bg-bg">How it works</button></li>
          <li><button type="button" onClick={() => goTo('results', { duration: 1.4 })} className="rounded-full px-4 py-2 text-sm text-ink transition-colors hover:bg-bg">Results</button></li>
          <li>
            <button type="button" aria-pressed={reduced} onClick={() => setMotion(reduced ? 'on' : 'off')} className="rounded-full px-4 py-2 text-sm text-ink transition-colors hover:bg-bg">
              {reduced ? 'Play motion' : 'Reduce motion'}
            </button>
          </li>
          <li>
            <a href={REPO} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full px-4 py-2 text-sm text-ink transition-colors hover:bg-bg">
              Source <ArrowUpRight size={14} weight="bold" />
            </a>
          </li>
        </ul>
      </div>
      <p aria-hidden="true" className="display mt-10 select-none text-center text-[26vw] leading-[0.74] text-accent md:mt-16 md:text-[26.5vw]" style={{ marginBottom: '-0.04em' }}>
        Naqsha
      </p>
    </footer>
  );
}
