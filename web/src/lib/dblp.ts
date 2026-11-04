// The DBLP collaboration network, rebuilt every month by the `dblp`
// workflow (`.github/workflows/dblp.yml`): `graphman dblp` turns the DBLP
// XML dump into the course format and the files are published twice, as a
// GitHub release (the archive) and on the repository's GitHub Pages, the
// one GitHub host that answers a browser's fetch with CORS headers (release
// assets and dblp.org itself do not). The page reads the manifest there,
// then streams a chosen file through the browser's gunzip.

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

/** The network up to a year (`null`: everything), as two files. */
export interface DblpTier {
  year: number | null;
  vertices: number;
  edges: number;
  graph: DblpFile;
  names: DblpFile;
}

/** `manifest.json`, as `graphman dblp` writes it (`crates/graphman-cli/src/commands/dblp.rs`)
    plus the `release` link the workflow adds. */
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
  tiers: DblpTier[];
  release?: string;
}

export async function fetchManifest(signal?: AbortSignal): Promise<DblpManifest> {
  const response = await fetch(`${DBLP_SITE}/manifest.json`, { signal, cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const manifest = (await response.json()) as DblpManifest;
  if (manifest.schema !== 1 || !Array.isArray(manifest.tiers) || manifest.tiers.length === 0) {
    throw new Error('unexpected manifest');
  }
  return manifest;
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

/** The file's name once unpacked (`rede_colaboracao_2009.txt.gz` → `.txt`). */
export function unpackedName(file: DblpFile): string {
  return file.file.replace(/\.gz$/, '');
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
