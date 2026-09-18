# GraphMan design system

GraphMan's site is a white instrument panel: paper white, a scale of greys,
hairline borders, near-square corners, and exactly one blue. The voice is
borrowed from Golem (a sibling project, black/orange): small tracked
capitals for every label, monospace for every number, surfaces with a
2 px accent edge, a mark that shakes when hovered, and mono "code comment"
captions. Here it is white and blue, because that is what the icon was
drawn for.

## Principles

1. **The data is the hero.** The observatory canvas is the one visual
   anchor; chrome around it is quiet, hairline-bordered and recedes. No
   decorative gradients, no effect libraries.
2. **Colour discipline.** White, greys and `--accent` blue. Blue means
   "alive": links, buttons, the origin vertex, level 0 of a search, the
   accent edge of a surface, flagged values. A lighter blue (`--accent-2`)
   exists only so the level ramp has a far end. No green, no red, no amber.
3. **Light only.** No dark theme; `color-scheme: light`. The canvas reads
   the same CSS variables the UI uses.
4. **Alive, not busy.** Everything actionable answers the pointer: buttons
   lift, ghosts fill with blue, cards rise and grow an accent line, the mark
   shakes, sections rise into view once. Motion is 150–700 ms on
   `cubic-bezier(0.22, 1, 0.36, 1)`, springs (`--ease-spring`) only on
   things that snap into place. Everything respects `prefers-reduced-motion`.
5. **Honest numbers.** Tables use tabular monospace figures, direct labels,
   and a flag (≥, in blue) on every bound or budget-limited value.

## Tokens (`web/src/app/globals.css`)

| Role | Value |
|---|---|
| `--bg` / `--bg-2` / `--bg-3` | `#fff` / `#fafafa` / `#f2f2f2` |
| `--fg` / `--fg-2` / `--fg-3` | `#171717` / `#666` / `#8f8f8f` |
| `--border` / `--border-2` | `#e6e6e6` / `#cfcfcf` |
| `--accent` / `--accent-hover` / `--accent-muted` | `#0070f3` / `#0a5fd0` / blue at 12 % |
| `--accent-2` (level ramp end) | `#a9dcff` |
| `--level-0` (level ramp start) | `#002f66` |
| `--node` / `--node-dim` | `#8f8f8f` / `#d6d6d6` |
| `--edge` / `--edge-dim` | ink at 14 % / 6 % |
| Radii | 2 / 4 / 6 px |
| `--tracking` | `0.1em` (labels), `0.3em` (eyebrows) |
| `--glow` | `0 6px 24px -6px var(--accent-muted)` |
| Container | 1080 px, 24 px gutters |

## Typography

Geist Sans and Geist Mono (the `geist` package). Weights 400, 500, 600.

- **Headlines**: Sans 600, hero `clamp(40px, 5.6vw, 64px)` at 1.05 and
  `-0.04em`, section titles 32 px at `-0.03em`. The hero title ends in a
  blue full stop.
- **Wordmark**: Mono `graphman` + blue `.`.
- **Labels** (`.label`): 11–12 px, 500, uppercase, `0.1em` tracking, grey.
  Used for nav links, buttons, table headers, panel titles, tile labels.
- **Eyebrows** (`.eyebrow`): Mono 11 px uppercase at `0.3em`, `--fg-3`.
- **Numbers**: Mono with `tnum` and `zero`; big tile values 28 px in blue.
- **Comments** (`.comment`): Mono 12 px grey, written like code comments
  (`// hover the graphman`, `// built sep 2026 · rio de janeiro`).
- Body 16–17 px at 1.5–1.6; UI text 13–14 px.

## The mark

`web/public/brand/graphman.svg` is the logo: a grey (`--fg-3`) hexagon
around a solid blue graph and figure. `graphman-mark.svg` is the one-colour
version: every gap is a real hole, so it tints with `currentColor` and
works as a CSS mask. `components/Logo.tsx` renders either (two-tone by
default) and shakes on hover (`@keyframes shake`); the nav uses it.

