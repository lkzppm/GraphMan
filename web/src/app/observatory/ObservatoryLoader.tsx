'use client';

import dynamic from 'next/dynamic';

// The observatory talks to navigator.gpu and the wasm module, neither of
// which exists on the server, so it is only ever rendered in the browser.
const Observatory = dynamic(() => import('@/observatory/Observatory'), {
  ssr: false,
  loading: () => <div style={{ height: 'calc(100dvh - var(--nav-height))' }} />,
});

export default function ObservatoryLoader() {
  return <Observatory />;
}
