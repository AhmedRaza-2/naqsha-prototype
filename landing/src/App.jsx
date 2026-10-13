import { useEffect } from 'react';
import { useMotion } from './lib/motion.js';
import { startLenis, stopLenis } from './lib/lenis.js';
import Nav from './components/Nav.jsx';
import Hero from './components/Hero.jsx';
import Explain from './components/Explain.jsx';
import Steps from './components/Steps.jsx';
import Results from './components/Results.jsx';
import Footer from './components/Footer.jsx';

export default function App() {
  const { reduced: reduce } = useMotion();
  useEffect(() => {
    if (reduce) return undefined;
    startLenis();
    return stopLenis;
  }, [reduce]);

  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Explain />
        <Steps />
        <Results />
      </main>
      <Footer />
    </>
  );
}
