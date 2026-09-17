import { useEffect, useState } from 'react';
import Nav from './components/Nav.tsx';
import Hero from './components/Hero.tsx';
import Observatory from './components/observatory/Observatory.tsx';
import Anatomy from './components/Anatomy.tsx';
import Studies from './components/Studies.tsx';
import Footer from './components/Footer.tsx';
import { fetchManifest, fetchStudies, type GraphMeta, type GraphStudy } from './lib/data.ts';

export default function App() {
  const [graphs, setGraphs] = useState<GraphMeta[]>([]);
  const [studies, setStudies] = useState<GraphStudy[]>([]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetchManifest(), fetchStudies()]).then(([manifest, results]) => {
      if (cancelled) return;
      setGraphs(manifest.graphs);
      setStudies(results);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <Nav />
      <main>
        <Hero graphs={graphs} studies={studies} />
        <Observatory graphs={graphs} />
        <Anatomy />
        <Studies studies={studies} />
      </main>
      <Footer />
    </>
  );
}
