import type { AnnalsEvent } from '../events/types.js';

/**
 * Persistence is an adapter. The library ships an in-memory one; IndexedDB
 * (Dexie), SQLite or files are separate entry points so the core stays
 * runtime-agnostic.
 */
export interface EventStore<E extends AnnalsEvent = AnnalsEvent> {
  append(events: readonly E[]): Promise<void>;
  /** Remove every event with this source. Returns removed ids. */
  removeBySource(source: string): Promise<string[]>;
  /** Every event, in log order. */
  load(): Promise<E[]>;
  clear(): Promise<void>;
}

/** Opaque derived blobs (serialized index, cached views). Safe to lose. */
export interface BlobStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}
