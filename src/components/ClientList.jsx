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

import { useRef, useState } from 'react';
import { parseClientCSV } from '../lib/csv.js';
import { matchClients } from '../lib/matching.js';
import { loadSampleClients } from '../lib/data.js';
import { displayAddress } from '../lib/format.js';
import ResultsTable from './ResultsTable.jsx';
import { RepeatCaveat } from './Caveat.jsx';

export default function ClientList({ index, meta, onSelect }) {
  const [result, setResult] = useState(null);
  const [isSample, setIsSample] = useState(false);
  const [error, setError] = useState(null);
  const fileRef = useRef(null);

  const run = (rows, sample) => {
    setResult({ ...matchClients(index, rows), total: rows.length });
    setIsSample(sample);
    setError(null);
  };

  const onFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const { rows, missing } = await parseClientCSV(file);
      if (missing.length) {
        setError(`That file is missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. Expected headers: client_name, address, and optionally zip.`);
        setResult(null);
        return;
      }
      if (!rows.length) {
        setError('No data rows found in that file.');
        setResult(null);
        return;
      }
      run(rows, false);
    } catch (err) {
      setError(`Could not read that file: ${err.message}`);
      setResult(null);
    }
  };

  const useSample = async () => {
    try {
      run(await loadSampleClients(), true);
    } catch (err) {
      setError(err.message);
    }
  };

  const matchRate = result ? Math.round((result.matched.length / result.total) * 100) : 0;

  return (
    <div className="clients">
      <div className="controls">
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          Upload client list (CSV)
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={onFile} />
        <button type="button" className="btn btn--secondary" onClick={useSample}>
          Try it with sample data
        </button>
        <a className="linkbtn" href="data/sample-clients.csv" download>
          Download CSV template
        </a>
        <span className="controls__hint">
          Columns: <code>client_name</code>, <code>address</code>, optional <code>zip</code>. Extra columns are ignored.
        </span>
      </div>

      {error ? <div className="notice notice--warn">{error}</div> : null}

      {isSample && result ? (
        <div className="notice notice--sample">
          <strong>Sample data.</strong> These are real Bronx buildings with <em>fictional</em> company names
          attached — not a real client roster, and no real management company is implied. The spread is
          deliberately mixed: strong recurrence, moderate, near-clean, one below the reliability floor, and
          two with administrative filings only.
        </div>
      ) : null}

      {result ? (
        <>
          <div className="summary">
            <strong>{result.matched.length}</strong> of <strong>{result.total}</strong> rows matched a
            Bronx HPD building ({matchRate}%).
            {result.needsReview.length > 0 ? ` ${result.needsReview.length} need review.` : ''}
          </div>

          <ResultsTable rows={result.matched} meta={meta} onSelect={onSelect} />
          <RepeatCaveat />

          {result.needsReview.length > 0 ? (
            <section className="review">
              <h3 className="card__section">Rows needing review ({result.needsReview.length})</h3>
              <p className="caveat">
                These are shown rather than dropped. A row here means we could not confidently identify the
                building — not that the building has a clean record.
              </p>
              <table className="table table--review">
                <thead>
                  <tr>
                    <th className="ta-left">Account</th>
                    <th className="ta-left">Address as listed</th>
                    <th className="ta-left">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {result.needsReview.map((row, i) => (
                    <tr key={`${row.client_name}-${i}`}>
                      <td className="ta-left">{row.client_name}</td>
                      <td className="ta-left">{row.address || <em>(blank)</em>}</td>
                      <td className="ta-left">
                        {row.reason === 'no-match' ? (
                          'No Bronx building with a pest violation matched this address'
                        ) : (
                          <>
                            Matched {row.candidates.length} buildings — pick one:{' '}
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
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
