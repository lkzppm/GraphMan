import type { Metadata } from 'next';
import Deck from '@/components/Deck';
import { studies } from '@/lib/studies';

export const metadata: Metadata = {
  title: 'Apresentação',
  description:
    'Os cinco slides da apresentação do GraphMan: arquitetura, decisões, estudos de caso e o QR code do observatório.',
};

export default function PresentationPage() {
  return (
    <main className="page">
      <Deck studies={studies} />
    </main>
  );
}
