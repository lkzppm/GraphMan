'use client';

import { Check, Copy } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import styles from './Code.module.css';

/* A code block in the site's mono, with a light Rust colouring (comments,
   strings, keywords, macros) done by one regex pass, and a copy button. */

const RUST =
  /(\/\/.*$)|(b?"(?:[^"\\]|\\.)*")|(\b(?:use|let|mut|for|in|impl|fn|struct|const|match|return|if|else|true|false|self|as|pub|type|where)\b)|(\b[a-z_][a-z0-9_]*!)|(\b\d[\d_]*\b)|(\b[A-Z][A-Za-z0-9]*\b)/gm;

function colour(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of code.matchAll(RUST)) {
    if (m.index > last) out.push(code.slice(last, m.index));
    const [text, comment, string, keyword, macro, number, type] = m;
    const kind = comment
      ? styles.comment
      : string
        ? styles.string
        : keyword
          ? styles.keyword
          : macro
            ? styles.macro
            : number
              ? styles.number
              : type
                ? styles.type
                : undefined;
    out.push(
      <span key={m.index} className={kind}>
        {text}
      </span>,
    );
    last = m.index + text.length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export default function Code({
  code,
  lang = 'rust',
  copyLabel,
  copiedLabel,
}: {
  code: string;
  lang?: 'rust' | 'shell' | 'toml';
  copyLabel: string;
  copiedLabel: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // No clipboard (insecure context): the text is still selectable.
    }
  };
  return (
    <div className={styles.block}>
      <pre className={`mono ${styles.pre}`} data-lang={lang}>
        <code>{lang === 'rust' ? colour(code) : code}</code>
      </pre>
      <button
        type="button"
        className={styles.copy}
        onClick={copy}
        aria-label={copied ? copiedLabel : copyLabel}
        title={copied ? copiedLabel : copyLabel}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}
