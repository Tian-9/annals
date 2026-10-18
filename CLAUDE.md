# annals 开发约定

设计基线在 docs/DESIGN.zh.md（英文镜像 docs/DESIGN.md），改设计先改文档，两份都改。

## 定位
- annals 是通用的个人 AI 数据库。AI 角色扮演（pocketverse 小手机）是第一个测试场景，不是它的用途。
- 测试用例、文档里的例子可以用 RP 场景。API 名字、入口名、会发给模型的说明文字（比如 JSON Schema 的 description）不许带 RP 概念。

## 跑之前
- `npm run lint`（类型检查 + 单元测试）和 `npm run build` 必须过。
- 测试在 Node 里跑，不开浏览器。需要浏览器行为的东西（IndexedDB）放单独入口，用 fake-indexeddb 测。

## 不能破的线
- 核心零运行时依赖。Dexie、SQLite 之类只能进单独入口。
- 库里没有 prompt，不调模型，不认识"角色""债务"这些应用概念。这些留给上层。
- 库永远不读 `Date.now()`。时间是调用方传进来的 `at`。
- 写入端和查询端必须用同一个分词器。改分词要同时考虑两边。
- 索引只存档位（1/2/3），权重、idf、boost 都是查询端参数。改映射不重建索引。
- 需要模型才能再生的是源数据，必须能导出；纯代码能再生的才是衍生物。`rebuild()` 不许调模型，调模型的叫 `reextract()`。
- 事件日志里一律带 `source`，撤回按 `source`。

## 文案
- 文档和注释中文英文各一份，README.md / README.zh.md，DESIGN.md / DESIGN.zh.md。
- 第三人称一律用"他"。