The hero draws the mark live instead (`components/HeroMark.tsx`): the same
geometry as an inline SVG with one element per vertex and edge. On load the
hexagon draws itself, the edges draw in BFS order from the top vertex and
the vertices pop in after them; idle, the vertices breathe. Hovering a
vertex runs one search wave (halos and light-blue edge flashes, level by
level) from it, that vertex grows and its edges thicken; the figure itself
is still. Every vertex — including the one tucked under the
figure's lower hand, an ordinary vertex joined to two others — can be
dragged and springs back home. The hexagon
never changes colour and the mark does not float. The figure's body sits
under the hexagon (its legs end beneath the border) and its head over it,
with a white gap where the head crosses the band — an outline clipped to
the band, as wide as the keylines between the arms and the body. Both
hands are plain rounded ends (the lower one overlaps its vertex, the upper
one holds a stub edge). The hero and the empty observatory share a
drifting constellation background (`components/Constellation.tsx`). The
hexagon path starts mid-edge so its draw-in has no notch at a corner. The
static `graphman.svg` is built the same way.

Keyframes used inside a CSS module (`rise`, `float`, `shake`, `bounce`)
are redeclared in that module: CSS modules scope animation names, so the
copies in `globals.css` are only reachable from global classes.

## Pages and navigation

One sticky nav, like Golem's: the mark + wordmark on the left is the home
link (the wordmark turns blue on the home page), then a tab per other page
— **Observatory** (`/observatory`), **Library** (`/library`, the six
decisions), **Case studies** (`/studies`, the tables), **Presentation**
(`/presentation`, the five slides) — then, on the right, the language
switch (two mono tags, `pt` · `en`, the current one in the blue-muted
pill) and a bordered GitHub button. The current tab is marked in blue:
blue text, a blue-muted pill and a 2 px underline; the pill slides between
tabs (a measured indicator, spring easing) and fades out on the home page.

**Language.** The interface is Portuguese by default (the course's
language) with English one tap away; the choice is remembered
(`localStorage`) and sets `<html lang>`. Every string the visitor reads
lives in one typed dictionary per language (`web/src/i18n/en.tsx` is the
schema, `pt.tsx` must match it), reached through `useT()`; components hold
no prose. Numbers keep one convention in both languages: mono, `1,298,710`,
`0.906 ms` — the tables read the same whichever language is on.
`scrollbar-gutter:
stable` keeps the nav the same width on pages with and without a scrollbar.

The hero fills one viewport: the live mark on the left (360 px), and on the
right the eyebrow, the mono wordmark `graphman.`, the brief, two buttons
and the stack line (brand glyphs from `simple-icons`: Rust, WebAssembly,
WebGPU, Next.js, Vercel) under a hairline. A bouncing `// discover more`
arrow at the bottom scrolls to the "what it is" section (lead + fact tiles).
Below 900 px the hero stacks and centres.

The observatory renders under the nav (`calc(100dvh - var(--nav-height))`)
with no header of its own: a 340 px sidebar and the stage. The sidebar never
scrolls; it is a column of panels (Graph: file, 2 × 2 tiles, degree
histogram, component bar, chips; Search: origin, BFS/DFS segmented control
and a square play button, then result tiles, level profile and playback
(replay + slider + count; download and clear live in the panel header);
Diameter: a strip along the bottom that opens as a drawer over the panels,
its body growing with a `grid-template-rows` transition). Search results
are three compact stats (reached, eccentricity/depth, time) over a chart
that depends on the traversal: a BFS shows vertices per level as
horizontal bars, level 0 at the bottom, the index on the left a button
that moves the timeline to that level (the list scrolls when there are
many levels, without a scrollbar); a DFS shows the stack depth over
discovery time as an area trace (it plunges and backtracks), blue up to
the timeline cursor, and clicking or dragging on it scrubs. The chart
fills the room between the stats and the playback row, which is pinned to
the bottom of the panel. Arrow keys work anywhere on the page (Safari does
not focus clicked buttons): ↑/↓ a level, ←/→ a vertex. On short viewports
the sidebar sheds
pieces instead of scrolling — chips (≤ 880 px), component bar (≤ 820),
histogram (≤ 740), level profile (≤ 660) — and only scrolls below 580 px.
The stage carries floating clusters: a help button top left that opens a
controls popover (the same `kbd` cheat sheet as the empty sidebar, plus the
stage gestures; closes on Esc, outside click or the button), layout tools
top right (simulation on/off, reheat, vertex numbers, follow), view tools
bottom right (zoom in/out, fit, full screen), the legend bottom left. Vertex numbers are a 2D canvas over
the WebGPU one, drawn only when discs are at least 5 px.

