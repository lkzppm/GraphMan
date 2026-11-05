// The DBLP collaboration network, rebuilt every month by the `dblp`
// workflow (`.github/workflows/dblp.yml`): `graphman dblp` turns the DBLP
// XML dump into the course format for a GitHub release (the archive) and
// into one file per year for the repository's GitHub Pages, the one GitHub
// host that answers a browser's fetch with CORS headers (release assets
// and dblp.org itself do not). The page reads the manifest there, streams
// the years up to the one chosen through the browser's gunzip and sums them
// in wasm (`NetworkBuilder`) into that year's network.

/** Where the latest build lives. `NEXT_PUBLIC_DBLP_SITE` points elsewhere, e.g.
    `/dblp-data` for a build copied into `web/public/dblp-data` (see
    `spec/WORKFLOW.md`). */
export const DBLP_SITE = process.env.NEXT_PUBLIC_DBLP_SITE || 'https://lkzppm.github.io/GraphMan';
/** Every monthly build, with the whole files. */
export const DBLP_RELEASES = 'https://github.com/lkzppm/GraphMan/releases';
/** DBLP's own page about the dump. */
export const DBLP_XML = 'https://dblp.org/xml/';

/** One published file: its name, its size on the host and once unpacked,
    and its parts when the host's 100 MB cap made it split. */
export interface DblpFile {
  file: string;
  bytes: number;
  rawBytes: number;
  parts?: string[];
}

/** One year of the build: what every pair gained that year (`strengths`,
    `u v strength` lines) and the researchers first seen that year
    (`names`, `vertex,name` lines), with the size of the network up to and
    including it. The last year holds the undated papers too, so it is the
    whole network. */
export interface DblpYear {
  year: number;
  vertices: number;
  edges: number;
  /** Lines in the strengths file. */
  pairs: number;
  strengths: DblpFile;
  names: DblpFile;
}

/** `manifest.json`, as `graphman dblp --site` writes it
    (`crates/graphman-cli/src/commands/dblp.rs`) plus the `release` link the
    workflow adds. */
export interface DblpManifest {
  schema: number;
  generator: string;
  /** Unix seconds. */
  builtAt: number;
  /** The dump's release date, `YYYY-MM-DD`. */
  date: string | null;
  source: string | null;
  dump: string;
  formalOnly: boolean;
  weight: string;
  records: number;
  skipped: number;
  papers: number;
  authors: number;
  edges: number;
  firstYear: number | null;
  lastYear: number | null;
  /** Ascending, one entry per year from the first to the last. */
  years: DblpYear[];
  release?: string;
}

export async function fetchManifest(signal?: AbortSignal): Promise<DblpManifest> {
  const response = await fetch(`${DBLP_SITE}/manifest.json`, { signal, cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const manifest = (await response.json()) as DblpManifest;
  if (manifest.schema !== 2 || !Array.isArray(manifest.years) || manifest.years.length === 0) {
    throw new Error('unexpected manifest');
  }
  return manifest;
}

/** The years up to `year`, in order: what builds that year's network. */
export function yearsUpTo(manifest: DblpManifest, year: number): DblpYear[] {
  return manifest.years.filter((entry) => entry.year <= year);
}

/** The bytes to transfer for the network of the years `from` to `to`: the
    strengths of those years, and the names of every year up to `to` (a
    pair's researchers may have been numbered long before). */
export function transferBytes(manifest: DblpManifest, from: number, to: number): number {
  return yearsUpTo(manifest, to).reduce(
    (sum, entry) =>
      sum + (entry.year >= from ? entry.strengths.bytes : 0) + entry.names.bytes,
    0,
  );
}

/** The browser's cache for the build's files, when there is one (a secure
    context): a year loaded once is on disk for the next visit. */
async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open('graphman-dblp');
  } catch {
    return null;
  }
}

/** One part of a file, from the cache when it has it. The URL carries the
    build's version, so a new month never serves last month's bytes. */
async function fetchPart(part: string, version: string, signal?: AbortSignal): Promise<Response> {
  const url = `${DBLP_SITE}/${part}?v=${encodeURIComponent(version)}`;
  const cache = await openCache();
  const hit = await cache?.match(url);
  if (hit) return hit;
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${part}`);
  if (cache) {
    // Stored while it is read; a failure to store is no failure to read.
    cache.put(url, response.clone()).catch(() => {});
  }
  return response;
}

/**
 * Downloads one published file and unpacks it in the browser. The parts of
 * a split file are streamed in order into one gunzip, so the host's cap
 * never shows. `onProgress` gets the compressed bytes received so far
 * (`file.bytes` is the total).
 */
export async function fetchFile(
  file: DblpFile,
  version: string,
  onProgress: (received: number) => void,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const parts = file.parts ?? [file.file];
  const gunzip = new DecompressionStream('gzip');
  // Consumed from the start, so the writer never blocks on a full pipe.
  const unpacked = new Response(gunzip.readable).arrayBuffer();
  const writer = gunzip.writable.getWriter();
  let received = 0;
  try {
    for (const part of parts) {
      const response = await fetchPart(part, version, signal);
      const reader = response.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        onProgress(received);
        await writer.write(value);
      }
    }
    await writer.close();
  } catch (error) {
    await writer.abort(error).catch(() => {});
    throw error;
  }
  return new Uint8Array(await unpacked);
}

/** Hands the visitor a file to save. */
export function saveFile(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'text/plain' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
