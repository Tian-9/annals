import type { AnnalsEvent, EventInput } from './types.js';

function genId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

/**
 * In-memory, ordered event log with retraction by source.
 *
 * `version` bumps on every mutation so derived views can cache against it.
 */
export class EventLog<E extends AnnalsEvent = AnnalsEvent> {
  private events: E[] = [];
  private nextSeq = 1;
  private ver = 0;

  get version(): number {
    return this.ver;
  }

  get length(): number {
    return this.events.length;
  }

  append<T extends E['type'], P>(input: EventInput<T, P>): E & AnnalsEvent<T, P> {
    const ev = {
      id: input.id ?? genId(),
      seq: this.nextSeq++,
      at: input.at,
      type: input.type,
      payload: input.payload,
      ...(input.source !== undefined ? { source: input.source } : {}),
    } as E & AnnalsEvent<T, P>;
    this.events.push(ev);
    this.ver++;
    return ev;
  }

  /** Remove every event produced by `source`. Returns what was removed, in log order. */
  retract(source: string): E[] {
    const gone: E[] = [];
    const keep: E[] = [];
    for (const e of this.events) (e.source === source ? gone : keep).push(e);
    if (gone.length) {
      this.events = keep;
      this.ver++;
    }
    return gone;
  }

  /** Events in log order. The array is a fresh copy. */
  all(): E[] {
    return this.events.slice();
  }

  bySource(source: string): E[] {
    return this.events.filter((e) => e.source === source);
  }

  byType<T extends E['type']>(type: T): (E & { type: T })[] {
    return this.events.filter((e): e is E & { type: T } => e.type === type);
  }

  /**
   * Replace the whole log, e.g. after loading from storage. Stored `seq`
   * values are kept (gaps left by retractions stay gaps) so new events never
   * collide with old ones; events are sorted by seq.
   */
  load(events: readonly E[]): void {
    this.events = events.slice().sort((a, b) => a.seq - b.seq);
    this.nextSeq = this.events.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
    this.ver++;
  }

  /** One JSON object per line. This is the export format. */
  toJSONL(): string {
    return this.events.map((e) => JSON.stringify(e)).join('\n') + (this.events.length ? '\n' : '');
  }

  static fromJSONL<E extends AnnalsEvent = AnnalsEvent>(text: string): EventLog<E> {
    const log = new EventLog<E>();
    const events: E[] = [];
    for (const line of text.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      events.push(JSON.parse(s) as E);
    }
    log.load(events);
    return log;
  }
}
