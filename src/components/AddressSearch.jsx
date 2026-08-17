/**
 * Entry point A — single-building address search.
 *
 * The everyday case: one renewal meeting tomorrow, one building to check. No
 * CSV required. Ambiguous queries show candidates rather than guessing.
 */

import { useMemo, useState } from 'react';
import { lookupAddress, suggest } from '../lib/matching.js';
import { statsOf, displayAddress, formatRate } from '../lib/format.js';

/* Real Bronx buildings from the Phase 0 demo set, chosen for contrast:
   a saturated repeat history, a large building with a moderate rate, and one
   with administrative filings only — so the demo never dead-ends. */
const EXAMPLES = ['1120 Fox Street', '10 Richman Plaza', '809 Allerton Ave'];

function Hit({ building, meta, onPick }) {
  const phys = statsOf(building, 'physical', meta?.volumeFloor ?? 8);
  return (
    <button type="button" className="hit" onClick={() => onPick(building)}>
      <span className="hit__addr">{displayAddress(building.address)}</span>
      <span className="hit__meta">
        {building.zip ? `ZIP ${building.zip} · ` : ''}
        {phys.total} pest violation{phys.total === 1 ? '' : 's'}
        {phys.classifiable > 0 && !phys.lowConfidence ? ` · ${formatRate(phys.repeatRate)} repeat rate` : ''}
      </span>
    </button>
  );
}

export default function AddressSearch({ index, meta, onSelect }) {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState(null);
  // Once a building is showing, stop offering suggestions for the text that
  // produced it — otherwise the dropdown hangs open above its own result.
  const [resolved, setResolved] = useState(false);

  const suggestions = useMemo(
    () => (query.trim().length >= 3 && !submitted && !resolved ? suggest(index, query) : []),
    [index, query, submitted, resolved],
  );

  const run = (value) => {
    const text = value ?? query;
    if (!text.trim()) return;
    setQuery(text);
    const result = lookupAddress(index, text);
    // One unambiguous hit goes straight through; anything else is shown for the
    // user to resolve rather than guessed at.
    if (result.matches.length === 1) {
      setSubmitted(null);
      setResolved(true);
      onSelect(result.matches[0]);
      return;
    }
    setSubmitted(result);
  };

  const pick = (building) => {
    setSubmitted(null);
    setResolved(true);
    onSelect(building);
  };

  return (
    <div className="search">
      <label className="search__label" htmlFor="address">
        Building address
      </label>
      <div className="search__row">
        <input
          id="address"
          className="search__input"
          type="text"
          placeholder="e.g. 1229 Franklin Ave — partial names and St/Street both work"
          value={query}
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setSubmitted(null);
            setResolved(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && run()}
        />
        <button type="button" className="btn" onClick={() => run()}>
          Look up
        </button>
      </div>

      <p className="search__hint">
        See how often closed pest violations came back in the same apartment within a year — the pattern a plain
        violation count can’t show. Partial street names, <code>St</code> vs <code>Street</code>, and trailing
        apartment numbers all work.
      </p>

      <div className="search__examples">
        <span>Try:</span>
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="linkbtn" onClick={() => run(ex)}>
            {ex}
          </button>
        ))}
      </div>

      {suggestions.length > 0 ? (
        <div className="hits">
          {suggestions.map((b) => (
            <Hit key={b.id} building={b} meta={meta} onPick={pick} />
          ))}
        </div>
      ) : null}

      {submitted?.status === 'none' ? (
        <div className="notice notice--warn">
          <strong className="notice__title">No building matched “{query}”</strong>
          Things worth trying:
          <ul>
            {submitted.parsed?.houseNumber ? null : (
              <li>Include the house number — “Franklin Ave” alone isn’t enough to identify a building.</li>
            )}
            <li>Drop any apartment or unit number, and check the street name spelling.</li>
            <li>
              Confirm the property is in the <strong>Bronx</strong> — this dataset covers that borough only.
            </li>
          </ul>
          <p className="caveat" style={{ color: 'inherit' }}>
            A building with no HPD pest violations since {meta?.since ?? '2021'} also won’t appear here. That is
            not the same as a building with a clean record, and it isn’t evidence either way.
          </p>
        </div>
      ) : null}

      {submitted && submitted.matches.length > 1 ? (
        <div className="hits">
          <div className="hits__head">
            {submitted.matches.length} buildings match {submitted.status === 'partial' ? 'that partial address' : 'that address'} — pick one:
          </div>
          {submitted.matches.map((b) => (
            <Hit key={b.id} building={b} meta={meta} onPick={pick} />
          ))}
        </div>
      ) : null}

    </div>
  );
}
