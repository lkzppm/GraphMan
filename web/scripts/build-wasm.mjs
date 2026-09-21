// Builds crates/graphman-wasm for the browser and drops the result where the
// app expects it:
//
//   src/wasm/graphman.js, graphman.d.ts   wasm-bindgen glue (imported by src/lib/graphman.ts)
//   src/wasm/manifest.ts                  the binary's URL, hashed
//   public/wasm/graphman.<hash>.wasm      the binary, fetched at runtime
//
// The binary's file name carries a content hash because /wasm is served as
// immutable: a rebuilt binary at an unchanged URL would leave browsers
// running the old one against the new glue.
//
// It needs a Rust toolchain with the wasm32-unknown-unknown target and the
// wasm-bindgen CLI at exactly the version pinned in Cargo.lock. Both are
// installed on demand: rustup when running in CI/Vercel and cargo is missing,
// and a prebuilt wasm-bindgen release into web/.cache. So `npm run build`
// works on a fresh Vercel build container as well as on a laptop.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('..', import.meta.url));
const root = join(web, '..');
const cargoBin = join(homedir(), '.cargo', 'bin');
process.env.PATH = `${cargoBin}${delimiter}${process.env.PATH ?? ''}`;

const log = (msg) => console.log(`[wasm] ${msg}`);

function has(cmd) {
  const probe = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
  return !probe.error && probe.status === 0;
}

function run(cmd, args, opts = {}) {
  log(`${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });
}

// 1. A Rust toolchain.
if (!has('cargo')) {
  if (!process.env.CI && !process.env.VERCEL) {
    console.error('cargo not found. Install Rust from https://rustup.rs and try again.');
    process.exit(1);
  }
  log('cargo not found; installing a minimal stable toolchain with rustup');
  execFileSync(
    'sh',
    [
      '-c',
      'curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal',
    ],
    { stdio: 'inherit' },
  );
}
if (has('rustup')) {
  run('rustup', ['target', 'add', 'wasm32-unknown-unknown']);
}

// 2. The wasm-bindgen CLI, matching the crate version in Cargo.lock exactly.
const lock = readFileSync(join(root, 'Cargo.lock'), 'utf8');
const version = /name = "wasm-bindgen"\r?\nversion = "([^"]+)"/.exec(lock)?.[1];
if (!version) {
  console.error('wasm-bindgen is not in Cargo.lock');
  process.exit(1);
}

function bindgenVersionOf(cmd) {
  const probe = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
  return probe.status === 0 ? probe.stdout.trim().split(/\s+/)[1] : null;
}

let bindgen = 'wasm-bindgen';
if (bindgenVersionOf(bindgen) !== version) {
  const targets = {
    'darwin-arm64': 'aarch64-apple-darwin',
    'darwin-x64': 'x86_64-apple-darwin',
    'linux-arm64': 'aarch64-unknown-linux-musl',
    'linux-x64': 'x86_64-unknown-linux-musl',
    'win32-x64': 'x86_64-pc-windows-msvc',
  };
  const target = targets[`${process.platform}-${process.arch}`];
  if (!target) {
    console.error(
      `no prebuilt wasm-bindgen for ${process.platform}-${process.arch}; ` +
        `run \`cargo install wasm-bindgen-cli --version ${version}\` and retry`,
    );
    process.exit(1);
  }
  const name = `wasm-bindgen-${version}-${target}`;
  const dir = join(web, '.cache', name);
  bindgen = join(dir, process.platform === 'win32' ? 'wasm-bindgen.exe' : 'wasm-bindgen');
  if (bindgenVersionOf(bindgen) !== version) {
    const url = `https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${version}/${name}.tar.gz`;
    log(`downloading ${url}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(web, '.cache'), { recursive: true });
    const tarball = join(web, '.cache', `${name}.tar.gz`);
    run('curl', ['-sSfL', url, '-o', tarball]);
    run('tar', ['-xzf', tarball, '-C', join(web, '.cache')]);
    rmSync(tarball, { force: true });
    if (bindgenVersionOf(bindgen) !== version) {
      console.error(`downloaded wasm-bindgen does not report version ${version}`);
      process.exit(1);
    }
  }
}
log(`wasm-bindgen ${version} at ${bindgen}`);

// 3. Compile and bind.
run('cargo', [
  'build',
  '-p',
  'graphman-wasm',
  '--target',
  'wasm32-unknown-unknown',
  '--profile',
  'wasm',
]);
const artifact = join(root, 'target', 'wasm32-unknown-unknown', 'wasm', 'graphman_wasm.wasm');
const outDir = join(web, 'src', 'wasm');
run(bindgen, [
  '--target',
  'web',
  '--typescript',
  '--out-dir',
  outDir,
  '--out-name',
  'graphman',
  artifact,
]);

// 4. The binary is served from /wasm under a content-hashed name; the glue
//    in src/wasm is plain JS and learns the name from manifest.ts.
if (!existsSync(join(outDir, 'graphman.js'))) {
  console.error('wasm-bindgen produced no graphman.js');
  process.exit(1);
}
const binary = readFileSync(join(outDir, 'graphman_bg.wasm'));
const hash = createHash('sha256').update(binary).digest('hex').slice(0, 12);
const publicDir = join(web, 'public', 'wasm');
mkdirSync(publicDir, { recursive: true });
for (const stale of readdirSync(publicDir)) {
  if (stale.endsWith('.wasm')) rmSync(join(publicDir, stale));
}
const name = `graphman.${hash}.wasm`;
copyFileSync(join(outDir, 'graphman_bg.wasm'), join(publicDir, name));
writeFileSync(
  join(outDir, 'manifest.ts'),
  `// Generated by scripts/build-wasm.mjs; the binary's URL (content-hashed).\nexport const WASM_URL = '/wasm/${name}';\n`,
);
log(`done: ${join(publicDir, name)}`);
