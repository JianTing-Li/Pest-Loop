/**
 * Entry point B — batch client-list upload.
 *
 * Parsing and matching both happen in the browser against the static building
 * JSON. The file never leaves the machine and no credential is involved.
 *
 * Rows that fail to match are shown, never dropped: address matching against
 * city data is never perfectly clean, and a silent omission would read as "this
 * client has no pest history" when it actually means "we couldn't find them".
 */

import { useMemo, useRef, useState } from 'react';
import { parseClientCSV } from '../lib/csv.js';
import { matchClients } from '../lib/matching.js';
import { loadSampleClients } from '../lib/data.js';
import { displayAddress, statsOf } from '../lib/format.js';
import { priorityOf, concentrationOf } from '../lib/ranking.js';
import ResultsTable from './ResultsTable.jsx';
import Filters, { DEFAULT_FILTERS, applyFilters } from './Filters.jsx';
import { RepeatCaveat } from './Caveat.jsx';

/** Let the browser paint before a synchronous block of work. */
const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

const CSV_NAME = /\.csv$/i;
const CSV_TYPES = ['text/csv', 'application/csv', 'application/vnd.ms-excel', ''];

function MatchBar({ matched, total, needsReview }) {
  const pct = total ? Math.round((matched / total) * 100) : 0;
  return (
    <div className="matchbar">
      <div className="matchstat">
        <span className="matchstat__num tnum">{matched}</span>
        <span className="matchstat__label">of {total} matched ({pct}%)</span>
      </div>
      {needsReview > 0 ? (
        <div className="matchstat">
          <span className="matchstat__num matchstat__num--warn tnum">{needsReview}</span>
          <span className="matchstat__label">need review</span>
        </div>
      ) : null}
      <div className="matchbar__track" role="presentation">
        <div className="matchbar__fill" style={{ width: `${pct}%` }} />
        <div className="matchbar__rest" style={{ width: `${100 - pct}%` }} />
      </div>
    </div>
  );
}

