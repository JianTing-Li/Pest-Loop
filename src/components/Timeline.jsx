/**
 * Phase 3 — full violation timeline for one building, with recurrence pairs
 * visually connected.
 *
 * Loaded lazily: only ~14% of buildings (3,181 of 22,254) have a timeline file
 * at all — Phase 0 only wrote one for buildings with at least one repeat pair,
 * since nobody opens a timeline for a building with zero repeats. A building
 * with no file is a normal outcome, not a load failure, and is worded that way.
 */

import { useEffect, useState } from 'react';
import { loadTimeline } from '../lib/data.js';
import { formatDate, violationLabel, violationStatus } from '../lib/format.js';
import { RepeatCaveat } from './Caveat.jsx';

/**
 * Rotating set of pair colors so several concurrent recurrence pairs (e.g.
 * apartment 5C's roach pair and 3E's mice pair) stay visually distinguishable.
 * Assigned by index, not by pest/apartment, purely for visual separation.
 */
const PAIR_COLORS = ['pair-a', 'pair-b', 'pair-c', 'pair-d'];

/**
 * Build a lookup from each violation id to the pair(s) it belongs to. The
 * `repeat` link in the data is one-directional — it lives on the earlier
 * (closing) violation and points forward — so the later violation needs a
 * reverse lookup to know it's part of a pair at all.
 *
 * A single later violation can be the qualifying repeat for MORE THAN ONE
 * earlier close (e.g. a roach case and a mice case in the same apartment both
 * find the same later inspection as their nearest match within the window) —
 * that's the intended "per-case yes/no" counting method, not a data error. So
 * the later side of the index holds an array, not a single overwritten entry,
 * or one of the two back-references would silently disappear.
 */
function pairIndex(rows) {
  const byVid = new Map(rows.map((r) => [r.vid, r]));
  const earlierOf = new Map(); // vid -> { color, gapDays, otherDate } — a row closes into at most one repeat
  const laterOf = new Map(); // vid -> [{ color, gapDays, otherDate }, ...] — a row can BE the repeat for several
  let count = 0;

  for (const row of rows) {
    if (!row.repeat) continue;
    const target = byVid.get(row.repeat.vid);
    if (!target) continue; // defensive: shouldn't happen, data is generated together
    const color = PAIR_COLORS[count % PAIR_COLORS.length];
    count += 1;
    earlierOf.set(row.vid, { color, gapDays: row.repeat.gapDays, otherDate: target.insp });
    if (!laterOf.has(target.vid)) laterOf.set(target.vid, []);
    laterOf.get(target.vid).push({ color, gapDays: row.repeat.gapDays, otherDate: row.insp });
  }

  // HPD occasionally logs two separate violation IDs for what amounts to the
  // same citation (same code, apartment, and both dates) — each is a real,
  // distinct record, so nothing is dropped, but rendering the identical
  // sentence twice in a row reads as a glitch rather than as two records.
  // Collapse matching back-references into one line with a count instead.
  for (const [vid, entries] of laterOf) {
    const merged = new Map();
    for (const e of entries) {
      const key = `${e.gapDays}::${e.otherDate}`;
      const existing = merged.get(key);
      if (existing) existing.n += 1;
      else merged.set(key, { ...e, n: 1 });
    }
    laterOf.set(vid, [...merged.values()]);
  }

  return { earlierOf, laterOf, count };
}

function Row({ row, earlier, laters }) {
  const status = violationStatus(row);
  // A row can be both the "earlier" end of its own pair and the "later" end of
  // someone else's — the earlier link wins for the tint since it's unique to
  // this row, while a shared later violation may need to show several notes.
  const color = earlier?.color ?? laters?.[0]?.color;
  return (
    <li className={`tl-row${color ? ` tl-row--${color}` : ''}`}>
      <div className="tl-row__date">{formatDate(row.insp)}</div>
      <div className="tl-row__body">
        <div className="tl-row__head">
          <span className="tl-row__label">{violationLabel(row)}</span>
          {row.cat === 'administrative' ? <span className="badge badge--info">administrative</span> : null}
          {row.apt ? <span className="tl-row__apt">Apt {row.apt}</span> : null}
        </div>
        <div className={`tl-row__status tl-row__status--${status.tone}`}>
          {status.label}
          {row.close ? ` · closed ${formatDate(row.close)}` : ''}
        </div>
        {earlier ? (
          <div className="tl-row__pairnote">
            → repeated in the same apartment {earlier.gapDays} days later, on {formatDate(earlier.otherDate)}
          </div>
        ) : null}
        {laters?.map((l, i) => (
          <div key={i} className="tl-row__pairnote">
            ↳ repeat of {l.n > 1 ? `${l.n} cases` : 'the case'} closed {formatDate(l.otherDate)} — {l.gapDays} days
            earlier
          </div>
        ))}
      </div>
    </li>
  );
}

export default function Timeline({ buildingId }) {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    loadTimeline(buildingId)
      .then((rows) => !cancelled && setState({ status: 'ready', rows }))
      .catch((err) => !cancelled && setState({ status: 'error', message: err.message }));
    return () => {
      cancelled = true;
    };
  }, [buildingId]);

  if (state.status === 'loading') {
    return (
      <div className="loading loading--inline">
        <span className="spinner" aria-hidden="true" />
        <span>Loading violation history…</span>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="notice notice--warn">
        <strong className="notice__title">Could not load the violation timeline</strong>
        {state.message}
      </div>
    );
  }
  if (state.rows.length === 0) {
    return (
      <p className="empty">
        No repeat pairs on record for this building, so there’s no timeline to show — the summary above already
        reflects every violation on file. Most Bronx buildings with pest violations fall in this group.
      </p>
    );
  }

  const { earlierOf, laterOf, count: pairCount } = pairIndex(state.rows);

  return (
    <div className="timeline">
      <p className="caveat">
        Showing every physical and administrative pest record on file for this building, oldest first.{' '}
        <strong>
          {pairCount} repeat pair{pairCount === 1 ? '' : 's'}
        </strong>{' '}
        {pairCount === 1 ? 'is' : 'are'} highlighted below, connecting the closed case to the repeat that followed
        it in the same apartment.
      </p>
      <RepeatCaveat />
      <ol className="tl">
        {state.rows.map((row) => (
          <Row key={row.vid} row={row} earlier={earlierOf.get(row.vid)} laters={laterOf.get(row.vid)} />
        ))}
      </ol>
    </div>
  );
}
