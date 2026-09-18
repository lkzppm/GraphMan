import type { Metadata } from 'next';
import Decisions from '@/components/Decisions';
import Footer from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Library',
  description: 'The GraphMan Rust library: one Graph trait, three representations, four diameters.',
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
