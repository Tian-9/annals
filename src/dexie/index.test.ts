// Fixtures come from the first test bed, an AI-roleplay app (see DESIGN §6, §8). The library itself is general-purpose.
// 用例取自第一个测试场景：一个 AI 角色扮演应用（见设计文档第 6、8 节）。库本身是通用的。
import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEXIE_BLOB_SCHEMA, DEXIE_EVENT_SCHEMA, DexieBlobStore, DexieEventStore, type BlobRow, type EventRow } from './index.js';
import { EventLog } from '../events/log.js';
import { SparseIndex } from '../sparse/index.js';

class TestDB extends Dexie {
  events!: Table<EventRow, string>;
  blobs!: Table<BlobRow, [string, string]>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ events: DEXIE_EVENT_SCHEMA, blobs: DEXIE_BLOB_SCHEMA });
  }
}

let db: TestDB;
let n = 0;
beforeEach(() => { db = new TestDB(`t${n++}`); });

describe('DexieEventStore', () => {
  it('round-trips a log, scoped, ordered by seq', async () => {
    const a = new DexieEventStore(db.events, 'cp-a');
    const b = new DexieEventStore(db.events, 'cp-b');
    const log = new EventLog();
    const e1 = log.append({ at: 1, type: 'summary', source: 'm1', payload: { text: 'one' } });
    const e2 = log.append({ at: 2, type: 'summary', source: 'm2', payload: { text: 'two' } });
    await a.append([e2, e1]);
    await b.append([log.append({ at: 1, type: 'summary', payload: { text: 'other' } })]);

    const back = await a.load();
    expect(back.map((e) => e.id)).toEqual([e1.id, e2.id]);
    expect(back[0]).not.toHaveProperty('scope');
    expect((await b.load()).length).toBe(1);
  });

  it('acceptance #4: removeBySource only touches its scope', async () => {
    const a = new DexieEventStore(db.events, 'cp-a');
    const b = new DexieEventStore(db.events, 'cp-b');
    const log = new EventLog();
    await a.append([log.append({ at: 1, type: 'x', source: 's', payload: 1 }), log.append({ at: 2, type: 'x', source: 't', payload: 2 })]);
    await b.append([log.append({ at: 1, type: 'x', source: 's', payload: 3 })]);
    const gone = await a.removeBySource('s');
    expect(gone.length).toBe(1);
    expect((await a.load()).map((e) => e.payload)).toEqual([2]);
    expect((await b.load()).map((e) => e.payload)).toEqual([3]);
    expect(await a.removeBySource('nope')).toEqual([]);
    await a.clear();
    expect(await a.load()).toEqual([]);
    expect((await b.load()).length).toBe(1);
  });

  it('bulkPut makes append idempotent by id', async () => {
    const a = new DexieEventStore(db.events, 'cp');
    const log = new EventLog();
    const e = log.append({ at: 1, type: 'x', payload: 1 });
    await a.append([e]);
    await a.append([e]);
    expect((await a.load()).length).toBe(1);
  });
});

describe('DexieBlobStore', () => {
  it('acceptance #5: serialized index survives a round trip', async () => {
    const blobs = new DexieBlobStore(db.blobs, 'cp');
    const idx = new SparseIndex();
    idx.add('s1', { core: ['猫', '黑炭'] });
    await blobs.put('index', idx.serialize());
    const copy = SparseIndex.deserialize((await blobs.get('index'))!);
    expect(copy.search('黑炭')[0]?.id).toBe('s1');
    expect(await blobs.get('missing')).toBeUndefined();
    await blobs.delete('index');
    expect(await blobs.get('index')).toBeUndefined();
  });
});
