/**
 * Tiers are the only "weight" a model is allowed to emit.
 *
 * The model classifies (which tier does this term belong to), code maps the
 * class to a number at query time. Changing the mapping never touches stored
 * bags, and rebuilding the index from bags is code-only.
 */

export type Tier = 'core' | 'related' | 'hint';

/** Strongest first. The stored posting code is `index + 1` (1 = core). */
export const TIERS: readonly Tier[] = ['core', 'related', 'hint'];

export type Weights = Record<Tier, number>;

export const DEFAULT_WEIGHTS: Readonly<Weights> = { core: 1, related: 0.6, hint: 0.3 };

/** What the extraction pipeline hands to the index. Missing tiers are fine. */
export type Bag = Partial<Record<Tier, readonly string[]>>;

/** 1-based code stored in posting lists; lower is stronger. Fits a uint8. */
export type TierCode = 1 | 2 | 3;

export function tierCode(t: Tier): TierCode {
  const i = TIERS.indexOf(t);
  if (i < 0) throw new Error(`unknown tier: ${String(t)}`);
  return (i + 1) as TierCode;
}

export function tierOf(code: number): Tier {
  const t = TIERS[code - 1];
  if (!t) throw new Error(`bad tier code: ${code}`);
  return t;
}
