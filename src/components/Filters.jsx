/**
 * Filter bar for the ranked client table.
 *
 * Physical and administrative are separate filters, never a combined score —
 * annual bedbug filings recur by statute and say nothing about an unresolved
 * infestation.
 */

import { PEST_LABELS } from '../lib/format.js';

export const DEFAULT_FILTERS = {
  category: 'all',
  minCases: 0,
  recency: 'any',
  pest: 'all',
  concentration: 'any',
};

const CATEGORIES = [
  { value: 'all', label: 'All accounts' },
  { value: 'physical', label: 'Physical recurrence' },
  { value: 'admin', label: 'Administrative only' },
];

const MIN_CASES = [
  { value: 0, label: 'Any' },
  { value: 4, label: '4+' },
  { value: 8, label: '8+ (floor)' },
  { value: 12, label: '12+' },
  { value: 20, label: '20+' },
];

const RECENCY = [
  { value: 'any', label: 'Any time' },
  { value: '12', label: 'Within 12 months' },
  { value: '24', label: 'Within 24 months' },
  { value: 'older', label: 'Over 2 years ago' },
  { value: 'never', label: 'No repeats on record' },
];

const CONCENTRATION = [
  { value: 'any', label: 'Any' },
  { value: 'single', label: 'One apartment' },
  { value: 'spread', label: '2+ apartments' },
];

function Select({ id, label, value, options, onChange, hint }) {
  return (
    <label className="filter" htmlFor={id} title={hint}>
      <span className="filter__label">{label}</span>
      <select
        id={id}
        className="filter__select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function Filters({ filters, onChange, shown, total }) {
  const set = (key) => (value) => onChange({ ...filters, [key]: value });
  const isDefault = Object.keys(DEFAULT_FILTERS).every((k) => String(filters[k]) === String(DEFAULT_FILTERS[k]));

  const pestOptions = [
    { value: 'all', label: 'All pests' },
    ...Object.entries(PEST_LABELS).map(([key, label]) => ({ value: key, label })),
  ];

  return (
    <div className="filters">
      <Select
        id="f-category" label="Category" value={filters.category} options={CATEGORIES}
        onChange={set('category')}
        hint="Physical infestation findings vs. statutory bedbug filing and posting records"
      />
      <Select
        id="f-cases" label="Classifiable cases" value={String(filters.minCases)}
        options={MIN_CASES.map((o) => ({ ...o, value: String(o.value) }))}
        onChange={(v) => set('minCases')(Number(v))}
        hint="Certified-corrected cases with a full year of follow-up. 8 is the reliability floor."
      />
      <Select
        id="f-recency" label="Last repeat" value={filters.recency} options={RECENCY}
        onChange={set('recency')} hint="When the most recent repeat was inspected"
      />
      <Select
        id="f-pest" label="Pest type" value={filters.pest} options={pestOptions}
        onChange={set('pest')} hint="Accounts with at least one violation of this pest type"
      />
      <Select
        id="f-conc" label="Repeats span" value={filters.concentration} options={CONCENTRATION}
        onChange={set('concentration')}
        hint="Whether repeats are confined to one apartment or spread across several"
      />

      <div className="filters__status">
        <span className="filters__count">
          {shown === total ? `${total} accounts` : `${shown} of ${total} accounts`}
        </span>
        {!isDefault ? (
          <button type="button" className="linkbtn" onClick={() => onChange({ ...DEFAULT_FILTERS })}>
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Apply the filter set to prepared rows. Pure — no state, easy to reason about. */
export function applyFilters(rows, filters) {
  return rows.filter(({ stats, admin, rank, concentration }) => {
    if (filters.category === 'physical' && (stats.repeats ?? 0) === 0) return false;
    if (filters.category === 'admin' && !((stats.total ?? 0) === 0 && (admin.total ?? 0) > 0)) return false;

    if (filters.minCases && (stats.classifiable ?? 0) < filters.minCases) return false;

    if (filters.recency !== 'any') {
      const last = stats.lastRepeat;
      if (filters.recency === 'never') {
        if (last) return false;
      } else if (!last) {
        return false;
      } else if (filters.recency === 'older') {
        if (rank.band?.key !== 'historic') return false;
      } else {
        const limit = Number(filters.recency);
        const months = rank.months ?? Infinity;
        if (months > limit) return false;
      }
    }

    if (filters.pest !== 'all' && !((stats.byPest ?? {})[filters.pest]?.total > 0)) return false;

    if (filters.concentration !== 'any' && concentration.key !== filters.concentration) return false;

    return true;
  });
}
