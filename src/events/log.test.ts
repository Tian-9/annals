import { describe, expect, it } from 'vitest';
import { EventLog } from './log.js';
import { fold, latest } from './fold.js';
import type { AnnalsEvent } from './types.js';

type StateSet = AnnalsEvent<'state.set', { entity: string; attr: string; value: string }>;
type Summary = AnnalsEvent<'summary', { text: string }>;
type Ev = StateSet | Summary;

const key = (e: Ev) => (e.type === 'state.set' ? `${e.payload.entity}\u0000${e.payload.attr}` : null);

describe('EventLog', () => {
  it('appends with monotonic seq and bumps version', () => {
    const log = new EventLog<Ev>();
    const a = log.append({ at: 1, type: 'summary', payload: { text: 'a' } });
    const b = log.append({ at: 2, type: 'summary', payload: { text: 'b' }, source: 'm2' });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(b.source).toBe('m2');
    expect(a).not.toHaveProperty('source');
    expect(log.version).toBe(2);
  });

  it('acceptance #2 + #4: debt direction follows events, retracting the refund rolls it back', () => {
    const log = new EventLog<Ev>();
    log.append({ at: 3, type: 'state.set', source: 'm1', payload: { entity: '债务', attr: '金额', value: 'char 欠 user 50r' } });
    log.append({ at: 3, type: 'state.set', source: 'm2', payload: { entity: '债务', attr: '金额', value: 'char 欠 user 49.5r' } });
    log.append({ at: 3, type: 'state.set', source: 'm2', payload: { entity: '猫', attr: '位置', value: '客栈B' } });

    let view = latest(log.all(), key);
    expect(view.get('债务\u0000金额')?.payload).toMatchObject({ value: 'char 欠 user 49.5r' });

    const gone = log.retract('m2');
    expect(gone.length).toBe(2);
    view = latest(log.all(), key);
    expect(view.get('债务\u0000金额')?.payload).toMatchObject({ value: 'char 欠 user 50r' });
    expect(view.has('猫\u0000位置')).toBe(false);
    expect(log.retract('m2')).toEqual([]);
  });

  it('latest() orders keys by recency of their last write', () => {
    const log = new EventLog<Ev>();
    log.append({ at: 1, type: 'state.set', payload: { entity: 'a', attr: 'x', value: '1' } });
    log.append({ at: 2, type: 'state.set', payload: { entity: 'b', attr: 'x', value: '1' } });
    log.append({ at: 3, type: 'state.set', payload: { entity: 'a', attr: 'x', value: '2' } });
    expect([...latest(log.all(), key).keys()]).toEqual(['b\u0000x', 'a\u0000x']);
  });

  it('fold() is a plain reducer', () => {
    const log = new EventLog<Ev>();
    log.append({ at: 1, type: 'summary', payload: { text: 'a' } });
    log.append({ at: 2, type: 'summary', payload: { text: 'b' } });
    const n = fold(log.byType('summary'), (s, e) => s + e.payload.text.length, 0);
    expect(n).toBe(2);
  });

  it('acceptance #5: JSONL export → import preserves events and views', () => {
    const log = new EventLog<Ev>();
    log.append({ id: 'e1', at: 1, type: 'state.set', source: 'm1', payload: { entity: '猫', attr: '归属', value: '未明确' } });
    log.append({ id: 'e2', at: 2, type: 'summary', payload: { text: '捡到一只猫' } });
    const text = log.toJSONL();
    expect(text.split('\n').filter(Boolean).length).toBe(2);
    const back = EventLog.fromJSONL<Ev>(text);
    expect(back.all()).toEqual(log.all());
    expect(latest(back.all(), key).get('猫\u0000归属')?.id).toBe('e1');
    back.append({ at: 3, type: 'summary', payload: { text: 'x' } });
    expect(back.all().at(-1)?.seq).toBe(3);
  });

  it('load keeps stored seq so appends after a retraction never collide', () => {
    const log = new EventLog();
    log.append({ at: 1, type: 'x', payload: 1 });
    log.append({ at: 2, type: 'x', source: 's', payload: 2 });
    log.append({ at: 3, type: 'x', payload: 3 });
    log.retract('s');
    const back = new EventLog();
    back.load(log.all().reverse());
    expect(back.all().map((e) => e.seq)).toEqual([1, 3]);
    expect(back.append({ at: 4, type: 'x', payload: 4 }).seq).toBe(4);
  });
});
