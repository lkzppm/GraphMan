import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import Nav from '@/components/Nav';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'GraphMan',
    template: '%s · GraphMan',
  },
  description:
    'A Rust graph library that measures itself, running in your browser: load a graph, drag its vertices and watch BFS and DFS unfold.',
  icons: {
    icon: [
      { url: '/brand/graphman.svg', type: 'image/svg+xml' },
      { url: '/brand/graphman-32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/brand/graphman-192.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#ffffff',
  colorScheme: 'light',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
