import type { AnnalsEvent } from './types.js';

/**
 * A view is a pure function of the log. Nothing here is stored; call it again
 * when `log.version` changes.
 */
export function fold<S, E extends AnnalsEvent = AnnalsEvent>(
  events: readonly E[],
  reducer: (state: S, event: E) => S,
  init: S,
): S {
  let s = init;
  for (const e of events) s = reducer(s, e);
  return s;
}

/**
 * Last-write-wins view: for every key, the latest event that maps to it.
 * `keyOf` returns `null` to skip an event. `annals/state` builds its
 * "current facts" view this way: key = `${entity}\u0000${attr}`.
 */
export function latest<K, E extends AnnalsEvent = AnnalsEvent>(
  events: readonly E[],
  keyOf: (event: E) => K | null,
): Map<K, E> {
  const out = new Map<K, E>();
  for (const e of events) {
    const k = keyOf(e);
    if (k !== null) {
      out.delete(k); // re-insert so Map order == recency
      out.set(k, e);
    }
  }
  return out;
}
