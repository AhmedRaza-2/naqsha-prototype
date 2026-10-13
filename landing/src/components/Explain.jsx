import { useMemo, useRef, useState } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import { useMotion } from '../lib/motion.js';
import { ArrowRight, WarningCircle, CircleNotch } from '@phosphor-icons/react';
import { maxBeds, parsePlot } from '../lib/parse.js';
import data from '../data/plan.json';
import PlanSvg from './PlanSvg.jsx';

const APP_URL = import.meta.env.VITE_APP_URL || '../index.html';
const BEDS = [2, 3, 4, 5];
const CHIPS = ['5 marla', '10 marla', '1 kanal'];

export default function Explain() {
  const section = useRef(null);
  const { reduced: reduce } = useMotion();
  const [text, setText] = useState('');
  const [beds, setBeds] = useState(3);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);

  const plot = useMemo(() => parsePlot(text), [text]);
  const valid = plot && !plot.error;
  const cap = valid ? maxBeds(plot.marla) : 5;
  const effBeds = Math.min(beds, cap);
  const showError = (touched && !text.trim()) || (plot && plot.error && text.trim().length > 2);

  const { scrollYProgress } = useScroll({ target: section, offset: ['start end', 'end start'] });
  const drift = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [70, -70]);

  const submit = (e) => {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    setBusy(true);
    const url = `${APP_URL}${APP_URL.includes('?') ? '&' : '?'}q=${encodeURIComponent(`${text.trim()} ${effBeds} bed`)}`;
    window.setTimeout(() => { window.location.href = url; }, 450);
  };

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
            Type a size like 10 marla or 30x60. Every layout is checked for setbacks, room sizes and ventilation before you see it.
          </p>

          <form onSubmit={submit} noValidate className="mt-10 max-w-md">
            <div className="flex flex-col gap-2">
              <label htmlFor="plot" className="text-sm font-medium">Plot size</label>
              <input
                id="plot"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onBlur={() => setTouched(true)}
                inputMode="text"
                autoComplete="off"
                placeholder="10 marla, 1 kanal or 30x60"
                aria-invalid={showError || undefined}
                aria-describedby="plot-help"
                className={`h-14 rounded-surface border bg-bg px-4 text-lg outline-none transition-colors placeholder:text-soft/60 focus:border-accent focus:ring-2 focus:ring-accent/25 ${showError ? 'border-err' : 'border-line'}`}
              />
              <p id="plot-help" className={`flex min-h-5 items-center gap-1.5 text-sm ${showError ? 'text-err' : 'text-soft'}`}>
                {showError ? <><WarningCircle size={16} weight="fill" /> {plot?.error || 'Enter a size like 10 marla or 30x60.'}</>
                  : valid ? <span className="num">{plot.label}</span> : 'Marla, kanal or feet.'}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                {CHIPS.map((c) => (
                  <button key={c} type="button" onClick={() => { setText(c); setTouched(true); }}
                    className="h-9 rounded-full border border-line px-4 text-sm text-ink transition-colors hover:border-accent active:scale-[0.98]">
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <fieldset className="mt-8 flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">Bedrooms</legend>
              <div className="flex gap-2" role="radiogroup">
                {BEDS.map((n) => {
                  const off = n > cap;
                  const on = n === effBeds;
                  return (
                    <button key={n} type="button" role="radio" aria-checked={on} disabled={off} onClick={() => setBeds(n)}
                      className={`h-11 min-w-12 rounded-full border px-4 text-base font-medium transition-[background-color,color,transform] duration-200 active:scale-[0.97] ${
                        on ? 'border-accent bg-accent text-accent-ink' : 'border-line text-ink hover:border-accent'} ${off ? 'cursor-not-allowed opacity-35 hover:border-line' : ''}`}>
                      {n}
                    </button>
                  );
                })}
              </div>
              <p className="min-h-5 text-sm text-soft">
                {valid && cap < 5 ? `A single floor on this plot fits up to ${cap} bedrooms.` : 'Single floor, ground level.'}
              </p>
            </fieldset>

            <button type="submit" disabled={busy}
              className="group mt-9 inline-flex h-14 items-center gap-3 rounded-full bg-accent pl-7 pr-6 text-base font-medium text-accent-ink transition-transform duration-300 ease-out-expo hover:-translate-y-px active:translate-y-px active:scale-[0.98] disabled:opacity-80">
              {busy ? <><CircleNotch size={20} className="animate-spin" /> Opening the planner</> : <>Plan my house <ArrowRight size={20} weight="bold" className="transition-transform duration-300 group-hover:translate-x-1" /></>}
            </button>
          </form>
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
