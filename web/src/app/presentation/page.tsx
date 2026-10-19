import type { Metadata } from 'next';
import Deck from '@/components/Deck';
import { studies, weightedStudies } from '@/lib/studies';

export const metadata: Metadata = {
  title: 'Apresentação',
  description:
    'As apresentações do GraphMan, parte 1 e parte 2: arquitetura, decisões, pesos, Dijkstra sobre três fronteiras, benchmarks e o QR code do site.',
};

export default function PresentationPage() {
  return (
    <main className="page">
      <Deck studies={studies} weighted={weightedStudies} />
    </main>
  );
}
