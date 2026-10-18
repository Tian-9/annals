// Fixtures come from the first test bed, an AI-roleplay app (see DESIGN §6, §8). The library itself is general-purpose.
// 用例取自第一个测试场景：一个 AI 角色扮演应用（见设计文档第 6、8 节）。库本身是通用的。
import { describe, expect, it } from 'vitest';
import { bagFromText, parseBag, rebuildIndex } from './bag.js';

describe('bagFromText', () => {
  it('tokenizes each field into its tier', () => {
    const b = bagFromText({ core: '邮差', related: '雨天才出现的邮差，送来的信都是空的。' });
    expect(b.core).toEqual(['邮差']);
    expect(b.related).toContain('雨天');
    expect(b.hint).toBeUndefined();
  });
});

describe('parseBag', () => {
  it('coerces untrusted output: strings only, trimmed, deduped, capped', () => {
    const b = parseBag({ core: [' 猫 ', 42, '黑炭', '小鱼干', '多余'], related: ['猫', '偷吃'], hint: ['零食'], junk: ['x'] });
    expect(b).toEqual({ core: ['猫', '黑炭', '小鱼干'], related: ['偷吃'], hint: ['零食'] });
  });
  it('caps the total and never throws on garbage', () => {
    const b = parseBag({ related: Array.from({ length: 30 }, (_, i) => `t${i}`) }, { total: 5 });
    expect(b.related?.length).toBe(5);
    expect(parseBag(null)).toEqual({});
    expect(parseBag('nope')).toEqual({});
  });
});

describe('rebuildIndex', () => {
  it('derives an index from any iterable, skipping nulls', () => {
    const rows = [
      { id: 'a', bag: { core: ['猫'] } },
      { id: 'skip' },
      { id: 'b', bag: { core: ['红包'] } },
    ];
    const idx = rebuildIndex(rows, (r) => ('bag' in r ? { id: r.id, bag: r.bag } : null));
    expect(idx.size).toBe(2);
    expect(idx.search('猫')[0]?.id).toBe('a');
  });
});
