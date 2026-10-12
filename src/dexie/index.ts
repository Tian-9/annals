/**
 * IndexedDB adapters through Dexie. Separate entry point so the core stays
 * dependency-free. `dexie` is a peer dependency.
 *
 * Both stores are scoped: one table can hold many logs (one per campaign,
 * per notebook…) and each store instance only sees its own `scope`.
 */
import type { Table } from 'dexie';
import type { AnnalsEvent } from '../events/types.js';
import type { BlobStore, EventStore } from '../storage/types.js';

/** Dexie schema string for the events table. */
export const DEXIE_EVENT_SCHEMA = 'id, scope, [scope+seq], [scope+source]';
/** Dexie schema string for the blobs table. */
export const DEXIE_BLOB_SCHEMA = '[scope+key], scope';

export type EventRow<E extends AnnalsEvent = AnnalsEvent> = E & { scope: string };
export interface BlobRow { scope: string; key: string; value: unknown }

export class DexieEventStore<E extends AnnalsEvent = AnnalsEvent> implements EventStore<E> {
  constructor(private readonly table: Table<EventRow<E>, string>, private readonly scope: string) {}

  async append(events: readonly E[]): Promise<void> {
    if (!events.length) return;
    await this.table.bulkPut(events.map((e) => ({ ...e, scope: this.scope })));
  }

  async removeBySource(source: string): Promise<string[]> {
    const rows = await this.table.where('[scope+source]').equals([this.scope, source]).toArray();
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    await this.table.bulkDelete(ids);
    return ids;
  }

  async load(): Promise<E[]> {
    const rows = await this.table.where('[scope+seq]').between([this.scope, -Infinity], [this.scope, Infinity]).toArray();
    return rows.map(({ scope: _s, ...e }) => e as unknown as E);
  }

  async clear(): Promise<void> {
    await this.table.where('scope').equals(this.scope).delete();
  }
}

export class DexieBlobStore implements BlobStore {
  constructor(private readonly table: Table<BlobRow, [string, string]>, private readonly scope: string) {}

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const row = await this.table.get([this.scope, key]);
    return row?.value as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    await this.table.put({ scope: this.scope, key, value });
  }

  async delete(key: string): Promise<void> {
    await this.table.delete([this.scope, key]);
  }
}
