/**
 * PestLoop — reading and formatting the precomputed data.
 *
 * The build script strips zero/null/empty fields to keep buildings.json small,
 * so nothing here may assume a key exists. Rates and the low-confidence flag are
 * DERIVED rather than read back, which means a missing field can never silently
 * become a wrong number on screen.
 */

import { PEST_LABELS } from '../../scripts/violation-codes.js';

export { PEST_LABELS };

const ZERO = {
  total: 0,
  open: 0,
  closedUncertified: 0,
  censored: 0,
  unlocatable: 0,
  classifiable: 0,
  repeats: 0,
  recitedOnly: 0,
  lastRepeat: null,
  lastViolation: null,
  unitsCited: 0,
  unitsWithRepeat: 0,
};

/** Read one category's stats with defaults filled and derived values computed. */
export function statsOf(building, category, volumeFloor = 8) {
  const raw = building?.[category] ?? {};
  const s = { ...ZERO, ...raw, byPest: raw.byPest ?? {} };
  s.repeatRate = s.classifiable > 0 ? s.repeats / s.classifiable : null;
  s.lowConfidence = s.classifiable < volumeFloor;
  return s;
}

export function formatRate(rate) {
  return rate === null || rate === undefined ? '—' : `${Math.round(rate * 100)}%`;
}

export function formatDate(value) {
  if (!value) return '—';
  const [y, m, d] = value.split('-');
  return `${m}/${d}/${y}`;
}

export function formatCount(n) {
  return n === 0 ? '—' : String(n);
}

/** Compact names for the table, where the full label overflows the column. */
const PEST_SHORT = { roach: 'Roach', mice: 'Mice', bedbug: 'Bedbug', fly: 'Fly', general: 'Other' };

/**
 * "Roach, Mice" — pest types seen at this building, most common first.
 * `short` trims to the table-friendly names and caps the list, since the full
 * five-type string pushes later columns off screen.
 */
export function pestSummary(stats, { short = false, max = Infinity } = {}) {
  const entries = Object.entries(stats.byPest ?? {})
    .filter(([, v]) => (v.total ?? 0) > 0)
    .sort((a, b) => (b[1].total ?? 0) - (a[1].total ?? 0));
  if (!entries.length) return '—';

  const names = entries.map(([pest]) => (short ? PEST_SHORT[pest] : PEST_LABELS[pest]) ?? pest);
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} +${names.length - max}`;
}

/** Title-case a HOUSE + STREET string for display without losing the number. */
export function displayAddress(address) {
  if (!address) return '(address not recorded)';
  return address
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(\d+)(st|nd|rd|th)\b/gi, (_, n, suf) => `${n}${suf.toLowerCase()}`);
}
