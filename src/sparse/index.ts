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
   * A document needs at least one strong match to count: a term of two or more characters, or a single
   * character at the core tier (written on purpose). Single characters elsewhere (cut out of longer terms,
   * lexical body text) can only add to a strong match. Without this, a sentence full of common characters
   * ("去", "说", "买") sums enough weak hits to recall unrelated documents. Default true.
   */
  requireStrong?: boolean;
}

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
const HINT = tierCode('hint');
const CORE = tierCode('core');

export class SparseIndex {
  private readonly postings = new Map<string, Map<string, TierCode>>();
  private readonly docs = new Map<string, Set<string>>();
  private readonly tok: Tokenizer;
  private readonly expand: boolean;

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
          for (const sub of this.tok(term)) {
            if (sub === term) continue;
            // A single character cut out of a longer term ("加" from "加俩蛋") is too common to
            // carry the term's tier: on its own it would recall unrelated documents. Demote it to
            // the weakest tier so it can only add to a real match, never make one.
            this.put(id, sub, [...sub].length === 1 ? HINT : code, terms);
          }
        }
      }
    }
    if (terms.size === 0) this.docs.delete(id);
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
    const requireStrong = opts.requireStrong ?? true;
    const w: Weights = { ...DEFAULT_WEIGHTS, ...opts.weights };
    const terms = typeof query === 'string'
      ? this.tok(query)
      : [...new Set(query.map((t) => normalize(t).trim()).filter(Boolean))];
    const n = this.docs.size;
    const acc = new Map<string, { score: number; terms: string[]; strong: boolean }>();
    for (const term of terms) {
      const pl = this.postings.get(term);
      if (!pl) continue;
      const idf = useIdf ? Math.log(1 + n / pl.size) : 1;
      const long = [...term].length >= 2;
      for (const [id, code] of pl) {
        const weight = w[tierOf(code)] * idf;
        const strong = long || code === CORE;
        const cur = acc.get(id);
        if (cur) {
          cur.score += weight;
          cur.terms.push(term);
          cur.strong ||= strong;
        } else {
          acc.set(id, { score: weight, terms: [term], strong });
        }
      }
    }
    const hits: Hit[] = [];
    for (const [id, { score, terms: matched, strong }] of acc) {
      if (requireStrong && !strong) continue;
      const s = opts.boost ? score * opts.boost(id) : score;
      if (s <= minScore) continue;
      hits.push({ id, score: s, terms: matched });
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
