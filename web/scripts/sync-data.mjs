// Copies the latest case-study results into src/data so the landing page can
// import them at build time (Turbopack only bundles files under web/).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
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

// The library page's code examples live in crates/graphman/tests/wiki.rs,
// where `cargo test` proves them; each `// wiki:start <id>` ... `// wiki:end`
// block is copied here, dedented, for the page to show verbatim.
const wiki = join(web, '..', 'crates', 'graphman', 'tests', 'wiki.rs');
const examples = {};
if (existsSync(wiki)) {
  const lines = readFileSync(wiki, 'utf8').split('\n');
  let id = null;
  let block = [];
  for (const line of lines) {
    const start = line.match(/^\s*\/\/ wiki:start (\S+)\s*$/);
    if (start) {
      id = start[1];
      block = [];
    } else if (/^\s*\/\/ wiki:end\s*$/.test(line)) {
      const indent = Math.min(
        ...block.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length),
      );
      examples[id] = block.map((l) => l.slice(indent)).join('\n');
      id = null;
    } else if (id) {
      block.push(line);
    }
  }
}
writeFileSync(join(dataDir, 'wiki.json'), JSON.stringify(examples, null, 2));
console.log(`[data] synced ${Object.keys(examples).length} wiki examples`);
