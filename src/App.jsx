import { useEffect, useState } from 'react';
import { loadData } from './lib/data.js';
import AddressSearch from './components/AddressSearch.jsx';
import ClientList from './components/ClientList.jsx';
import BuildingCard from './components/BuildingCard.jsx';

export default function App() {
  const [state, setState] = useState({ status: 'loading' });
  const [tab, setTab] = useState('search');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    loadData()
      .then(({ buildings, meta, index }) => setState({ status: 'ready', buildings, meta, index }))
      .catch((err) => setState({ status: 'error', message: err.message }));
  }, []);

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
          <h1 className="topbar__title">PestLoop</h1>
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
          <ClientList index={index} meta={meta} onSelect={select} />
        )}

        {selected ? (
          <BuildingCard
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
