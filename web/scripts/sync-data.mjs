// Copies the latest case-study results into src/data so the landing page can
// import them at build time (Turbopack only bundles files under web/).
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const web = new URL('..', import.meta.url).pathname;
const dataDir = join(web, 'src', 'data');
const results = join(web, '..', 'studies', 'results.json');
mkdirSync(dataDir, { recursive: true });

if (existsSync(results)) {
  copyFileSync(results, join(dataDir, 'results.json'));
  console.log('[data] synced studies/results.json');
} else {
  writeFileSync(join(dataDir, 'results.json'), '[]');
  console.log('[data] no studies yet; wrote an empty results.json');
}
