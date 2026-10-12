import { describe, expect, it } from 'vitest';
import { EventLog } from '../events/log.js';
import { diffPatches, liveEntries, parsePatches, renderStateLines, stateView, type StateSetEvent } from './index.js';

describe('parsePatches', () => {
  it('coerces and dedupes by entity+attr, honours attr whitelist', () => {
    const p = parsePatches([
      { entity: ' 猫 ', attr: '位置', value: '客栈B' },
      { entity: '猫', attr: '位置', value: '重复' },
      { entity: '猫', attr: '心情', value: '不在白名单' },
      { entity: '', attr: 'x', value: 'y' },
      'junk',
    ], { attrs: ['位置', '归属'] });
    expect(p).toEqual([{ entity: '猫', attr: '位置', value: '客栈B' }]);
  });
});

describe('state view and block', () => {
  it('acceptance #1 + #2: latest wins, no-op patches are dropped, rollback restores', () => {
    const log = new EventLog<StateSetEvent>();
    log.append({ at: 1, type: 'state.set', source: 'm1', payload: { entity: '当前', attr: '地点', value: '客栈A' } });
    log.append({ at: 2, type: 'state.set', source: 'm5', payload: { entity: '当前', attr: '地点', value: '夜市' } });
    log.append({ at: 3, type: 'state.set', source: 'm9', payload: { entity: '当前', attr: '地点', value: '客栈B' } });
    log.append({ at: 3, type: 'state.set', source: 'm9', payload: { entity: '债务#红包', attr: '欠款', value: 'char 欠 user 49.5r' } });

    let view = stateView(log.all());
    expect(renderStateLines(view)).toEqual(['当前 · 地点：客栈B', '债务#红包 · 欠款：char 欠 user 49.5r']);

    expect(diffPatches(view, [
      { entity: '当前', attr: '地点', value: '客栈B' },
      { entity: '猫', attr: '归属', value: '未明确' },
    ])).toEqual([{ entity: '猫', attr: '归属', value: '未明确' }]);

    log.retract('m9');
    view = stateView(log.all());
    expect(renderStateLines(view)).toEqual(['当前 · 地点：夜市']);
  });

  it('an empty value clears a fact without deleting history', () => {
    const log = new EventLog<StateSetEvent>();
    log.append({ at: 1, type: 'state.set', payload: { entity: '猫', attr: '位置', value: '客栈A' } });
    log.append({ at: 2, type: 'state.set', source: 'manual', payload: { entity: '猫', attr: '位置', value: '' } });
    expect(renderStateLines(stateView(log.all()))).toEqual([]);
    expect(liveEntries(stateView(log.all()))).toEqual([]);
    log.retract('manual');
    expect(renderStateLines(stateView(log.all()))).toEqual(['猫 · 位置：客栈A']);
  });

  it('evicts by write recency, keeping the freshest at the end', () => {
    const log = new EventLog<StateSetEvent>();
    for (let i = 0; i < 5; i++) log.append({ at: i, type: 'state.set', payload: { entity: `e${i}`, attr: 'a', value: 'v' } });
    log.append({ at: 9, type: 'state.set', payload: { entity: 'e0', attr: 'a', value: 'w' } });
    const lines = renderStateLines(stateView(log.all()), { limit: 3 });
    expect(lines).toEqual(['e3 · a：v', 'e4 · a：v', 'e0 · a：w']);
  });
});
