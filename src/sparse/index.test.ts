import { describe, expect, it } from 'vitest';
import { SparseIndex } from './index.js';

function sample(): SparseIndex {
  const idx = new SparseIndex();
  idx.add('s1', {
    core: ['猫', '黑炭', '小鱼干'],
    related: ['偷吃', '半夜', '案板'],
    hint: ['零食'],
  });
  idx.add('s2', {
    core: ['红包', '债务'],
    related: ['误发', '退款'],
    hint: ['猫'],
  });
  idx.add('s3', {
    core: ['客栈', '夜市'],
    related: ['搬家'],
  });
  return idx;
}

describe('SparseIndex', () => {
  it('acceptance #3: 黑炭昨天晚上吃了什么 hits the fish-snack summary first', () => {
    const idx = sample();
    const hits = idx.search('黑炭昨天晚上吃了什么');
    expect(hits[0]?.id).toBe('s1');
    expect(hits[0]?.terms).toContain('黑炭');
  });

  it('query sub-word meets a multi-char bag term through expansion', () => {
    const idx = sample();
    const hits = idx.search('鱼干');
    expect(hits.map((h) => h.id)).toEqual(['s1']);
  });

  it('stronger tier outranks weaker tier on the same term', () => {
    const idx = sample();
    const hits = idx.search(['猫']);
    expect(hits.map((h) => h.id)).toEqual(['s1', 's2']);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it('idf down-weights terms that appear everywhere', () => {
    const idx = new SparseIndex();
    idx.add('a', { core: ['猫', '鱼干'] });
    idx.add('b', { core: ['猫', '红包'] });
    idx.add('c', { core: ['猫'] });
    const [top] = idx.search(['猫', '红包']);
    expect(top?.id).toBe('b');
    const noIdf = idx.search(['猫'], { idf: false });
    expect(noIdf.every((h) => h.score === 1)).toBe(true);
  });

  it('weights are a query-time knob', () => {
    const idx = sample();
    const def = idx.search(['猫'], { idf: false });
    const flat = idx.search(['猫'], { idf: false, weights: { hint: 1 } });
    expect(def[1]!.score).toBeCloseTo(0.3);
    expect(flat[0]!.score).toBe(flat[1]!.score);
  });

  it('boost is applied per document after summing', () => {
    const idx = sample();
    const hits = idx.search(['猫'], { idf: false, boost: (id) => (id === 's2' ? 10 : 1) });
    expect(hits[0]?.id).toBe('s2');
  });

  it('remove and replace keep posting lists consistent', () => {
    const idx = sample();
    expect(idx.size).toBe(3);
    expect(idx.remove('s1')).toBe(true);
    expect(idx.remove('s1')).toBe(false);
    expect(idx.search('鱼干')).toEqual([]);
    idx.add('s2', { core: ['客栈'] });
    expect(idx.search(['红包'])).toEqual([]);
    expect(idx.search(['客栈']).map((h) => h.id).sort()).toEqual(['s2', 's3']);
    expect(idx.vocabulary().find((v) => v.term === '客栈')?.df).toBe(2);
  });

  it('keeps the stronger tier when a term appears in two tiers', () => {
    const idx = new SparseIndex();
    idx.add('a', { core: ['猫'], hint: ['猫'] });
    expect(idx.bagOf('a')).toEqual({ 猫: 'core' });
  });

  it('normalizes bag terms and queries the same way', () => {
    const idx = new SparseIndex();
    idx.add('a', { core: ['Ｂｌａｃｋ Ｃａｔ'] });
    expect(idx.search('black cat')[0]?.id).toBe('a');
  });

  it('serialize → deserialize round-trips search results', () => {
    const idx = sample();
    const copy = SparseIndex.deserialize(JSON.parse(JSON.stringify(idx.serialize())));
    expect(copy.size).toBe(3);
    expect(copy.search('黑炭昨天晚上吃了什么')).toEqual(idx.search('黑炭昨天晚上吃了什么'));
    expect(copy.bagOf('s2')).toEqual(idx.bagOf('s2'));
  });

  it('empty bags do not create documents', () => {
    const idx = new SparseIndex();
    idx.add('x', { core: ['  '] });
    expect(idx.size).toBe(0);
    expect(idx.has('x')).toBe(false);
  });

  it('honours k and minScore', () => {
    const idx = sample();
    expect(idx.search(['猫'], { k: 1 }).length).toBe(1);
    expect(idx.search(['猫'], { idf: false, minScore: 0.5 }).map((h) => h.id)).toEqual(['s1']);
  });
});
