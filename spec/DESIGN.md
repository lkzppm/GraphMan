# GraphMan design system

The look of GraphMan is its own: an instrument, not a brochure. The page is a
sequence of full-height scenes that alternate between paper (white and
parchment) and graphite (near-black), the only colour is the signal blue that
also lights the BFS wave, and every moving thing moves like liquid or catches
light like metal. Motion explains structure; nothing animates for its own sake.

## Principles

1. **The data is the hero.** The observatory canvas and the logo loop are the
   two visual anchors; chrome around them is quiet, hairline-bordered, and
   recedes. No decorative gradients on surfaces, no drop shadows on cards.
2. **One signal colour.** Blue means "alive": links, primary actions, the lit
   frontier of a search, the active graph. On graphite it brightens to sky
   blue so it stays readable. Everything else is ink, paper or graphite.
3. **Full-screen scenes.** Every section is at least one viewport tall and
   vertically centred, so each scroll stop reads as a complete slide. This is
   also how the site doubles as the presentation.
4. **Fluid, physical motion.** Hover lifts, liquid indicators that flow
   between targets, metal rings that shimmer, a frontier wave that breathes.
   Everything eases out (`cubic-bezier(0.22, 1, 0.36, 1)`) and respects
   `prefers-reduced-motion`.
5. **Honest numbers.** Charts follow the dataviz method: thin marks, direct
   labels, a legend for every multi-series chart, validated categorical
   colours, no dual axes. A budgeted or approximate value is always flagged.

## Tokens (`web/src/styles/tokens.css`)

| Role | Value | Notes |
|---|---|---|
| Signal blue | `#0066cc` | links, primary pills, eyebrows on paper |
| Signal blue, focus | `#0071e3` | focus rings, hover fill |
| Sky blue | `#2997ff` | the signal on graphite; also the lit frontier in the observatory |
| Paper | `#ffffff` | hero, case studies |
| Parchment | `#f5f5f7` | anatomy, footer |
| Graphite 1 / 2 / 3 | `#272729` / `#2a2a2c` / `#252527` | observatory tile and its stat tiles |
| Void | `#000000` | nav bar, observatory canvas |
| Ink | `#1d1d1f` | text on paper |
| Ink 80 / 48 | `#333333` / `#7a7a7a` | secondary and muted text |
| Hairline | `#e0e0e0`, `rgba(0,0,0,.08)` | card borders |
| Radii | 8 / 11 / 18 / pill | utility, list items, cards and frames, actions |
| Spacing | 4 · 8 · 12 · 17 · 24 · 32 · 48 · 64 | 8-based with 17 for text rhythm |

Chart series (validated with the dataviz palette): adjacency list `#2a78d6`,
adjacency matrix `#eb6834`, CSR `#1baf7a`; diameter methods reuse the first
three slots plus `#eda100` for brute force, always with direct labels.

## Typography

System display stack (`SF Pro` on Apple platforms, `Inter` elsewhere).
Weights 400 and 600 only. Headlines are tight: hero `clamp(44px, 6.2vw, 84px)`
at line-height 1.02 and `-0.03em` tracking; section titles 40px; body 17px
at 1.47; captions 14px; numbers in the monospace stack with tabular figures.

## Surfaces and scenes

- **Hero (paper)**: two columns, copy left, the logo loop right. The loop is a
  white-background video blended with `mix-blend-mode: multiply` so only the
  drawing floats on the page. Facts row of four numbers under the CTAs.
- **Observatory (graphite)**: a console. Sidebar with the graph list, the
  liquid BFS/DFS switch, level profile and hints; the stage on the right,
  framed by a slowly turning metallic ring, with the transport bar and three
  stat tiles beneath it. The stage fills the viewport height minus the
  header. Stacks on tablets and phones with the stage first.
- **Anatomy (parchment)**: the trait diagram draws itself on scroll, then six
  decision cards.
- **Case studies (paper)**: small-multiple panels per graph, one legend per
  chart family, tables for the assignment's answers.
- **Footer (parchment)**: three link columns and a legal line.

## Components

- **Pill**: 12 × 24 px, full radius, signal blue fill or ghost outline; hover
  lifts 2 px and brightens; the primary hero pill wears a silver metal ring
  (`metal-fx`).
- **Icon button**: 34 px circle, translucent chip fill, silver metal ring on
  graphite; scales 1.06 on hover.
- **Liquid switch**: the BFS/DFS segmented control; the white thumb is a
  `liquid-gooey` move item so it stretches and settles like a drop.
- **Liquid nav**: the highlight behind the top links is a liquid blob that
  flows to whatever link is hovered.
- **Card / panel**: paper surface, hairline border, radius 18; hover lifts 4 px
  and tints the border blue.
- **Graph list item**: radius 11; the active one gets a translucent sky-blue
  fill and inset ring that slides between items (`layoutId`).
- **Stat tile**: graphite 2 surface, 11 px radius, label 11px, value 17px 600.
- **Stage ring**: 1 px conic gradient of sky blue and white on graphite,
  rotating over 14 s, paused under reduced motion.
- **Loader**: a single pulsing sky-blue ring with the download progress text.

## Motion

| Situation | Treatment |
|---|---|
| Entering the page | staggered rise (22 px, 0.6–0.7 s) for hero copy; the loop scales in from 0.96 |
| Scrolling into a section | headers and cards rise once (`whileInView`), diagram wires draw with `pathLength` |
| Hover | lift + border tint on cards, lift + brighten on pills, scale on icon buttons, liquid blob on nav |
| Switching BFS / DFS | shader morph between the two layouts (exponential ease, ~1 s); the wave replays after the morph |
| The wave | frontier advances at `(maxLevel + 2) / 7 s`, holds 1.6 s at the end, loops |
| Reduced motion | `scroll-behavior: auto`, ring rotation off; library components honour the media query |

## Effects budget

Two effect libraries, each with one job: `liquid-gooey` for indicators that
move (switch thumb, nav highlight) and `metal-fx` for rings on actionable
things (primary pill, icon buttons). Nothing else shimmers. WebGL is spent on
the observatory; everything else is CSS and a few SVG filters.

## Responsive rules

Breakpoints at 1068, 834, 640 and 480 px. The hero stacks with the loop on
top below 1068; the console stacks with the stage first below 834; grids fold
from 4 → 2 → 1 columns; nav links shrink but never wrap; touch targets stay
at least 34 px.
