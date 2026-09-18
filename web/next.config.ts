import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The wasm glue in src/wasm is generated (wasm-bindgen); it ships as plain
  // JS and fetches the .wasm binary from /wasm at runtime, so no bundler
  // configuration for WebAssembly is needed.
  reactStrictMode: true,
  headers: async () => [
    {
      source: '/wasm/:path*',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
    },
    {
      // Cross-origin isolation: browsers then stop coarsening performance.now()
      // (Chrome 100 µs → 5 µs, Firefox 1 ms → 20 µs), which is what the
      // observatory times a single BFS/DFS with. Everything the site loads is
      // same-origin (fonts, wasm), so require-corp blocks nothing.
      source: '/:path*',
      headers: [
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
      ],
    },
  ],
};

export default nextConfig;