## Icons

- UI icons come from `lucide-react` (14–24 px, `strokeWidth` 1.5–2):
  upload, flask (sample, only while no graph is loaded), x (close the
  graph), play/pause/replay, download, trash, ruler, magnet (force simulation),
  refresh, hash, plus/minus, maximise, expand/minimise, arrow-right,
  chevron-down, plus one per decision card and pipeline step.
- Brand glyphs come from `simple-icons` through `components/BrandIcon.tsx`,
  drawn in the current text colour.
- Icon chips (pipeline steps, decision cards) are 30–32 px bordered squares
  that turn blue and tilt 8° on hover.

## Components

- **Button**: 38 px (32 small), tracked uppercase 12 px, radius 4. `primary`
  is the blue fill (hover: darker + blue glow); `secondary` is a ghost that
  turns its border and text blue on hover. All lift 1 px on hover and press
  to 0.97.
- **Fact tile**: bordered grid cell, label on top, blue mono value, grey
  hint; a 2 px blue line grows along the bottom on hover.
- **Surface card**: 1 px border, 2 px blue left edge, radius 4; hover lifts
  3 px, tints to `--bg-2`, and the title underlines in blue.
- **Pipeline step**: cell in a bordered grid; hover slides the index right
  and grows a blue edge down the left.
- **Table**: bordered wrapper, caption band with a blue left edge, tracked
  uppercase headers, hairline rows that tint on hover.
- **Segmented control**: grey track with a white thumb that springs between
  segments.
- **Input / select**: 36 px, hairline; focus turns the border blue with a
  soft blue ring.
- **Panel** (observatory sidebar): tracked uppercase title with icon
  actions on the right, hairline bottom; panels rise in with a stagger.
  Inside: stat tiles (2 × 2 bordered grid, blue mono values), tiny bar
  charts (32 px, blue bars on a hairline axis), mono chips.
- **Icon button**: 30 px bordered square; hover turns it blue with a glow;
  `aria-pressed` fills it blue-muted. In a floating **cluster** (blurred,
  bordered pill on the stage) the borders drop and hover tints grey.
- **Empty observatory**: the sidebar shows two starter tiles (Sample, Open
  a file) and a cheat sheet of `kbd` chips (click, drag, scroll, F, space,
  arrows, esc) with three-word labels; the stage draws a faint drifting
  constellation on the label canvas (grey dots, a few blue, hairline links,
  pushed away by the pointer; decoration only) under a compact dashed card:
  icon, "Drop a graph file anywhere", the sample file as the format
  explanation (a tiny file card with `// comments`), and two buttons.
- **Nav**: sticky, blurred; links are tracked capitals that get a grey pill
  and a blue underline on hover; the bar slides in on load.
- **Notice**: floating bar bottom-centre, rises in.
- **Presentation** (`/presentation`, `Deck`): five slides, each filling the
  viewport under the nav — cover (the mark, the wordmark, the tagline, the
  stack), architecture (the `Graph` trait beside the three crates),
  decisions (five numbered cards), case studies (one dense table fed by
  `results.json`: memory of the list and the matrix, BFS/DFS on the list,
  components, the best diameter answer with `≥` for bounds), the
  observatory (four fact tiles and the call to action). ← → / space /
  PageUp-Down move, Home/End jump, F is full screen (the bar fades unless
  hovered); a thin bar holds prev/next, dots, the counter and the hint.
  Slides rise in; the hidden ones are `inert`.

## The canvas

- Vertices are instanced discs, `3.5·√zoom` px clamped to 1.5–12 px, blue
  (`--node` = `--accent`) without a search; during a search a three-stop
  ramp — `--level-0` (a deep navy, the accent at 42 %) at level 0, the
  accent halfway, `--accent-2` (light blue) at the deepest level — for
  reached vertices whose discovery rank is at or below the reveal cursor,
  `--node-dim` otherwise. The ramp is computed in the shader from the two
  accent uniforms.
