/**
 * State profile: the "what is true now" convention on top of the primitives.
 * A fact is entity + attr + value; the newest write per entity+attr wins.
 * Still no prompts and no model calls; this is the data contract between an
 * extraction call and the event log, plus the pure functions that turn state
 * events into the block an application injects.
 *
 * 状态画像：在原语之上约定"现在什么是真的"。一条事实是 实体 + 属性 + 值，
 * 同一 实体+属性 取最新一次写入。仍然没有 prompt、不调模型：这里只有抽取调用和
 * 事件日志之间的数据合同，以及把状态事件渲染成注入块的纯函数。
 */
import { latest } from '../events/fold.js';
import type { AnnalsEvent } from '../events/types.js';

export interface StatePatch {
  /** 谁或什么："user"、"猫"、"房租" */
  entity: string;
  /** 哪一方面："住址"、"归属"、"金额" */
  attr: string;
  /** 现在的值，一句规范句。有方向的事实写清主宾："user 欠 Alex 50 欧" */
  value: string;
}

export type StateSetEvent = AnnalsEvent<'state.set', StatePatch>;

/** JSON Schema fragment for the `patches` field of an extraction output. */
export const PATCHES_SCHEMA = {
  type: 'array',
  maxItems: 12,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['entity', 'attr', 'value'],
    properties: {
      entity: { type: 'string', description: '谁或什么：人名、物件、事项（同类多件用"事项#区分词"）' },
      attr: { type: 'string', description: '哪一方面：位置、归属、关系、金额、承诺、偏好等当前仍成立或不可逆的事' },
      value: { type: 'string', description: '现在的值，一句话。有方向的写清谁对谁；不确定就写"未明确（原因）"' },
    },
  },
} as const;

/** JSON Schema fragment for a three-tier bag. */
export const BAG_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    core: { type: 'array', maxItems: 3, items: { type: 'string' }, description: '最多 3 个：这件事的主体和关键物件，含别名' },
    related: { type: 'array', maxItems: 8, items: { type: 'string' }, description: '直接相关的动作、地点、时间段' },
    hint: { type: 'array', maxItems: 8, items: { type: 'string' }, description: '可能被用来找到这件事的联想词' },
  },
} as const;

export interface PatchLimits {
  /** Allowed attrs. Patches with other attrs are dropped. Omit to accept any. */
  attrs?: readonly string[];
  /** Max patches kept. Default 12. */
  max?: number;
}

/** Coerce untrusted model output into patches. Never throws. */
export function parsePatches(input: unknown, limits: PatchLimits = {}): StatePatch[] {
  if (!Array.isArray(input)) return [];
  const max = limits.max ?? 12;
  const allow = limits.attrs ? new Set(limits.attrs) : null;
  const out: StatePatch[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const entity = typeof r.entity === 'string' ? r.entity.trim().slice(0, 40) : '';
    const attr = typeof r.attr === 'string' ? r.attr.trim().slice(0, 24) : '';
    const value = typeof r.value === 'string' ? r.value.trim().slice(0, 160) : '';
    if (!entity || !attr || !value) continue;
    if (allow && !allow.has(attr)) continue;
    const k = stateKey(entity, attr);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ entity, attr, value });
    if (out.length >= max) break;
  }
  return out;
}

export function stateKey(entity: string, attr: string): string {
  return `${entity}\u0000${attr}`;
}

/** Latest value per entity+attr, in recency order of last write. */
export function stateView<E extends AnnalsEvent>(events: readonly E[]): Map<string, StateSetEvent> {
  const sets = events.filter((e): e is E & StateSetEvent => e.type === 'state.set');
  return latest(sets, (e) => stateKey(e.payload.entity, e.payload.attr));
}

/**
 * Drop patches that would not change the view. The model never supplies the
 * old value; code reads it here.
 */
export function diffPatches(view: ReadonlyMap<string, StateSetEvent>, patches: readonly StatePatch[]): StatePatch[] {
  return patches.filter((p) => view.get(stateKey(p.entity, p.attr))?.payload.value !== p.value);
}

export interface RenderOptions {
  /** Keep only the most recently written entries. Default 20. */
  limit?: number;
}

/**
 * Lines for the injected state block, most recently changed last so the
 * model reads the freshest fact closest to the conversation. Activity
 * eviction is by write recency, not by the application clock: a long gap
 * (a month away, a "three months later" skip) must not blank the block.
 */
export function renderStateLines(view: ReadonlyMap<string, StateSetEvent>, opts: RenderOptions = {}): string[] {
  const limit = opts.limit ?? 20;
  return liveEntries(view).slice(-limit).map((e) => `${e.payload.entity} · ${e.payload.attr}：${e.payload.value}`);
}

/**
 * Entries that are currently set, in write-recency order. An empty `value`
 * means "cleared": the key stays in the log (so it can be rolled back) but is
 * not rendered. That is how a manual edit removes a fact without deleting
 * history.
 */
export function liveEntries(view: ReadonlyMap<string, StateSetEvent>): StateSetEvent[] {
  return [...view.values()].filter((e) => e.payload.value !== '');
}
