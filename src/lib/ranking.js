/**
 * PestLoop — deterministic prioritization.
 *
 * Every value here is computed from visible fields and can be recomputed by
 * hand from the numbers shown in the table. There is no opaque risk score.
 *
 * priority = adjusted rate x recency weight
 *
 * Ranking never uses the raw repeat rate on its own: a building with 1 case
 * that recurred (100%) is weaker evidence than 6 recurrences out of 8 (75%),
 * and the Wilson lower bound is what encodes that. Administrative filings never
 * contribute — they recur on a statutory schedule, not because pests came back.
 */

/** Buildings below this many classifiable cases are shown but never ranked. */
export const DEFAULT_VOLUME_FLOOR = 8;

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;

/**
 * Recency bands. A pattern that stopped three years ago is a different renewal
 * conversation from one still running, but recency is a WEIGHT rather than a
 * gate — otherwise a 14%-rate account outranks a 92% one on three months.
 */
export const RECENCY_BANDS = [
  { key: 'active', maxMonths: 12, weight: 1.0, label: 'Active', hint: 'Repeat within the last 12 months' },
  { key: 'dormant', maxMonths: 24, weight: 0.85, label: 'Dormant 1–2y', hint: 'Most recent repeat 1–2 years ago' },
  { key: 'historic', maxMonths: Infinity, weight: 0.7, label: 'Historic 2y+', hint: 'Most recent repeat over 2 years ago' },
];

/**
 * Wilson score interval, lower bound at 95%. Weighs an observed rate by how
 * many cases it rests on, so a small-sample 100% cannot outrank a large-sample
 * 92%. Standard statistic — not a bespoke weighting.
 */
export function wilsonLowerBound(successes, total, z = 1.96) {
  if (!total || total <= 0) return 0;
  const p = successes / total;
  const z2 = z * z;
  const centre = p + z2 / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return Math.max(0, (centre - margin) / (1 + z2 / total));
}

export function monthsSince(iso, asOf) {
  if (!iso) return Infinity;
  return (new Date(asOf).getTime() - new Date(iso).getTime()) / MS_PER_MONTH;
}

export function recencyBand(lastRepeat, asOf) {
  const months = monthsSince(lastRepeat, asOf);
  return RECENCY_BANDS.find((b) => months <= b.maxMonths) ?? RECENCY_BANDS[RECENCY_BANDS.length - 1];
}

/**
 * @returns {{
 *   status: 'ranked'|'insufficient'|'none',
 *   priority: number|null, adjusted: number|null,
 *   weight: number, band: object|null
 * }}
 *   'none'         — no classifiable cases at all
 *   'insufficient' — below the volume floor; listed and flagged, never ranked
 *   'ranked'       — enough volume for the rate to mean something
 */
export function priorityOf(stats, { floor = DEFAULT_VOLUME_FLOOR, asOf } = {}) {
  const C = stats.classifiable ?? 0;
  const R = stats.repeats ?? 0;
  const months = monthsSince(stats.lastRepeat, asOf);
  const base = { priority: null, adjusted: null, weight: 1, band: null, months };

  if (C === 0) return { ...base, status: 'none' };
  if (C < floor) return { ...base, status: 'insufficient' };

  const adjusted = wilsonLowerBound(R, C);
  // With no repeats there is no "last repeat" to age, so recency is not applied.
  const band = R > 0 ? recencyBand(stats.lastRepeat, asOf) : null;
  const weight = band ? band.weight : 1;

  return { ...base, status: 'ranked', priority: adjusted * weight, adjusted, weight, band };
}

/**
 * Sort comparator. Ranked accounts first by priority, then raw repeat volume,
 * then recency. Unranked accounts keep their own ordering below, so a client
 * with thin data is still visible rather than buried at random.
 */
export function comparePriority(a, b) {
  const order = { ranked: 0, insufficient: 1, none: 2 };
  if (order[a.rank.status] !== order[b.rank.status]) return order[a.rank.status] - order[b.rank.status];

  if (a.rank.status === 'ranked') {
    if (b.rank.priority !== a.rank.priority) return b.rank.priority - a.rank.priority;
  }
  if ((b.stats.repeats ?? 0) !== (a.stats.repeats ?? 0)) return (b.stats.repeats ?? 0) - (a.stats.repeats ?? 0);
  return String(b.stats.lastRepeat ?? '').localeCompare(String(a.stats.lastRepeat ?? ''));
}

/**
 * Concentration — deliberately NOT part of priority. 84% of buildings with 3+
 * repeats already spread across multiple apartments, so it would barely reorder
 * anything, but for the remaining 16% it changes the conversation entirely
 * (a chronic single unit rather than a building-wide prevention case). Shown
 * and filterable so the account manager makes that judgement.
 */
export function concentrationOf(stats) {
  const units = stats.unitsWithRepeat ?? 0;
  if (units === 0) return { key: 'none', label: '—' };
  // Shortened from "One apartment" / "N apartments" — the table column stays
  // visible (rather than moved out entirely) because the "Repeats span"
  // filter filters on this exact value, and hiding the column would leave
  // that filter's effect invisible in the table.
  return units === 1 ? { key: 'single', label: '1 apt' } : { key: 'spread', label: `${units} apts` };
}
