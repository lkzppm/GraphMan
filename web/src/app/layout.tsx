import type { Metadata, Viewport } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Analytics } from '@vercel/analytics/next';
import Nav from '@/components/Nav';
import LocaleProvider from '@/i18n/LocaleProvider';
import { THEME_BOOT_SCRIPT } from '@/lib/theme';
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
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
  ],
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      // The boot script sets `data-theme` before React hydrates.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <LocaleProvider>
          <Nav />
          {children}
        </LocaleProvider>
        <Analytics />
      </body>
    </html>
  );
}
