// Copies the latest case-study results next to the observatory data and
// writes a manifest of every exported graph, so the app never hard-codes
// what is available.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dataDir = join(root, 'public', 'data');
const results = join(root, '..', 'studies', 'results.json');
mkdirSync(dataDir, { recursive: true });

if (existsSync(results)) {
  copyFileSync(results, join(dataDir, 'results.json'));
  console.log('synced studies/results.json');
} else if (!existsSync(join(dataDir, 'results.json'))) {
  writeFileSync(join(dataDir, 'results.json'), '[]');
  console.log('no studies yet; wrote an empty results.json');
}

const graphs = readdirSync(dataDir)
  .filter((f) => f.endsWith('.json') && f !== 'results.json' && f !== 'manifest.json')
  .map((f) => JSON.parse(readFileSync(join(dataDir, f), 'utf8')))
  .filter((meta) => existsSync(join(dataDir, meta.bfs.file)) && existsSync(join(dataDir, meta.dfs.file)))
  .sort((a, b) => a.vertices - b.vertices || a.edges - b.edges);

writeFileSync(join(dataDir, 'manifest.json'), JSON.stringify({ graphs }, null, 2));
console.log(`manifest: ${graphs.map((g) => g.name).join(', ') || '(no graphs exported)'}`);
