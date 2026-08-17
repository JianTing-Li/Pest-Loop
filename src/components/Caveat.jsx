/**
 * The epistemic caution that must accompany every display of recurrence data.
 * Centralized so it cannot drift between the search view, the table, and the
 * eventual renewal brief.
 */

export const REPEAT_MEANING =
  'A repeat means the same apartment in this building was cited for the same violation code again, ' +
  'between 30 and 365 days after the earlier case was certified corrected.';

export const REPEAT_LIMITS =
  'It does not prove earlier treatment failed. Re-infestation spreads from adjacent units, occupants ' +
  'change, and building-wide sources are common. Treat it as a prompt to investigate, not a conclusion.';

export const ADMIN_MEANING =
  'Bedbug filing, posting and notice records are statutory paperwork. They recur on an annual schedule ' +
  'by design and are not evidence of an unresolved pest problem — they are kept out of the physical signal entirely.';

export function Caveat({ children, tone = 'note' }) {
  return <p className={`caveat caveat--${tone}`}>{children}</p>;
}

export function RepeatCaveat() {
  return (
    <Caveat>
      <strong>What a repeat is.</strong> {REPEAT_MEANING} {REPEAT_LIMITS}
    </Caveat>
  );
}
