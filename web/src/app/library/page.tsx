import type { Metadata } from 'next';
import Decisions from '@/components/Decisions';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Biblioteca',
  description:
    'A biblioteca Rust do GraphMan: um trait Graph, três representações, quatro diâmetros.',
};

export default function LibraryPage() {
  return (
    <>
      <main className="page">
        <Decisions />
      </main>
      <Footer />
    </>
  );
}
