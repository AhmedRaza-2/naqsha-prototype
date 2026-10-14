import { useEffect, useRef, useState } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import { useMotion } from '../lib/motion.js';
import RequestForm from './RequestForm.jsx';
import { prefetchModel } from '../lib/prefetch.js';
import data from '../data/plan.json';
import PlanSvg from './PlanSvg.jsx';

export default function Explain() {
  const section = useRef(null);
  const { reduced: reduce } = useMotion();
  const [active, setActive] = useState(0);

  useEffect(() => {                                           // start the model download as the form comes into view
    const el = section.current;
    if (!el || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { prefetchModel(import.meta.env.VITE_APP_URL || '/app/'); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const { scrollYProgress } = useScroll({ target: section, offset: ['start end', 'end start'] });
  const drift = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [70, -70]);

  return (
    <section
      ref={section}
      className={`relative pb-24 md:pb-36 ${reduce ? 'bg-bg pt-24 md:pt-36' : 'z-20 -mt-[77vh] pt-[20vh] md:-mt-[95vh]'}`}
      style={reduce ? undefined : { background: 'linear-gradient(to bottom, transparent 0, transparent 14vh, var(--bg) 46vh)' }}
    >
      <div id="plan" className="mx-auto grid max-w-7xl gap-14 px-5 md:px-8 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5 lg:pt-8">
          <h2 className="display max-w-[14ch] text-4xl md:text-6xl">Tell us your plot. Get layouts that fit it.</h2>
          <p className="mt-6 max-w-[42ch] text-base leading-relaxed text-soft md:text-lg">
            Type a size like 10 marla or 30x60. Add washrooms or a bigger hall under More options. Every layout is checked before you see it.
          </p>

          <RequestForm />
        </div>

        <motion.div style={{ y: drift }} className="lg:col-span-7">
          <div className="rounded-surface bg-alt p-4 sm:p-8">
            <div className="relative mx-auto aspect-[38/66] w-full max-w-[34rem]">
              {data.plans.map((p, i) => (
                <PlanSvg key={i} data={data} plan={p} stage={3}
                  className={`absolute inset-0 h-full w-full transition-opacity duration-500 ${i === active ? 'opacity-100' : 'pointer-events-none opacity-0'}`} />
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
              <p className="num text-sm text-soft">{data.plot.w} x {data.plot.d} ft, {Math.round(data.marla)} marla, {data.beds} bedrooms</p>
              <div className="flex gap-2" role="tablist" aria-label="Layouts for this plot">
                {data.plans.map((_, i) => (
                  <button key={i} type="button" role="tab" aria-selected={i === active} aria-label={`Layout ${i + 1}`} onClick={() => setActive(i)}
                    className={`size-11 rounded-full border text-sm font-medium transition-colors ${i === active ? 'border-accent bg-accent text-accent-ink' : 'border-line text-ink hover:border-accent'}`}>
                    {String.fromCharCode(65 + i)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
