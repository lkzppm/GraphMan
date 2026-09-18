// The interface strings live in one typed object per language: `en.tsx`
// defines the shape, `pt.tsx` must provide every key of it, so a missing
// translation is a type error, not a blank on the page. Code, docs and
// commits stay in English; only what the visitor reads is translated.
import { en } from './en';
import { pt } from './pt';

export type Locale = 'en' | 'pt';
export type Dictionary = typeof en;

export const DEFAULT_LOCALE: Locale = 'pt';
export const DICTIONARIES: Record<Locale, Dictionary> = { en, pt };
