import { describe, expect, it } from 'vitest';
import { createTokenizer, normalize, tokenize } from './tokenize.js';

describe('normalize', () => {
  it('folds full-width and case', () => {
    expect(normalize('ＡＢＣ１２３')).toBe('abc123');
    expect(normalize('Black Cat')).toBe('black cat');
  });
});

describe('tokenize', () => {
  it('emits segmenter words and CJK bigrams, drops stopwords', () => {
    const t = tokenize('昨天半夜猫偷吃了小鱼干');
    expect(t).toContain('猫');
    expect(t).toContain('昨天');
    expect(t).toContain('鱼干'); // bigram: ICU splits 小鱼干 into single chars
    expect(t).toContain('小鱼');
    expect(t).not.toContain('了');
  });

  it('keeps latin words lowercased and digits', () => {
    expect(tokenize('Black Cat ate 50 fish')).toEqual(expect.arrayContaining(['black', 'cat', 'ate', '50', 'fish']));
  });

  it('deduplicates and preserves order', () => {
    const t = tokenize('猫猫');
    expect(t.filter((x) => x === '猫').length).toBe(1);
    expect(t).toContain('猫猫');
  });

  it('single CJK char runs survive', () => {
    expect(tokenize('猫')).toEqual(['猫']);
  });

  it('honours custom stopwords and bigram switch', () => {
    expect(tokenize('猫 的')).not.toContain('的');
    expect(createTokenizer({ stopwords: new Set() })('猫 的')).toContain('的');
    expect(createTokenizer({ bigrams: false })('吃了鱼干')).not.toContain('了鱼');
    expect(tokenize('吃了鱼干')).toContain('了鱼');
  });
});
