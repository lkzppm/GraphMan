'use client';

import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'graphman.theme';

/**
 * Runs in `<head>` before the first paint (see `app/layout.tsx`): the
 * stored choice, or else the system's, lands on `<html data-theme>` so a
 * dark visitor never sees a white flash. Kept in step with `systemTheme`
 * and `storedTheme` below.
 */
export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='light'}`;

// Like the language, the theme is an external store: the visitor's choice
// once they have made one (remembered in localStorage, or held here when
// storage is unavailable), the system's until then, followed live.
let chosen: Theme | null = null;
const listeners = new Set<() => void>();

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark';
}

function storedTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // Storage unavailable (private mode): the system decides.
  }
  return null;
}

function systemTheme(): Theme {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readTheme(): Theme {
  return storedTheme() ?? chosen ?? systemTheme();
}

/** The browser's own bar follows the page, whichever way it was chosen. */
function syncThemeColor(theme: Theme) {
  const paper = theme === 'dark' ? '#0a0a0a' : '#ffffff';
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute('content', paper));
}

function notify() {
  const theme = readTheme();
  document.documentElement.dataset.theme = theme;
  syncThemeColor(theme);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    syncThemeColor(readTheme());
    window.addEventListener('storage', notify);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', notify);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener('storage', notify);
      matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', notify);
    }
  };
}

/** How long a switch eases the colours (the transition on
    `:root[data-theme-switching]` in globals.css). */
export const THEME_FADE_MS = 600;

let switching = 0;

/** Switches the theme and remembers it. The colour tokens ease from one
    theme to the other for `THEME_FADE_MS` while every other transition is
    held (see globals.css); canvases follow with `onThemeFade`. */
export function setTheme(next: Theme) {
  chosen = next;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Not persisted; the choice still holds for this page.
  }
  const root = document.documentElement;
  root.dataset.themeSwitching = '';
  notify();
  clearTimeout(switching);
  switching = window.setTimeout(() => delete root.dataset.themeSwitching, THEME_FADE_MS + 50);
}

/** The current theme. The server, and the first client render, say light;
    the real one follows straight after hydration. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme, () => 'light');
}

/** Calls `frame` on every animation frame while the theme's colours
    ease, from the switch until they settle; returns the unsubscribe. For
    canvases, which read the CSS colours rather than inherit them. */
export function onThemeFade(frame: () => void): () => void {
  let raf = 0;
  const off = subscribe(() => {
    cancelAnimationFrame(raf);
    const end = performance.now() + THEME_FADE_MS + 50;
    const step = () => {
      frame();
      if (performance.now() < end) raf = requestAnimationFrame(step);
    };
    step();
  });
  return () => {
    off();
    cancelAnimationFrame(raf);
  };
}
