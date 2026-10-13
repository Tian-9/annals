// SparseIndex benchmark on synthetic Chinese bags.
// SparseIndex 压测，用合成的中文词袋。
//
//   npm run bench            # 1k / 10k / 50k docs
//   npm run bench -- 100000  # custom sizes
//
// Bags: ~12 terms per doc (core 3–5, related 3–6, hint 2–4), drawn Zipf-style
// from a 40k-word vocabulary of 2–4 random CJK chars, so a few terms are
// everywhere and most are rare, like a real personal vocabulary. Random chars
// get split finer by Intl.Segmenter than real words, so memory here is an
// upper-ish estimate.
// 词袋：每条约 12 个词，从 4 万个 2～4 字的随机汉字词里按 Zipf 分布抽取，少数词
// 到处都有、多数词很少见，接近真实的个人词表。随机汉字会被 Intl.Segmenter 切得
// 比真实词更碎，所以这里的内存数字偏保守（偏高）。

import { SparseIndex } from '../dist/index.js';

const sizes = process.argv.slice(2).map(Number).filter((n) => n > 0);
if (sizes.length === 0) sizes.push(1_000, 10_000, 50_000);

let seed = 42;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

const chars = [];
for (let i = 0; i < 3000; i++) chars.push(String.fromCodePoint(0x4e00 + Math.floor(rnd() * 0x51a5)));
const VOCAB = 40_000;
const vocab = [];
for (let i = 0; i < VOCAB; i++) {
  const len = 2 + Math.floor(rnd() * 3);
  let w = '';
  for (let j = 0; j < len; j++) w += chars[Math.floor(rnd() * chars.length)];
  vocab.push(w);
}
const cum = new Float64Array(VOCAB);
let tot = 0;
for (let i = 0; i < VOCAB; i++) { tot += 1 / (i + 1); cum[i] = tot; }
const zipf = () => {
  const r = rnd() * tot;
  let lo = 0, hi = VOCAB - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r) lo = m + 1; else hi = m; }
  return vocab[lo];
};
const pick = (min, max) => Array.from({ length: min + Math.floor(rnd() * (max - min + 1)) }, zipf);

const fillers = ['昨天晚上', '之前', '记得', '说过', '发生了什么', '是谁', '在哪里', '后来'];
const filler = () => fillers[Math.floor(rnd() * fillers.length)];
const queries = [];
for (let i = 0; i < 300; i++) queries.push(pick(1, 3).join(filler()) + filler());

const gc = globalThis.gc ?? (() => {});
const mb = (b) => (b / 1024 / 1024).toFixed(1);

function latency(idx, opts) {
  for (let i = 0; i < 20; i++) idx.search(queries[i], opts);
  const lat = [];
  for (const q of queries) { const s = performance.now(); idx.search(q, opts); lat.push(performance.now() - s); }
  lat.sort((a, b) => a - b);
  const p = (x) => lat[Math.floor(lat.length * x)].toFixed(2);
  return `${p(0.5)} / ${p(0.95)}`;
}

const rows = [];
for (const n of sizes) {
  const bags = [];
  for (let i = 0; i < n; i++) bags.push({ core: pick(3, 5), related: pick(3, 6), hint: pick(2, 4) });

  gc();
  const heap0 = process.memoryUsage().heapUsed;
  let t = performance.now();
  const idx = new SparseIndex();
  for (let i = 0; i < n; i++) idx.add(`doc-${i}`, bags[i]);
  const buildMs = performance.now() - t;
  gc();
  const heap = process.memoryUsage().heapUsed - heap0;

  const json = JSON.stringify(idx.serialize());
  t = performance.now();
  SparseIndex.deserialize(JSON.parse(json));
  const loadMs = performance.now() - t;

  rows.push({
    docs: n,
    terms: idx.vocabulary().length,
    'heap MB': globalThis.gc ? mb(heap) : 'n/a',
    'json MB': mb(Buffer.byteLength(json)),
    'build ms': Math.round(buildMs),
    'load ms': Math.round(loadMs),
    'search p50/p95 ms': latency(idx, {}),
    'maxDf 0.3': latency(idx, { maxDf: 0.3 }),
  });
}
console.table(rows);
