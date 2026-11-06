'use client';

import { flushSync } from 'react-dom';
import {
  Calendar,
  ChevronDown,
  FileDown,
  FileText,
  Globe,
  LoaderCircle,
  Info,
  Network,
  Route as RouteIcon,
  Share2,
  UsersRound,
  Search,
  SlidersHorizontal,
  Telescope,
  TriangleAlert,
  UserRound,
  X,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Constellation from '@/components/Constellation';
import { useLocale } from '@/i18n/LocaleProvider';
import {
  DBLP_RELEASES,
  fetchFile,
  fetchManifest,
  collectFile,
  saveFile,
  transferBytes,
  yearsUpTo,
  type DblpFile,
  type DblpManifest,
  type DblpYear,
} from '@/lib/dblp';
import { formatBytes, formatInt, formatWeight } from '@/lib/format';
import {
  loadGraphman,
  type Graph,
  type GraphmanModule,
  type NetworkBuilder,
  type Subgraph,
} from '@/lib/graphman';
import { OBSERVATORY_MAX_BYTES, offerGraph, type Handoff } from '@/lib/handoff';
import {
  DBLP_SESSION,
  OBSERVATORY_SESSION,
  keepSession,
  releaseSession,
  sessionBytes,
  takeSession,
} from '@/lib/session';
import styles from './DblpConsole.module.css';

/** The observatory itself, fetched only when the path mode is chosen: it
    brings the WebGPU renderer with it. */
const Observatory = dynamic(() => import('@/observatory/Observatory'), { ssr: false });

/** How a cut picks its vertices (the wasm `SubgraphKind`), or the mode with no
    cut at all: the shortest path between two researchers. */
type Rule = 'ball' | 'mostConnected' | 'whole' | 'path';
const RULES: readonly Rule[] = ['ball', 'mostConnected', 'whole', 'path'];
const RULE_ICONS = {
  ball: UserRound,
  mostConnected: Network,
  whole: Globe,
  path: RouteIcon,
} as const;

/** Where a cut around a researcher stops: at a size, or at a radius (the egonet). */
type CutBy = 'size' | 'radius';
const CUTS: readonly CutBy[] = ['size', 'radius'];

/** Which years make the network: everything up to the year, the year
    alone, or a range ending in it. */
type Span = 'until' | 'only' | 'range';
const SPANS: readonly Span[] = ['until', 'only', 'range'];

/** The smallest cut the slider offers, and what a fresh network opens at. */
const MIN_SIZE = 10;
const DEFAULT_SIZE = 2000;
/** The researcher the course's questions start from, when the year has him. */
const DEFAULT_SEED = 'Edsger W. Dijkstra';
/** Where the course's last question ends, when the year has him, spelled as
    DBLP spells him now (the course's 2009 file has no suffix). */
const DEFAULT_TARGET = 'Daniel R. Figueiredo 0001';
/** How long the counters and the path's canvas take to swap (the CSS's `.fold`). */
const FOLD_MS = 450;
/** The radius a fresh egonet opens at, and the most its slider offers (the
    field beside it takes any). */
const DEFAULT_RADIUS = 1;
const SLIDER_RADIUS = 10;
/** Slider steps (the slider is logarithmic). */
const STEPS = 1000;
/** Past this many vertices the observatory draws, but slowly. */
const HEAVY = 300_000;

/** A network summed and held in wasm for cutting: the years it is made
    of (`key` tells one choice from another) and its size. */
interface Base {
  graph: Graph;
  key: string;
  span: Span;
  from: number;
  year: number;
  vertices: number;
  edges: number;
}

/** One choice of years, as the key a base is compared by. */
function spanKey(span: Span, from: number, year: number): string {
  return span === 'until' ? `until:${year}` : span === 'only' ? `only:${year}` : `${from}:${year}`;
}

/** The first year a choice sums strengths from. */
function spanStart(manifest: DblpManifest, span: Span, from: number, year: number): number {
  return span === 'until' ? manifest.years[0].year : span === 'only' ? year : from;
}

/** A download in flight. */
interface Job {
  received: number;
  total: number;
  phase: 'fetching' | 'parsing';
}

/** A cut's files being written, for one of the two buttons. */
interface Writing {
  action: 'open' | 'export';
  percent: number;
}

/** A cut's file above this opens with the network freed, not parked: both
    would share wasm's 4 GiB, and the whole network leaves 141 MiB beside its
    own copy. Coming back to the tab downloads the years again. */
const FREE_NETWORK_ABOVE = 256 * 1024 * 1024;

/** What summing and building a network takes from wasm's 4 GiB at its peak,
    per edge (measured on the whole network: 2310 MiB for 33.2M edges). */
const WASM_BYTES_PER_EDGE = 73;
/** How much a network and a graph parked beside it may add up to: wasm's
    memory fragments, so far less than 4 GiB is usable in one piece. */
const WASM_ROOM = 2304 * 1024 * 1024;

/** Frees a wasm object. One a trap left borrowed cannot be freed: it stays
    until the reload the out-of-memory notice asks for, and must not hide that
    notice by throwing here. */
function release(object: { free(): void }) {
  try {
    object.free();
  } catch {
    // Left borrowed by a trap.
  }
}

/** How many years download ahead of the one being summed. */
const AHEAD = 4;

/** What the console parks when it unmounts with a network summed, and
    takes back on its next mount if the build is still the same. */
interface DblpSession {
  base: Base;
  builtAt: number;
  seedInput: string;
  targetInput: string;
  rule: Rule;
  cutBy: CutBy;
  size: number;
  radius: number;
}

/** A range opens five years long, or as long as the build allows. */
function defaultFrom(manifest: DblpManifest, year: number): number {
  return Math.max(manifest.years[0].year, year - 4);
}

interface Preview {
  vertices: number;
  edges: number;
  bytes: number;
}

/** A researcher on a path: the vertex in the whole network, and the name. */
interface PathStop {
  vertex: number;
  name: string;
}

/** A shortest path found, for the pair of researchers `key` names; `stops` is
    null when there is none to draw, because they are in different components
    or, when `failed`, because the search itself failed (the notice says why). */
interface Route {
  key: string;
  stops: PathStop[] | null;
  weights: number[];
  distance: number;
  edges: number;
  failed: boolean;
}

/** The library's rule for a cut (the whole network is the earliest vertices,
    all of them). */
function kindOf(module: GraphmanModule, which: Rule) {
  return which === 'ball'
    ? module.SubgraphKind.Ball
    : which === 'mostConnected'
      ? module.SubgraphKind.MostConnected
      : module.SubgraphKind.Earliest;
}

/** What a researcher field holds as a vertex of the network, 0 when it is not
    one. */
function vertexOf(graph: Graph, vertices: number, text: string): number {
  const typed = text.trim();
  if (!typed) return 0;
  if (/^\d+$/.test(typed)) {
    const v = Number(typed);
    return v >= 1 && v <= vertices ? v : 0;
  }
  return graph.vertexNamed(typed) ?? 0;
}

/** The year a fresh page offers: the last one, the whole network. */
function initialYear(manifest: DblpManifest): number {
  return manifest.years[manifest.years.length - 1].year;
}

/**
 * The DBLP tab: one console in the middle of the screen, three boxes in a
 * row. Left, the year: choosing one fetches the years up to it (one small
 * file per year, unpacked in the tab, kept in the browser's cache for next
 * time) and sums them in wasm into that year's network, so any year from
 * the first in DBLP to the dump's can be picked. Centre, the cut: around a researcher, the most
 * connected or the earliest, at the size wanted, or a researcher's egonet,
 * with what it will weigh counted live. Right, the result: opened in the
 * observatory, or exported as the two course-format files. One more mode
 * replaces the cut: the shortest path between two researchers, in the
 * observatory itself (embedded, the stage alone) where the counters were, its
 * results in the upper corners, and the right box takes the path's two files.
 */
export default function DblpConsole() {
  const { t: dictionary } = useLocale();
  const t = dictionary.dblp;
  const lang = dictionary.lang;
  const router = useRouter();
  const [wasm, setWasm] = useState<GraphmanModule | null>(null);
  const [manifest, setManifest] = useState<DblpManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [year, setYear] = useState(0);
  const [span, setSpan] = useState<Span>('until');
  const [from, setFrom] = useState(0);
  const [base, setBase] = useState<Base | null>(null);
  const baseRef = useRef<Base | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const jobRef = useRef<AbortController | null>(null);
  const [seedInput, setSeedInput] = useState('');
  const [targetInput, setTargetInput] = useState('');
  const [rule, setRule] = useState<Rule>('ball');
  const [cutBy, setCutBy] = useState<CutBy>('size');
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [opening, setOpening] = useState(false);
  const [writing, setWriting] = useState<Writing | null>(null);
  const writeRef = useRef<AbortController | null>(null);
  /** Leaving for the observatory with a cut too large to keep the network beside. */
  const freeOnLeaveRef = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadGraphman().then(
      (module) => {
        if (!cancelled) setWasm(module);
      },
      (error: unknown) => {
        if (!cancelled) setNotice(error instanceof Error ? error.message : String(error));
      },
    );
    const controller = new AbortController();
    fetchManifest(controller.signal)
      .then((loaded) => {
        // A network left here on the way out comes back, if it is of this build.
        const saved = takeSession<DblpSession>(DBLP_SESSION);
        if (cancelled) {
          // Gone again before the manifest came: left for the next visit.
          if (saved) keepSession(DBLP_SESSION, saved);
          return;
        }
        if (saved && saved.builtAt === loaded.builtAt) {
          baseRef.current = saved.base;
          setBase(saved.base);
          setYear(saved.base.year);
          setSpan(saved.base.span);
          setFrom(saved.base.from);
          setSeedInput(saved.seedInput);
          setTargetInput(saved.targetInput);
          setRule(saved.rule);
          setCutBy(saved.cutBy);
          setSize(saved.size);
          setRadius(saved.radius);
        } else {
          if (saved) release(saved.base.graph);
          const last = initialYear(loaded);
          setYear(last);
          setFrom(defaultFrom(loaded, last));
        }
        setManifest(loaded);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setManifestError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  /** The inputs as of the last render, for the snapshot taken on unmount. */
  const latest = {
    seedInput,
    targetInput,
    rule,
    cutBy,
    size,
    radius,
    builtAt: manifest?.builtAt ?? 0,
  };
  const latestRef = useRef(latest);
  useEffect(() => {
    latestRef.current = latest;
  });

  // Leaving the page stops a download; a network summed is parked for the
  // next visit, not freed.
  useEffect(
    () => () => {
      jobRef.current?.abort();
      writeRef.current?.abort();
      const base = baseRef.current;
      if (base && freeOnLeaveRef.current) release(base.graph);
      else if (base) keepSession<DblpSession>(DBLP_SESSION, { base, ...latestRef.current });
      baseRef.current = null;
    },
    [],
  );

  const chosen = manifest?.years.find((entry) => entry.year === year) ?? null;
  const key = spanKey(span, from, year);

  /** Downloads the years chosen, unpacks them and sums them in wasm into
      one network: every year up to the last gives its names (the
      numbering), the years of the span their strengths. A few years
      download ahead of the one being summed, which takes them in order. */
  const fetchNetwork = useCallback(async () => {
    if (!wasm || !manifest) return;
    const years = yearsUpTo(manifest, year);
    if (years.length === 0) return;
    const start = spanStart(manifest, span, from, year);
    const wanted = (entry: DblpYear) => entry.year >= start;
    jobRef.current?.abort();
    // The network being cut is about to be replaced.
    writeRef.current?.abort();
    const controller = new AbortController();
    jobRef.current = controller;
    setNotice(null);
    const total = transferBytes(manifest, start, year);
    const version = String(manifest.builtAt);
    // At most this many pairs: the span's lines, and the whole network's.
    const pairs = years.reduce((sum, entry) => sum + (wanted(entry) ? entry.pairs : 0), 0);
    const capacity = Math.min(pairs, years[years.length - 1].edges);
    let builder: NetworkBuilder | null = null;
    let finished = false;
    try {
      // Every file's compressed bytes so far, for the one progress bar.
      const got = new Map<string, number>();
      let painted = 0;
      const progress = (file: DblpFile) => (received: number) => {
        got.set(file.file, received);
        const now = performance.now();
        if (now - painted < 80 && received < file.bytes) return;
        painted = now;
        let sum = 0;
        for (const bytes of got.values()) sum += bytes;
        setJob({ received: Math.min(sum, total), total, phase: 'fetching' });
      };
      setJob({ received: 0, total, phase: 'fetching' });
      const queue: Promise<[Uint8Array | null, Uint8Array]>[] = [];
      const begin = (entry: DblpYear) => {
        const pair = Promise.all([
          wanted(entry)
            ? fetchFile(entry.strengths, version, progress(entry.strengths), controller.signal)
            : Promise.resolve(null),
          fetchFile(entry.names, version, progress(entry.names), controller.signal),
        ]);
        // Reported where it is awaited, not as an unhandled rejection.
        pair.catch(() => {});
        queue.push(pair);
      };
      let next = 0;
      for (; next < Math.min(AHEAD, years.length); next++) begin(years[next]);
      for (let i = 0; i < years.length; i++) {
        const [strengths, names] = await queue[i];
        if (next < years.length) begin(years[next++]);
        if (controller.signal.aborted) return;
        if (!builder) {
          // Summing needs the room the old network holds. It is off the page
          // first: nothing rendered or waiting on a timer may reach it freed.
          const old = baseRef.current;
          if (old) {
            baseRef.current = null;
            flushSync(() => {
              setBase(null);
              setPreview(null);
            });
            release(old.graph);
          }
          const parked = sessionBytes(OBSERVATORY_SESSION);
          if (parked > 0 && capacity * WASM_BYTES_PER_EDGE + parked > WASM_ROOM) {
            releaseSession(OBSERVATORY_SESSION);
            setNotice(t.observatoryClosed);
          }
          builder = new wasm.NetworkBuilder(capacity);
        }
        if (strengths) builder.addStrengths(strengths);
        builder.addNames(names);
        // Let the progress paint between two years.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      setJob({ received: total, total, phase: 'parsing' });
      // Let the status paint before the (synchronous) build.
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (controller.signal.aborted || !builder) return;
      finished = true;
      const graph = builder.finish(wasm.RepresentationKind.Csr, span !== 'until');
      const loaded: Base = {
        graph,
        key,
        span,
        from,
        year,
        vertices: graph.vertexCount,
        edges: graph.edgeCount,
      };
      baseRef.current = loaded;
      setBase(loaded);
      const seed = graph.vertexNamed(DEFAULT_SEED);
      setSeedInput(seed ? DEFAULT_SEED : (graph.name(1) ?? '1'));
      setTargetInput(graph.vertexNamed(DEFAULT_TARGET) ? DEFAULT_TARGET : '');
      setSize((current) => Math.min(current, graph.vertexCount));
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        setNotice(
          error instanceof WebAssembly.RuntimeError ? t.outOfMemory : t.failedFetch(message),
        );
      }
    } finally {
      // `finish` consumed the builder; otherwise its table is freed here.
      if (builder && !finished) release(builder);
      if (jobRef.current === controller) {
        jobRef.current = null;
        setJob(null);
      }
    }
  }, [wasm, manifest, year, span, from, key, t]);

  // A choice of years is fetched at once; another choice cancels the first.
  useEffect(() => {
    if (!wasm || !manifest || !year || baseRef.current?.key === key) return;
    const timer = setTimeout(() => void fetchNetwork(), 0);
    return () => {
      clearTimeout(timer);
      jobRef.current?.abort();
    };
  }, [wasm, manifest, year, key, fetchNetwork]);

  /** The years chosen, for file names: `2018`, `only_2018`, `2014_2018`. */
  const spanStem =
    span === 'until' ? `${year}` : span === 'only' ? `only_${year}` : `${from}_${year}`;
  /** The whole network needs no size: the cut is every vertex, in order. */
  const cutSize = rule === 'whole' ? (base?.vertices ?? size) : size;

  /** The seed as a vertex of the loaded network, 0 when it is not one. */
  const seedVertex = useMemo(
    () => (base ? vertexOf(base.graph, base.vertices, seedInput) : 0),
    [base, seedInput],
  );
  const targetVertex = useMemo(
    () => (base ? vertexOf(base.graph, base.vertices, targetInput) : 0),
    [base, targetInput],
  );

  const suggest = useCallback((text: string) => {
    const graph = baseRef.current?.graph;
    const typed = text.trim();
    if (!graph || typed.length < 2 || /^\d+$/.test(typed)) return [];
    return Array.from(graph.searchNames(typed, 6)).map((v) => ({
      vertex: v,
      name: graph.name(v) ?? String(v),
    }));
  }, []);

  /** The cut chosen, of the network loaded. */
  const byRadius = rule === 'ball' && cutBy === 'radius';
  const cutOf = useCallback(
    (graph: Graph, module: GraphmanModule) =>
      byRadius
        ? graph.egonet(seedVertex, radius)
        : graph.subgraph(kindOf(module, rule), seedVertex || 1, cutSize),
    [byRadius, seedVertex, radius, rule, cutSize],
  );
  /** The cut chosen, for file names. */
  const cutStem = byRadius ? `egonet${radius}` : rule.toLowerCase();

  /** What a failed write says: wasm traps when its memory runs out. */
  const writeFailure = useCallback(
    (error: unknown) =>
      error instanceof WebAssembly.RuntimeError
        ? t.outOfMemory
        : t.failedFiles(error instanceof Error ? error.message : String(error)),
    [t],
  );

  // What the cut would be, counted a moment after the last change.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!base || !wasm || rule === 'path' || (rule === 'ball' && !seedVertex)) {
        setPreview(null);
        return;
      }
      try {
        const cut = cutOf(base.graph, wasm);
        setPreview({ vertices: cut.vertices, edges: cut.edges, bytes: cut.bytes });
        cut.free();
      } catch (error) {
        setPreview(null);
        setNotice(writeFailure(error));
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [base, wasm, rule, seedVertex, cutOf, writeFailure]);

  /** Which pair the path shown should be of, null when there is no pair yet. */
  const pairKey =
    base && seedVertex && targetVertex ? `${base.key}:${seedVertex}:${targetVertex}` : null;
  const routeKey = rule === 'path' ? pairKey : null;
  /** By the pair, not the mode: the path stays on the canvas as it folds away. */
  const shownRoute = route && route.key === pairKey ? route : null;

  // The canvas stays mounted while it folds away, and is mounted the moment
  // its mode is chosen, so it unfolds with its content.
  const [routeMounted, setRouteMounted] = useState(rule === 'path');
  if (rule === 'path' && !routeMounted) setRouteMounted(true);
  useEffect(() => {
    if (rule === 'path' || !routeMounted) return;
    const timer = setTimeout(() => setRouteMounted(false), FOLD_MS);
    return () => clearTimeout(timer);
  }, [rule, routeMounted]);

  /** When the mode was last chosen: a search, synchronous, must not freeze the unfolding. */
  const enteredPath = useRef(0);
  useEffect(() => {
    if (rule === 'path') enteredPath.current = performance.now();
  }, [rule]);
  /** The path as the observatory reads any graph: an edge file and a names
      file, numbered along it, so the first researcher is vertex 1. */
  const routeFile = useMemo((): Handoff | null => {
    if (!shownRoute?.stops) return null;
    const encoder = new TextEncoder();
    const edges = shownRoute.weights.map((weight, i) => `${i + 1} ${i + 2} ${weight}`);
    const names = shownRoute.stops.map((stop, i) => `${i + 1},${stop.name}`);
    const stops = shownRoute.stops;
    const stem = `dblp_${spanStem}_path_${stops[0].vertex}_${stops[stops.length - 1].vertex}`;
    return {
      name: `${stem}.txt`,
      bytes: encoder.encode([shownRoute.stops.length, ...edges, ''].join('\n')),
      names: { name: `${stem}_vertices.txt`, bytes: encoder.encode(names.join('\n') + '\n') },
    };
  }, [shownRoute, spanStem]);

  // The shortest path, a moment after the last change: the run is synchronous
  // (seconds on the whole network), and the status paints first.
  useEffect(() => {
    if (!base || !routeKey || route?.key === routeKey) return;
    const timer = setTimeout(
      () => {
        const nothing = { key: routeKey, stops: null, weights: [], distance: 0, edges: 0 };
        let found: Route;
        try {
          const path = base.graph.shortestPath(seedVertex, targetVertex);
          if (path) {
            const stops = Array.from(path.vertices()).map((vertex) => ({
              vertex,
              name: base.graph.name(vertex) ?? String(vertex),
            }));
            found = {
              ...nothing,
              stops,
              weights: Array.from(path.weights()),
              distance: path.distance,
              edges: path.edges,
              failed: false,
            };
            path.free();
          } else {
            found = { ...nothing, failed: false };
          }
        } catch (error) {
          found = { ...nothing, failed: true };
          setNotice(
            error instanceof WebAssembly.RuntimeError
              ? t.outOfMemory
              : error instanceof Error
                ? error.message
                : String(error),
          );
        }
        setRoute(found);
      },
      Math.max(150, FOLD_MS + 40 - (performance.now() - enteredPath.current)),
    );
    return () => clearTimeout(timer);
  }, [base, route, routeKey, seedVertex, targetVertex, t]);

  /** The cut's two files, named after what made them; `null` when cancelled
      or failed, which the notice then says. */
  const writeFiles = async (action: Writing['action']) => {
    if (!base || !wasm) return null;
    const { graph } = base;
    const controller = new AbortController();
    writeRef.current = controller;
    setNotice(null);
    setWriting({ action, percent: 0 });
    let cut: Subgraph | null = null;
    try {
      // Let the button paint before the (synchronous) cut.
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (controller.signal.aborted) return null;
      const made = cutOf(graph, wasm);
      cut = made;
      const stem = `dblp_${spanStem}_${cutStem}_${made.vertices}`;
      const report = () => setWriting({ action, percent: Math.floor(made.progress * 100) });
      const edges = await collectFile(() => made.nextEdges(), controller.signal, report);
      const names = await collectFile(() => made.nextNames(graph), controller.signal, report);
      if (!edges || !names) return null;
      return {
        name: `${stem}.txt`,
        file: edges,
        names: names.size > 0 ? { name: `${stem}_vertices.txt`, file: names } : null,
      };
    } catch (error) {
      setNotice(writeFailure(error));
      return null;
    } finally {
      if (cut) release(cut);
      if (writeRef.current === controller) {
        writeRef.current = null;
        setWriting(null);
      }
    }
  };

  const open = async () => {
    // A path is already its files, and small: nothing to write, nothing to free.
    if (rule === 'path') {
      if (!routeFile) return;
      setOpening(true);
      offerGraph(routeFile);
      router.push('/observatory');
      return;
    }
    const built = await writeFiles('open');
    if (!built) return;
    setOpening(true);
    try {
      const bytesOf = async (file: Blob) => new Uint8Array(await file.arrayBuffer());
      offerGraph({
        name: built.name,
        bytes: await bytesOf(built.file),
        names: built.names && { name: built.names.name, bytes: await bytesOf(built.names.file) },
      });
      freeOnLeaveRef.current = built.file.size > FREE_NETWORK_ABOVE;
      router.push('/observatory');
    } catch (error) {
      setOpening(false);
      setNotice(writeFailure(error));
    }
  };

  const exportFiles = async () => {
    if (rule === 'path') {
      if (!routeFile) return;
      const blobOf = (bytes: Uint8Array) =>
        new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'text/plain' });
      saveFile(routeFile.name, blobOf(routeFile.bytes));
      const names = routeFile.names;
      if (names) setTimeout(() => saveFile(names.name, blobOf(names.bytes)), 300);
      return;
    }
    const built = await writeFiles('export');
    if (!built) return;
    saveFile(built.name, built.file);
    const names = built.names;
    if (names) setTimeout(() => saveFile(names.name, names.file), 300);
  };

  // The slider is logarithmic: as many steps from 10 to 100 as from 100k to 1M.
  const maxSize = Math.max(MIN_SIZE + 1, base?.vertices ?? DEFAULT_SIZE);
  const low = Math.log(MIN_SIZE);
  const high = Math.log(maxSize);
  const clampSize = (s: number) => Math.min(maxSize, Math.max(1, Math.round(s)));
  const stepOf = (s: number) =>
    Math.round((STEPS * (Math.log(Math.max(MIN_SIZE, s)) - low)) / (high - low));
  const sizeOf = (step: number) => clampSize(Math.exp(low + (step / STEPS) * (high - low)));

  const live = base !== null && job === null;
  const canCut =
    live &&
    (rule === 'path' ? routeFile !== null : preview !== null) &&
    !opening &&
    writing === null;
  /** The cut's file is more than the observatory takes: it can only be exported. */
  const overLimit = preview !== null && preview.bytes > OBSERVATORY_MAX_BYTES;
  const warning = overLimit
    ? t.overLimit(formatBytes(preview.bytes), formatBytes(OBSERVATORY_MAX_BYTES))
    : t.heavy;
  const stem = base ? `dblp_${spanStem}_${cutStem}_${preview?.vertices ?? cutSize}` : '';
  const seeded = rule === 'ball' || rule === 'path';
  const invalidOf = (text: string, vertex: number) =>
    text.trim() !== '' && vertex === 0 ? t.invalidSeed : null;

  return (
    <div className={styles.stage}>
      <Constellation />
      <div className={styles.console}>
        <header className={styles.heading}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{t.title}</h1>
            <span className={`${styles.info} ${styles.infoTitle}`}>
              <button type="button" className={styles.infoButton} aria-label={t.built.title}>
                <Info size={15} aria-hidden="true" />
              </button>
              <span className={`${styles.tip} ${styles.tipBuilt}`} role="tooltip">
                <span className={styles.tipHead}>{t.built.title}</span>
                {t.built.lines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </span>
            </span>
          </div>
          {manifest && <p className={styles.dated}>{dumpDate(manifest, lang)}</p>}
        </header>
        {manifestError && (
          <p className={styles.notice} role="alert">
            {t.failed(manifestError)}{' '}
            <a href={DBLP_RELEASES} target="_blank" rel="noreferrer">
              {t.releases}
            </a>
            .
          </p>
        )}
        {!manifest && !manifestError && (
          <p className={`comment ${styles.line}`} role="status">
            {t.loading}
          </p>
        )}

        {manifest && chosen && (
          <div className={styles.boxes}>
            {/* ---- the year ---- */}
            <section className={styles.box} aria-label={t.year}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>
                  <Calendar size={13} aria-hidden="true" />
                  {t.span}
                </span>
                <div className={styles.segments} role="radiogroup" aria-label={t.span}>
                  {SPANS.map((which) => (
                    <button
                      key={which}
                      type="button"
                      role="radio"
                      aria-checked={span === which}
                      className={styles.segment}
                      title={t.spanHints[which]}
                      onClick={() => setSpan(which)}
                    >
                      {t.spans[which]}
                    </button>
                  ))}
                </div>
              </div>
              <div className={styles.years} data-range={span === 'range' || undefined}>
                <div
                  className={`${styles.field} ${styles.fromSlot}`}
                  aria-hidden={span !== 'range'}
                >
                  <label htmlFor="dblp-from" className={styles.fieldLabel}>
                    {t.from}
                  </label>
                  <span className={styles.select}>
                    <select
                      id="dblp-from"
                      className={`mono ${styles.input}`}
                      value={from}
                      disabled={span !== 'range'}
                      onChange={(event) => setFrom(Number(event.target.value))}
                    >
                      {manifest.years
                        .filter((entry) => entry.year <= year)
                        .reverse()
                        .map((entry) => (
                          <option key={entry.year} value={entry.year}>
                            {entry.year}
                          </option>
                        ))}
                    </select>
                    <ChevronDown size={14} className={styles.chevron} aria-hidden="true" />
                  </span>
                </div>
                <div className={styles.field}>
                  <label htmlFor="dblp-year" className={styles.fieldLabel}>
                    {span === 'range' ? t.to : t.year}
                  </label>
                  <span className={styles.select}>
                    <select
                      id="dblp-year"
                      className={`mono ${styles.input}`}
                      value={year}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        setYear(next);
                        setFrom((current) => Math.min(current, next));
                      }}
                    >
                      {manifest.years
                        .slice()
                        .reverse()
                        .map((entry) => (
                          <option key={entry.year} value={entry.year}>
                            {entry.year}
                          </option>
                        ))}
                    </select>
                    <ChevronDown size={14} className={styles.chevron} aria-hidden="true" />
                  </span>
                </div>
              </div>
              <dl className={styles.facts}>
                <div>
                  <dt>{t.facts.vertices}</dt>
                  <dd className="mono">
                    {base?.key === key
                      ? formatInt(base.vertices)
                      : span === 'until'
                        ? formatInt(chosen.vertices)
                        : '·'}
                  </dd>
                </div>
                <div>
                  <dt>{t.facts.edges}</dt>
                  <dd className="mono">
                    {base?.key === key
                      ? formatInt(base.edges)
                      : span === 'until'
                        ? formatInt(chosen.edges)
                        : '·'}
                  </dd>
                </div>
                <div>
                  <dt>{t.facts.transfer}</dt>
                  <dd className="mono">
                    {formatBytes(
                      transferBytes(manifest, spanStart(manifest, span, from, year), year),
                    )}
                  </dd>
                </div>
              </dl>
              <div className={styles.status} data-open={job !== null || undefined}>
                <div className={styles.statusInner}>
                  {job ? (
                    <div
                      className={styles.progress}
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={job.total}
                      aria-valuenow={Math.min(job.received, job.total)}
                    >
                      <span className={styles.progressRow}>
                        <LoaderCircle size={14} className={styles.spinner} aria-hidden="true" />
                        <span className={`comment ${styles.progressText}`}>
                          {job.phase === 'parsing'
                            ? t.parsing
                            : t.fetching(formatBytes(job.received), formatBytes(job.total))}
                        </span>
                        <button
                          type="button"
                          className={styles.cancel}
                          aria-label={t.cancel}
                          title={t.cancel}
                          onClick={() => {
                            jobRef.current?.abort();
                            jobRef.current = null;
                            setJob(null);
                          }}
                        >
                          <X size={13} />
                        </button>
                      </span>
                      <span className={styles.track}>
                        <span
                          className={styles.bar}
                          style={{
                            width: `${Math.min(100, (100 * job.received) / job.total)}%`,
                          }}
                        />
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
              {notice && (
                <p className={styles.notice} role="alert">
                  {notice}
                </p>
              )}
            </section>

            {/* ---- the cut ---- */}
            <section className={`${styles.box} ${styles.boxMain}`} data-off={!live || undefined}>
              <div className={styles.rules} role="radiogroup" aria-label={t.rule}>
                {RULES.map((which) => {
                  const Icon = RULE_ICONS[which];
                  return (
                    <div key={which} className={styles.rule}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={rule === which}
                        className={styles.ruleButton}
                        disabled={!live}
                        onClick={() => setRule(which)}
                      >
                        <span className={styles.ruleIcon}>
                          <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                        </span>
                        <span className={styles.ruleName}>{t.rules[which]}</span>
                      </button>
                      <span className={styles.info}>
                        <button
                          type="button"
                          className={styles.infoButton}
                          aria-label={t.ruleHints[which]}
                        >
                          <Info size={13} aria-hidden="true" />
                        </button>
                        <span className={styles.tip} role="tooltip">
                          {t.ruleHints[which]}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
              <div
                className={styles.controls}
                data-seed={seeded || undefined}
                data-hidden={rule === 'whole' || undefined}
              >
                <div className={styles.seedSlot} aria-hidden={!seeded}>
                  <ResearcherField
                    id="dblp-seed"
                    label={rule === 'path' ? t.path.from : t.seed}
                    value={seedInput}
                    onChange={setSeedInput}
                    placeholder={t.seedPlaceholder}
                    suggest={suggest}
                    disabled={!live || !seeded}
                    invalid={invalidOf(seedInput, seedVertex)}
                  />
                </div>
                {rule === 'path' ? (
                  <div key="target" className={styles.swapIn}>
                    <ResearcherField
                      id="dblp-target"
                      label={t.path.to}
                      value={targetInput}
                      onChange={setTargetInput}
                      placeholder={t.seedPlaceholder}
                      suggest={suggest}
                      disabled={!live}
                      invalid={invalidOf(targetInput, targetVertex)}
                    />
                  </div>
                ) : (
                  <div key="size" className={`${styles.field} ${styles.swapIn}`}>
                    <div className={styles.fieldHead}>
                      <label htmlFor="dblp-size" className={styles.fieldLabel}>
                        <SlidersHorizontal size={13} aria-hidden="true" />
                        {rule === 'ball' ? t.cutBy : t.size}
                      </label>
                      {rule === 'ball' && (
                        <div className={styles.toggle} role="radiogroup" aria-label={t.cutBy}>
                          {CUTS.map((which) => (
                            <button
                              key={which}
                              type="button"
                              role="radio"
                              aria-checked={cutBy === which}
                              className={styles.segment}
                              title={t.cutHints[which]}
                              disabled={!live}
                              onClick={() => setCutBy(which)}
                            >
                              {t.cuts[which]}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {byRadius ? (
                      <div className={styles.sizeRow}>
                        <input
                          type="range"
                          min={1}
                          max={SLIDER_RADIUS}
                          value={Math.min(radius, SLIDER_RADIUS)}
                          style={
                            {
                              '--fill': `${(100 * (Math.min(radius, SLIDER_RADIUS) - 1)) / (SLIDER_RADIUS - 1)}%`,
                            } as CSSProperties
                          }
                          aria-label={t.radius}
                          disabled={!live}
                          onChange={(event) => setRadius(Number(event.target.value))}
                        />
                        <span className={`mono ${styles.radiusName}`} aria-hidden="true">
                          k =
                        </span>
                        <input
                          id="dblp-size"
                          type="number"
                          className={`mono ${styles.input} ${styles.number} ${styles.numberShort}`}
                          min={1}
                          max={maxSize}
                          value={radius}
                          aria-label={t.radius}
                          title={t.radius}
                          disabled={!live}
                          onChange={(event) =>
                            setRadius(clampSize(Number(event.target.value) || 1))
                          }
                        />
                      </div>
                    ) : (
                      <div className={styles.sizeRow}>
                        <input
                          type="range"
                          min={0}
                          max={STEPS}
                          value={stepOf(size)}
                          style={{ '--fill': `${(100 * stepOf(size)) / STEPS}%` } as CSSProperties}
                          aria-label={t.size}
                          disabled={!live}
                          onChange={(event) => setSize(sizeOf(Number(event.target.value)))}
                        />
                        <input
                          id="dblp-size"
                          type="number"
                          className={`mono ${styles.input} ${styles.number}`}
                          min={1}
                          max={maxSize}
                          value={size}
                          aria-label={t.size}
                          title={t.size}
                          disabled={!live}
                          onChange={(event) => setSize(clampSize(Number(event.target.value) || 1))}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className={styles.swap}>
                {routeMounted && (
                  <div
                    className={styles.fold}
                    data-open={rule === 'path' || undefined}
                    inert={rule !== 'path'}
                  >
                    <div className={styles.foldInner}>
                      <div className={styles.route}>
                        <Observatory
                          embed={{
                            path: routeFile,
                            left: (
                              <RouteFact
                                label={t.path.distance}
                                value={shownRoute?.stops ? shownRoute.distance : null}
                                format={formatWeight}
                              />
                            ),
                            right: (
                              <RouteFact
                                side="right"
                                label={t.path.edges}
                                value={shownRoute?.stops ? shownRoute.edges : null}
                                format={formatInt}
                              />
                            ),
                            empty:
                              shownRoute?.stops || shownRoute?.failed ? null : (
                                <p className={`comment ${styles.routeNote}`} role="status">
                                  {pairKey && !shownRoute ? (
                                    <>
                                      <LoaderCircle
                                        size={14}
                                        className={styles.spinner}
                                        aria-hidden="true"
                                      />
                                      {t.path.searching}
                                    </>
                                  ) : shownRoute ? (
                                    t.path.none
                                  ) : (
                                    t.path.needBoth
                                  )}
                                </p>
                              ),
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}
                <div
                  className={styles.fold}
                  data-open={rule !== 'path' || undefined}
                  inert={rule === 'path'}
                >
                  <div className={styles.foldInner}>
                    <div className={styles.tiles} aria-live="polite">
                      <Tile
                        icon={UsersRound}
                        value={preview?.vertices ?? null}
                        loading={job !== null}
                        format={formatInt}
                        share={preview && base ? preview.vertices / base.vertices : null}
                        label={t.facts.vertices}
                      />
                      <Tile
                        icon={Share2}
                        value={preview?.edges ?? null}
                        loading={job !== null}
                        format={formatInt}
                        share={preview && base ? preview.edges / base.edges : null}
                        label={t.facts.edges}
                      />
                      <FileSize
                        value={preview?.bytes ?? null}
                        loading={job !== null}
                        label={t.facts.file}
                        files={base ? [`${stem}.txt`, `${stem}_vertices.txt`] : null}
                        caption={t.filesCaption}
                      />
                    </div>
                  </div>
                </div>
              </div>
              {live && rule === 'ball' && !seedVertex && (
                <p className={`comment ${styles.line}`}>{t.needSeed}</p>
              )}
            </section>

            {/* ---- the result ---- */}
            <div className={styles.side}>
              {/* A cut too large for the observatory to draw comfortably:
                  a warning that floats in above the box, its text on hover. */}
              <span
                className={`${styles.info} ${styles.warning}`}
                data-on={(preview && (preview.vertices > HEAVY || overLimit)) || undefined}
                data-limit={overLimit || undefined}
              >
                <button type="button" className={styles.warningButton} aria-label={warning}>
                  <TriangleAlert size={15} strokeWidth={1.75} aria-hidden="true" />
                </button>
                <span className={`${styles.tip} ${styles.tipWarning}`} role="tooltip">
                  {warning}
                </span>
              </span>
              <section className={styles.box} data-off={!canCut || undefined} aria-label={t.open}>
                <button
                  type="button"
                  className={`${styles.action} ${styles.actionPrimary}`}
                  disabled={!canCut || overLimit}
                  onClick={() => void open()}
                >
                  {opening || writing?.action === 'open' ? (
                    <LoaderCircle size={20} className={styles.spinner} aria-hidden="true" />
                  ) : (
                    <Telescope size={20} strokeWidth={1.75} aria-hidden="true" />
                  )}
                  <span>
                    {writing?.action === 'open'
                      ? t.writing(writing.percent)
                      : opening
                        ? t.opening
                        : t.open}
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.action}
                  disabled={!canCut}
                  onClick={() => void exportFiles()}
                >
                  {writing?.action === 'export' ? (
                    <LoaderCircle size={20} className={styles.spinner} aria-hidden="true" />
                  ) : (
                    <FileDown size={20} strokeWidth={1.75} aria-hidden="true" />
                  )}
                  <span>
                    {writing?.action === 'export' ? t.writing(writing.percent) : t.export}
                  </span>
                </button>
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Eases a number towards its target over a few frames, so a readout counts
    up instead of snapping; `null` reads as nothing yet. */
function useCountUp(target: number | null, ms = 450): number | null {
  const [shown, setShown] = useState<number | null>(target);
  const from = useRef<number | null>(target);
  useEffect(() => {
    if (target === null) {
      from.current = null;
      const frame = requestAnimationFrame(() => setShown(null));
      return () => cancelAnimationFrame(frame);
    }
    const start = from.current ?? target;
    const t0 = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      const value = start + (target - start) * eased;
      setShown(value);
      from.current = value;
      if (k < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, ms]);
  return shown;
}

/** One live number of the cut: its icon, the number counting up to its
    value, its label, and a bar for the share of the whole network it is. */
function Tile({
  icon: Icon,
  value,
  loading,
  format,
  share,
  label,
}: {
  icon: typeof UsersRound;
  value: number | null;
  loading: boolean;
  format: (value: number) => string;
  share: number | null;
  label: string;
}) {
  const shown = useCountUp(value);
  const percent = share === null ? 0 : Math.min(100, 100 * share);
  return (
    <div className={styles.tile} data-empty={value === null || undefined}>
      <span className={styles.tileHead}>
        <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
        <span className={`label ${styles.tileLabel}`}>{label}</span>
      </span>
      <span className={`mono ${styles.tileValue}`}>
        {loading ? (
          <LoaderCircle size={18} className={styles.spinner} aria-hidden="true" />
        ) : shown === null ? (
          '·'
        ) : (
          format(Math.round(shown))
        )}
      </span>
      <span className={styles.tileBar} aria-hidden="true">
        <span className={styles.tileFill} style={{ width: `${percent}%` }} />
      </span>
      <span className={`mono ${styles.tileShare}`}>
        {share === null ? '' : share >= 0.9995 ? '100%' : `${(100 * share).toPrecision(2)}%`}
      </span>
    </div>
  );
}

/** One number of the path's result: a tracked label, a blue number counting
    to its value. */
function RouteFact({
  side,
  label,
  value,
  format,
}: {
  side?: 'right';
  label: string;
  value: number | null;
  format: (value: number) => string;
}) {
  const shown = useCountUp(value);
  return (
    <div
      className={styles.routeFact}
      data-side={side}
      data-empty={value === null || undefined}
      aria-live="polite"
    >
      <span className={`label ${styles.tileLabel}`}>{label}</span>
      <span className={`mono ${styles.fileSizeValue}`}>{shown === null ? '·' : format(shown)}</span>
    </div>
  );
}

/** The edge file's size, plain: a blue number counting to its value, with
    the two files' names behind a file icon, like the rules' captions. */
function FileSize({
  value,
  loading,
  label,
  files,
  caption,
}: {
  value: number | null;
  loading: boolean;
  label: string;
  files: string[] | null;
  caption: string;
}) {
  const shown = useCountUp(value);
  return (
    <div className={styles.fileSize} data-empty={value === null || undefined}>
      <span className={styles.fileSizeHead}>
        <span className={`label ${styles.tileLabel}`}>{label}</span>
        {files && (
          <span className={`${styles.info} ${styles.infoInline}`}>
            <button
              type="button"
              className={styles.infoButton}
              aria-label={`${files.join(', ')}: ${caption}`}
            >
              <FileText size={13} aria-hidden="true" />
            </button>
            <span className={`${styles.tip} ${styles.tipFiles}`} role="tooltip">
              {files.map((file) => (
                <span key={file} className={`mono ${styles.tipFile}`}>
                  {file}
                </span>
              ))}
              <span className={styles.tipCaption}>{caption}</span>
            </span>
          </span>
        )}
      </span>
      <span className={`mono ${styles.fileSizeValue}`}>
        {loading ? (
          <LoaderCircle size={22} className={styles.spinner} aria-hidden="true" />
        ) : shown === null ? (
          '·'
        ) : (
          formatBytes(Math.round(shown))
        )}
      </span>
    </div>
  );
}

/** A researcher by name or vertex, with the library's suggestions under
    the field while it is typed into. */
function ResearcherField({
  id,
  label,
  value,
  onChange,
  placeholder,
  suggest,
  disabled,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  suggest: (text: string) => { vertex: number; name: string }[];
  disabled: boolean;
  invalid: string | null;
}) {
  const [open, setOpen] = useState(false);
  const suggestions = useMemo(() => (open ? suggest(value) : []), [open, suggest, value]);
  const shown = suggestions.length === 1 && suggestions[0].name === value.trim() ? [] : suggestions;
  return (
    <div className={styles.field}>
      <div className={styles.fieldHead}>
        <label htmlFor={id} className={styles.fieldLabel}>
          <Search size={13} aria-hidden="true" />
          {label}
        </label>
      </div>
      <div className={styles.fieldWrap}>
        <input
          id={id}
          className={`${styles.input} ${invalid ? styles.inputInvalid : ''}`}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
          }}
        />
        {shown.length > 0 && (
          <ul className={styles.suggestions} role="listbox">
            {shown.map((s) => (
              <li key={s.vertex}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(s.name);
                    setOpen(false);
                  }}
                >
                  <span>{s.name}</span>
                  <span className={`mono ${styles.suggestionId}`}>{s.vertex}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {invalid && <span className={styles.invalid}>{invalid}</span>}
    </div>
  );
}

/** The day the dump was taken, in the visitor's language: the snapshot's
    own date when the manifest has one, else the day of the build. The date
    is read at noon UTC so no time zone moves it to the day before. */
function dumpDate(manifest: DblpManifest, lang: string): string {
  const day = manifest.date
    ? new Date(`${manifest.date}T12:00:00Z`)
    : new Date(manifest.builtAt * 1000);
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(
    day,
  );
}
