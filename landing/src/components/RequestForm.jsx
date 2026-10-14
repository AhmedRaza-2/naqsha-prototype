import { useId, useMemo, useRef, useState } from 'react';
import { ArrowRight, CaretDown, CircleNotch, SlidersHorizontal, WarningCircle } from '@phosphor-icons/react';
import { FOCUS, LIMITS, bathOptions, feetError, focusAllowed, maxBeds, parsePlot } from '../lib/parse.js';

const APP_URL = import.meta.env.VITE_APP_URL || '../index.html';
const BEDS = [2, 3, 4, 5, 6];
const CHIPS = ['5 marla', '10 marla', '1 kanal'];

const field = (bad) =>
  `h-12 w-full rounded-surface border bg-bg px-4 text-base outline-none transition-colors placeholder:text-soft/60 focus:border-accent focus:ring-2 focus:ring-accent/25 ${bad ? 'border-err' : 'border-line'}`;
const pill = (on, off) =>
  `min-h-11 rounded-full border px-4 text-[0.95rem] font-medium transition-[background-color,color,transform] duration-200 active:scale-[0.97] ${
    on ? 'border-accent bg-accent text-accent-ink' : 'border-line text-ink hover:border-accent'} ${off ? 'cursor-not-allowed opacity-35 hover:border-line' : ''}`;

function Hint({ error, children, id }) {
  return (
    <p id={id} className={`flex min-h-5 items-start gap-1.5 text-sm ${error ? 'text-err' : 'text-soft'}`}>
      {error && <WarningCircle size={16} weight="fill" className="mt-0.5 shrink-0" />}
      <span>{children}</span>
    </p>
  );
}

/* The request form: plot size and bedrooms up front, "More options" opens exact feet, washrooms and which rooms to
   make bigger. Everything is validated before the visitor is sent to the planner. */
