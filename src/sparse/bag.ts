import { tokenize as defaultTokenize, type Tokenizer } from '../tokenize.js';
import type { Bag, Tier } from './tiers.js';
import { SparseIndex, type SparseIndexOptions } from './index.js';
import { TIERS } from './tiers.js';

/**
 * Lexical baseline: build a bag from plain text by tokenizing each field into
 * its tier. Use it for documents nobody has extracted a bag for yet (lore
 * entries, old memories). A model-written bag is always better; this is the
 * "纯词法跑通" step of the roadmap.
 */
export function bagFromText(fields: Partial<Record<Tier, string>>, tokenize: Tokenizer = defaultTokenize): Bag {
  const out: Bag = {};
  for (const tier of TIERS) {
    const text = fields[tier];
    if (!text) continue;
    const terms = tokenize(text);
    if (terms.length) out[tier] = terms;
  }
  return out;
}

export interface BagLimits {
  /** Max terms in `core`. Default 3. */
  core?: number;
  /** Max terms across all tiers. Default 15. */
  total?: number;
  /** Max characters per term. Default 32. */
  termLength?: number;
}

/**
 * Coerce an untrusted value (model output) into a Bag: strings only, trimmed,
 * length-capped, duplicates across tiers keep the strongest tier, core ≤ 3,
 * total ≤ 15. Never throws.
 */
export function parseBag(input: unknown, limits: BagLimits = {}): Bag {
  const maxCore = limits.core ?? 3;
  const maxTotal = limits.total ?? 15;
  const maxLen = limits.termLength ?? 32;
  const out: Bag = {};
  if (!input || typeof input !== 'object') return out;
  const seen = new Set<string>();
  let total = 0;
  for (const tier of TIERS) {
    const raw = (input as Record<string, unknown>)[tier];
    if (!Array.isArray(raw)) continue;
    const list: string[] = [];
    for (const v of raw) {
      if (typeof v !== 'string') continue;
      const t = v.trim().slice(0, maxLen);
      if (!t || seen.has(t)) continue;
      if (tier === 'core' && list.length >= maxCore) continue;
      if (total >= maxTotal) break;
      seen.add(t);
      list.push(t);
      total++;
    }
    if (list.length) out[tier] = list;
  }
  return out;
}

/**
 * Derive a fresh index from any iterable (events, table rows). `pick` returns
 * the document id and bag for an item, or null to skip it. This is the
 * code-only `rebuild()`: no model, idempotent, sub-second at personal scale.
 */
export function rebuildIndex<T>(
  items: Iterable<T>,
  pick: (item: T) => { id: string; bag: Bag } | null | undefined,
  opts: SparseIndexOptions = {},
): SparseIndex {
  const idx = new SparseIndex(opts);
  for (const item of items) {
    const d = pick(item);
    if (d) idx.add(d.id, d.bag);
  }
  return idx;
}
