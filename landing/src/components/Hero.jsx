import { Component, lazy, Suspense, useCallback, useRef, useState } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import { useMotion } from '../lib/motion.js';
import { ArrowRight } from '@phosphor-icons/react';

const APP_URL = import.meta.env.VITE_APP_URL || '/app/';      // the planner: the plot is entered there, in one place

// Three.js (the heavy part) is its own chunk: the headline paints first, the scene fades in once ready.
const HouseScene = lazy(() => import('./HouseScene.jsx'));

class SceneBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFail?.(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export default function Hero() {
  const track = useRef(null);
  const { reduced: reduce } = useMotion();
  const [scene, setScene] = useState('loading'); // loading | ready | failed
  const onReady = useCallback(() => setScene('ready'), []);
  const onFail = useCallback(() => setScene('failed'), []);
  const ready = scene === 'ready';
  const { scrollYProgress } = useScroll({ target: track, offset: ['start start', 'end end'] });

  const textOpacity = useTransform(scrollYProgress, [0, 0.11], [1, 0]);
  const textY = useTransform(scrollYProgress, [0, 0.11], [0, -36]);
  const glow = useTransform(scrollYProgress, [0.74, 0.95], [0, 0.55]);

  return (
    <section
      ref={track}
      id="top"
      className={reduce ? 'relative h-[100dvh]' : 'relative h-[360vh] md:h-[440vh]'}
      aria-label="A house you walk into as you scroll"
    >
      <div className="sticky top-0 h-[100dvh] overflow-hidden">
        {/* poster: paints instantly, covered once the scene has rendered */}
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(120% 70% at 20% 0%, #fbf0dc 0%, rgba(251,240,220,0) 55%), linear-gradient(#c8d0c8 0%, #efeae2 58%, #b3c0b4 58.2%, #a9b9aa 100%)' }}
        />
        <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? 'opacity-100' : 'opacity-0'}`}>
          <SceneBoundary onFail={onFail}>
            <Suspense fallback={null}>
              <HouseScene progress={reduce ? null : scrollYProgress} still={!!reduce} onReady={onReady} onFail={onFail} />
            </Suspense>
          </SceneBoundary>
        </div>

        {/* what the visitor sees while the 3D scene loads, or if it cannot start */}
        {scene !== 'ready' && (
          <p role="status" className="hero-ink absolute inset-x-0 bottom-8 mx-auto flex w-fit max-w-[90vw] items-center gap-3 rounded-full bg-[#fbf8f1]/80 px-5 py-2.5 text-sm backdrop-blur">
            {scene === 'loading' ? (
              <><span className="relative h-1.5 w-20 overflow-hidden rounded-full bg-[#c8d0c8]"><span className="absolute inset-y-0 left-0 w-1/2 animate-[load_1.2s_ease-in-out_infinite] rounded-full bg-[#394845]" /></span>Loading the house</>
            ) : '3D is not available in this browser. You can still scroll down to plan your house.'}
          </p>
        )}

        <motion.div
          style={reduce ? undefined : { opacity: textOpacity, y: textY }}
          className="hero-ink relative mx-auto flex h-full max-w-7xl flex-col justify-start px-5 pt-24 md:px-8"
        >
          <h1 className="display max-w-[13ch] text-[2.65rem] sm:text-6xl md:max-w-[15ch] md:text-[clamp(2.75rem,9vh,4.5rem)]">
            Walk into the house before you build it.
          </h1>
          <p className="mt-4 max-w-[34ch] text-base leading-relaxed text-[#3a2f2c]/80 md:mt-5 md:text-lg">
            Enter your plot size. Naqsha drafts room layouts for Pakistani homes, then lets you walk through them in 3D.
          </p>
          <div className="mt-7">
            <a
              href={APP_URL}
              className="group inline-flex h-12 items-center gap-2 rounded-full bg-[#394845] pl-6 pr-5 text-[0.95rem] font-medium text-[#fbf8f1] transition-transform duration-300 ease-out-expo hover:-translate-y-px active:translate-y-px active:scale-[0.98]"
            >
              Plan my house
              <ArrowRight size={18} weight="bold" className="transition-transform duration-300 group-hover:translate-x-0.5" />
            </a>
          </div>
        </motion.div>

        {/* warm light from the hall grows as you walk in; the next section then rises over it */}
        {!reduce && (
          <motion.div
            aria-hidden="true"
            style={{ opacity: glow, background: 'radial-gradient(circle at 50% 56%, #fff7e6 0%, #fdf2dc 50%, #fbf8f1 100%)' }}
            className="pointer-events-none absolute inset-0"
          />
        )}
      </div>
    </section>
  );
}