export default function RequestForm() {
  const uid = useId();
  const [text, setText] = useState('');
  const [beds, setBeds] = useState(3);
  const [more, setMore] = useState(false);
  const [wFt, setWFt] = useState('');
  const [dFt, setDFt] = useState('');
  const [baths, setBaths] = useState(null);
  const [focus, setFocus] = useState('balanced');
  const [touched, setTouched] = useState({});
  const [busy, setBusy] = useState(false);
  const plotRef = useRef(null);
  const wRef = useRef(null);
  const dRef = useRef(null);

  const touch = (k) => setTouched((t) => ({ ...t, [k]: true }));

  // ---- the plot: exact feet win over the marla text
  const parsed = useMemo(() => parsePlot(text), [text]);
  const hasFeet = wFt.trim() !== '' || dFt.trim() !== '';
  const feetMsg = hasFeet ? feetError(parseFloat(wFt), parseFloat(dFt)) : '';
  const feetOk = hasFeet && !feetMsg;
  const plot = feetOk
    ? { w: parseFloat(wFt), d: parseFloat(dFt), marla: (parseFloat(wFt) * parseFloat(dFt)) / 225 }
    : parsed && !parsed.error ? parsed : null;
  const marlaText = parsed && !parsed.error ? parsed.marla : null;
  const mismatch = feetOk && marlaText && Math.abs(plot.marla - marlaText) / marlaText > 0.2;

  const textError = !hasFeet && ((touched.plot && !text.trim()) || (parsed?.error && text.trim().length > 2));
  const textMsg = parsed?.error || 'Enter a size like 10 marla or 30x60.';

  // ---- bedrooms and washrooms depend on the plot
  const cap = plot ? maxBeds(plot.w, plot.d) : 6;
  const effBeds = Math.min(beds, cap);
  const baOpts = bathOptions(effBeds);
  const effBaths = baOpts.some((o) => o.n === baths) ? baths : effBeds + 1;
  const bathHint = baOpts.find((o) => o.n === effBaths).hint;
  const effFocus = focusAllowed(focus, plot?.marla) ? focus : 'balanced';

  const plotHelp = feetOk
    ? `${plot.w} x ${plot.d} ft, about ${(Math.round(plot.marla * 10) / 10).toString()} marla`
    : parsed && !parsed.error ? parsed.label : 'Marla, kanal or feet.';

  const submit = (e) => {
    e.preventDefault();
    setTouched({ plot: true, feet: true });
    if (hasFeet && feetMsg) {
      setMore(true);
      (feetMsg.startsWith('Depth') ? dRef : wRef).current?.focus();
      return;
    }
    if (!plot) { plotRef.current?.focus(); return; }
    setBusy(true);
    const dims = feetOk ? { w: plot.w, d: plot.d } : { w: parsed.w, d: parsed.d };
    const label = feetOk ? `${dims.w}x${dims.d}` : text.trim();
    const qs = new URLSearchParams({ q: `${label} ${effBeds} bed`, w: dims.w, d: dims.d, baths: effBaths, focus: effFocus });
    const url = `${APP_URL}${APP_URL.includes('?') ? '&' : '?'}${qs}`;
    window.setTimeout(() => { window.location.href = url; }, 450);
  };

  return (
    <form onSubmit={submit} noValidate className="mt-10 max-w-md">
      <div className="flex flex-col gap-2">
        <label htmlFor={`${uid}plot`} className="text-sm font-medium">Plot size</label>
        <input
          ref={plotRef}
          id={`${uid}plot`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => touch('plot')}
          inputMode="text"
          autoComplete="off"
          placeholder="10 marla, 1 kanal or 30x60"
          aria-invalid={textError || undefined}
          aria-describedby={`${uid}plot-help`}
          className={`${field(textError)} h-14 text-lg`}
        />
        <Hint id={`${uid}plot-help`} error={textError}>
          {textError ? textMsg : <span className="num">{plotHelp}</span>}
        </Hint>
        <div className="flex flex-wrap gap-2 pt-1">
          {CHIPS.map((c) => (
            <button key={c} type="button" onClick={() => { setText(c); touch('plot'); }} className="h-9 rounded-full border border-line px-4 text-sm text-ink transition-colors hover:border-accent active:scale-[0.98]">
              {c}
            </button>
          ))}
        </div>
      </div>

      <fieldset className="mt-8 flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Bedrooms</legend>
        <div className="flex gap-2" role="radiogroup" aria-label="Bedrooms">
          {BEDS.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={n === effBeds} disabled={n > cap} onClick={() => setBeds(n)} className={`${pill(n === effBeds, n > cap)} min-w-12`}>
              {n}
            </button>
          ))}
        </div>
        <p className="min-h-5 text-sm text-soft">
          {plot && cap < 6 ? `A single floor on ${plot.w} x ${plot.d} ft fits up to ${cap} bedrooms.${cap < 4 && plot.marla > 8 ? ' A wider plot (about 38 ft) fits 4.' : ''}` : 'Single floor, ground level.'}
        </p>
      </fieldset>

      <button
        type="button"
        aria-expanded={more}
        aria-controls={`${uid}more`}
        onClick={() => setMore((v) => !v)}
        className="mt-3 inline-flex h-10 items-center gap-2 rounded-full border border-line px-4 text-sm font-medium text-ink transition-colors hover:border-accent active:scale-[0.98]"
      >
        <SlidersHorizontal size={16} />
        More options
        <CaretDown size={14} weight="bold" className={`transition-transform duration-300 ${more ? 'rotate-180' : ''}`} />
      </button>

      {/* grid-rows 0fr -> 1fr opens the panel without measuring its height */}
      <div id={`${uid}more`} className={`grid transition-[grid-template-rows,opacity] duration-500 ease-out-expo ${more ? 'mt-5 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`} aria-hidden={!more}>
        <div className="overflow-hidden">
          <div className="flex flex-col gap-8 rounded-surface bg-alt p-5">
            <fieldset className="flex flex-col gap-2" disabled={!more}>
              <legend className="mb-1 text-sm font-medium">Exact plot size in feet</legend>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-2">
                  <label htmlFor={`${uid}w`} className="text-sm text-soft">Width (ft)</label>
                  <input ref={wRef} id={`${uid}w`} value={wFt} onChange={(e) => setWFt(e.target.value)} onBlur={() => touch('feet')} inputMode="decimal" autoComplete="off"
                    placeholder={parsed && !parsed.error ? String(parsed.w) : '35'} aria-invalid={(touched.feet && !!feetMsg) || undefined} aria-describedby={`${uid}feet-help`} className={field(touched.feet && feetMsg)} />
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor={`${uid}d`} className="text-sm text-soft">Depth (ft)</label>
                  <input ref={dRef} id={`${uid}d`} value={dFt} onChange={(e) => setDFt(e.target.value)} onBlur={() => touch('feet')} inputMode="decimal" autoComplete="off"
                    placeholder={parsed && !parsed.error ? String(parsed.d) : '65'} aria-invalid={(touched.feet && !!feetMsg) || undefined} aria-describedby={`${uid}feet-help`} className={field(touched.feet && feetMsg)} />
                </div>
              </div>
              <Hint id={`${uid}feet-help`} error={touched.feet && !!feetMsg}>
                {touched.feet && feetMsg ? feetMsg
                  : mismatch ? `${plot.w} x ${plot.d} ft is about ${(Math.round(plot.marla * 10) / 10).toString()} marla, not ${Math.round(marlaText)}. We use your feet.`
                  : feetOk ? <span className="num">{plot.w} x {plot.d} ft, about {(Math.round(plot.marla * 10) / 10).toString()} marla</span>
                  : `Optional. ${LIMITS.wMin} to ${LIMITS.wMax} ft wide, ${LIMITS.dMin} to ${LIMITS.dMax} ft deep. Replaces the marla size.`}
              </Hint>
            </fieldset>

            <fieldset className="flex flex-col gap-2" disabled={!more}>
              <legend className="mb-1 text-sm font-medium">Washrooms</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Washrooms">
                {baOpts.map((o) => (
                  <button key={o.n} type="button" role="radio" aria-checked={o.n === effBaths} onClick={() => setBaths(o.n)} className={pill(o.n === effBaths, false)}>
                    <span className="num">{o.n}</span> <span className="font-normal">{o.label}</span>
                  </button>
                ))}
              </div>
              <Hint>{bathHint}</Hint>
            </fieldset>

            <fieldset className="flex flex-col gap-2" disabled={!more}>
              <legend className="mb-1 text-sm font-medium">Make bigger</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Make bigger">
                {FOCUS.map((o) => (
                  <button key={o.id} type="button" role="radio" aria-checked={o.id === effFocus} disabled={!focusAllowed(o.id, plot?.marla)} onClick={() => setFocus(o.id)} className={pill(o.id === effFocus, !focusAllowed(o.id, plot?.marla))}>
                    {o.label}
                  </button>
                ))}
              </div>
              <Hint>{plot && !focusAllowed('kitchen', plot.marla) ? 'A bigger kitchen needs more than 6 marla.' : effFocus === 'balanced' ? 'No preference: rooms are sized in the usual proportions.' : `The ${FOCUS.find((o) => o.id === effFocus).label.toLowerCase()} gets a larger share of the house; other rooms give up some space.`}</Hint>
            </fieldset>
          </div>
        </div>
      </div>

      <button type="submit" disabled={busy}
        className="group mt-9 inline-flex h-14 items-center gap-3 rounded-full bg-accent pl-7 pr-6 text-base font-medium text-accent-ink transition-transform duration-300 ease-out-expo hover:-translate-y-px active:translate-y-px active:scale-[0.98] disabled:opacity-80">
        {busy ? <><CircleNotch size={20} className="animate-spin" /> Opening the planner</> : <>Plan my house <ArrowRight size={20} weight="bold" className="transition-transform duration-300 group-hover:translate-x-1" /></>}
      </button>
    </form>
  );
}
