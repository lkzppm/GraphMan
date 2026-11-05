// What a page keeps for its own return: the observatory parks its graph
// and everything around it here when it unmounts (a client-side
// navigation to another tab), and takes it back when it mounts again, so
// leaving and coming back is not starting over. The DBLP console does the
// same with the year it summed. The slots live in memory: a reload empties
// them, and so does the page itself when the visitor closes its graph. A
// slot's wasm objects stay allocated while it is held, which is the point.

const slots = new Map<string, unknown>();

/** Parks `value` under `key`, replacing what was there. */
export function keepSession<T>(key: string, value: T): void {
  slots.set(key, value);
}

/** Takes what `key` holds, leaving the slot empty; `null` when nothing is held. */
export function takeSession<T>(key: string): T | null {
  const held = slots.get(key);
  slots.delete(key);
  return (held as T | undefined) ?? null;
}

/** The observatory's slot. */
export const OBSERVATORY_SESSION = 'observatory';
/** The DBLP console's slot. */
export const DBLP_SESSION = 'dblp';
