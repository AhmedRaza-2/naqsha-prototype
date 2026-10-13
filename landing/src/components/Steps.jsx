import { useEffect, useRef, useState } from 'react';
import { Check } from '@phosphor-icons/react';
import data from '../data/plan.json';
import PlanSvg from './PlanSvg.jsx';

const STEPS = [
  { title: 'Describe the plot', body: 'Marla, kanal or feet. Naqsha turns it into a plot outline and applies the setbacks for that size.' },
  { title: 'Draft the layout', body: 'A transformer trained on thousands of Pakistani-style plans writes the rooms row by row, from the road to the back.' },
  { title: 'Check the rules', body: 'Setbacks, room sizes, attached baths, reachable rooms, guest privacy and kitchen ventilation. A plan that fails is dropped.' },
  { title: 'Walk through it', body: 'Pick a layout and walk through it in first person. You see the rooms, the doors and how you move between them.' },
];

const CHECK_TEXT = {
  setbacks: 'Setbacks respected',
  coverage: 'Plot coverage within the limit',
  'min room sizes': 'Rooms meet minimum sizes',
  'attached baths': 'Every bedroom has an attached bath',
  'entrance on road side': 'Entrance faces the road',
  'every room reachable': 'Every room is reachable',
  'guest privacy': 'Guests never cross a bedroom',
  'bedroom not opening into kitchen': 'No bedroom opens into the kitchen',
  'kitchen ventilation': 'Kitchen has an outside window',
  'natural light': 'Bedrooms and drawing room get daylight',
};

// step -> how much of the plan is drawn (0 outline, 2 rooms and names, 3 baths marked, 4 walking route)
const STAGE = [0, 2, 3, 4];

export default function Steps() {
  const [active, setActive] = useState(0);
  const refs = useRef([]);

  useEffect(() => {
    // the step whose block crosses the middle of the viewport becomes active
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActive(Number(e.target.dataset.i)); }),
      { rootMargin: '-45% 0px -45% 0px' },
    );
    refs.current.forEach((n) => n && io.observe(n));
    return () => io.disconnect();
  }, []);

  const plan = data.plans[0];

  return (
    <section id="how" className="relative bg-alt py-24 md:py-36">
      <div className="mx-auto max-w-7xl px-5 md:px-8">
        <h2 className="display max-w-[16ch] text-4xl md:text-6xl">From a plot size to a house you can walk through.</h2>

        <div className="mt-12 grid gap-10 lg:mt-20 lg:grid-cols-12 lg:gap-12">
          {/* on phones the plan stays pinned under the nav while the steps scroll beneath it */}
          <div className="sticky top-[4.5rem] z-10 -mx-1 lg:top-24 lg:order-2 lg:col-span-7 lg:self-start">
            <div className="relative flex h-[44dvh] items-stretch gap-6 rounded-surface bg-bg p-3 sm:p-5 lg:h-[calc(100dvh-8rem)] lg:p-8">
              <div className="flex min-w-0 flex-1 items-center justify-center lg:flex-none lg:basis-[62%]">
                <PlanSvg data={data} plan={plan} stage={STAGE[active]} className="block h-full max-h-full w-auto max-w-full" />
              </div>
              <ul
                aria-hidden={active !== 2}
                className={`hidden min-w-0 flex-1 flex-col justify-center gap-2.5 transition-opacity duration-500 lg:flex ${active === 2 ? 'opacity-100' : 'opacity-0'}`}
              >
                {plan.checks.map((c, i) => (
                  <li key={c.name} className="flex items-start gap-2.5 text-[0.95rem] leading-snug" style={{ transitionDelay: active === 2 ? `${i * 55}ms` : '0ms' }}>
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent text-accent-ink"><Check size={12} weight="bold" /></span>
                    {CHECK_TEXT[c.name] || c.name}
                  </li>
                ))}
              </ul>
              <p className={`absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity duration-500 lg:hidden ${active === 2 ? 'opacity-100' : 'opacity-0'}`}>
                <Check size={14} weight="bold" /> <span className="num">{plan.checks.length} of {plan.checks.length}</span> rules passed
              </p>
            </div>
          </div>

          <ol className="lg:order-1 lg:col-span-5">
            {STEPS.map((s, i) => (
              <li key={s.title} ref={(n) => (refs.current[i] = n)} data-i={i}
                className={`flex min-h-[58dvh] flex-col justify-center transition-opacity duration-500 lg:min-h-[78dvh] ${i === active ? 'opacity-100' : 'opacity-40'}`}>
                <h3 className="display text-3xl md:text-4xl">{s.title}</h3>
                <p className="mt-4 max-w-[38ch] text-base leading-relaxed text-soft md:text-lg">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
