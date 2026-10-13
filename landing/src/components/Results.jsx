import { motion } from 'motion/react';
import { useMotion } from '../lib/motion.js';
import { ArrowUpRight } from '@phosphor-icons/react';
import metrics from '../data/metrics.json';

const REPO = 'https://github.com/AhmedRaza-2/naqsha-prototype';

function Bar({ value, tone, delay, reduce }) {
  return (
    <div className="flex items-center gap-4">
      <motion.div
        initial={reduce ? false : { scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ duration: 1, delay, ease: [0.16, 1, 0.3, 1] }}
        style={{ width: `${value}%`, transformOrigin: 'left' }}
        className={`h-3 rounded-full ${tone === 'model' ? 'bg-accent' : 'bg-line'}`}
      />
      <span className="num shrink-0 text-sm">{value.toFixed(1)}%</span>
    </div>
  );
}

export default function Results() {
  const { reduced: reduce } = useMotion();
  return (
    <section id="results" className="relative bg-bg py-24 md:py-36">
      <div className="mx-auto grid max-w-7xl gap-16 px-5 md:px-8 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-7">
          <h2 className="display max-w-[15ch] text-4xl md:text-6xl">Measured on plots the model never saw.</h2>

          <div className="mt-14 flex flex-col gap-12">
            {metrics.rows.map((r, i) => (
              <div key={r.label}>
                <p className="text-lg font-medium md:text-xl">{r.label}</p>
                <div className="mt-4 flex flex-col gap-3">
                  <div>
                    <p className="mb-1.5 text-sm text-soft">Naqsha model</p>
                    <Bar value={r.model} tone="model" delay={i * 0.08} reduce={reduce} />
                  </div>
                  <div>
                    <p className="mb-1.5 text-sm text-soft">Rule-based generator, one try</p>
                    <Bar value={r.baseline} tone="base" delay={i * 0.08 + 0.12} reduce={reduce} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-10 max-w-[56ch] text-sm leading-relaxed text-soft">{metrics.note}</p>
        </div>

        <div className="lg:col-span-4 lg:col-start-9 lg:pt-24">
          <h3 className="display text-3xl md:text-4xl">Open by design.</h3>
          <dl className="mt-8 flex flex-col gap-6 text-base leading-relaxed">
            <div><dt className="font-medium">Model</dt><dd className="text-soft">A small transformer trained from scratch in PyTorch.</dd></div>
            <div><dt className="font-medium">Checks</dt><dd className="text-soft">Setbacks, room sizes, reachability, privacy and ventilation, in plain readable code.</dd></div>
            <div><dt className="font-medium">3D</dt><dd className="text-soft">Three.js, running in your browser.</dd></div>
            <div><dt className="font-medium">Cost</dt><dd className="text-soft">No paid APIs anywhere in the pipeline.</dd></div>
          </dl>
          <a href={REPO} target="_blank" rel="noreferrer"
            className="mt-10 inline-flex h-12 items-center gap-2 rounded-full border border-accent px-6 text-[0.95rem] font-medium text-ink transition-transform duration-300 ease-out-expo hover:-translate-y-px active:translate-y-px active:scale-[0.98]">
            Read the source <ArrowUpRight size={18} weight="bold" />
          </a>
        </div>
      </div>
    </section>
  );
}
