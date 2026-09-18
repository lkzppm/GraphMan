'use client';

import { useEffect, useRef } from 'react';
import styles from './Constellation.module.css';

/**
 * A faint constellation drifting over its parent: grey dots, a few blue,
 * hairline links between neighbours, pushed gently away by the pointer.
 * Decoration only; it fills the nearest positioned ancestor and ignores
 * pointer events. Still under `prefers-reduced-motion`.
 */
export default function Constellation({
  count = 72,
  className = '',
}: {
  count?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const accent =
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0070f3';
    const LINK = 120;
    const dots = Array.from({ length: count }, () => ({
      x: Math.random(),
      y: Math.random(),
      // A slow base drift plus an impulse from the pointer that fades out.
      bx: (Math.random() - 0.5) * 0.22,
      by: (Math.random() - 0.5) * 0.22,
      ix: 0,
      iy: 0,
      blue: Math.random() < 0.12,
    }));
    let pointer: { x: number; y: number } | null = null;
    const onMove = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
    };
    const onLeave = () => {
      pointer = null;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerleave', onLeave);
    document.addEventListener('pointerleave', onLeave);

    let w = 0;
    let h = 0;
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (w !== rect.width || h !== rect.height) {
        // First frame maps the unit square to pixels; later ones rescale.
        for (const d of dots) {
          d.x = w ? (d.x / w) * rect.width : d.x * rect.width;
          d.y = h ? (d.y / h) * rect.height : d.y * rect.height;
        }
        w = rect.width;
        h = rect.height;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      ctx.clearRect(0, 0, w, h);
      const px = pointer ? pointer.x - rect.left : -1e9;
      const py = pointer ? pointer.y - rect.top : -1e9;
      if (!still) {
        for (const d of dots) {
          const dx = d.x - px;
          const dy = d.y - py;
          const dist = Math.hypot(dx, dy);
          if (dist < 150) {
            const f = ((1 - dist / 150) * 0.5) / Math.max(dist, 1);
            d.ix += dx * f;
            d.iy += dy * f;
          }
          d.ix *= 0.94;
          d.iy *= 0.94;
          d.x += d.bx + d.ix;
          d.y += d.by + d.iy;
          if (d.x < -12) d.x = w + 12;
          else if (d.x > w + 12) d.x = -12;
          if (d.y < -12) d.y = h + 12;
          else if (d.y > h + 12) d.y = -12;
        }
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const a = dots[i];
          const b = dots[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= LINK * LINK) continue;
          const t = 1 - Math.sqrt(d2) / LINK;
          ctx.strokeStyle = `rgba(23, 23, 23, ${(0.14 * t).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
      for (const d of dots) {
        ctx.fillStyle = d.blue ? accent : '#cfcfcf';
        ctx.globalAlpha = d.blue ? 0.75 : 1;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.blue ? 2.6 : 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [count]);

  return <canvas ref={canvasRef} className={`${styles.canvas} ${className}`} aria-hidden="true" />;
}
