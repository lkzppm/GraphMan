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
   exists only so the level ramp has a far end. One green (`--target`,
   `#16a34a`) exists for exactly one thing: the destination of a distance
   query, on the canvas and in the path balls. No red, no amber.
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

| Role                                             | Value                                 |
| ------------------------------------------------ | ------------------------------------- |
| `--bg` / `--bg-2` / `--bg-3`                     | `#fff` / `#fafafa` / `#f2f2f2`        |
| `--fg` / `--fg-2` / `--fg-3`                     | `#171717` / `#666` / `#8f8f8f`        |
| `--border` / `--border-2`                        | `#e6e6e6` / `#cfcfcf`                 |
| `--accent` / `--accent-hover` / `--accent-muted` | `#0070f3` / `#0a5fd0` / blue at 12 %  |
| `--accent-2` (level ramp end)                    | `#a9dcff`                             |
| `--level-0` (level ramp start)                   | `#002f66`                             |
| `--node` / `--node-dim`                          | `#8f8f8f` / `#d6d6d6`                 |
| `--edge` / `--edge-dim`                          | ink at 14 % / 6 %                     |
| Radii                                            | 2 / 4 / 6 px                          |
| `--tracking`                                     | `0.1em` (labels), `0.3em` (eyebrows)  |
| `--glow`                                         | `0 6px 24px -6px var(--accent-muted)` |
| Container                                        | 1080 px, 24 px gutters                |

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
— **Observatory** (`/observatory`), **Library** (`/library`, the
interactive manual), **Case studies** (`/studies`, the seven questions drawn), **Presentation**
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
`0.906 ms`, so the tables read the same whichever language is on. The em
dash is banned from everything the visitor reads (site and slides): a
comma, a colon or a full stop takes its place, and a missing table value
is a middle dot. `scrollbar-gutter: stable` keeps the nav the same width on
pages with and without a scrollbar.

The hero fills one viewport: the live mark on the left (360 px), and on the
right the eyebrow, the mono wordmark `graphman.`, the brief, two buttons
and the stack line (brand glyphs from `simple-icons`: Rust, WebAssembly,
WebGPU, Next.js, Vercel) under a hairline. A bouncing `// discover more`
arrow at the bottom scrolls to the "what it is" section. Below 900 px the
hero stacks and centres.

The two sections under the hero have no boxes; they sit straight on the
white page and rise into view as it is scrolled (`components/Reveal.tsx`,
26 px and 0.9 s, staggered through `--delay`).

- **What it is**: the title and lead on the left with three facts under a
  hairline (blue mono value, tracked label, grey hint), and on the right
  the three-representations figure (`components/Representations.tsx`): one
  five-vertex graph drawn beside its adjacency list and its bitset matrix
  (one dot per bit), with its CSR arrays underneath. One vertex is in focus at a time and everything that belongs to it turns
  blue: the vertex and its edges, its row in the list (and itself wherever
  it appears as a neighbour), its row and column in the matrix, its slice
  of `targets` and the two `offsets` that bound it. The vertex taking the
  focus squashes flat, stretches tall and settles (0.6 s, about its own
  centre). The focus walks the vertices every 1.8 s and follows the
  pointer while the figure is hovered.
- **Library** (`components/Wiki.tsx`): a manual in eight chapters on the
  sample graph (the pentagon with one chord the home draws three ways,
  `lib/sample.ts`), more minimal than the home. A rail fixed on the left
  and centred on the viewport lists the eight chapters as vertices on one
  vertical edge; the edge is drawn in blue down to the current stop, whose
  vertex is filled and larger (hidden below 1240 px; it fades out when the
  footer scrolls up to it and returns when the footer leaves). One 760 px column,
  centred, with no head of its own: the first chapter opens the page.
  Each chapter: mono index, title, a link to the source file
  it documents, one paragraph, the Rust example (plain usage with results
  in comments, never tests) and a fixed drawing of what it computes. Code
  and tables are washed in the accent (`components/Code.tsx`: a 5 % blue
  block with a 14 % hairline, keywords in the hover blue, types and macros
  in the navy, strings and numbers in the accent, comments grey, a copy
  button on hover; tables get a 7 % blue header band and 2.5 % zebra
  rows). Drawings are unboxed, centred, with their legend under them, and
  share the home figure's look (`components/GraphFigure.tsx`: 1.35 px per
  unit of `lib/sample.ts`, 12 px vertices, 1.5 px strokes, 11 px mono
  labels): the sample's text file (the count in blue) with an arrow to the
  graph it describes, each under a tracked label (start), the
  normalisation as chips with loops and repeats struck (format), the home's
  figure (representations), BFS beside DFS with levels on the navy-to-light
  ramp and tree edges in blue (traversals), the search as it stands when
  `Until(4)` breaks beside its `discover` calls as balls on one vertical
  edge in the same level colours (visitors), two components in fading
  blues with the shortest path from 4 to 3 (distance), the endpoints 1 and
  5 ringed in navy with a longest shortest path (diameter), and the sample
  file, the `graphman bfs` command and the file it writes, arrows between
  (CLI). The memory budget is a paragraph
  and three lines of the representations chapter, not a chapter of its
  own, and the design decisions belong to the presentation.
