/**
 * Entry point A — single-building address search.
 *
 * The everyday case: one renewal meeting tomorrow, one building to check. No
 * CSV required. Ambiguous queries show candidates rather than guessing.
 *
 * Autosuggest is a fast assist layered on top of the free-text flow, not a
 * replacement for it — it reads from a slim, client-derived address index
 * (buildStreetIndex/suggestAddresses in lib/matching.js) so "Franklin" alone
 * surfaces "1229 Franklin Ave" without needing a house number first. The
 * authoritative Look-up path (full matchKeys variant support) is unchanged:
 * typing a full address and pressing Enter with nothing highlighted, or
 * clicking Look up, behaves exactly as it did before this existed.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { lookupAddress, suggestAddresses, buildStreetIndex } from '../lib/matching.js';
import { statsOf, displayAddress, formatRate } from '../lib/format.js';

/* Real Bronx buildings from the Phase 0 demo set, chosen for contrast:
   a saturated repeat history, a large building with a moderate rate, and one
   with administrative filings only — so the demo never dead-ends. */
const EXAMPLES = ['1120 Fox Street', '10 Richman Plaza', '809 Allerton Ave'];

const SUGGEST_MIN_CHARS = 3;
const SUGGEST_LIMIT = 8;
const SUGGEST_DEBOUNCE_MS = 150;

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

/** Autosuggest dropdown row — slim data only (no stats fetch needed to render this). */
function Suggestion({ entry, active, id, onPick }) {
  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={active}
      className={`hit${active ? ' hit--active' : ''}`}
      // Not a Tab stop: per the ARIA combobox pattern, DOM focus stays on the
      // input the whole time — options are only ever "virtually" active via
      // aria-activedescendant, reached by arrow keys, not by tabbing in.
      tabIndex={-1}
      // Stops the browser moving focus off the input on mousedown, which would
      // otherwise blur-close the dropdown before the click ever registers.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onPick(entry)}
    >
      <span className="hit__addr">{displayAddress(entry.address)}</span>
      <span className="hit__meta">
        {[entry.zip ? `ZIP ${entry.zip}` : null, entry.nta].filter(Boolean).join(' · ')}
      </span>
    </button>
  );
}

export default function AddressSearch({ index, meta, onSelect }) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [submitted, setSubmitted] = useState(null);
  const inputRef = useRef(null);

  // One-time derivations from the already-loaded building list — see the
  // buildStreetIndex doc comment for why this isn't a separately fetched file.
  const streetIndex = useMemo(() => buildStreetIndex(index.buildings), [index.buildings]);
  const buildingsById = useMemo(() => new Map(index.buildings.map((b) => [b.id, b])), [index.buildings]);

  // Debounce the SUGGESTION COMPUTATION, not the input — typed characters
  // appear instantly; the dropdown lags a little behind fast typing. Pure
  // client-side work, so this is about skipping wasted recomputation, not
  // network etiquette.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), SUGGEST_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const { matches: suggestions, total: suggestionTotal } = useMemo(() => {
    if (debouncedQuery.trim().length < SUGGEST_MIN_CHARS) return { matches: [], total: 0 };
    return suggestAddresses(streetIndex, debouncedQuery, SUGGEST_LIMIT);
  }, [streetIndex, debouncedQuery]);

  // A fresh suggestion list invalidates whatever was highlighted before.
  useEffect(() => setHighlightedIndex(-1), [suggestions]);

  const showDropdown = dropdownOpen && suggestions.length > 0;

  const run = (value) => {
    const text = value ?? query;
    if (!text.trim()) return;
    setQuery(text);
    setDropdownOpen(false);
    const result = lookupAddress(index, text);
    // One unambiguous hit goes straight through; anything else is shown for the
    // user to resolve rather than guessed at.
    if (result.matches.length === 1) {
      setSubmitted(null);
      onSelect(result.matches[0]);
      return;
    }
    setSubmitted(result);
  };

  const pick = (building) => {
    setDropdownOpen(false);
    setSubmitted(null);
    onSelect(building);
  };

  /** A suggestion is the slim {id, address, zip, nta} shape — resolve to the full record. */
  const pickSuggestion = (entry) => {
    setQuery(displayAddress(entry.address));
    const building = buildingsById.get(entry.id);
    if (building) pick(building);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      if (!showDropdown) return;
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      if (!showDropdown) return;
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      if (showDropdown && highlightedIndex >= 0) {
        e.preventDefault();
        pickSuggestion(suggestions[highlightedIndex]);
      } else {
        run();
      }
    } else if (e.key === 'Escape') {
      if (dropdownOpen) {
        setDropdownOpen(false);
        setHighlightedIndex(-1);
      }
    }
  };

  const activeId =
    showDropdown && highlightedIndex >= 0 ? `address-option-${highlightedIndex}` : undefined;

  return (
    <div className="search">
      <label className="search__label" htmlFor="address">
        Building address
      </label>
      <div className="search__row">
        <input
          ref={inputRef}
          id="address"
          className="search__input"
          type="text"
          placeholder="e.g. 1229 Franklin Ave — partial names and St/Street both work"
          value={query}
          autoComplete="off"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls="address-listbox"
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          onChange={(e) => {
            setQuery(e.target.value);
            setSubmitted(null);
            setDropdownOpen(true);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setDropdownOpen(false)}
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

      {showDropdown ? (
        <div className="hits" id="address-listbox" role="listbox" aria-label="Address suggestions">
          {suggestions.map((entry, i) => (
            <Suggestion
              key={entry.id}
              entry={entry}
              active={i === highlightedIndex}
              id={`address-option-${i}`}
              onPick={pickSuggestion}
            />
          ))}
          {suggestionTotal > suggestions.length ? (
            <div className="hits__foot">
              +{suggestionTotal - suggestions.length} more — keep typing to narrow
            </div>
          ) : null}
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
