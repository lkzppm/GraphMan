// What a page keeps for its own return: the observatory parks its graph
// and everything around it here when it unmounts (a client-side
// navigation to another tab), and takes it back when it mounts again, so
// leaving and coming back is not starting over. The DBLP console does the
// same with the year it summed. The slots live in memory: a reload empties
// them, and so does the page itself when the visitor closes its graph. A
// slot's wasm objects stay allocated while it is held, which is the point.

interface Slot {
  value: unknown;
  /** What the value holds in wasm, for a page that needs the room. */
  bytes: number;
  /** Frees the value's wasm objects. */
  release?: () => void;
}

const slots = new Map<string, Slot>();

/** Parks `value` under `key`, replacing what was there. */
export function keepSession<T>(
  key: string,
  value: T,
  held?: { bytes: number; release: () => void },
): void {
  slots.set(key, { value, bytes: held?.bytes ?? 0, release: held?.release });
}

/** Takes what `key` holds, leaving the slot empty; `null` when nothing is held. */
export function takeSession<T>(key: string): T | null {
  const slot = slots.get(key);
  slots.delete(key);
  return (slot?.value as T | undefined) ?? null;
}

/** What `key` holds in wasm, as declared when it was parked. */
export function sessionBytes(key: string): number {
  return slots.get(key)?.bytes ?? 0;
}

/** Frees what `key` holds and empties the slot, for a page that needs the room. */
export function releaseSession(key: string): void {
  const slot = slots.get(key);
  slots.delete(key);
  try {
    slot?.release?.();
  } catch {
    // Left borrowed by a trap: it stays until the page is reloaded.
  }
}

/** The observatory's slot. */
export const OBSERVATORY_SESSION = 'observatory';
/** The DBLP console's slot. */
export const DBLP_SESSION = 'dblp';
