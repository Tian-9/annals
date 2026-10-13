import { normalize, tokenize as defaultTokenize, type Tokenizer } from '../tokenize.js';
import {
  DEFAULT_WEIGHTS, TIERS, tierCode, tierOf,
  type Bag, type Tier, type TierCode, type Weights,
} from './tiers.js';

export interface SparseIndexOptions {
  /** Tokenizer used to expand bag terms on write and to split string queries on read. */
  tokenize?: Tokenizer;
  /**
   * On `add`, also index every sub-token of each bag term at the same tier
   * (e.g. "小鱼干" → "小鱼", "鱼干"). Default true. This is what lets a user
   * query meet a model-written multi-character term.
   */
  expandTerms?: boolean;
}

export interface SearchOptions {
  /** Max hits. Default 10. */
  k?: number;
  /** Tier → weight. Missing tiers fall back to {@link DEFAULT_WEIGHTS}. */
  weights?: Partial<Weights>;
  /** Multiply each term's weight by log(1 + N/df). Default true. */
  idf?: boolean;
  /**
   * Per-document multiplier applied after summing. The library knows nothing
   * about time; the application passes recency decay (or anything else) here.
   */
  boost?: (docId: string) => number;
  /** Drop hits below this score. Default 0 (drop only non-positive). */
  minScore?: number;
  /**
   * Skip query terms found in more than this fraction of documents, e.g. 0.3.
   * Off by default. A term that is everywhere (the protagonist's name) adds
   * little ranking signal but costs a walk over its whole posting list, which
   * is what makes the slow queries slow on large indexes. If every matched
   * query term would be skipped, none are.
   * 跳过出现在超过这个比例文档里的查询词，例如 0.3。默认关闭。到处都有的词
   * （主角名字）几乎不贡献排序信息，却要把整条 posting list 走一遍，大索引上
   * 慢查询就慢在这里。如果命中的查询词全都超标，就一个都不跳。
   */
  maxDf?: number;
}

/** Upper bound for the per-index sub-token cache; cleared wholesale when reached. 子词缓存上限，满了整体清空。 */
const SUB_CACHE_MAX = 50_000;

export interface Hit {
  id: string;
  score: number;
  /** Query terms that matched this document, for explain/debug. */
  terms: string[];
}

export interface SerializedSparseIndex {
  v: 1;
  /** term → [docId, tierCode][] */
  terms: Record<string, [string, TierCode][]>;
}

/**
 * term → (docId → tierCode) inverted index with a reverse map for removal.
 *
 * No term frequency, no document length, no learned anything. Score is a sum
 * over matched query terms of `weight(tier) * idf(term)`, then `boost(doc)`.
 */
export class SparseIndex {
  private readonly postings = new Map<string, Map<string, TierCode>>();
  private readonly docs = new Map<string, Set<string>>();
  private readonly tok: Tokenizer;
  private readonly expand: boolean;
  /**
   * bag term → its sub-tokens (minus itself). Bags reuse the vocabulary, so
   * the same terms are tokenized over and over during `add`/rebuild; the
   * tokenizer (Intl.Segmenter) is >90% of build time. Assumes the tokenizer
   * is pure, which the write/query symmetry already requires.
   * 词袋词 → 子词（不含自身）。词袋复用词表，`add` 和重建时同一批词被反复分词，
   * 而分词（Intl.Segmenter）占建索引九成以上的时间。前提是分词器是纯函数，
   * 写入端和查询端对称本来就要求这一点。
   */
  private readonly subCache = new Map<string, string[]>();

  constructor(opts: SparseIndexOptions = {}) {
    this.tok = opts.tokenize ?? defaultTokenize;
    this.expand = opts.expandTerms ?? true;
  }

  /** Number of documents. */
  get size(): number {
    return this.docs.size;
  }

  has(id: string): boolean {
    return this.docs.has(id);
  }

  /** Add or replace a document's bag. */
  add(id: string, bag: Bag): void {
    if (this.docs.has(id)) this.remove(id);
    const terms = new Set<string>();
    this.docs.set(id, terms);
    for (const tier of TIERS) {
      const list = bag[tier];
      if (!list) continue;
      const code = tierCode(tier);
      for (const raw of list) {
        const term = normalize(raw).trim();
        if (!term) continue;
        this.put(id, term, code, terms);
        if (this.expand) {
          for (const sub of this.subTokens(term)) this.put(id, sub, code, terms);
        }
      }
    }
    if (terms.size === 0) this.docs.delete(id);
  }

