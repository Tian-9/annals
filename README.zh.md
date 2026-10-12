# annals · 纪年

本地优先的个人 AI 数据库。追加写入的事件是唯一真理，状态由代码折叠，检索靠模型写的分档词袋走一个很小的倒排索引。零依赖，库里不调模型，浏览器和 Node 都能跑。

[English](README.md) · [设计文档](docs/DESIGN.zh.md)

## 为什么

模型擅长吐事实，不擅长维护状态。相似度检索会把"谁欠谁"这类有方向的事实搅混。服务端记忆层把数据锁进它们自己的格式。annals 把一切放进一个人眼能读的 JSONL 事件日志，用纯函数从里面折叠出状态，让模型只写**档位**（core / related / hint）而不是分数，排序永远是查询端的旋钮。

可以理解为"把 LLM 当成简化版 SPLADE 编码器"：模型给词分类，代码把类别映射成权重，倒排索引干剩下的。

## 安装

```sh
npm install annals
```

## 三十秒上手

```ts
import { EventLog, latest, SparseIndex, type AnnalsEvent, type Bag } from 'annals';

type Ev =
  | AnnalsEvent<'state.set', { entity: string; attr: string; value: string }>
  | AnnalsEvent<'bag', Bag & { doc: string }>;

// 1. 事件是唯一真理。at 是你自己的钟（这里是剧情 Day）。
const log = new EventLog<Ev>();
log.append({ at: 3, type: 'state.set', source: 'msg-41',
  payload: { entity: '债务', attr: '金额', value: 'char 欠 user 49.5r' } });
log.append({ at: 3, type: 'bag', source: 'msg-41',
  payload: { doc: 'scene-7', core: ['猫', '黑炭', '小鱼干'], related: ['偷吃', '半夜'], hint: ['零食'] } });

// 2. 状态是日志的纯函数。
const view = latest(log.byType('state.set'), (e) => `${e.payload.entity}/${e.payload.attr}`);
view.get('债务/金额')?.payload.value; // 'char 欠 user 49.5r'

// 3. 检索：写入档位，查询时映射权重，不调模型。
const idx = new SparseIndex();
for (const e of log.byType('bag')) idx.add(e.payload.doc, e.payload);
idx.search('黑炭昨天晚上吃了什么'); // [{ id: 'scene-7', score: …, terms: ['黑炭'] }]

// 4. 用户 swipe 掉了那条消息。它产生的一切一起消失。
log.retract('msg-41');
```

这段代码原样放在 `src/quickstart.test.ts` 里当测试。导出就是 `log.toJSONL()`，导入是 `EventLog.fromJSONL(text)`。索引随时可以从词袋事件重建，它是衍生物。

## 盒子里有什么

| 原语 | 做什么 |
|---|---|
| `EventLog` | 有序事件，`retract(source)` 按来源撤回，JSONL 进出，`version` 做缓存键 |
| `fold` / `latest` | 归约日志；每个键取最新一条 |
| `SparseIndex` | term → doc → 档位；`search` 支持档位权重、idf、每文档 boost；`vocabulary()`；可序列化 |
| `tokenize` | NFKC + `Intl.Segmenter` 分词 + CJK 二元组 + 停用词，写入端和查询端共用 |
| `MemoryEventStore` / `MemoryBlobStore` | 测试和 Node 用的适配器；IndexedDB 适配器是单独入口（计划中） |

## 状态

v0.1：原语和测试。路线图见[设计文档](docs/DESIGN.zh.md#7-路线图)。第一个用户是一个 AI 角色扮演 PWA，设计文档第 6 节写了它怎么用这些原语。

## 许可

MIT
