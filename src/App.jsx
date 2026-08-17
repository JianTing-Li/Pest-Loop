import { useEffect, useRef, useState } from 'react';
import { loadData } from './lib/data.js';
import AddressSearch from './components/AddressSearch.jsx';
import ClientList from './components/ClientList.jsx';
import BuildingCard from './components/BuildingCard.jsx';

export default function App() {
  const [state, setState] = useState({ status: 'loading' });
  const [tab, setTab] = useState('search');
  const [selected, setSelected] = useState(null);
  const detailRef = useRef(null);

  useEffect(() => {
    loadData()
      .then(({ buildings, meta, index }) => setState({ status: 'ready', buildings, meta, index }))
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, []);

  // Scroll the detail view into frame whenever a new selection is made — on a
  // longer client list the card renders well below the fold, so without this
  // a row click looks like it did nothing. `scroll-margin-top` on `.card`
  // (styles.css) gives the landing position breathing room instead of
  // slamming the header flush against the viewport edge.
  useEffect(() => {
    if (!selected || !detailRef.current) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    detailRef.current.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }, [selected]);

  if (state.status === 'loading') {
    return (
      <div className="app">
        <div className="loading">
          <span className="spinner" aria-hidden="true" />
          <span>Loading Bronx building records…</span>
        </div>
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="app">
        <div className="notice notice--warn">
          <strong className="notice__title">Could not load the dataset</strong>
          {state.message}. Run <code>node scripts/fetch-data.js</code> to generate the files in{' '}
          <code>public/data/</code>.
        </div>
      </div>
    );
  }

  const { meta, index, buildings } = state;
  const select = (building, clientName) => setSelected({ building, clientName });

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="brand">
            {/* Same loop motif as the favicon (index.html), reused here so the
                browser tab and the header read as one consistent mark. */}
            <svg className="brand__icon" viewBox="0 0 32 32" aria-hidden="true">
              <path d="M16 6a10 10 0 0 1 9.8 8h-3.1A7 7 0 0 0 16 9a7 7 0 0 0-6.9 6H12l-4.5 5L3 15h2.6A10 10 0 0 1 16 6Z" />
              <path d="M16 26a10 10 0 0 1-9.8-8h3.1A7 7 0 0 0 16 23a7 7 0 0 0 6.9-6H20l4.5-5L29 17h-2.6A10 10 0 0 1 16 26Z" />
            </svg>
            <h1 className="topbar__title">
              <span className="topbar__title-pest">Pest</span>
              <span className="topbar__title-loop">Loop</span>
            </h1>
          </div>
          <p className="topbar__sub">
            Recurring pest violations at your multifamily accounts — Bronx HPD records,{' '}
            {meta.since} to {meta.dataAsOf}.
          </p>
        </div>
        <div className="topbar__stats">
          <span>{buildings.length.toLocaleString()} buildings</span>
          <span>{meta.sourceRows.toLocaleString()} violations</span>
          <span>repeat window {meta.minRepeatGapDays}–{meta.recurrenceWindowDays} days</span>
        </div>
      </header>

      <nav className="tabs">
        {/* Switching tabs clears the open building — otherwise a card from the
            other view lingers under unrelated content. */}
        <button
          type="button"
          className={`tab${tab === 'search' ? ' tab--on' : ''}`}
          onClick={() => { setTab('search'); setSelected(null); }}
        >
          Look up one building
        </button>
        <button
          type="button"
          className={`tab${tab === 'clients' ? ' tab--on' : ''}`}
          onClick={() => { setTab('clients'); setSelected(null); }}
        >
          Review a client list
        </button>
      </nav>

      <main className="main">
        {tab === 'search' ? (
          <AddressSearch index={index} meta={meta} onSelect={(b) => select(b)} />
        ) : (
          <ClientList index={index} meta={meta} onSelect={select} selectedBuildingId={selected?.building?.id} />
        )}

        {selected ? (
          <BuildingCard
            rootRef={detailRef}
            building={selected.building}
            clientName={selected.clientName}
            meta={meta}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </main>

      <footer className="foot">
        Source: NYC HPD Housing Maintenance Code Violations (<code>{meta.dataset}</code>), pulled{' '}
        {new Date(meta.generatedAt).toLocaleDateString()}. Static snapshot — the app makes no live API calls.
        Public records describe past inspections and do not establish a building's current condition.
      </footer>
    </div>
  );
}
