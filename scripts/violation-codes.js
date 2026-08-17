/**
 * PestLoop — violation code configuration.
 *
 * Single source of truth for which HPD OrderNumbers this tool considers, and how
 * each one is classified. Everything downstream (fetch filter, physical vs.
 * administrative split, pest-type filters in the UI) reads from here.
 *
 * Retargeting this tool to another trade (plumbing, heat, mold) is mostly a
 * matter of swapping the two tables below.
 *
 * Paired numbers (568/868, 569/869, ...) are the same violation type recorded
 * under slightly different citation variants.
 */

/**
 * PHYSICAL — genuine physical-condition pest findings. These are the recurrence
 * signal: a closed roach violation followed by another roach violation is
 * evidence of a building-level pattern worth investigating.
 */
export const PHYSICAL_CODES = {
  '568': { pest: 'roach', label: 'Roach infestation' },
  '868': { pest: 'roach', label: 'Roach infestation' },
  '569': { pest: 'mice', label: 'Mice infestation' },
  '869': { pest: 'mice', label: 'Mice infestation' },
  '570': { pest: 'bedbug', label: 'Bedbug infestation' },
  '870': { pest: 'bedbug', label: 'Bedbug infestation' },
  '567': { pest: 'general', label: 'General pest / rodent nuisance' },
  '867': { pest: 'general', label: 'General pest / rodent nuisance' },
  '566': { pest: 'fly', label: 'Fly infestation nuisance' },
  '866': { pest: 'fly', label: 'Fly infestation nuisance' },
};

/**
 * ADMINISTRATIVE — filing, posting and notice requirements. These recur on a
 * statutory schedule, not because pests came back. Tracked separately and NEVER
 * merged into the physical score.
 */
export const ADMINISTRATIVE_CODES = {
  '1507': { pest: 'bedbug', label: 'Annual bedbug report filing' },
  '1508': { pest: 'bedbug', label: 'Bedbug notice distribution to tenants' },
  '1509': { pest: 'bedbug', label: 'Bedbug prevention notice posting' },
};

/** Human-readable names for the pest types above. */
export const PEST_LABELS = {
  roach: 'Roach',
  mice: 'Mice',
  bedbug: 'Bedbug',
  general: 'General pest / rodent',
  fly: 'Fly',
};

export const PHYSICAL_ORDER_NUMBERS = Object.keys(PHYSICAL_CODES);
export const ADMINISTRATIVE_ORDER_NUMBERS = Object.keys(ADMINISTRATIVE_CODES);
export const ALL_ORDER_NUMBERS = [
  ...PHYSICAL_ORDER_NUMBERS,
  ...ADMINISTRATIVE_ORDER_NUMBERS,
];

/** @returns {'physical'|'administrative'|null} */
export function categoryOf(orderNumber) {
  const key = String(orderNumber ?? '').trim();
  if (PHYSICAL_CODES[key]) return 'physical';
  if (ADMINISTRATIVE_CODES[key]) return 'administrative';
  return null;
}

export function codeInfo(orderNumber) {
  const key = String(orderNumber ?? '').trim();
  return PHYSICAL_CODES[key] ?? ADMINISTRATIVE_CODES[key] ?? null;
}

/**
 * Row counts observed when these codes were last verified against the live
 * Bronx dataset. The fetch script compares a fresh probe against these and
 * warns on a large drift, which would suggest HPD revised a code section.
 * Populated on first probe run — see scripts/fetch-data.js --probe.
 */
export const EXPECTED_CODE_COUNTS = null;
