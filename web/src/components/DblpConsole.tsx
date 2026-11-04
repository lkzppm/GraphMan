'use client';

import {
  Calendar,
  ChevronDown,
  FileDown,
  FileText,
  History,
  LoaderCircle,
  Info,
  Network,
  Share2,
  UsersRound,
  Search,
  SlidersHorizontal,
  Telescope,
  TriangleAlert,
  UserRound,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Constellation from '@/components/Constellation';
import { useLocale } from '@/i18n/LocaleProvider';
import {
  DBLP_RELEASES,
  fetchFile,
  fetchManifest,
  saveFile,
  unpackedName,
  type DblpManifest,
  type DblpTier,
} from '@/lib/dblp';
import { formatBytes, formatInt } from '@/lib/format';
import { loadGraphman, type Graph, type GraphmanModule } from '@/lib/graphman';
import { offerGraph } from '@/lib/handoff';
import styles from './DblpConsole.module.css';

/** How a cut picks its vertices (the wasm `SubgraphKind`). */
type Rule = 'ball' | 'mostConnected' | 'earliest';
const RULES: readonly Rule[] = ['ball', 'mostConnected', 'earliest'];
const RULE_ICONS = { ball: UserRound, mostConnected: Network, earliest: History } as const;

/** The smallest cut the slider offers, and what a fresh network opens at. */
const MIN_SIZE = 10;
const DEFAULT_SIZE = 2000;
/** The researcher the course's questions start from, when the year has him. */
const DEFAULT_SEED = 'Edsger W. Dijkstra';
/** Slider steps (the slider is logarithmic). */
const STEPS = 1000;
/** Past this many vertices the observatory draws, but slowly. */
const HEAVY = 300_000;

/** A year's whole network, parsed and held in wasm for cutting. */
interface Base {
  graph: Graph;
  tier: DblpTier;
  vertices: number;
  edges: number;
}

/** A download in flight. */
interface Job {
  what: string;
  received: number;
  total: number;
  phase: 'fetching' | 'unpacking' | 'parsing';
}

interface Preview {
  vertices: number;
  edges: number;
  bytes: number;
}

/** The network a fresh page offers: the course file's twin, else the last year. */
function initialTier(manifest: DblpManifest): number {
  const twin = manifest.tiers.findIndex((tier) => tier.year === 2009);
  return twin >= 0 ? twin : Math.max(0, manifest.tiers.length - 2);
}

/**
 * The DBLP tab: one console in the middle of the screen, three boxes in a
 * row. Left, the year: choosing one fetches that network into memory
 * (unpacked in the tab, parsed by the wasm library, kept in the browser's
 * cache for next time). Centre, the cut: around a researcher, the most
 * connected or the earliest, at the size wanted, with what it will weigh
 * counted live. Right, the result: opened in the observatory, or exported
 * as the two course-format files.
 */
export default function DblpConsole() {
  const { t: dictionary } = useLocale();
  const t = dictionary.dblp;
  const lang = dictionary.lang;
  const router = useRouter();
  const [wasm, setWasm] = useState<GraphmanModule | null>(null);
  const [manifest, setManifest] = useState<DblpManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [tierIndex, setTierIndex] = useState(0);
  const [base, setBase] = useState<Base | null>(null);
  const baseRef = useRef<Base | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const jobRef = useRef<AbortController | null>(null);
  const [seedInput, setSeedInput] = useState('');
  const [rule, setRule] = useState<Rule>('ball');
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [opening, setOpening] = useState(false);
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
        setTierIndex(initialTier(loaded));
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

  // Leaving the page stops a download and frees the network held in wasm.
  useEffect(
    () => () => {
      jobRef.current?.abort();
      baseRef.current?.graph.free();
      baseRef.current = null;
    },
    [],
  );

  const chosen = manifest?.tiers[tierIndex] ?? null;
  const tierName = (tier: DblpTier) => (tier.year === null ? t.all : t.upTo(String(tier.year)));

  /** Downloads the chosen year, unpacks it and parses it into wasm. */
  const fetchNetwork = useCallback(async () => {
    const tier = manifest?.tiers[tierIndex];
    if (!wasm || !manifest || !tier) return;
    jobRef.current?.abort();
    const controller = new AbortController();
    jobRef.current = controller;
    setNotice(null);
    const total = tier.graph.bytes + tier.names.bytes;
    const version = String(manifest.builtAt);
    try {
      let before = 0;
      let painted = 0;
      const got: Uint8Array[] = [];
      for (const file of [tier.graph, tier.names]) {
        const what = unpackedName(file);
        setJob({ what, received: before, total, phase: 'fetching' });
        got.push(
          await fetchFile(
            file,
            version,
            (received) => {
              const now = performance.now();
              const done = received >= file.bytes;
              if (now - painted < 80 && !done) return;
              painted = now;
              setJob({
                what,
                received: before + received,
                total,
                phase: done ? 'unpacking' : 'fetching',
              });
            },
            controller.signal,
          ),
        );
        before += file.bytes;
      }
      setJob({ what: '', received: total, total, phase: 'parsing' });
      // Let the status paint before the (synchronous) parse.
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (controller.signal.aborted) return;
      const parsed = new wasm.Parsed(got[0]);
      const graph = parsed.build(wasm.RepresentationKind.Csr);
      graph.setNames(got[1]);
      baseRef.current?.graph.free();
      const next: Base = { graph, tier, vertices: graph.vertexCount, edges: graph.edgeCount };
      baseRef.current = next;
      setBase(next);
      const seed = graph.vertexNamed(DEFAULT_SEED);
      setSeedInput(seed ? DEFAULT_SEED : (graph.name(1) ?? '1'));
      setSize((current) => Math.min(current, graph.vertexCount));
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        setNotice(t.failedFetch(message));
      }
    } finally {
      if (jobRef.current === controller) {
        jobRef.current = null;
        setJob(null);
      }
    }
  }, [wasm, manifest, tierIndex, t]);

  // A chosen year is fetched at once; choosing another cancels the first.
  useEffect(() => {
    const tier = manifest?.tiers[tierIndex];
    if (!wasm || !tier || baseRef.current?.tier === tier) return;
    const timer = setTimeout(() => void fetchNetwork(), 0);
    return () => {
      clearTimeout(timer);
      jobRef.current?.abort();
    };
  }, [wasm, manifest, tierIndex, fetchNetwork]);

  /** The seed as a vertex of the loaded network, 0 when it is not one. */
  const seedVertex = useMemo(() => {
    if (!base) return 0;
    const typed = seedInput.trim();
    if (!typed) return 0;
    if (/^\d+$/.test(typed)) {
      const v = Number(typed);
      return v >= 1 && v <= base.vertices ? v : 0;
    }
    return base.graph.vertexNamed(typed) ?? 0;
  }, [base, seedInput]);

  const suggest = useCallback((text: string) => {
    const graph = baseRef.current?.graph;
    const typed = text.trim();
    if (!graph || typed.length < 2 || /^\d+$/.test(typed)) return [];
    return Array.from(graph.searchNames(typed, 6)).map((v) => ({
      vertex: v,
      name: graph.name(v) ?? String(v),
    }));
  }, []);

  const kindOf = (module: GraphmanModule, which: Rule) =>
    which === 'ball'
      ? module.SubgraphKind.Ball
      : which === 'mostConnected'
        ? module.SubgraphKind.MostConnected
        : module.SubgraphKind.Earliest;

  // What the cut would be, counted a moment after the last change.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!base || !wasm || (rule === 'ball' && !seedVertex)) {
        setPreview(null);
        return;
      }
      const cut = base.graph.subgraph(kindOf(wasm, rule), seedVertex || 1, size, false);
      setPreview({ vertices: cut.vertices, edges: cut.edges, bytes: cut.bytes });
      cut.free();
    }, 120);
    return () => clearTimeout(timer);
  }, [base, wasm, rule, seedVertex, size]);

  /** The cut's two files, named after what made them. */
  const files = () => {
    if (!base || !wasm) return null;
    const cut = base.graph.subgraph(kindOf(wasm, rule), seedVertex || 1, size, true);
    const stem = `dblp_${base.tier.year ?? 'all'}_${rule.toLowerCase()}_${cut.vertices}`;
    const names = cut.namesFile();
    const built = {
      name: `${stem}.txt`,
      bytes: cut.edgeFile(),
      names: names.length ? { name: `${stem}_vertices.txt`, bytes: names } : null,
    };
    cut.free();
    return built;
  };

  const open = () => {
    const built = files();
    if (!built) return;
    setOpening(true);
    offerGraph(built);
    router.push('/observatory');
  };

  const exportFiles = () => {
    const built = files();
    if (!built) return;
    saveFile(built.name, built.bytes);
    const names = built.names;
    if (names) setTimeout(() => saveFile(names.name, names.bytes), 300);
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
  const canCut = live && preview !== null && !opening;
  const stem = base
    ? `dblp_${base.tier.year ?? 'all'}_${rule.toLowerCase()}_${preview?.vertices ?? size}`
    : '';

  return (
    <div className={styles.stage}>
      <Constellation />
      <div className={styles.console}>
        <header className={styles.heading}>
          <h1 className={styles.title}>{t.title}</h1>
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
                <label htmlFor="dblp-year" className={styles.fieldLabel}>
                  <Calendar size={13} aria-hidden="true" />
                  {t.year}
                </label>
                <span className={styles.select}>
                  <select
                    id="dblp-year"
                    className={`mono ${styles.input}`}
                    value={tierIndex}
                    onChange={(event) => setTierIndex(Number(event.target.value))}
                  >
                    {manifest.tiers.map((tier, i) => (
                      <option key={tier.year ?? 'all'} value={i}>
                        {tierName(tier)}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} className={styles.chevron} aria-hidden="true" />
                </span>
              </div>
              <dl className={styles.facts}>
                <div>
                  <dt>{t.facts.vertices}</dt>
                  <dd className="mono">{formatInt(chosen.vertices)}</dd>
                </div>
                <div>
                  <dt>{t.facts.edges}</dt>
                  <dd className="mono">{formatInt(chosen.edges)}</dd>
                </div>
                <div>
                  <dt>{t.facts.transfer}</dt>
                  <dd className="mono">{formatBytes(chosen.graph.bytes + chosen.names.bytes)}</dd>
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
                            : job.phase === 'unpacking'
                              ? t.unpacking
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
              <div className={styles.controls} data-seed={rule === 'ball' || undefined}>
                <div className={styles.seedSlot} aria-hidden={rule !== 'ball'}>
                  <ResearcherField
                    label={t.seed}
                    value={seedInput}
                    onChange={setSeedInput}
                    placeholder={t.seedPlaceholder}
                    suggest={suggest}
                    disabled={!live || rule !== 'ball'}
                    invalid={seedInput.trim() !== '' && seedVertex === 0 ? t.invalidSeed : null}
                  />
                </div>
                <div className={styles.field}>
                  <label htmlFor="dblp-size" className={styles.fieldLabel}>
                    <SlidersHorizontal size={13} aria-hidden="true" />
                    {t.size}
                  </label>
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
                      disabled={!live}
                      onChange={(event) => setSize(clampSize(Number(event.target.value) || 1))}
                    />
                  </div>
                </div>
              </div>
              <div className={styles.tiles} aria-live="polite">
                <Tile
                  icon={UsersRound}
                  value={preview?.vertices ?? null}
                  format={formatInt}
                  share={preview && base ? preview.vertices / base.vertices : null}
                  label={t.facts.vertices}
                />
                <Tile
                  icon={Share2}
                  value={preview?.edges ?? null}
                  format={formatInt}
                  share={preview && base ? preview.edges / base.edges : null}
                  label={t.facts.edges}
                />
                <FileSize
                  value={preview?.bytes ?? null}
                  label={t.facts.file}
                  files={base ? [`${stem}.txt`, `${stem}_vertices.txt`] : null}
                  caption={t.filesCaption}
                />
              </div>
              {(!live || (rule === 'ball' && !seedVertex)) && (
                <p className={`comment ${styles.line}`}>{!live ? t.idle : t.needSeed}</p>
              )}
            </section>

            {/* ---- the result ---- */}
            <div className={styles.side}>
              {/* A cut too large for the observatory to draw comfortably:
                  a warning that floats in above the box, its text on hover. */}
              <span
                className={`${styles.info} ${styles.warning}`}
                data-on={(preview && preview.vertices > HEAVY) || undefined}
              >
                <button type="button" className={styles.warningButton} aria-label={t.heavy}>
                  <TriangleAlert size={15} strokeWidth={1.75} aria-hidden="true" />
                </button>
                <span className={`${styles.tip} ${styles.tipWarning}`} role="tooltip">
                  {t.heavy}
                </span>
              </span>
              <section className={styles.box} data-off={!canCut || undefined} aria-label={t.open}>
                <button
                  type="button"
                  className={`${styles.action} ${styles.actionPrimary}`}
                  disabled={!canCut}
                  onClick={open}
                >
                  {opening ? (
                    <LoaderCircle size={20} className={styles.spinner} aria-hidden="true" />
                  ) : (
                    <Telescope size={20} strokeWidth={1.75} aria-hidden="true" />
                  )}
                  <span>{opening ? t.opening : t.open}</span>
                </button>
                <button
                  type="button"
                  className={styles.action}
                  disabled={!canCut}
                  onClick={exportFiles}
                >
                  <FileDown size={20} strokeWidth={1.75} aria-hidden="true" />
                  <span>{t.export}</span>
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
  format,
  share,
  label,
}: {
  icon: typeof UsersRound;
  value: number | null;
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
        {shown === null ? '·' : format(Math.round(shown))}
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

/** The edge file's size, plain: a blue number counting to its value, with
    the two files' names behind a file icon, like the rules' captions. */
function FileSize({
  value,
  label,
  files,
  caption,
}: {
  value: number | null;
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
        {shown === null ? '·' : formatBytes(Math.round(shown))}
      </span>
    </div>
  );
}

/** A researcher by name or vertex, with the library's suggestions under
    the field while it is typed into. */
function ResearcherField({
  label,
  value,
  onChange,
  placeholder,
  suggest,
  disabled,
  invalid,
}: {
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
      <label htmlFor="dblp-seed" className={styles.fieldLabel}>
        <Search size={13} aria-hidden="true" />
        {label}
      </label>
      <div className={styles.fieldWrap}>
        <input
          id="dblp-seed"
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
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(day);
}
