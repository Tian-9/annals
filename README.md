# annals

A local-first personal AI database. Append-only events are the only truth, state is folded by code, retrieval runs on model-written tiered bags over a tiny inverted index. Zero dependencies, no model calls inside, runs in the browser and in Node.

[中文说明](README.zh.md) · [Design](docs/DESIGN.md)

## Why

Models are good at emitting facts and bad at keeping state. Similarity search scrambles directional facts like who owes whom. Server-side memory layers lock your data into their format. annals keeps everything in one JSONL event log you can read by eye, folds state out of it with plain functions, and lets a model write *tiers* (core / related / hint) instead of scores so that ranking stays a query-time knob.

Think of it as "LLM as a SPLADE-lite encoder": the model classifies terms, code maps classes to weights, an inverted index does the rest.

## Install

```sh
npm install annals
```

## Thirty seconds

```ts
import { EventLog, latest, SparseIndex, type AnnalsEvent, type Bag } from 'annals';

type Ev =
  | AnnalsEvent<'state.set', { entity: string; attr: string; value: string }>
  | AnnalsEvent<'bag', Bag & { doc: string }>;

// 1. Events are the only truth. `at` is YOUR clock (a day counter here).
const log = new EventLog<Ev>();
log.append({ at: 3, type: 'state.set', source: 'msg-41',
  payload: { entity: 'debt#tickets', attr: 'amount', value: 'user owes Alex 50 EUR' } });
log.append({ at: 3, type: 'bag', source: 'msg-41',
  payload: { doc: 'note-7', core: ['猫', '黑炭', '小鱼干'], related: ['偷吃', '半夜'], hint: ['零食'] } });

// 2. State is a pure function of the log.
const view = latest(log.byType('state.set'), (e) => `${e.payload.entity}/${e.payload.attr}`);
view.get('debt#tickets/amount')?.payload.value; // 'user owes Alex 50 EUR'

// 3. Retrieval: tiers in, weights at query time, no model.
const idx = new SparseIndex();
for (const e of log.byType('bag')) idx.add(e.payload.doc, e.payload);
idx.search('黑炭昨天晚上吃了什么'); // [{ id: 'note-7', score: …, terms: ['黑炭'] }]

// 4. The user deleted that message. Everything it produced goes with it.
log.retract('msg-41');
```

The same snippet lives in `src/quickstart.test.ts`. Export is `log.toJSONL()`; import is `EventLog.fromJSONL(text)`. Rebuild the index from bag events whenever you like; it is derived data.

## What is in the box

| Primitive | What it does |
|---|---|
| `EventLog` | ordered events, `retract(source)`, JSONL in/out, `version` for cache keys |
| `fold` / `latest` | reduce the log; last-write-wins view per key |
| `SparseIndex` | term → doc → tier; `search` with tier weights, idf, per-doc boost; `vocabulary()`; serialize |
| `tokenize` | NFKC + `Intl.Segmenter` words + CJK bigrams + stopwords, shared by write and query sides |
| `bagFromText` / `parseBag` / `rebuildIndex` | lexical baseline bags, coercion of untrusted model output, code-only index rebuild |
| `MemoryEventStore` / `MemoryBlobStore` | adapters for tests and Node |
| `annals/dexie` | `DexieEventStore` / `DexieBlobStore`: scoped IndexedDB adapters, `dexie` as an optional peer |
| `annals/state` | the state profile ("what is true now"): `parsePatches`, `stateView`, `diffPatches`, `renderStateLines`, JSON Schema fragments for patches and bags |

## Status

v0.2: primitives, Dexie adapters and the state profile, all tested. See the [roadmap](docs/DESIGN.md#7-roadmap).

annals is a general-purpose personal AI database. Its first test bed is an AI-roleplay PWA (pocketverse), because it is the hardest case: time skips, swipe rollbacks, directional numeric facts. Most test fixtures come from that scene; the design doc's §6 shows how it uses these primitives.

## License

MIT
