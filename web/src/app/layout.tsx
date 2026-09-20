import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import Nav from '@/components/Nav';
import LocaleProvider from '@/i18n/LocaleProvider';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'GraphMan',
    template: '%s · GraphMan',
  },
  description:
    'Uma biblioteca de grafos em Rust que mede a si mesma, rodando no seu navegador: carregue um grafo, arraste seus vértices e veja BFS e DFS acontecerem.',
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
    <html lang="pt-BR" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <LocaleProvider>
          <Nav />
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}