- **Case studies** (`components/Studies.tsx`, `/studies`): the seven
  questions of the assignment on one screen and nothing else, no title
  and no prose, everything read from `studies/results.json`. A menu stuck
  under the site's nav (blurred white, a hairline under it) lists the
  views as vertices on one edge: `Geral` first and the default (its
  vertex holds a dot), then the six graphs; the current view's vertex is
  filled blue and the view is kept in the hash (`#geral`, `#grafo-3`).
  It is a tablist: left and right walk it from anywhere on the page, and
  with the menu focused up, down, Home and End work too and the focus
  follows the chosen tab (the arrows still scroll the page elsewhere).
  Every view is the same sheet: the name, then in the room to its right
  the output file's facts (vertices, edges, degree min/max/mean/median,
  loops and duplicates dropped; the overview opens the row with `média dos
  6 grafos` in tracked blue and leaves the dropped lines out, an average
  of them means nothing), a row that wraps inside its own column so it
  never drops under the name; then three rows. Row one: memory, mean BFS and mean DFS as
  three bar charts side by side (list in the accent, CSR in the navy,
  matrix in the light blue; a dashed outline where the matrix was refused,
  labelled with what it would need). Row two: the parents of 10, 20 and
  30 as two accent-washed tables side by side, BFS and DFS, the parent
  over its level, a dot for another component. Row three: the three
  distances as a triangle (10 on top, 20 and 30 below), each side labelled
  in a white pill (the drawing fills its column up to 195 px), dashed and
  grey with `∞` across components; beside it, the components as a ring
  (150 px) cut into three arcs, clockwise from the top (the largest in the
  accent, everything between it and the smallest in a 45 % blue, the
  smallest in the light blue, a hairline gap between them), the count in
  blue in the hole with the word under it, and to the right a legend line
  per part with a swatch, its size and percentage; hovering an arc or its
  line swells that arc and fades the rest. The three columns stretch to
  the triangle's height; the ring sits in the middle of its column and
  the four diameter rows spread over the same height. The third column
  is the diameter as the
  BFS runs each method spent (brute force navy, Takes-Kosters accent, iFUB
  mid blue, 4-sweep light), the answer in blue when certified and grey
  with `≥` when a bound, a dashed bar and `stopped at` where the budget ran
  out. The overview sheet holds the mean of every number over the six
  graphs; where a number exists on fewer graphs (the matrix on two, brute
  force on four) `k de 6` is written beside it, the parent cells become
  `k de 6` reached over the mean level, and a diameter method is exact
  only when it was on every graph. The bar scales are computed once over
  all six graphs and shared by every sheet, so a bar's length means the
  same wherever it is; bars grow from nothing when their chapter comes
  into view. Switching view never remounts the sheet: the elements stay in
  place, bars and arcs slide to their new length over 1.1 s (a bar with
  nothing to show keeps its box at width 0) and every number crossfades in
  400 ms, keyed by the view. Table rows are a fixed 44 px tall so a cell
  that holds only a dot does not resize the table mid-transition. The whole sheet fits a 1440 × 900 viewport under the two
  bars. Below 900 px the rows stack and the menu wraps; below 600 px the
  values drop under their bars.
- **Footer**: a small graph. One 1.5 px edge runs across the top and each
  of the four columns (project, stack, author, course) hangs from a 12 px
  vertex on it; hovering a column fills its vertex blue. The author column
  carries the GitHub and LinkedIn links with their glyphs (LinkedIn's path
  is inlined, simple-icons no longer ships it). Under a hairline, centred:
  the mark, the wordmark and `© 2026`. At 720 px the columns go two-up and
  only the first row keeps its vertices.
