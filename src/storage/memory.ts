import type { AnnalsEvent } from '../events/types.js';
import type { BlobStore, EventStore } from './types.js';

export class MemoryEventStore<E extends AnnalsEvent = AnnalsEvent> implements EventStore<E> {
  private events: E[] = [];

  async append(events: readonly E[]): Promise<void> {
    this.events.push(...events);
  }

  async removeBySource(source: string): Promise<string[]> {
    const gone: string[] = [];
    this.events = this.events.filter((e) => {
      if (e.source === source) {
        gone.push(e.id);
        return false;
      }
      return true;
    });
    return gone;
  }

  async load(): Promise<E[]> {
    return this.events.slice();
  }

  async clear(): Promise<void> {
    this.events = [];
  }
}

export class MemoryBlobStore implements BlobStore {
  private blobs = new Map<string, unknown>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.blobs.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.blobs.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.blobs.delete(key);
  }
}