export default function ClientList({ index, meta, onSelect, selectedBuildingId }) {
  const [result, setResult] = useState(null);
  const [isSample, setIsSample] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ ...DEFAULT_FILTERS });
  const fileRef = useRef(null);

  // Prepared once per result set: stats, priority and concentration for each
  // matched account. Filtering and sorting both read from this.
  const prepared = useMemo(() => {
    if (!result) return [];
    return result.matched.map((row) => {
      const stats = statsOf(row.building, 'physical', meta.volumeFloor);
      return {
        row,
        stats,
        admin: statsOf(row.building, 'administrative', meta.volumeFloor),
        rank: priorityOf(stats, { floor: meta.volumeFloor, asOf: meta.dataAsOf }),
        concentration: concentrationOf(stats),
      };
    });
  }, [result, meta]);

  const visible = useMemo(() => applyFilters(prepared, filters), [prepared, filters]);

  const run = async (rows, sample) => {
    setError(null);
    setResult(null);
    setFilters({ ...DEFAULT_FILTERS }); // a new list shouldn't inherit the last one's filters
    // Matching is synchronous, so the loading state has to be painted before it
    // starts — otherwise React batches both and the message is never seen.
    setBusy(`Matching ${rows.length} address${rows.length === 1 ? '' : 'es'} against ${meta.buildings.toLocaleString()} Bronx buildings…`);
    await nextPaint();
    const matched = matchClients(index, rows);
    setResult({ ...matched, total: rows.length });
    setIsSample(sample);
    setBusy(null);
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-picking the same file after a fix
    if (!file) return;

    setResult(null);
    setError(null);

    if (!CSV_NAME.test(file.name) && !CSV_TYPES.includes(file.type)) {
      setError(
        `“${file.name}” doesn’t look like a CSV file. Export your client list as CSV — a .xlsx, .numbers or .pdf export won’t work here.`,
      );
      return;
    }

    try {
      setBusy(`Reading ${file.name}…`);
      await nextPaint();
      const { rows, missing } = await parseClientCSV(file);

      if (missing.length) {
        setBusy(null);
        setError(
          `“${file.name}” is missing the ${missing.map((m) => `“${m}”`).join(' and ')} column${missing.length > 1 ? 's' : ''}. ` +
            'Expected headers are client_name and address, with zip optional. Download the CSV template below to see the format.',
        );
        return;
      }
      if (!rows.length) {
        setBusy(null);
        setError(`“${file.name}” has the right columns but no data rows underneath them.`);
        return;
      }
      await run(rows, false);
    } catch (err) {
      setBusy(null);
      setError(`Could not read “${file.name}”: ${err.message}`);
    }
  };

  const useSample = async () => {
    try {
      setBusy('Loading sample client list…');
      await nextPaint();
      await run(await loadSampleClients(), true);
    } catch (err) {
      setBusy(null);
      setError(`Could not load the sample list: ${err.message}`);
    }
  };

  const showEmpty = !busy && !result && !error;

  return (
    <div className="clients">
      {/* The toolbar is redundant while the empty state is showing its own
          calls to action, so only one of the two is on screen at a time. */}
      <div className="controls" hidden={showEmpty}>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={!!busy}>
          Upload client list (CSV)
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
        <button type="button" className="btn btn--secondary" onClick={useSample} disabled={!!busy}>
          Try it with sample data
        </button>
        <a className="linkbtn" href="data/sample-clients.csv" download>
          Download CSV template
        </a>
        <span className="controls__hint">
          Columns: <code>client_name</code>, <code>address</code>, optional <code>zip</code>. Extra columns are ignored.
        </span>
      </div>

      {error ? (
        <div className="notice notice--warn">
          <strong className="notice__title">That file couldn’t be used</strong>
          {error}
        </div>
      ) : null}

      {busy ? (
        <div className="loading">
          <span className="spinner" aria-hidden="true" />
          <span>{busy}</span>
        </div>
      ) : null}

      {showEmpty ? (
        <div className="emptystate">
          <h3 className="emptystate__title">Review your whole book of business at once</h3>
          <p className="emptystate__text">
            Upload a client list to see which accounts have pest violations that came back after being certified
            corrected — the pattern a plain violation count can’t show. Matching runs entirely in your browser;
            the file is never uploaded anywhere.
          </p>
          <div className="emptystate__actions">
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              Upload client list (CSV)
            </button>
            <button type="button" className="btn btn--secondary" onClick={useSample}>
              Try it with sample data
            </button>
          </div>
          <p className="emptystate__meta">
            Needs <code>client_name</code> and <code>address</code> columns, with <code>zip</code> optional —{' '}
            <a className="linkbtn" href="data/sample-clients.csv" download>
              download the CSV template
            </a>
          </p>
        </div>
      ) : null}

      {isSample && result ? (
        <div className="notice notice--sample">
          <strong className="notice__title">Sample data — not a real client roster</strong>
          These are real Bronx buildings with <em>fictional</em> company names attached; no real management company
          is implied. The spread is deliberately mixed: strong recurrence, moderate, near-clean, three below the
          reliability floor, and two with administrative filings only.
        </div>
      ) : null}

      {result ? (
        <>
          <MatchBar matched={result.matched.length} total={result.total} needsReview={result.needsReview.length} />
          <Filters filters={filters} onChange={setFilters} shown={visible.length} total={prepared.length} />
          <ResultsTable rows={visible} onSelect={onSelect} selectedBuildingId={selectedBuildingId} />
          <p className="caveat">
            <strong>How the order is decided.</strong> Priority is the repeat rate adjusted for how many cases it
            rests on, multiplied by a recency weight (×1.00 within 12 months, ×0.85 at 1–2 years, ×0.70 beyond).
            Every input is a column above, so any row’s position can be checked by hand. Accounts below{' '}
            {meta.volumeFloor} classifiable cases are listed but never ranked, and administrative filings never
            affect the order.
          </p>
          <RepeatCaveat />

          {result.needsReview.length > 0 ? (
            <section className="review">
              <h3 className="card__section">Rows needing review ({result.needsReview.length})</h3>
              <p className="caveat">
                These are shown rather than dropped. A row here means we could not confidently identify the
                building — not that the building has a clean record.
              </p>
              <div className="tablewrap">
                <table className="table table--review">
                  <thead>
                    <tr>
                      <th className="ta-left">Account</th>
                      <th className="ta-left">Address as listed</th>
                      <th className="ta-left">What to do</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.needsReview.map((row, i) => (
                      <tr key={`${row.client_name}-${i}`}>
                        <td className="ta-left td--client">{row.client_name}</td>
                        <td className="ta-left td--addr">{row.address || <em>(blank)</em>}</td>
                        <td className="ta-left">
                          {row.reason === 'no-match' && !row.address ? (
                            'This row has no address, so there was nothing to match. Add the street address to your CSV and re-upload.'
                          ) : row.reason === 'no-match' ? (
                            'No Bronx building with a recorded pest violation matched this address. Check the spelling and house number, and confirm the property is in the Bronx.'
                          ) : (
                            <>
                              Matched {row.candidates.length} buildings — pick the right one:{' '}
                              {row.candidates.map((b) => (
                                <button
                                  key={b.id}
                                  type="button"
                                  className="linkbtn"
                                  onClick={() => onSelect(b, row.client_name)}
                                >
                                  {displayAddress(b.address)}
                                  {b.zip ? ` (${b.zip})` : ''}
                                </button>
                              ))}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
