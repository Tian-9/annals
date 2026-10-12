# annals design

> A personal AI database that runs in the browser. Events are the only truth, state is folded by code, retrieval runs on model-written tiered bags over an inverted index. No model calls inside the library.

This is the design baseline; code follows it, and design changes land here first. Chinese version: [DESIGN.zh.md](DESIGN.zh.md).

## 0. Positioning

- **For whom**: one person, their own data, local-first, zero backend. The first application is AI roleplay (AIRP, the hard mode); the same primitives serve a personal assistant.
- **What it is**: a library of three primitives. Event log, folded views, sparse index.
- **What it is not**: not an agent framework, not a vector database, not a knowledge graph. There are no prompts and no model calls in here. The library does not know what a "character" or a "debt" is; that lives in the application.

## 1. Principles

1. **Minimal and decoupled; code as data.** Any "what is the case right now" question is answered to the model by the system. The model never has to infer it from history.
2. **Events vs. state.** Models are good at emitting events (append-only facts) and bad at maintaining state (what the event stream implies: ownership, location, relationships, debts). State is maintained by code and injected every turn.
3. **Events are the only truth.** Messages, the event log, character cards and manual edits are source data. Views, indexes, numeric weights and vectors are derived and can be recomputed idempotently by code.
4. **Heavy work goes to the write side.** Extraction, expansion and normalization happen offline or asynchronously. The query path stays dumb: at runtime there is only table lookup, addition and sorting.
5. **Hard facts go through structured channels.** Directional and numeric facts (who owes whom, where a thing is, how much) get scrambled by attention. They are never delegated to similarity search or model memory.
6. **Models classify, they do not regress.** The model picks a tier; it never emits a score. Numbers come from a discrete table in code.

## 2. The three primitives

### 2.1 Event log `EventLog`

```ts
interface AnnalsEvent<T extends string = string, P = unknown> {
  id: string;        // caller-supplied or generated
  seq: number;       // monotonic within the log, assigned by the log
  at: number;        // the application's own clock: story day, campaign clock, wall time. The library never reads Date.now()
  type: T;           // discriminator: "state.set", "summary", "bag"
  source?: string;   // what produced it: a message id, an import batch. Retracting a source removes everything it produced
  payload: P;
}
```

- `append` adds; `retract(source)` removes by origin. When the user swipes, edits or deletes a message, the application calls `retract(messageId)` once and every state change, summary and bag that message produced disappears; views and index are recomputed. This is the core mechanism for staying agnostic about model output.
- `version` increments on every mutation; derived views use it as a cache key.
- `toJSONL()` / `fromJSONL()` is the export format. One file is the whole database, readable by eye, parseable in any language, recoverable without this library.

### 2.2 Folded views `fold` / `latest`

A view is a pure function of the log. Nothing is stored; recompute when `version` changes. Volumes are small (hundreds to a few thousand events for one person), so a full scan is sub-second and no real materialization is needed.

- `fold(events, reducer, init)`: any reduction.
- `latest(events, keyOf)`: the newest event per key. The AIRP "materialized view" is `latest` with `key = entity + attr`. Map iteration order equals recency of last write, which doubles as an activity ordering.

### 2.3 Sparse index `SparseIndex`

A `term → (docId → tierCode)` inverted index with a reverse map for removal.

- **Stores tiers only. No term frequency, no document length.** Three tiers: `core` / `related` / `hint`, stored as 1 / 2 / 3, one uint8.
- **Score = Σ over matched query terms of weight(tier) × idf(term), then × boost(doc).** The weight table, the idf switch and boost are all query-time parameters; changing them never touches the index.
- **idf** is `log(1 + N/df)`, where df is the posting list length. One line, not BM25. Without it, "cat" appearing in every summary carries no signal.
- **boost** is an application-supplied per-document multiplier. The library knows nothing about time; recency decay is computed by the application on its own clock and passed in.
- `vocabulary()` returns every term with its document frequency. The extraction prompt attaches this table and asks the model to reuse existing terms, so the vocabulary converges on the person's own language.
- `serialize()` / `deserialize()` for Dexie or elsewhere; or `rebuild()` from bag events at startup. Small data, sub-second.

## 3. Tokenization: write side and query side must share one function

Bags are written by the model and contain multi-character terms like "小鱼干" or "debt"; queries are the user's own words. If the two vocabularies differ, the posting lists are empty.

`Intl.Segmenter` splits "小鱼干" into three single characters "小 / 鱼 / 干" (measured on Node 22 ICU). Therefore:

- **Normalize**: NFKC (full-width to half-width, compatibility forms) + lowercase.
- **Words**: `Intl.Segmenter` (word granularity) when available, otherwise a script-boundary fallback.
- **CJK bigrams**: always emitted over every contiguous CJK run, independent of the segmenter. "小鱼" and "鱼干" are the only bridge between the query "鱼干" and the bag term "小鱼干".
- **Stopwords**: a small replaceable list. Model-written bags almost never contain them; user questions always do.
- **Write-side expansion**: on `add`, each bag term is run through the tokenizer and its sub-tokens are indexed at the same tier (`expandTerms`, default on). A term that appears in two tiers keeps the stronger one.

Traditional/simplified folding is deferred; it needs a mapping table and will be added when it actually bites.

## 4. The source/derived boundary

The line is: **anything that needs a model to regenerate is source data; only what code alone can regenerate is derived.**

| Source (exported) | Derived (not exported) |
|---|---|
| Message text | Inverted index |
| Event log (state changes, summaries, bag tiers) | Folded views |
| Character cards, world settings | Weights after tier mapping |
| Manual edits, configuration | Vectors |

