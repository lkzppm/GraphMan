// A graph handed from the DBLP tab to the observatory without touching
// disk: the console builds a network in memory, offers it here and opens
// /observatory, which takes it as if the files had been dropped. The slot
// lives for one client-side navigation; a reload of the observatory finds
// it empty, which is the empty stage as usual.

/** The largest file the observatory takes, dropped or handed over. */
export const OBSERVATORY_MAX_BYTES = 1024 * 1024 * 1024;

/** A graph file and, when there is one, its names file. */
export interface Handoff {
  name: string;
  bytes: Uint8Array;
  names: { name: string; bytes: Uint8Array } | null;
}

let pending: Handoff | null = null;

export function offerGraph(handoff: Handoff): void {
  pending = handoff;
}

export function takeGraph(): Handoff | null {
  const handoff = pending;
  pending = null;
  return handoff;
}
