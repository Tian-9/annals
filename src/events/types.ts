/**
 * The event log is the only source of truth. Everything else (views, index,
 * weights) is derived and can be recomputed by code alone.
 */

export interface AnnalsEvent<T extends string = string, P = unknown> {
  /** Unique id. Supplied by the caller or generated. */
  id: string;
  /** Monotonic position in the log. Assigned by the log. */
  seq: number;
  /**
   * When this happened, on the application's own clock (story day, campaign
   * clock, wall time…). The library never reads `Date.now()`.
   */
  at: number;
  /** Discriminator, e.g. "state.set", "summary", "bag". */
  type: T;
  /**
   * What produced this event (a message id, an import batch…). Retracting a
   * source removes every event it produced. This is how an edited or swiped
   * message takes its consequences with it.
   */
  source?: string;
  payload: P;
}

export interface EventInput<T extends string = string, P = unknown> {
  id?: string;
  at: number;
  type: T;
  source?: string;
  payload: P;
}
