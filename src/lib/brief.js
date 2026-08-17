/**
 * PestLoop — renewal brief generator.
 *
 * Deterministic template, not AI-drafted: every sentence is built directly
 * from the same structured stats already shown in the table and detail view
 * (statsOf / priorityOf / concentrationOf), so there is no generation step to
 * audit and no claim that can't be traced back to a specific field.
 *
 * Six account states get genuinely different prose, not one template with
 * numbers swapped in — a clean building must never read as alarming, and a
 * below-floor building must never be handed a rate it can't support.
 */

import { statsOf, formatDate, displayAddress, PEST_LABELS } from './format.js';
import { priorityOf, concentrationOf, monthsSince } from './ranking.js';
import { REPEAT_MEANING, REPEAT_LIMITS, ADMIN_MEANING } from '../components/Caveat.jsx';

const wasWere = (n) => (n === 1 ? 'was' : 'were');
const plural = (n, word, pluralForm = `${word}s`) => (n === 1 ? word : pluralForm);

/** "roach", "roach and mice", "roach, mice, and bedbug" — reads as prose, not a table cell. */
function pestPhrase(stats) {
  const entries = Object.entries(stats.byPest ?? {})
    .filter(([, v]) => (v.total ?? 0) > 0)
    .sort((a, b) => (b[1].total ?? 0) - (a[1].total ?? 0))
    .map(([pest]) => (PEST_LABELS[pest] ?? pest).toLowerCase());

  if (entries.length === 0) return 'pest';
  if (entries.length === 1) return entries[0];
  if (entries.length === 2) return `${entries[0]} and ${entries[1]}`;
  return `${entries.slice(0, -1).join(', ')}, and ${entries.at(-1)}`;
}

function recencyPhrase(lastDate, asOf) {
  const months = monthsSince(lastDate, asOf);
  if (months <= 1) return 'within the last month';
  if (months <= 12) return 'within the last year';
  if (months <= 24) return 'one to two years ago';
  return 'more than two years ago';
}

export function generateBrief({ building, clientName, meta }) {
  const floor = meta?.volumeFloor ?? 8;
  const asOf = meta?.dataAsOf;
  const since = meta?.since ?? '2021-01-01';
  const phys = statsOf(building, 'physical', floor);
  const admin = statsOf(building, 'administrative', floor);
  const rank = priorityOf(phys, { floor, asOf });
  const conc = concentrationOf(phys);

  const header = clientName ? `${clientName} — ${displayAddress(building.address)}` : displayAddress(building.address);
  const pestWord = pestPhrase(phys);

  let body;
  if (phys.total === 0 && admin.total > 0) {
    body =
      `HPD's records for this building show ${admin.total} bedbug filing or posting ${plural(admin.total, 'record')} ` +
      `but no physical pest violations since ${formatDate(since)}. ${ADMIN_MEANING}`;
  } else if (phys.total === 0) {
    body = `No pest violations of any kind are on file for this building since ${formatDate(since)}.`;
  } else if (phys.classifiable === 0) {
    body =
      `${phys.total} ${pestWord} ${plural(phys.total, 'violation')} ${wasWere(phys.total)} recorded at this building, ` +
      `but none have both a certified correction and enough elapsed time to classify for recurrence yet. There's a ` +
      `violation count here, not yet a repeat signal — this tool deliberately doesn't rank on count alone.`;
  } else if (rank.status === 'insufficient') {
    body =
      `Only ${phys.classifiable} closed ${pestWord} ${plural(phys.classifiable, 'case')} at this building ${wasWere(phys.classifiable)} ` +
      `open long enough to classify — below the ${floor}-case threshold this tool uses before treating a rate as reliable. ` +
      `${phys.repeats} of ${phys.classifiable} ${wasWere(phys.repeats)} followed by a repeat in the same apartment. With this ` +
      `few cases, that isn't a stable number to compare against other accounts — a data point to watch, not a conclusion.`;
  } else if (phys.repeats === 0) {
    body =
      `${phys.classifiable} closed ${pestWord} ${plural(phys.classifiable, 'case')} at this building had enough follow-up ` +
      `time to classify, and none were followed by another violation of the same type in the same apartment within a ` +
      `year${asOf ? ` (as of ${formatDate(asOf)})` : ''}. There's no recurrence pattern here at this time.`;
  } else {
    const pct = Math.round(phys.repeatRate * 100);
    const spanPhrase =
      conc.key === 'single' ? 'all in the same apartment' : `across ${phys.unitsWithRepeat} different apartments`;
    body =
      `${phys.classifiable} closed ${pestWord} ${plural(phys.classifiable, 'case')} at this building had enough follow-up ` +
      `time to classify. ${phys.repeats} ${wasWere(phys.repeats)} followed by another violation of the same type in the ` +
      `same apartment within a year — a repeat rate of ${pct}%, ${spanPhrase}. The most recent repeat was on ` +
      `${formatDate(phys.lastRepeat)}, ${recencyPhrase(phys.lastRepeat, asOf)}.`;
  }

  const parts = [header, body];

  // The standing repeat caveat only makes sense to append when a repeat is
  // actually being discussed — for clean/below-floor/no-data states the body
  // text above already says the honest thing, and bolting on "here's what a
  // repeat means" when there isn't one reads as defensive filler.
  if (phys.repeats > 0) parts.push(`${REPEAT_MEANING} ${REPEAT_LIMITS}`);

  if (admin.total > 0 && phys.total > 0) {
    parts.push(
      `Separately, HPD also has ${admin.total} bedbug filing or posting ${plural(admin.total, 'record')} on file for ` +
        `this building. ${ADMIN_MEANING}`,
    );
  }

  return parts.join('\n\n');
}

/** A filesystem-safe filename for the downloaded brief, e.g. "pestloop-brief-riverside-property-group.txt". */
export function briefFilename({ building, clientName }, extension) {
  const base = clientName || building.address || `building-${building.id}`;
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `pestloop-brief-${slug || building.id}.${extension}`;
}
