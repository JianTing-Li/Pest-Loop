/**
 * The ranked client table — the monthly-account-review view.
 *
 * Sorting here is intentionally simple (click a column, it sorts) with a default
 * of repeat count descending. The deterministic prioritization that weighs
 * repeats, case volume and recency together is Phase 2; this does not attempt it.
 *
 * Low-confidence rows stay visible and are flagged in place, per spec — an
 * account manager needs to see their client whether or not the data supports a
 * ranking, and a caveat somewhere else on the page would be missed.
 */

import { useMemo, useState } from 'react';
import { statsOf, formatRate, formatDate, formatCount, pestSummary, displayAddress } from '../lib/format.js';

const COLUMNS = [
  { key: 'client', label: 'Account', align: 'left', help: 'Name from your client list' },
  { key: 'address', label: 'Address', align: 'left', help: 'Matched HPD building' },
  { key: 'total', label: 'Pest violations', help: 'All physical pest violations on record' },
  { key: 'classifiable', label: 'Classifiable cases', help: 'Certified-corrected cases with a full year of follow-up' },
  { key: 'repeats', label: 'Repeats', help: 'Cases re-cited in the same apartment within a year' },
  { key: 'rate', label: 'Repeat rate', help: 'Repeats ÷ classifiable cases' },
  { key: 'lastRepeat', label: 'Last repeat', help: 'Inspection date of the most recent repeat' },
  { key: 'pests', label: 'Pest types', align: 'left', help: 'Pest types cited, most frequent first' },
  { key: 'admin', label: 'Admin filings', help: 'Bedbug filing/posting paperwork — kept out of the physical signal' },
];

export default function ResultsTable({ rows, meta, onSelect }) {
  const floor = meta?.volumeFloor ?? 8;
  const [sort, setSort] = useState({ key: 'repeats', dir: 'desc' });

  const prepared = useMemo(
    () =>
      rows.map((row) => {
        const phys = statsOf(row.building, 'physical', floor);
        const admin = statsOf(row.building, 'administrative', floor);
        return { row, phys, admin };
      }),
    [rows, floor],
  );

  const sorted = useMemo(() => {
    const value = ({ row, phys, admin }) => {
      switch (sort.key) {
        case 'client': return row.client_name?.toLowerCase() ?? '';
        case 'address': return row.building.address ?? '';
        case 'total': return phys.total;
        case 'classifiable': return phys.classifiable;
        case 'repeats': return phys.repeats;
        // Below-floor rates sort as -1 so a 100% drawn from three cases can
        // never head the descending list. Ascending still groups them together.
        case 'rate': return phys.lowConfidence ? -1 : phys.repeatRate ?? -1;
        case 'lastRepeat': return phys.lastRepeat ?? '';
        case 'pests': return pestSummary(phys, { short: true });
        case 'admin': return admin.total;
        default: return 0;
      }
    };
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...prepared].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av === bv) return (a.row.client_name ?? '').localeCompare(b.row.client_name ?? '');
      return av > bv ? dir : -dir;
    });
  }, [prepared, sort]);

  const toggle = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));

  return (
    <div className="tablewrap">
      <table className="table">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                title={c.help}
                className={`${c.align === 'left' ? 'ta-left' : 'ta-right'}${sort.key === c.key ? ' th--sorted' : ''}`}
                onClick={() => toggle(c.key)}
              >
                {c.label}
                <span className="th__arrow">{sort.key === c.key ? (sort.dir === 'desc' ? '▼' : '▲') : ''}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ row, phys, admin }) => (
            <tr
              key={`${row.client_name}-${row.building.id}`}
              className={phys.lowConfidence ? 'tr--low' : undefined}
              onClick={() => onSelect(row.building, row.client_name)}
            >
              <td className="ta-left td--client">{row.client_name}</td>
              <td className="ta-left">
                {displayAddress(row.building.address)}
                {row.matchType === 'partial' ? <span className="badge badge--info" title="Matched on a partial street name">partial match</span> : null}
              </td>
              <td>{formatCount(phys.total)}</td>
              <td>{formatCount(phys.classifiable)}</td>
              <td className={phys.repeats > 0 ? 'td--strong' : undefined}>{formatCount(phys.repeats)}</td>
              <td>
                {phys.classifiable === 0 ? (
                  <span className="badge">no closed cases</span>
                ) : phys.lowConfidence ? (
                  <span className="badge" title={`Fewer than ${floor} classifiable cases — rate is not reliable enough to rank on`}>
                    not enough data
                  </span>
                ) : (
                  formatRate(phys.repeatRate)
                )}
              </td>
              <td>{formatDate(phys.lastRepeat)}</td>
              <td className="ta-left td--pests" title={pestSummary(phys)}>
                {pestSummary(phys, { short: true, max: 3 })}
              </td>
              <td className="td--admin">{formatCount(admin.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length === 0 ? <p className="empty">No matched accounts to show.</p> : null}
    </div>
  );
}
