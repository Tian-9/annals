// Mirrors the README "thirty seconds" example. If this breaks, fix the README too.
import { expect, it } from 'vitest';
import { EventLog, latest, SparseIndex, type AnnalsEvent, type Bag } from './index.js';

type Ev =
  | AnnalsEvent<'state.set', { entity: string; attr: string; value: string }>
  | AnnalsEvent<'bag', Bag & { doc: string }>;

it('quickstart', () => {
  const log = new EventLog<Ev>();
  log.append({ at: 3, type: 'state.set', source: 'msg-41',
    payload: { entity: 'debt#tickets', attr: 'amount', value: 'user owes Alex 50 EUR' } });
  log.append({ at: 3, type: 'bag', source: 'msg-41',
    payload: { doc: 'note-7', core: ['猫', '黑炭', '小鱼干'], related: ['偷吃', '半夜'], hint: ['零食'] } });

  const view = latest(log.byType('state.set'), (e) => `${e.payload.entity}/${e.payload.attr}`);
  expect(view.get('debt#tickets/amount')?.payload.value).toBe('user owes Alex 50 EUR');

  const idx = new SparseIndex();
  for (const e of log.byType('bag')) idx.add(e.payload.doc, e.payload);
  const hits = idx.search('黑炭昨天晚上吃了什么');
  expect(hits[0]).toMatchObject({ id: 'note-7', terms: ['黑炭'] });

  log.retract('msg-41');
  expect(log.length).toBe(0);
});