- Edges are one-pixel lines: `--edge` without a search; tree edges take the
  child's level colour, every other edge drops to `--edge-dim`. On graphs
  with millions of edges their alpha is scaled down with the zoom so that
  where they pile up they add to a mid grey rather than a black disc, and
  while the picture moves only a sample of them is drawn (see
  `ARCHITECTURE.md`, the observatory); it never looks lighter than a single
  edge at full strength.
- **Discovery animation**: the reveal cursor advances at `rate` ranks per
  second (a uniform). A vertex discovered `age` seconds ago pops to 1.9× and
  settles over 0.5 s with an expanding blue halo; its tree edge draws itself
  from the parent during the rank before discovery and stays bright for
  0.7 s. Both are pure shader functions of `reveal`, `rate` and the ranks.
- The hovered vertex grows 1.3× with a `--fg` ring; the selected vertex
  grows 1.5× and keeps its ring. Selecting a vertex lights its neighbourhood: the
  neighbours grow 1.25× with the ring at half strength and the edges
  between are drawn in the accent, at full strength whatever the fade,
  and never dropped by the level-of-detail sampling. Running a search
  clears the selection: the tree is the picture, the origin is just
  level 0.
- **Components**: the Components tile of the graph summary carries a `›`
  button that swaps the summary for the components browser: a stacked bar
  of sizes (largest first, the tail past eight bucketed) whose pieces are
  buttons, a `‹ component 3 / 10 ›` navigator with ✕ back to the summary,
  and the selected component's tiles (vertices with its share, edges with
  their share, degree range with the mean, density). Opening lights the
  largest component on the canvas — accent vertices and edges, everything
  else `--node-dim` / `--edge-dim` — and glides the camera to frame it;
  ←/→ (or ↑/↓) step to the next / previous component while the components
  own the arrow keys (they take them on a click, the search takes them back
  when run or scrubbed); Esc clears the highlight. The legend reads
  `● component 3 | ● the rest`. The summary tiles carry no sub-labels.
- The search wave reveals discovery order over 1.6–8 s; the slider scrubs
  it, Space pauses, F fits, Esc (or a click on the background) clears the
  origin, ←/→ step a vertex (⇧ ten), ↑/↓ step a BFS level (ten vertices in
  a DFS).
- **Follow** (a `Focus` toggle in the layout cluster, always shown, off by
  default; running a search does not change it): the camera glides to frame the vertices
  discovered so far while the wave plays or the timeline is scrubbed, so a
  level-by-level walk stays readable on a large graph. Panning or zooming
  by hand switches it off.
- Layout: the BFS-radial initial layout from Rust, then a d3-style force
  simulation on the GPU for graphs up to 30 000 vertices. The view follows
  the simulation until the user pans, zooms or drags. Larger graphs open
  in the Radial levels layout instead, rooted in the largest component
  (the force placement is only a seed for a simulation they will not run).
- **The top-right cluster** is split by a hairline: on the left the view
  toggles (vertex numbers `#`, follow), on the right the layout menu
  (`Shapes`). The menu is a popover like the help one, hung under the
  cluster: Force (springs and repulsion), Radial levels (BFS rings around
  the origin), Layered (levels as rows, subtrees together), Degree circle
  (sorted by degree, edges as chords), each a `menuitemradio` with an icon,
  name and one-line hint; while Force is current a footer row holds the
  simulation toggle (magnet) and reheat. Picking a layout slides every
  vertex to its new place over 700 ms and glides the view to fit; the
  level layouts start at the search origin (or the selected vertex, else
  1) and re-arrange when a new search runs, the view then framing the
  origin's component only (the rest just makes room). Every component
  gets the layout: radial components are packed as discs around the
  origin's, layered ones stand side by side with level 0 on one line.

## Responsive rules

The landing folds at 900 px (hero stacks, mark first; decisions grid
becomes one column) and 720/640 px (mark 240 px, facts go two-up, footer
columns stack). The observatory sheds sidebar pieces by viewport height
(above) and stacks at 840 px: stage on top, the sidebar becomes a scrollable
bottom sheet of at most 46 % of the viewport with every piece shown again.
Touch targets stay at least 30 px; the stage uses `touch-action: none`.
