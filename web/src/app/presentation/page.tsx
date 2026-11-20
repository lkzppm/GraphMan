import type { Metadata } from 'next';
import Deck from '@/components/Deck';
import { directedStudies, studies, weightedStudies } from '@/lib/studies';

export const metadata: Metadata = {
  title: 'Apresentação',
  description:
    'As apresentações do GraphMan, partes 1, 2 e 3: arquitetura, decisões, pesos, Dijkstra sobre seis fronteiras, direção, Bellman-Ford sobre seis agendas, Floyd-Warshall, benchmarks e o QR code do site.',
};

export default function PresentationPage() {
  return (
    <main className="page">
      <Deck studies={studies} weighted={weightedStudies} directed={directedStudies} />
    </main>
  );
}
