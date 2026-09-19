'use client';

import { useEffect, useRef, type RefObject } from 'react';
import styles from './Field.module.css';

/* The field behind "in the browser": a grid of grey dots filling the
   section, and every few seconds a wave setting off from the globe's
   centre. A dot the wave reaches stretches along the wave's direction,
   squashes back as the crest passes, and settles, turning blue while it
   moves: squash and stretch, the animator's way to give a dot weight.
   Drawn on a canvas (a thousand ellipses a frame is nothing), only while
   the section is on screen. The same clock sets `--blink` on the section,
   which the globe's opacity reads, so its blue blinks exactly when a wave
   leaves it. */

/** Pixels between dots, and the resting radius of one. */
const PITCH = 28;
const RADIUS = 1.2;
/** Seconds between two waves, and how fast a wave travels (px/s). */
const PERIOD = 4.5;
const SPEED = 130;
/** Seconds a wave lives (two are always on their way). */
const LIFE = PERIOD * 2;
/** Width of the crest, in pixels, and where the deformation peaks. */
const SIGMA = 46;
/** How far the dots stay full above and below the origin, and where they
    are gone, so the field hands over to the plain page at both edges. */
const FADE = { above: [-220, -400], below: [160, 600] };

type Dot = { x: number; y: number; d: number; angle: number; fade: number };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const bump = (v: number, at: number, width: number) => Math.exp(-(((v - at) / width) ** 2));

/** The globe's blue for a wave of age `a` seconds, 0..1: a blink, a smaller
    bounce, and a glow that lingers until the next wave. */
function pulse(a: number): number {
  const k = a / 4.2;
  if (k >= 1) return 0;
  const linger = 0.35 * (1 - k) ** 1.5;
  return Math.min(1, bump(k, 0.12, 0.1) + 0.5 * bump(k, 0.36, 0.13) + linger);
}

interface Props {
  /** The element the waves set off from (its centre). */
  origin: RefObject<Element | null>;
}

export default function Field({ origin }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const section = canvas?.parentElement;
    if (!canvas || !section) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    const grey = getComputedStyle(document.documentElement).getPropertyValue('--border-2').trim();
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Everything the frames share, in one object the closures may change.
    const st = {
      dots: [] as Dot[],
      width: 0,
      height: 0,
      dpr: 1,
      frame: 0,
      start: 0,
      running: false,
    };

    // Lay the grid out again whenever the section or the origin moves.
    const layout = () => {
      const box = section.getBoundingClientRect();
      const from = origin.current?.getBoundingClientRect();
      const { width, height } = box;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const ox = from ? from.left - box.left + from.width / 2 : width / 2;
      const oy = from ? from.top - box.top + from.height / 2 : height / 2;
      const dots: Dot[] = [];
      // Dots sit on a grid centred on the origin, so one dot is under it.
      for (let y = oy % PITCH; y < height; y += PITCH) {
        for (let x = ox % PITCH; x < width; x += PITCH) {
          const dx = x - ox;
          const dy = y - oy;
          const fade =
            dy < 0
              ? 1 - clamp01((dy - FADE.above[0]) / (FADE.above[1] - FADE.above[0]))
              : 1 - clamp01((dy - FADE.below[0]) / (FADE.below[1] - FADE.below[0]));
          if (fade <= 0) continue;
          dots.push({ x, y, d: Math.hypot(dx, dy), angle: Math.atan2(dy, dx), fade });
        }
      }
      Object.assign(st, { dots, width, height, dpr });
    };

    const draw = (t: number) => {
      ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
      ctx.clearRect(0, 0, st.width, st.height);

      // The waves on their way right now: their crest radius and strength.
      const waves: { r: number; strength: number }[] = [];
      let blink = 0;
      if (!still) {
        for (let k = 0; k < LIFE / PERIOD; k++) {
          const age = ((t + k * PERIOD) % LIFE) as number;
          const life = age / LIFE;
          // Strength eases in over the first second and out towards the end.
          const strength = clamp01(age / 1.2) * (1 - life * life);
          waves.push({ r: age * SPEED, strength });
          blink = Math.max(blink, pulse(age));
        }
      }

      // Every dot the waves leave alone goes into one grey path.
      ctx.beginPath();
      ctx.fillStyle = grey;
      const moving: { dot: Dot; s: number; q: number; i: number }[] = [];
      for (const dot of st.dots) {
        let s = 0;
        let q = 0;
        let i = 0;
        for (const wave of waves) {
          // w: how far the crest is past this dot, in crest widths.
          const w = (wave.r - dot.d) / SIGMA;
          if (w < -1.6 || w > 3.2) continue;
          s = Math.max(s, bump(w, 0.3, 0.7) * wave.strength);
          q = Math.max(q, bump(w, 1.7, 0.8) * wave.strength);
          i = Math.max(i, s, q);
        }
        if (i < 0.02) {
          ctx.globalAlpha = dot.fade;
          ctx.moveTo(dot.x + RADIUS, dot.y);
          ctx.arc(dot.x, dot.y, RADIUS, 0, Math.PI * 2);
        } else {
          moving.push({ dot, s, q, i });
        }
      }
      ctx.globalAlpha = 1;
      ctx.fill();

      // The dots in the wave: stretched along the wave as the crest comes,
      // squashed across it as the crest goes, blue in proportion.
      for (const { dot, s, q, i } of moving) {
        const along = RADIUS * (1 + 2.6 * s - 0.45 * q + 0.6 * i);
        const across = RADIUS * (1 - 0.35 * s + 1.4 * q + 0.6 * i);
        ctx.beginPath();
        ctx.globalAlpha = dot.fade;
        ctx.fillStyle = i > 0.5 ? accent : grey;
        if (i <= 0.5) {
          // Mix towards blue before it takes over.
          ctx.globalAlpha = dot.fade * (1 - i * 2);
          ctx.ellipse(dot.x, dot.y, along, across, dot.angle, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.globalAlpha = dot.fade * i * 2;
          ctx.fillStyle = accent;
        }
        ctx.ellipse(dot.x, dot.y, along, across, dot.angle, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Resting blue 0.2, full blink 0.55.
      section.style.setProperty('--blink', String(0.2 + 0.35 * blink));
    };

    const tick = (now: number) => {
      if (!st.running) return;
      if (!st.start) st.start = now;
      draw((now - st.start) / 1000);
      st.frame = requestAnimationFrame(tick);
    };
    const run = (on: boolean) => {
      if (on === st.running) return;
      st.running = on && !still;
      if (st.running) st.frame = requestAnimationFrame(tick);
      else cancelAnimationFrame(st.frame);
    };

    layout();
    draw(0);
    const resize = new ResizeObserver(() => {
      layout();
      draw(0);
    });
    resize.observe(section);
    const visible = new IntersectionObserver(([entry]) => run(entry.isIntersecting), {
      threshold: 0,
    });
    visible.observe(section);
    return () => {
      run(false);
      resize.disconnect();
      visible.disconnect();
    };
  }, [origin]);

  return <canvas ref={canvasRef} className={styles.field} aria-hidden="true" />;
}
