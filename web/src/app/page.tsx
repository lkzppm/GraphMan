import Footer from '@/components/Footer';
import Hero from '@/components/Hero';
import Pipeline from '@/components/Pipeline';
import { studies } from '@/lib/studies';

export default function Home() {
  return (
    <>
      <main className="page">
        <Hero studies={studies} />
        <Pipeline />
      </main>
      <Footer />
    </>
  );
}
