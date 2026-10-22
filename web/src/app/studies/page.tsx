import type { Metadata } from 'next';
import Footer from '@/components/Footer';
import Studies from '@/components/Studies';
import { studies, weightedStudies } from '@/lib/studies';

export const metadata: Metadata = {
  title: 'Estudos de caso',
  description:
    'Memória, tempos de BFS/DFS, diâmetros, componentes e distâncias nos seis grafos da disciplina; Dijkstra com vetor e heap nos grafos com pesos e os caminhos na rede de colaboração.',
};

export default function StudiesPage() {
  return (
    <>
      <main className="page">
        <Studies studies={studies} weighted={weightedStudies} />
      </main>
      <Footer />
    </>
  );
}
