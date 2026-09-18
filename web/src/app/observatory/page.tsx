import type { Metadata } from 'next';
import ObservatoryLoader from './ObservatoryLoader';

export const metadata: Metadata = {
  title: 'Observatory',
  description:
    'Load a graph, drag its vertices and run BFS or DFS with the GraphMan Rust library compiled to WebAssembly, drawn with WebGPU.',
};

export default function ObservatoryPage() {
  return <ObservatoryLoader />;
}
