import type { Metadata } from 'next';
import Footer from '@/components/Footer';
import Studies from '@/components/Studies';
import { studies } from '@/lib/studies';

export const metadata: Metadata = {
  title: 'Case studies',
  description:
    'Memory, BFS/DFS timings, diameters, components and distances on the six course graphs.',
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