  private subTokens(term: string): string[] {
    let subs = this.subCache.get(term);
    if (!subs) {
      subs = this.tok(term).filter((s) => s !== term);
      if (this.subCache.size >= SUB_CACHE_MAX) this.subCache.clear();
      this.subCache.set(term, subs);
    }
    return subs;
  }

  private put(id: string, term: string, code: TierCode, terms: Set<string>): void {
    let pl = this.postings.get(term);
    if (!pl) {
      pl = new Map();
      this.postings.set(term, pl);
    }
    const prev = pl.get(id);
    if (prev !== undefined && prev <= code) return; // keep the stronger tier
    pl.set(id, code);
    terms.add(term);
  }

  remove(id: string): boolean {
    const terms = this.docs.get(id);
    if (!terms) return false;
    for (const term of terms) {
      const pl = this.postings.get(term);
      if (!pl) continue;
      pl.delete(id);
      if (pl.size === 0) this.postings.delete(term);
    }
    this.docs.delete(id);
    return true;
  }

  clear(): void {
    this.postings.clear();
    this.docs.clear();
    this.subCache.clear();
  }

  /** Tiers recorded for one document, for inspection. */
  bagOf(id: string): Record<string, Tier> | undefined {
    const terms = this.docs.get(id);
    if (!terms) return undefined;
    const out: Record<string, Tier> = {};
    for (const t of terms) {
      const code = this.postings.get(t)?.get(id);
      if (code !== undefined) out[t] = tierOf(code);
    }
    return out;
  }

  /**
   * Search by free text (tokenized with the index's tokenizer) or by
   * pre-split terms (normalized only). Query terms are deduplicated: term
   * frequency on the query side is ignored too.
   */
  search(query: string | readonly string[], opts: SearchOptions = {}): Hit[] {
    const k = opts.k ?? 10;
    const useIdf = opts.idf ?? true;
    const minScore = opts.minScore ?? 0;
    const w: Weights = { ...DEFAULT_WEIGHTS, ...opts.weights };
    const terms = typeof query === 'string'
      ? this.tok(query)
      : [...new Set(query.map((t) => normalize(t).trim()).filter(Boolean))];
    const n = this.docs.size;
    let matched: [string, Map<string, TierCode>][] = [];
    for (const term of terms) {
      const pl = this.postings.get(term);
      if (pl) matched.push([term, pl]);
    }
    if (opts.maxDf !== undefined) {
      const cap = opts.maxDf * n;
      const kept = matched.filter(([, pl]) => pl.size <= cap);
      if (kept.length > 0) matched = kept;
    }
    const acc = new Map<string, { score: number; terms: string[] }>();
    for (const [term, pl] of matched) {
      const idf = useIdf ? Math.log(1 + n / pl.size) : 1;
      for (const [id, code] of pl) {
        const weight = w[tierOf(code)] * idf;
        const cur = acc.get(id);
        if (cur) {
          cur.score += weight;
          cur.terms.push(term);
        } else {
          acc.set(id, { score: weight, terms: [term] });
        }
      }
    }
    const hits: Hit[] = [];
    for (const [id, { score, terms: hitTerms }] of acc) {
      const s = opts.boost ? score * opts.boost(id) : score;
      if (s <= minScore) continue;
      hits.push({ id, score: s, terms: hitTerms });
    }
    hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return hits.slice(0, k);
  }

  /**
   * Every indexed term with its document frequency, most frequent first.
   * Hand this to the extraction prompt so the model reuses existing terms
   * instead of inventing synonyms.
   */
  vocabulary(): { term: string; df: number }[] {
    const out: { term: string; df: number }[] = [];
    for (const [term, pl] of this.postings) out.push({ term, df: pl.size });
    out.sort((a, b) => b.df - a.df || (a.term < b.term ? -1 : 1));
    return out;
  }

  serialize(): SerializedSparseIndex {
    const terms: Record<string, [string, TierCode][]> = {};
    for (const [term, pl] of this.postings) terms[term] = [...pl];
    return { v: 1, terms };
  }

  static deserialize(data: SerializedSparseIndex, opts: SparseIndexOptions = {}): SparseIndex {
    if (data.v !== 1) throw new Error(`unsupported index version: ${String(data.v)}`);
    const idx = new SparseIndex(opts);
    for (const [term, list] of Object.entries(data.terms)) {
      for (const [id, code] of list) {
        let terms = idx.docs.get(id);
        if (!terms) {
          terms = new Set();
          idx.docs.set(id, terms);
        }
        idx.put(id, term, code, terms);
      }
    }
    return idx;
  }
}
