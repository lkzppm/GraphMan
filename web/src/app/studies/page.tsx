import type { Metadata } from 'next';
import Footer from '@/components/Footer';
import Studies from '@/components/Studies';
import { studies } from '@/lib/studies';

export const metadata: Metadata = {
  title: 'Estudos de caso',
  description:
    'Memória, tempos de BFS/DFS, diâmetros, componentes e distâncias nos seis grafos da disciplina.',
};

export default function StudiesPage() {
  return (
    <>
      <main className="page">
        <Studies studies={studies} />
      </main>
      <Footer />
    </>
  );
}
