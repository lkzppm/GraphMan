'use client';

import dynamic from 'next/dynamic';

// The console parses the network with the wasm library, which only exists
// in the browser, so like the observatory it is never rendered on the server.
const DblpConsole = dynamic(() => import('@/components/DblpConsole'), {
  ssr: false,
  loading: () => <div style={{ height: 'calc(100dvh - var(--nav-height))' }} />,
});

export default function DblpLoader() {
  return <DblpConsole />;
}