- **In the browser**: the title centred, its last words (`in your browser`)
  in blue, over a faint blue globe (lucide `globe` at 520 px, thick lines,
  a watermark masked to fade at the rim); then two cards (wasm, WebGPU).
  The section's background is a field of faint
  grey dots (28 px grid) that fades out towards the section's edges, the
  way the constellation fades under the hero; every 4.5 s a ring expands
  from the globe's centre to the edges of the section and is visible only
  through soft-edged dots wider than the grey ones, so each dot swells
  blue as the ring rises under it and shrinks back as it passes: a wave
  lifting the field. As each ring sets off the globe's blue blinks
  brighter (0.11 to 0.3) and settles back with a little bounce; the globe
  itself never moves. Everything eases: the ring grows at a steady pace
  (`grow`, linear) while its strength eases in over the first second and
  out over the rest (`glow`), and the pulse is `ease-in-out`, so nothing
  pops at either end of the 9 s loop. Rings and pulse start together when
  the words scroll into view, so they stay in step (`Pipeline.module.css`,
  pure CSS: masked radial gradients; hidden under reduced motion).

The observatory renders under the nav (`calc(100dvh - var(--nav-height))`)
with no header of its own: a 340 px sidebar and the stage. The sidebar never
scrolls; it is a column of panels (Graph: file, 2 × 2 tiles, degree
histogram, component bar, chips; Search: two small segmented controls
side by side — mode (Max, the whole traversal / Distance) and traversal (BFS / DFS) — then
origin (and, in Distance, target) with a square play button, then result
tiles, level profile and playback (replay + slider + count; download and
clear live in the panel header). Controls are compact: 28 px inputs,
segments and play button, 11 px labels. **Distance** runs the chosen
traversal from the origin and stops it the moment the target is
discovered: the tiles read distance (steps, for a DFS; `∞` when the
target is in another component), reached and time, and the level profile
or depth trace cover only what was visited until then. The path floats
at the top centre of the canvas as a row of balls (`③ → ⑤ → ②`, coloured
from the origin's accent to the destination's `--target` green, the
middle elided past ten) with two icon buttons beside it: grey out
everything but the path (a toggle), and fit the path to the view. On the
canvas the origin is drawn in the accent and the destination in green,
the path's vertices grow 1.6× with the `--fg` ring and wear the same
gradient, its edges are thick gradient segments drawn over everything
(appearing with the wave, never dropped by the sampling), every vertex
off the path shrinks to a third (the fit button frames the path; the
view otherwise stays where it was); the legend reads origin ·
destination · not reached. In Distance a
click on the canvas picks the target once the origin is set;
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
- Icon chips (decision cards) are 30–32 px bordered squares that turn blue
  and tilt 8° on hover; the pipeline cards show the bare icon in blue.
- The globe behind the "in the browser" title is lucide `globe` at 520 px
  with `strokeWidth` 0.8 (about 17 px lines at that size), blue at 0.11
  between pulses.

## Components

- **Button**: 38 px (32 small), tracked uppercase 12 px, radius 4. `primary`
  is the blue fill (hover: darker + blue glow); `secondary` is a ghost that
  turns its border and text blue on hover. All lift 1 px on hover and press
  to 0.97.
- **Fact**: blue mono value (34 px), tracked label, grey hint, in a row
  under a hairline with nothing boxed; the value lifts 2 px on hover.
- **Surface card**: 1 px border, 2 px blue left edge, radius 4; hover lifts
  3 px, tints to `--bg-2`, and the title underlines in blue.
- **Pipeline step**: a white card on the dot field framed as a graph: a
  6 px vertex on each corner joined by a 1.5 px edge along each side (an
  SVG with percent coordinates), the bare 22 px icon in blue beside the
  title, the body under; hover lifts it 3 px, fills the vertices and edges
  blue and tilts the icon. No index, no disc.
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
  1. and re-arrange when a new search runs, the view then framing the
     origin's component only (the rest just makes room). Every component
     gets the layout: radial components are packed as discs around the
     origin's, layered ones stand side by side with level 0 on one line.

## Responsive rules

The landing folds at 900 px (hero stacks, mark first; decisions grid
becomes one column) and 720/640 px (mark 240 px, footer columns stack);
the representations figure folds at 560 px (the drawing full width, the
list and the matrix side by side, CSR under them). The observatory sheds sidebar pieces by viewport height
(above) and stacks at 840 px: stage on top, the sidebar becomes a scrollable
bottom sheet of at most 46 % of the viewport with every piece shown again.
Touch targets stay at least 30 px; the stage uses `touch-action: none`.
