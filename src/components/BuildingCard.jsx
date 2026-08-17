/**
 * Single-building summary. Reached from the address search, or by clicking a
 * row in the client table. Phase 3 replaces this with the full timeline view;
 * for now it shows the same underlying numbers without the violation history.
 */

import { statsOf, formatRate, formatDate, pestSummary, displayAddress } from '../lib/format.js';
import { ADMIN_MEANING, RepeatCaveat } from './Caveat.jsx';

function Metric({ label, value, hint, muted }) {
  return (
    <div className={`metric${muted ? ' metric--muted' : ''}`}>
      <div className="metric__value">{value}</div>
      <div className="metric__label">{label}</div>
      {hint ? <div className="metric__hint">{hint}</div> : null}
    </div>
  );
}

export default function BuildingCard({ building, meta, clientName, onClose }) {
  const floor = meta?.volumeFloor ?? 8;
  const phys = statsOf(building, 'physical', floor);
  const admin = statsOf(building, 'administrative', floor);

  return (
    <section className="card">
      <header className="card__head">
        <div>
          {clientName ? <div className="card__client">{clientName}</div> : null}
          <h2 className="card__title">{displayAddress(building.address)}</h2>
          <div className="card__sub">
            Building ID {building.id}
            {building.zip ? ` · ZIP ${building.zip}` : ''}
            {building.nta ? ` · ${building.nta}` : ''}
          </div>
          {building.addressVariants?.length ? (
            <div className="card__sub">
              Also recorded as: {building.addressVariants.map(displayAddress).join('; ')}
            </div>
          ) : null}
        </div>
        {onClose ? (
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        ) : null}
      </header>

      <h3 className="card__section">Physical pest violations</h3>
      {phys.total === 0 ? (
        <p className="empty">
          No physical pest violations recorded for this building since {meta?.since ?? '2021'}.
        </p>
      ) : (
        <>
          <div className="metrics">
            <Metric label="Pest violations recorded" value={phys.total} hint={pestSummary(phys)} />
            <Metric
              label="Cases with enough follow-up to classify"
              value={phys.classifiable}
              hint={`${phys.censored} closed too recently to judge`}
            />
            <Metric label="Followed by a repeat" value={phys.repeats} hint={`across ${phys.unitsWithRepeat} apartment${phys.unitsWithRepeat === 1 ? '' : 's'}`} />
            <Metric
              label="Repeat rate"
              value={phys.lowConfidence ? 'n/a' : formatRate(phys.repeatRate)}
              hint={phys.lowConfidence ? `below the ${floor}-case reliability floor` : `${phys.repeats} of ${phys.classifiable} cases`}
              muted={phys.lowConfidence}
            />
            <Metric label="Most recent repeat" value={formatDate(phys.lastRepeat)} />
            <Metric label="Apartments cited" value={phys.unitsCited} />
          </div>

          {phys.lowConfidence && phys.classifiable > 0 ? (
            <p className="caveat caveat--warn">
              <strong>Not enough data to rank.</strong> This building has {phys.classifiable} classifiable
              case{phys.classifiable === 1 ? '' : 's'}, below the {floor}-case floor. The underlying counts are
              real, but a rate drawn from this few cases is not a reliable comparison against other accounts.
            </p>
          ) : null}

          {phys.recitedOnly > 0 ? (
            <p className="caveat">
              <strong>{phys.recitedOnly} case{phys.recitedOnly === 1 ? ' was' : 's were'} re-cited within 30 days
              of closing.</strong> Counted separately from repeats — at that interval the record reads as a
              condition that never cleared rather than one that came back.
            </p>
          ) : null}

          <RepeatCaveat />
        </>
      )}

      <h3 className="card__section">Administrative records (tracked separately)</h3>
      {admin.total === 0 ? (
        <p className="empty">No bedbug filing or posting records for this building.</p>
      ) : (
        <div className="metrics metrics--admin">
          <Metric label="Filing / posting records" value={admin.total} />
          <Metric label="Most recent" value={formatDate(admin.lastViolation)} />
        </div>
      )}
      <p className="caveat">{ADMIN_MEANING}</p>
    </section>
  );
}
