import type { Metadata } from 'next';
import ObservatoryLoader from './ObservatoryLoader';

export const metadata: Metadata = {
  title: 'Observatório',
  description:
    'Carregue um grafo, arraste seus vértices e rode BFS ou DFS com a biblioteca Rust do GraphMan compilada para WebAssembly, desenhada com WebGPU.',
};

export default function ObservatoryPage() {
  return <ObservatoryLoader />;
}