Hence two functions that must not be merged:

- **`rebuild()`**: replay the event log into views, rebuild the index. Pure code, idempotent, free. Run it after import or repair without a second thought.
- **`reextract()`**: re-run extraction with a new prompt or model, producing new summary and bag events. Burns API budget, non-deterministic. Run only on model upgrades.

Summaries and bags are model products, but they are events, carry a `source`, and roll back with their message.

## 5. Storage

- Storage is an adapter: `EventStore` (events) and `BlobStore` (disposable derived blobs).
- The library ships in-memory implementations; tests run in Node without a browser.
- The Dexie / IndexedDB adapter is a separate entry point, as SQLite will be. The core stays zero-dependency.
- In the browser the application calls `navigator.storage.persist()` at startup. Images are stored as Blobs, never base64.

## 6. Application profile: how AIRP uses the primitives

This section is an application-level convention, not part of the library. It lives here because AIRP is the first consumer and the hardest one.

### 6.1 Time

- Two tracks: every event records `day` (integer from story start) and `storyDate` (in-story date, ISO `YYYY-MM-DD`, for seasons, festivals, birthdays). `at` carries `day`.
- The system computes and injects: "Day 128 (2027-03-14, early spring), 6 days since the last date, 11 days to his birthday." The model does no date arithmetic.
- Jumps like "three months later" are recorded as their own event so no hidden gap enters the story.
- Relative time in queries ("yesterday", "last week") is resolved by the application into an `at` range used as a filter or boost. A bag will never contain "yesterday".

### 6.2 State system

- Event type `state.set`, payload `{ entity, attr, value, valueKind? }`. The model never supplies `oldVal`; code reads it from the current view and drops no-op patches.
- Attribute whitelist: location, ownership, alive/dead, relationship, debt, unfulfilled promises, irreversible descriptions. No running commentary.
- Directional relations use an explicit direction field and are rendered as subject-object sentences on injection: "char owes user 49.5r (Day 3 red-packet mistake, unsettled)". Direction-free free text is forbidden.
- Fuzzy values are legal: "cat | ownership: undecided (user found it, character has not agreed to keep it)". Facts the story has not settled are not forced.
- Activity eviction: an entity not mentioned within the last N events leaves the injected block (not by story days; one "three months later" would evict everything). A retrieval hit remounts it.
- The injected state block targets < 150 tokens. The UI has a panel: automatic maintenance plus manual override; the user has the final word.

### 6.3 Extraction pipeline (the only channel through which a model writes)

- A separate asynchronous call, decoupled from the roleplay call. Low temperature, strict JSON, with the last N messages as context. Extraction is never piggybacked on the roleplay call.
- One call produces three things: scene summary, state patch array, three-tier bag. All three are calm extraction tasks and share one call.
- Bag rules: ≤ 15 terms, ≤ 3 core; no free numbers; the prompt attaches `vocabulary()` and asks for reuse.
- Code side: schema validation, retry on failure, every event carries `source = message id`.
- Throttling: every N messages or on scene change. v1 waits synchronously; an async queue is a later optimization.
- Layered summaries: messages → scene summary → chapter summary, each keeping Day anchors, relationship turns and unfulfilled promises. A summary covering several messages carries all their ids as sources; retracting any one re-extracts the window.

### 6.4 Prompt assembly

```
[character card + system settings]   ← cached
[chapter summaries]                  ← cached
[state block]
[retrieved fragments]
[recent messages]
```

Retrieval runs in code before the request, in milliseconds, on every message, with no extra model call. Volatile content goes only into the last user message; the stable prefix uses `cache_control`.

## 7. Roadmap

- **v0.1 primitives**: `EventLog`, `fold` / `latest`, `SparseIndex`, tokenizer, in-memory storage, JSONL import/export. Current state of this repository.
- **v0.2 adapters**: Dexie `EventStore` / `BlobStore`; a `rebuild()` helper.
- **v0.3 AIRP profile**: state event conventions, state block rendering, relative-time parsing, as a separate entry or example; wired into pocketverse to replace MiniSearch and `state_update`.
- **v1 semantic lift**: bag extraction in the pipeline, tier mapping configuration, query log.
- **v2 (deferred)**: information asymmetry (scene "present" tags + per-character knows lists, later per-character context filtering), RRF hybrid retrieval, local dense embeddings, query-log tuning.

## 8. Acceptance cases (regressions from real sessions)

1. **Anchor drift**: the story moves inn A → night market → wakes up in inn B, then 20+ more messages. The character must not place itself in A again. The state block shows "current: inn B".
2. **Debt direction flip**: after user sends 50r → char refunds 0.5r, every later statement must be "char owes user 49.5r", never reversed. Swiping away the refund message rolls the state back automatically.
3. **Semantic reach**: write "last night the cat stole 50 pieces of dried fish cut on the big board"; the query "what did Blackie eat last night" must hit (relies on the alias "黑炭" in the bag and the bigram "鱼干").
4. **Rollback consistency**: after editing or deleting a message, every event and bag tied to its `source` is gone, and views and index agree after recomputation.
5. **Backup round trip**: full export → wipe → import → `rebuild()` leaves all of the above unchanged.

2, 4 and 5 are unit-tested; the retrieval half of 1 and 3 is unit-tested, the state block half waits for v0.3.

## 9. Non-goals

- Knowledge graphs, graph visualization, entity disambiguation. The write-side "heavy work" becomes too heavy for a single-user budget.
- SPLADE-style sparse models that need a dedicated encoder; fine-tuning.
- Multi-device sync. Only exported files for single-machine backup.
- Group chats with several characters (v2's information asymmetry is single-character perspective filtering, not group chat).
