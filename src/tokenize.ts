/**
 * Tokenizer shared by the write side (expanding bag terms) and the query side.
 *
 * Both sides MUST go through the same function, otherwise the vocabulary the
 * model wrote into a bag and the vocabulary a user query produces never meet
 * in the posting lists.
 *
 * Strategy:
 *  - normalize: NFKC (full-width → half-width, compatibility forms), lowercase.
 *  - words: `Intl.Segmenter` (word granularity) when available, else a regex
 *    fallback splitting on script boundaries.
 *  - CJK bigrams over every contiguous CJK run, always. ICU segments
 *    "小鱼干" into "小 / 鱼 / 干"; bigrams ("小鱼", "鱼干") are what let the
 *    query "鱼干" meet the bag term "小鱼干".
 *  - stopwords removed, duplicates removed, order preserved.
 */

const CJK_CHAR = /[㐀-䶿一-鿿豈-﫿]/u;
const CJK_RUN = /[㐀-䶿一-鿿豈-﫿]+/gu;
const WORD = /[\p{L}\p{N}]+/gu;

/** Small default stoplist. Bags written by a model rarely contain these; user queries always do. */
export const DEFAULT_STOPWORDS: ReadonlySet<string> = new Set([
  // zh function words
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '们', '和', '与', '或', '也', '都', '就',
  '吗', '呢', '吧', '啊', '呀', '哦', '嗯', '这', '那', '这个', '那个', '什么', '怎么', '为什么',
  '有', '没', '没有', '不', '很', '把', '被', '对', '从', '到', '给', '让', '着', '过', '又', '还',
  '一个', '一下', '一些', '上', '下', '里', '中',
  // en function words
  'the', 'a', 'an', 'of', 'to', 'is', 'are', 'was', 'were', 'and', 'or', 'in', 'on', 'at', 'it',
  'this', 'that', 'what', 'did', 'do', 'does', 'i', 'you', 'he', 'she', 'they', 'we', 'me', 'my',
]);

export interface TokenizeOptions {
  /** Terms to drop. Defaults to {@link DEFAULT_STOPWORDS}. Pass an empty set to keep everything. */
  stopwords?: ReadonlySet<string>;
  /** Emit bigrams over CJK runs. Default true. */
  bigrams?: boolean;
}

export type Tokenizer = (text: string) => string[];

/** NFKC + lowercase. Applied to bag terms and query text alike. */
export function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

let segmenter: Intl.Segmenter | null | undefined;
function getSegmenter(): Intl.Segmenter | null {
  if (segmenter !== undefined) return segmenter;
  try {
    segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
      ? new Intl.Segmenter('zh', { granularity: 'word' })
      : null;
  } catch {
    segmenter = null;
  }
  return segmenter;
}

function words(norm: string): string[] {
  const seg = getSegmenter();
  if (seg) {
    const out: string[] = [];
    for (const s of seg.segment(norm)) {
      if (!s.isWordLike) continue;
      const w = s.segment.trim();
      if (w) out.push(w);
    }
    return out;
  }
  // Fallback: letters/digits runs; CJK runs contribute single chars only when length 1
  // (longer runs are covered by bigrams).
  const out: string[] = [];
  for (const m of norm.matchAll(WORD)) {
    const w = m[0];
    if (CJK_CHAR.test(w)) {
      let run = '';
      const flush = () => { if (run.length === 1) out.push(run); run = ''; };
      for (const ch of w) {
        if (CJK_CHAR.test(ch)) run += ch;
        else { flush(); out.push(ch); }
      }
      flush();
    } else {
      out.push(w);
    }
  }
  return out;
}

function bigrams(norm: string): string[] {
  const out: string[] = [];
  for (const m of norm.matchAll(CJK_RUN)) {
    const run = [...m[0]];
    if (run.length === 1) out.push(run[0]!);
    for (let i = 0; i + 1 < run.length; i++) out.push(run[i]! + run[i + 1]!);
  }
  return out;
}

/** Build a tokenizer with fixed options. */
export function createTokenizer(opts: TokenizeOptions = {}): Tokenizer {
  const stop = opts.stopwords ?? DEFAULT_STOPWORDS;
  const useBigrams = opts.bigrams ?? true;
  return (text: string): string[] => {
    const norm = normalize(text);
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (t: string) => {
      if (!t || stop.has(t) || seen.has(t)) return;
      seen.add(t);
      out.push(t);
    };
    for (const w of words(norm)) push(w);
    if (useBigrams) for (const b of bigrams(norm)) push(b);
    return out;
  };
}

/** Default tokenizer: default stoplist, bigrams on. */
export const tokenize: Tokenizer = createTokenizer();
