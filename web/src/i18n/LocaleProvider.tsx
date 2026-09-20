'use client';

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { DICTIONARIES, DEFAULT_LOCALE, type Dictionary, type Locale } from './index';

const STORAGE_KEY = 'graphman.locale';

// The chosen language is an external store: localStorage when it works, a
// module variable otherwise. Reading it through useSyncExternalStore lets
// the server and the hydrating client agree on the default and switch to
// the stored choice right after, with no setState inside an effect.
let chosen: Locale | null = null;
const listeners = new Set<() => void>();

function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'pt';
}

function readLocale(): Locale {
  if (chosen) return chosen;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Storage unavailable (private mode): the default stands.
  }
  return DEFAULT_LOCALE;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

function writeLocale(next: Locale) {
  chosen = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not persisted; the choice still holds for this page.
  }
  listeners.forEach((listener) => listener());
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Dictionary;
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: DICTIONARIES[DEFAULT_LOCALE],
});

/** Holds the interface language (Portuguese, the course's, by default). */
export default function LocaleProvider({ children }: { children: React.ReactNode }) {
  const locale = useSyncExternalStore(subscribe, readLocale, () => DEFAULT_LOCALE);

  useEffect(() => {
    document.documentElement.lang = DICTIONARIES[locale].lang;
  }, [locale]);

  const value = useMemo(
    () => ({ locale, setLocale: writeLocale, t: DICTIONARIES[locale] }),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** The current dictionary plus the locale and its setter. */
export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

/** The current dictionary: `const t = useT(); t.nav.library`. */
export function useT(): Dictionary {
  return useContext(LocaleContext).t;
}
