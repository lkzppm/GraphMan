import type { Metadata } from 'next';
import Footer from '@/components/Footer';
import Wiki from '@/components/Wiki';
import examples from '@/data/wiki.json';

export const metadata: Metadata = {
  title: 'Biblioteca',
  description:
    'Como usar a biblioteca Rust do GraphMan, capítulo a capítulo, com exemplos testados.',
};

export default function LibraryPage() {
  return (
    <>
      <main className="page">
        <Wiki examples={examples} />
      </main>
      <Footer />
    </>
  );
}
