/**
 * AIRP profile: conventions for AI-roleplay applications built on the
 * primitives. Still no prompts and no model calls; this is the data contract
 * between an extraction call and the event log, plus the pure functions that
 * turn state events into the block an application injects.
 */
import { latest } from '../events/fold.js';
import type { AnnalsEvent } from '../events/types.js';

export interface StatePatch {
  /** 谁或什么："猫"、"债务#红包"、"user" */
  entity: string;
  /** 哪一方面："位置"、"归属"、"欠款" */
  attr: string;
  /** 现在的值，一句规范句。有方向的事实写清主宾："char 欠 user 49.5r" */
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
      entity: { type: 'string', description: '谁或什么：人名、物件、"债务#事由"' },
      attr: { type: 'string', description: '哪一方面：位置、归属、生死、关系、欠款、承诺、外貌等不可逆或当前仍成立的事' },
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
 * eviction is by write recency, not story days: a "three months later" jump
 * must not blank the block.
 */
export function renderStateLines(view: ReadonlyMap<string, StateSetEvent>, opts: RenderOptions = {}): string[] {
  const limit = opts.limit ?? 20;
  const entries = [...view.values()];
  return entries.slice(Math.max(0, entries.length - limit)).map((e) => `${e.payload.entity} · ${e.payload.attr}：${e.payload.value}`);
}
