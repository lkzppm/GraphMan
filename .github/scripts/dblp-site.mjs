// Prepares the GitHub Pages copy of a `graphman dblp --site` layout (the
// files the page fetches: per year, the strengths and the names): copies
// the gzipped files and the manifest, splits any file above the host's
// 100 MB cap into numbered parts the page streams back together, records
// those parts and the release link in the manifest, and writes an index
// that sends a visitor to the site. A schema 1 build (the course-format
// files of the release) is laid out the same way.
//
//   node .github/scripts/dblp-site.mjs <layout dir> <site dir> [release url]

import {
  closeSync,
  copyFileSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const [, , from, to, release] = process.argv;
if (!from || !to) {
  console.error("usage: dblp-site.mjs <build dir> <site dir> [release url]");
  process.exit(1);
}

/** Safely under GitHub's 100 MB per-file limit. */
const PART_BYTES = 95 * 1024 * 1024;

const manifest = JSON.parse(readFileSync(join(from, "manifest.json"), "utf8"));
mkdirSync(to, { recursive: true });

const entries = manifest.years ?? manifest.tiers ?? [];
for (const entry of entries) {
  for (const file of [entry.strengths ?? entry.graph, entry.names]) {
    const source = join(from, file.file);
    const size = statSync(source).size;
    if (size <= PART_BYTES) {
      copyFileSync(source, join(to, file.file));
      continue;
    }
    const parts = [];
    const fd = openSync(source, "r");
    for (
      let offset = 0, index = 0;
      offset < size;
      offset += PART_BYTES, index++
    ) {
      const buffer = Buffer.alloc(Math.min(PART_BYTES, size - offset));
      readSync(fd, buffer, 0, buffer.length, offset);
      const name = `${file.file}.${index}`;
      writeFileSync(join(to, name), buffer);
      parts.push(name);
    }
    closeSync(fd);
    file.parts = parts;
    console.log(`${file.file}: ${size} bytes in ${parts.length} parts`);
  }
}

if (release) manifest.release = release;
writeFileSync(join(to, "manifest.json"), JSON.stringify(manifest));
writeFileSync(join(to, ".nojekyll"), "");
writeFileSync(
  join(to, "index.html"),
  [
    "<!doctype html>",
    '<meta charset="utf-8">',
    '<meta http-equiv="refresh" content="0; url=https://graphman-ufrj.vercel.app/dblp">',
    "<title>GraphMan · DBLP</title>",
    '<p>The DBLP collaboration network, rebuilt monthly: <a href="https://graphman-ufrj.vercel.app/dblp">graphman-ufrj.vercel.app/dblp</a></p>',
    "",
  ].join("\n"),
);
console.log(`site in ${to}: ${entries.length} ${manifest.years ? "years" : "networks"}`);
