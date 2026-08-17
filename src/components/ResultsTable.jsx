/**
 * The ranked client table — the monthly-account-review view.
 *
 * Default order is the deterministic priority from lib/ranking.js. Every input
 * to that order is a visible column, so the ranking can be checked by hand:
 * priority = adjusted rate x recency weight, and adjusted rate is the Wilson
 * lower bound of repeats out of classifiable cases.
 *
 * Below-floor rows stay visible and are flagged in place, per spec — an account
 * manager needs to see their client whether or not the data supports ranking.
 */

import { useMemo, useState } from 'react';
import { formatRate, formatDate, formatCount, pestSummary, displayAddress } from '../lib/format.js';
import { comparePriority } from '../lib/ranking.js';

const COLUMNS = [
  { key: 'rank', label: '#', help: 'Priority order: adjusted repeat rate × recency weight' },
  { key: 'client', label: 'Account', align: 'left', help: 'Name from your client list' },
  { key: 'address', label: 'Address', align: 'left', help: 'Matched HPD building' },
  { key: 'total', label: 'Violations', help: 'All physical pest violations on record' },
  { key: 'classifiable', label: 'Classifiable cases', help: 'Certified-corrected cases with a full year of follow-up' },
  { key: 'repeats', label: 'Repeats', help: 'Cases re-cited in the same apartment 30–365 days after closing' },
  { key: 'rate', label: 'Repeat rate', help: 'Repeats ÷ classifiable cases' },
  { key: 'adjusted', label: 'Adjusted rate', help: 'Repeat rate weighted by how many cases it rests on (Wilson 95% lower bound). A 100% from 12 cases ranks below a 92% from 37.' },
  { key: 'lastRepeat', label: 'Last repeat', help: 'Inspection date of the most recent repeat' },
  { key: 'span', label: 'Repeats span', help: 'How many distinct apartments the repeats occurred in' },
  { key: 'pests', label: 'Pest types', align: 'left', help: 'Pest types cited, most frequent first' },
  { key: 'admin', label: 'Admin filings', help: 'Bedbug filing/posting paperwork — never part of the physical signal or the ranking' },
];

export default function ResultsTable({ rows, onSelect }) {
  const [sort, setSort] = useState({ key: 'rank', dir: 'asc' });

  const sorted = useMemo(() => {
    if (sort.key === 'rank') {
      const byPriority = [...rows].sort(comparePriority);
      return sort.dir === 'asc' ? byPriority : byPriority.reverse();
    }

    const value = ({ row, stats, admin, rank, concentration }) => {
      switch (sort.key) {
        case 'client': return row.client_name?.toLowerCase() ?? '';
        case 'address': return row.building.address ?? '';
        case 'total': return stats.total;
        case 'classifiable': return stats.classifiable;
        case 'repeats': return stats.repeats;
        // Below-floor rates sort as -1 so a 100% drawn from three cases can
        // never head the descending list.
        case 'rate': return rank.status === 'ranked' ? stats.repeatRate ?? -1 : -1;
        case 'adjusted': return rank.adjusted ?? -1;
        case 'lastRepeat': return stats.lastRepeat ?? '';
        case 'span': return concentration.key === 'none' ? -1 : stats.unitsWithRepeat;
        case 'pests': return pestSummary(stats, { short: true });
        case 'admin': return admin.total;
        default: return 0;
      }
    };
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = value(a);
      const bv = value(b);
      if (av === bv) return (a.row.client_name ?? '').localeCompare(b.row.client_name ?? '');
      return av > bv ? dir : -dir;
    });
  }, [rows, sort]);

  const toggle = (key) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
        : { key, dir: key === 'rank' || key === 'client' || key === 'address' ? 'asc' : 'desc' },
    );

  return (
    <div className="tablewrap">
      <table className="table">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                className={`${c.align === 'left' ? 'ta-left' : 'ta-right'}${sort.key === c.key ? ' th--sorted' : ''}${c.key === 'rank' ? ' th--rank' : ''}`}
                onClick={() => toggle(c.key)}
              >
                <span className="thtip" tabIndex={0}>
                  {c.label}
                  <span className="th__arrow">{sort.key === c.key ? (sort.dir === 'desc' ? '▼' : '▲') : ''}</span>
                  <span className="thtip__bubble" role="tooltip">{c.help}</span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry, i) => {
            const { row, stats, admin, rank, concentration } = entry;
            const unranked = rank.status !== 'ranked';
            return (
              <tr
                key={`${row.client_name}-${row.building.id}`}
                className={unranked ? 'tr--low' : undefined}
                onClick={() => onSelect(row.building, row.client_name)}
              >
                <td className="td--rank">{rank.status === 'ranked' && sort.key === 'rank' ? i + 1 : '·'}</td>
                <td className="ta-left td--client" title={row.client_name}>{row.client_name}</td>
                <td className="ta-left td--addr" title={displayAddress(row.building.address)}>
                  {displayAddress(row.building.address)}
                  {row.matchType === 'partial' ? (
                    <span className="badge badge--info" title="Matched on a partial street name">partial match</span>
                  ) : null}
                </td>
                <td>{formatCount(stats.total)}</td>
                <td>{formatCount(stats.classifiable)}</td>
                <td className={stats.repeats > 0 ? 'td--strong' : undefined}>{formatCount(stats.repeats)}</td>
                <td>
                  {stats.classifiable === 0 ? (
                    <span className="badge">no closed cases</span>
                  ) : rank.status === 'insufficient' ? (
                    <span className="badge" title="Fewer than the reliability floor of classifiable cases — this rate is not stable enough to rank on">
                      not enough data
                    </span>
                  ) : (
                    formatRate(stats.repeatRate)
                  )}
                </td>
                <td className="td--adj">{rank.adjusted === null ? '—' : rank.adjusted.toFixed(2)}</td>
                <td>
                  {formatDate(stats.lastRepeat)}
                  {rank.band ? (
                    <span className={`dot dot--${rank.band.key}`} title={`${rank.band.label} — ${rank.band.hint}. Recency weight ×${rank.band.weight.toFixed(2)}`} />
                  ) : null}
                </td>
                <td className="td--span">{concentration.label}</td>
                <td className="ta-left td--pests" title={pestSummary(stats)}>
                  {pestSummary(stats, { short: true, max: 3 })}
                </td>
                <td className="td--admin">{formatCount(admin.total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sorted.length === 0 ? (
        <p className="empty" style={{ padding: '20px' }}>
          No accounts match these filters. Clear a filter to widen the list.
        </p>
      ) : null}
    </div>
  );
}
