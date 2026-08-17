/**
 * PestLoop — build-time data pipeline.
 *
 * SECURITY: this file runs under Node only (`node scripts/fetch-data.js`).
 * It is never imported by the React app and never bundled by Vite. It is the
 * ONLY place SOCRATA_APP_TOKEN is read. Its output is static JSON in
 * public/data/, which is all the browser ever sees.
 *
 * Usage:
 *   node scripts/fetch-data.js --probe     Cheap metadata + count probe, no bulk pull
 *   node scripts/fetch-data.js             Full pull (uses .cache/ if present), then aggregate
 *   node scripts/fetch-data.js --refresh   Force a fresh pull, ignoring cache
 *   node scripts/fetch-data.js --offline   Aggregate from cache only, never hit the network
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ALL_ORDER_NUMBERS,
  PHYSICAL_ORDER_NUMBERS,
  ADMINISTRATIVE_ORDER_NUMBERS,
  categoryOf,
  codeInfo,
} from './violation-codes.js';
import { matchKeysFor, normalizeStreet, normalizeHouseNumber } from '../shared/address.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = path.join(ROOT, '.cache');
const OUT_DIR = path.join(ROOT, 'public', 'data');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DATASET = 'wvxf-dwi5';
const RESOURCE_URL = `https://data.cityofnewyork.us/resource/${DATASET}.json`;
const METADATA_URL = `https://data.cityofnewyork.us/api/views/${DATASET}.json`;

const BORO = 'BRONX';
const SINCE = '2021-01-01T00:00:00'; // 5-year lookback: ~4 usable years of closes after censoring
const PAGE_LIMIT = 50000;

/** Columns the pipeline needs. `zip` is optional — added only if the dataset has it. */
const BASE_COLUMNS = [
  'violationid',
  'buildingid',
  'registrationid',
  'boro',
  'class',
  'inspectiondate',
  'certifieddate',
  'ordernumber',
  'novdescription',
  'currentstatus',
  'currentstatusdate',
  'violationstatus',
  'nta',
  'housenumber',
  'streetname',
];
const OPTIONAL_COLUMNS = ['zip', 'postcode'];

const DAY_MS = 86400000;
const RECURRENCE_WINDOW_DAYS = 365;

/**
 * Minimum gap between a certified close and the next citation for it to count
 * as a recurrence. 26.7% of raw repeats landed within 30 days of the close
 * (7.8% within a week) — at that distance it is almost certainly the same
 * unresolved condition being re-cited, not a problem that came back after
 * treatment. Calling those "repeats" in a renewal brief would be an overclaim.
 *
 * They are not discarded: a case with only a sub-threshold follow-up is counted
 * as `recitedOnly`, which is arguably the stronger talking point — the record
 * suggests the condition never cleared in the first place.
 */
const MIN_REPEAT_GAP_DAYS = 30;
const VOLUME_FLOOR = 8; // min classifiable closed cases before a rate is treated as reliable

/**
 * Strict "classifiable closed case" definition — the repeat-rate denominator.
 *
 * A case counts only when violationstatus='Close' AND certifieddate is present:
 * the owner attested the condition was corrected on a specific date. This is
 * deliberately label-agnostic, because the probe showed the terminal labels do
 * NOT rank the way you'd guess — VIOLATION DISMISSED carries a certification
 * 52.2% of the time vs 46.7% for VIOLATION CLOSED, so "dismissed" is a normal
 * terminal state, not a thrown-out one. Excluding it would have discarded ~100k
 * records for no reason.
 *
 * The rule self-validates: FALSE CERTIFICATION and INVALID CERTIFICATION
 * records remain violationstatus='Open', so rejected certifications never enter
 * the denominator.
 *
 * Closed-but-uncertified records (~half of all closes) left the books without a
 * recorded correction, so a later repeat says nothing about whether treatment
 * worked. Tracked separately as `closedUncertified`, never counted.
 */
const NON_CORRECTIVE_STATUS = /FALSE CERT|INVALID|NO ACCESS/i;

/**
 * Recurrence unit.
 *
 * Physical violations recur at the APARTMENT level: HPD writes pest violations
 * per unit, and the description carries the unit ("...LOCATED AT APT 3E, 4th
 * STORY"). Keying recurrence on building alone made the metric ~82% positive
 * and monotonically increasing with violation volume — in a building with any
 * steady violation flow, something always lands within 365 days of a close, so
 * the rate collapsed into a proxy for building size. Keying on the apartment
 * removes that artifact (overall rate 35%, real spread above the volume floor)
 * and makes the claim more specific: the same unit was cited again for the same
 * pest within a year of a certified correction.
 *
 * Administrative filings have no apartment — they are building-wide statutory
 * requirements — so they stay keyed on building + code. Those recur on schedule
 * by design, which is precisely why they never touch the physical signal.
 */
const APARTMENT_PATTERN = /LOCATED AT\s+APT\.?\s*([^,]+?)\s*(?:,|$)/i;

function parseApartment(description) {
  const m = APARTMENT_PATTERN.exec(description ?? '');
  if (!m) return null;
  const apt = m[1].toUpperCase().replace(/[^A-Z0-9]/g, '');
  return apt || null;
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
const log = (...a) => console.log(...a);

function loadToken() {
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
  const token = process.env.SOCRATA_APP_TOKEN;
  if (!token) {
    console.error('Missing SOCRATA_APP_TOKEN (.env or environment). Aborting.');
    process.exit(1);
  }
  return token; // never logged, never written to any output
}

async function socrata(url, token, attempt = 0) {
  const res = await fetch(url, {
    headers: {
      'X-App-Token': token, // header, not query string — keeps it out of URLs and logs
      'Accept-Encoding': 'gzip',
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (attempt < 3 && (res.status >= 500 || res.status === 429)) {
      const wait = 1500 * 2 ** attempt;
      log(`  ! HTTP ${res.status}, retrying in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      return socrata(url, token, attempt + 1);
    }
    throw new Error(`HTTP ${res.status} — ${body.slice(0, 400)}`);
  }
  return res.json();
}

function buildUrl(params) {
  const u = new URL(RESOURCE_URL);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

const inList = (codes) => `ordernumber in (${codes.map((c) => `'${c}'`).join(',')})`;
const baseWhere = () => `boro='${BORO}' AND inspectiondate >= '${SINCE}' AND ${inList(ALL_ORDER_NUMBERS)}`;

const toDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
const daysBetween = (a, b) => Math.round((b - a) / DAY_MS);
const iso = (d) => (d ? d.toISOString().slice(0, 10) : null);

// ---------------------------------------------------------------------------
// Probe — cheap sanity check before committing to the bulk pull
// ---------------------------------------------------------------------------

async function probe(token) {
  log(`\nPestLoop probe — ${DATASET}, boro=${BORO}, inspectiondate >= ${SINCE.slice(0, 10)}\n`);

  const meta = await socrata(METADATA_URL, token);
  const columns = new Set((meta.columns ?? []).map((c) => c.fieldName));
  const missing = BASE_COLUMNS.filter((c) => !columns.has(c));
  const optional = OPTIONAL_COLUMNS.filter((c) => columns.has(c));
  log(`Columns required : ${missing.length ? `MISSING -> ${missing.join(', ')}` : 'all present'}`);
  log(`Columns optional : ${optional.length ? optional.join(', ') : 'none of zip/postcode available'}`);

  const counts = await socrata(
    buildUrl({
      $select: 'ordernumber, count(violationid) AS n',
      $where: baseWhere(),
      $group: 'ordernumber',
      $order: 'ordernumber',
    }),
    token,
  );

  log(`\nRow counts by ordernumber:`);
  let total = 0;
  const seen = new Set();
  for (const row of counts.sort((a, b) => Number(b.n) - Number(a.n))) {
    const info = codeInfo(row.ordernumber);
    const cat = categoryOf(row.ordernumber);
    total += Number(row.n);
    seen.add(String(row.ordernumber));
    log(
      `  ${String(row.ordernumber).padEnd(6)} ${String(row.n).padStart(8)}  ` +
        `${cat === 'physical' ? 'PHYS' : 'ADMIN'}  ${info?.label ?? '?'}`,
    );
  }
  const absent = ALL_ORDER_NUMBERS.filter((c) => !seen.has(c));
  if (absent.length) log(`  !! codes returning ZERO rows: ${absent.join(', ')}`);
  log(`  ${'TOTAL'.padEnd(6)} ${String(total).padStart(8)}`);

  const statuses = await socrata(
    buildUrl({
      $select: 'violationstatus, currentstatus, count(violationid) AS n',
      $where: baseWhere(),
      $group: 'violationstatus, currentstatus',
    }),
    token,
  );

  log(`\nStatus distribution (drives the strict "classifiable closed case" rule):`);
  for (const row of statuses.sort((a, b) => Number(b.n) - Number(a.n))) {
    const vs = row.violationstatus ?? '(null)';
    const cs = row.currentstatus ?? '(null)';
    const verdict =
      vs !== 'Close' ? 'open/other' : NON_CORRECTIVE_STATUS.test(cs) ? 'EXCLUDED' : 'counts';
    log(`  ${String(row.n).padStart(8)}  ${vs.padEnd(6)} ${cs.padEnd(46)} ${verdict}`);
  }
  // Does a terminal status actually carry an owner certification of correction?
  // This is what separates "left the books because it was fixed" from "left the
  // books for some other reason", and it decides the repeat-rate denominator.
  const certified = await socrata(
    buildUrl({
      $select: 'currentstatus, count(violationid) AS n',
      $where: `${baseWhere()} AND violationstatus='Close' AND certifieddate IS NOT NULL`,
      $group: 'currentstatus',
    }),
    token,
  );
  const closed = await socrata(
    buildUrl({
      $select: 'currentstatus, count(violationid) AS n',
      $where: `${baseWhere()} AND violationstatus='Close'`,
      $group: 'currentstatus',
    }),
    token,
  );

  const certMap = new Map(certified.map((r) => [r.currentstatus, Number(r.n)]));
  log(`\nClosed records carrying a certifieddate (owner certified the condition corrected):`);
  for (const row of closed.sort((a, b) => Number(b.n) - Number(a.n))) {
    const total = Number(row.n);
    const withCert = certMap.get(row.currentstatus) ?? 0;
    log(
      `  ${String(row.currentstatus).padEnd(40)} ${String(withCert).padStart(7)} / ${String(total).padStart(7)}` +
        `  (${((withCert / total) * 100).toFixed(1)}% certified)`,
    );
  }
  log('');
  return { optional };
}

// ---------------------------------------------------------------------------
// Bulk pull — keyset pagination
// ---------------------------------------------------------------------------

function cachePath() {
  return path.join(CACHE_DIR, `bronx-pest-${SINCE.slice(0, 10)}.ndjson`);
}

async function detectOptionalColumns(token) {
  try {
    const meta = await socrata(METADATA_URL, token);
    const columns = new Set((meta.columns ?? []).map((c) => c.fieldName));
    return OPTIONAL_COLUMNS.filter((c) => columns.has(c));
  } catch {
    return [];
  }
}

async function pull(token) {
  const optional = await detectOptionalColumns(token);
  const select = [...BASE_COLUMNS, ...optional].join(', ');
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const out = fs.createWriteStream(cachePath());
  let cursor = null;
  let total = 0;
  let page = 0;

  log(`\nPulling ${BORO} pest violations since ${SINCE.slice(0, 10)} …`);
  while (true) {
    // `violationid` is a TEXT column, so $order and the cursor comparison are
    // both lexicographic — consistent with each other, which is all keyset
    // pagination requires. Offset paging degrades badly at this row count.
    const where = cursor ? `${baseWhere()} AND violationid > '${cursor}'` : baseWhere();
    const rows = await socrata(
      buildUrl({ $select: select, $where: where, $order: 'violationid', $limit: PAGE_LIMIT }),
      token,
    );
    if (rows.length === 0) break;

    for (const row of rows) out.write(JSON.stringify(row) + '\n');
    total += rows.length;
    page += 1;
    cursor = rows[rows.length - 1].violationid;
    log(`  page ${page}: +${rows.length} (total ${total})`);
    if (rows.length < PAGE_LIMIT) break;
  }

  await new Promise((r) => out.end(r));
  fs.writeFileSync(
    cachePath().replace('.ndjson', '.meta.json'),
    JSON.stringify({ fetchedAt: new Date().toISOString(), rows: total, since: SINCE, columns: select }, null, 2),
  );
  log(`Cached ${total} rows -> ${path.relative(ROOT, cachePath())}\n`);
  return total;
}

function readCache() {
  const file = cachePath();
  if (!fs.existsSync(file)) return null;
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim()) rows.push(JSON.parse(line));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Aggregation — all analysis happens here, never in the browser
// ---------------------------------------------------------------------------

function prepare(raw) {
  const rows = [];
  for (const r of raw) {
    const category = categoryOf(r.ordernumber);
    if (!category) continue; // defensive: server-side filter should already exclude these
    const inspection = toDate(r.inspectiondate);
    if (!inspection || !r.buildingid) continue;

    const certified = toDate(r.certifieddate);
    const statusDate = toDate(r.currentstatusdate);
    const isClosed = String(r.violationstatus ?? '').toLowerCase() === 'close';

    // Effective close date, used for display and the Phase 3 timeline:
    // certifieddate when present, else currentstatusdate on a closed record.
    const closeDate = certified ?? (isClosed ? statusDate : null);

    // The stricter date the recurrence math runs off: a certified correction.
    const corrective = isClosed && !!certified && !NON_CORRECTIVE_STATUS.test(r.currentstatus ?? '');

    rows.push({
      vid: String(r.violationid),
      bid: String(r.buildingid),
      rid: r.registrationid ? String(r.registrationid) : null,
      code: String(r.ordernumber),
      category,
      pest: codeInfo(r.ordernumber).pest,
      cls: r.class ?? null,
      apt: category === 'physical' ? parseApartment(r.novdescription) : null,
      inspection,
      closeDate,
      correctiveClose: corrective ? certified : null,
      closed: isClosed,
      corrective,
      status: r.currentstatus ?? null,
      vstatus: r.violationstatus ?? null,
      nta: r.nta ?? null,
      house: r.housenumber ?? '',
      street: r.streetname ?? '',
      zip: r.zip ?? r.postcode ?? null,
    });
  }
  return rows;
}

/**
 * Classify every corrective-closed case as repeated / not-repeated / censored,
 * and attach the matching repeat when there is one.
 */
function classifyRecurrence(rows, dataAsOf) {
  // Physical: same apartment + same code. Administrative: same building + code.
  const groups = new Map();
  for (const row of rows) {
    if (row.category === 'physical' && !row.apt) {
      // ~5% of physical records have an unparseable unit token. They still count
      // toward totals, but cannot be assigned to a unit, so they can never enter
      // a repeat-rate denominator.
      row.state = 'unlocatable';
      row.repeat = null;
      continue;
    }
    const key =
      row.category === 'physical' ? `${row.bid}::${row.apt}::${row.code}` : `${row.bid}::${row.code}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  for (const group of groups.values()) {
    group.sort((a, b) => a.inspection - b.inspection);

    for (const c of group) {
      // Distinguish genuinely-open from closed-without-certification, so the
      // timeline never labels a closed violation "open".
      c.state = c.closed ? 'uncertified' : 'open';
      c.repeat = null;

      if (!c.corrective || !c.correctiveClose) continue;

      const close = c.correctiveClose.getTime();
      const windowEnd = close + RECURRENCE_WINDOW_DAYS * DAY_MS;
      // Strictly AFTER the close: a violation opened while the first was still
      // outstanding is a concurrent condition, not a recurrence.
      const followUps = group
        .filter(
          (v) => v.vid !== c.vid && v.inspection.getTime() > close && v.inspection.getTime() <= windowEnd,
        )
        .map((v) => ({ vid: v.vid, date: iso(v.inspection), gapDays: daysBetween(c.correctiveClose, v.inspection) }));

      const repeat = followUps.find((f) => f.gapDays >= MIN_REPEAT_GAP_DAYS);
      const recited = followUps.find((f) => f.gapDays < MIN_REPEAT_GAP_DAYS);

      if (repeat) {
        // An observed repeat is never censored — we saw the event.
        c.state = 'classifiable';
        c.repeat = repeat;
        if (recited) c.recited = recited;
      } else if (daysBetween(c.correctiveClose, dataAsOf) >= RECURRENCE_WINDOW_DAYS) {
        // Full follow-up elapsed with no qualifying repeat. If the only thing
        // that followed was a near-immediate re-citation, say so explicitly.
        if (recited) c.recited = recited;
        c.state = 'classifiable';
      } else {
        // Closed too recently to know either way. Tracked, never counted as
        // "no recurrence" — that would quietly flatter recent performance.
        c.state = 'censored';
      }
    }
  }
}

function emptyStats() {
  return {
    total: 0,
    open: 0,
    closedUncertified: 0,
    censored: 0,
    unlocatable: 0,
    classifiable: 0,
    repeats: 0,
    recitedOnly: 0,
    repeatRate: null,
    lastRepeat: null,
    lastViolation: null,
    byPest: {},
    _units: new Set(),
    _repeatUnits: new Set(),
  };
}

function tallyInto(stats, row) {
  stats.total += 1;
  if (!stats.lastViolation || row.inspection > new Date(stats.lastViolation)) {
    stats.lastViolation = iso(row.inspection);
  }

  if (!stats.byPest[row.pest]) stats.byPest[row.pest] = { total: 0, classifiable: 0, repeats: 0 };
  const pest = stats.byPest[row.pest];
  pest.total += 1;

  if (row.apt) stats._units.add(row.apt);

  if (row.state === 'unlocatable') stats.unlocatable += 1;
  else if (row.state === 'censored') stats.censored += 1;
  else if (row.state === 'classifiable') {
    stats.classifiable += 1;
    pest.classifiable += 1;
    if (row.repeat) {
      stats.repeats += 1;
      pest.repeats += 1;
      if (row.apt) stats._repeatUnits.add(row.apt);
      if (!stats.lastRepeat || row.repeat.date > stats.lastRepeat) stats.lastRepeat = row.repeat.date;
    } else if (row.recited) {
      // Closed, then re-cited almost immediately, and nothing further within the
      // year: reads as a condition that never cleared rather than one that returned.
      stats.recitedOnly += 1;
    }
  } else if (row.closed) stats.closedUncertified += 1;
  else stats.open += 1;
}

function finalize(stats) {
  stats.repeatRate = stats.classifiable > 0 ? stats.repeats / stats.classifiable : null;
  stats.lowConfidence = stats.classifiable < VOLUME_FLOOR;
  // Distinct units give the brief a second, independent way to describe scale:
  // "4 repeats across 3 different apartments" reads very differently from
  // "4 repeats all in one apartment".
  stats.unitsCited = stats._units.size;
  stats.unitsWithRepeat = stats._repeatUnits.size;
  delete stats._units;
  delete stats._repeatUnits;
  return stats;
}

function aggregate(rows) {
  const buildings = new Map();

  for (const row of rows) {
    if (!buildings.has(row.bid)) {
      buildings.set(row.bid, {
        id: row.bid,
        registrationIds: new Set(),
        addresses: new Map(), // "house|street" -> {house, street, count}
        zips: new Map(),
        nta: row.nta,
        physical: emptyStats(),
        administrative: emptyStats(),
      });
    }
    const b = buildings.get(row.bid);
    if (row.rid) b.registrationIds.add(row.rid);
    if (!b.nta && row.nta) b.nta = row.nta;

    // Every address spelling HPD has used for this building becomes a search key.
    const addrKey = `${normalizeHouseNumber(row.house)}|${normalizeStreet(row.street)}`;
    if (row.house && row.street) {
      const entry = b.addresses.get(addrKey) ?? { house: row.house, street: row.street, count: 0 };
      entry.count += 1;
      b.addresses.set(addrKey, entry);
    }
    if (row.zip) b.zips.set(row.zip, (b.zips.get(row.zip) ?? 0) + 1);

    tallyInto(row.category === 'physical' ? b.physical : b.administrative, row);
  }

  const out = [];
  for (const b of buildings.values()) {
    const variants = [...b.addresses.values()].sort((x, y) => y.count - x.count);
    const canonical = variants[0] ?? { house: '', street: '' };
    const keys = new Set();
    for (const v of variants) for (const k of matchKeysFor(v.house, v.street)) keys.add(k);
    const zip = [...b.zips.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;

    out.push({
      id: b.id,
      house: canonical.house,
      street: canonical.street,
      address: `${canonical.house} ${canonical.street}`.trim(),
      zip,
      nta: b.nta,
      registrationIds: [...b.registrationIds],
      matchKeys: [...keys],
      addressVariants: variants.slice(1).map((v) => `${v.house} ${v.street}`),
      physical: finalize(b.physical),
      administrative: finalize(b.administrative),
    });
  }

  out.sort((a, b) => b.physical.repeats - a.physical.repeats || b.physical.total - a.physical.total);
  return out;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/** Drop zero/null/empty members. Halves the file; the app fills defaults back in. */
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === 0 || v === false) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = compact(v);
      if (Object.keys(inner).length === 0) continue;
      out[k] = inner;
      continue;
    }
    out[k] = v;
  }
  return out;
}

function writeOutputs(buildings, rows, dataAsOf, sourceRowCount, alwaysInclude) {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const write = (name, data) => {
    const file = path.join(OUT_DIR, name);
    fs.writeFileSync(file, JSON.stringify(data));
    const kb = (fs.statSync(file).size / 1024).toFixed(0);
    log(`  ${name.padEnd(26)} ${String(kb).padStart(7)} KB`);
    return file;
  };

  log('\nWriting static data:');
  write(
    'buildings.json',
    buildings.map((b) =>
      compact({
        id: b.id,
        address: b.address,
        zip: b.zip,
        nta: b.nta,
        matchKeys: b.matchKeys,
        addressVariants: b.addressVariants,
        physical: b.physical,
        administrative: b.administrative,
      }),
    ),
  );

  // Timeline records only for buildings with a recurrence pair — nobody opens a
  // timeline for a building with no repeats, and this is where the size lives.
  // Demo buildings are always included so the sample never dead-ends.
  const keep = new Set(
    buildings.filter((b) => b.physical.repeats > 0 || b.administrative.repeats > 0).map((b) => b.id),
  );
  for (const id of alwaysInclude) keep.add(id);

  // One file per building rather than a single blob. The ranked table needs no
  // timeline data at all, and the detail view then fetches only the building it
  // opened (~5-50 KB) instead of pulling 20+ MB to show one page.
  const timeline = {};
  for (const r of rows) {
    if (!keep.has(r.bid)) continue;
    (timeline[r.bid] ??= []).push(
      compact({
        vid: r.vid,
        code: r.code,
        cat: r.category,
        pest: r.pest,
        cls: r.cls,
        apt: r.apt,
        insp: iso(r.inspection),
        close: iso(r.closeDate),
        status: r.status,
        open: !r.closed,
        state: r.state,
        repeat: r.repeat,
        recited: r.recited,
      }),
    );
  }
  const timelineDir = path.join(OUT_DIR, 'timelines');
  fs.rmSync(timelineDir, { recursive: true, force: true });
  fs.mkdirSync(timelineDir, { recursive: true });
  let timelineBytes = 0;
  let timelineRows = 0;
  for (const [bid, list] of Object.entries(timeline)) {
    list.sort((a, b) => a.insp.localeCompare(b.insp));
    const json = JSON.stringify(list);
    fs.writeFileSync(path.join(timelineDir, `${bid}.json`), json);
    timelineBytes += json.length;
    timelineRows += list.length;
  }
  log(
    `  ${'timelines/*.json'.padEnd(26)} ${String((timelineBytes / 1024).toFixed(0)).padStart(7)} KB ` +
      `across ${Object.keys(timeline).length} files (${timelineRows} rows)`,
  );

  // Remove the single-blob output from earlier runs of this script.
  fs.rmSync(path.join(OUT_DIR, 'violations.json'), { force: true });

  write('meta.json', {
    dataset: DATASET,
    boro: BORO,
    since: SINCE.slice(0, 10),
    dataAsOf: iso(dataAsOf),
    generatedAt: new Date().toISOString(),
    sourceRows: sourceRowCount,
    buildings: buildings.length,
    timelineBuildings: Object.keys(timeline).length,
    recurrenceUnit: 'physical: building + apartment + ordernumber; administrative: building + ordernumber',
    recurrenceWindowDays: RECURRENCE_WINDOW_DAYS,
    minRepeatGapDays: MIN_REPEAT_GAP_DAYS,
    volumeFloor: VOLUME_FLOOR,
    classificationRule:
      "A case enters the repeat-rate denominator only when violationstatus='Close' and " +
      'certifieddate is present (owner certified the condition corrected). Closed records ' +
      'without a certification are tracked as closedUncertified and never counted. A physical ' +
      'case is a repeat when another violation with the same ordernumber was recorded for the ' +
      'SAME APARTMENT in that building, inspected at least 30 and at most 365 days after the ' +
      'close date; administrative filings carry no apartment and are matched on building alone. ' +
      'A follow-up inside 30 days is treated as the same unresolved condition being re-cited, ' +
      'not a recurrence, and is reported separately as recitedOnly. ' +
      'Cases closed under 365 days ago with no repeat yet are censored and excluded from the ' +
      'rate. Physical records whose apartment cannot be parsed (~5%) count toward totals but ' +
      'can never enter a denominator.',
    physicalCodes: PHYSICAL_ORDER_NUMBERS,
    administrativeCodes: ADMINISTRATIVE_ORDER_NUMBERS,
  });

  return { timelineBuildings: Object.keys(timeline).length };
}

// ---------------------------------------------------------------------------
// Console report — what Phase 0 is reviewed against
// ---------------------------------------------------------------------------

function report(buildings, rows, dataAsOf) {
  const pct = (v) => (v === null ? '   —' : `${(v * 100).toFixed(0)}%`.padStart(4));
  const line = (b) =>
    `  ${b.id.padEnd(8)} ${(b.address || '(no address)').slice(0, 30).padEnd(30)} ` +
    `${String(b.physical.total).padStart(5)} ${String(b.physical.classifiable).padStart(6)} ` +
    `${String(b.physical.censored).padStart(4)} ${String(b.physical.repeats).padStart(4)} ` +
    `${pct(b.physical.repeatRate)}  ${(b.physical.lastRepeat ?? '—').padEnd(10)} ` +
    `${String(b.administrative.total).padStart(5)} ${b.physical.lowConfidence ? 'LOW-CONF' : ''}`;

  const header =
    `  ${'bldgid'.padEnd(8)} ${'address'.padEnd(30)} ${'phys'.padStart(5)} ${'class'.padStart(6)} ` +
    `${'cens'.padStart(4)} ${'rept'.padStart(4)} ${'rate'.padStart(4)}  ${'last repeat'.padEnd(10)} ${'admin'.padStart(5)}`;

  const eligible = buildings.filter((b) => b.physical.classifiable >= VOLUME_FLOOR);
  const strong = [...eligible].sort((a, b) => b.physical.repeatRate - a.physical.repeatRate).slice(0, 6);
  const clean = [...eligible].sort((a, b) => a.physical.repeatRate - b.physical.repeatRate).slice(0, 4);
  const thin = buildings
    .filter((b) => b.physical.total > 0 && b.physical.classifiable > 0 && b.physical.classifiable < VOLUME_FLOOR)
    .sort((a, b) => b.physical.total - a.physical.total)
    .slice(0, 4);
  const adminOnly = buildings
    .filter((b) => b.physical.total === 0 && b.administrative.total > 0)
    .sort((a, b) => b.administrative.total - a.administrative.total)
    .slice(0, 3);

  log(`\n${'='.repeat(112)}`);
  log(`SAMPLE OUTPUT — data as of ${iso(dataAsOf)}, volume floor ${VOLUME_FLOOR} classifiable closed cases`);
  log('='.repeat(112));
  log(header);
  log(`\n  --- high recurrence, above volume floor ---`);
  strong.forEach((b) => log(line(b)));
  log(`\n  --- above volume floor, little or no recurrence ---`);
  clean.forEach((b) => log(line(b)));
  log(`\n  --- below volume floor (rate must not be ranked on) ---`);
  thin.forEach((b) => log(line(b)));
  log(`\n  --- administrative-only (filing/posting records, no physical findings) ---`);
  adminOnly.forEach((b) => log(line(b)));

  const totals = {
    buildings: buildings.length,
    aboveFloor: eligible.length,
    withAnyRepeat: buildings.filter((b) => b.physical.repeats > 0).length,
    physRows: rows.filter((r) => r.category === 'physical').length,
    adminRows: rows.filter((r) => r.category === 'administrative').length,
    classifiable: rows.filter((r) => r.state === 'classifiable').length,
    censored: rows.filter((r) => r.state === 'censored').length,
    repeated: rows.filter((r) => r.repeat).length,
    uncertified: rows.filter((r) => r.closed && !r.corrective).length,
    unlocatable: rows.filter((r) => r.state === 'unlocatable').length,
  };

  log(`\n${'-'.repeat(112)}`);
  log(`Buildings with any pest record : ${totals.buildings}`);
  log(`  above volume floor (>=${VOLUME_FLOOR})     : ${totals.aboveFloor}  (${((totals.aboveFloor / totals.buildings) * 100).toFixed(1)}%)`);
  log(`  with >=1 physical repeat      : ${totals.withAnyRepeat}`);
  log(`Violations: ${totals.physRows} physical / ${totals.adminRows} administrative`);
  log(`  classifiable closed cases     : ${totals.classifiable}`);
  log(`  censored (closed <365d, no repeat yet): ${totals.censored}`);
  log(`  closed without certification (excluded): ${totals.uncertified}`);
  log(`  physical with unparseable apartment    : ${totals.unlocatable}`);
  log(`  cases followed by a repeat    : ${totals.repeated}`);

  const dist = [1, 2, 3, 4, 5, 8, 12, 20].map((n) => ({
    n,
    count: buildings.filter((b) => b.physical.classifiable >= n).length,
  }));
  log(`\nVolume-floor sensitivity (buildings with >= N classifiable closed physical cases):`);
  for (const d of dist) {
    log(`  >= ${String(d.n).padStart(2)} : ${String(d.count).padStart(6)}  ${d.n === VOLUME_FLOOR ? '<- current floor' : ''}`);
  }
  log('');
  return totals;
}

// ---------------------------------------------------------------------------
// Demo/sample client set (Phase 1 consumes this)
// ---------------------------------------------------------------------------

const FICTIONAL_CLIENTS = [
  'Riverside Property Group', 'Kestrel Residential', 'Halstead Bay Holdings',
  'Northpoint Asset Partners', 'Grand Concourse Management', 'Alder & Vine Properties',
  'Meridian Housing Partners', 'Blue Harbor Realty Group', 'Sutton Field Management',
  'Ironwood Residential Trust', 'Larchmont Property Co', 'Copperleaf Estates',
  'Whitestone Ridge Partners', 'Marlow Street Holdings', 'Vantage Point Residential',
  'Cedarbrook Property Group', 'Fenwick Housing LLC', 'Orchard Hill Management',
  'Beacon & Pine Realty', 'Stonebridge Residential', 'Kingsley Court Partners',
  'Ravenwood Asset Management',
];

function buildSample(buildings) {
  const withAddress = buildings.filter((b) => b.address && b.matchKeys.length);
  const above = withAddress.filter((b) => b.physical.classifiable >= VOLUME_FLOOR);

  // Round-robin across case-volume bands so the demo isn't all large properties.
  // A real client list is a mix of building sizes, and picking purely by repeat
  // count would surface only the biggest buildings in every category.
  const BANDS = [[8, 15], [16, 40], [41, 100], [101, Infinity]];
  const pick = (list, n, taken) => {
    const buckets = BANDS.map(([lo, hi]) =>
      list.filter((b) => b.physical.classifiable >= lo && b.physical.classifiable <= hi),
    );
    const out = [];
    for (let round = 0; out.length < n; round += 1) {
      let progressed = false;
      for (const bucket of buckets) {
        const next = bucket.find((b) => !taken.has(b.id));
        if (!next) continue;
        progressed = true;
        taken.add(next.id);
        out.push(next);
        if (out.length >= n) break;
      }
      if (!progressed) break;
    }
    // Fall back to the raw list for groups that have no volume spread (e.g.
    // below-floor and administrative-only buildings sit outside every band).
    for (const b of list) {
      if (out.length >= n) break;
      if (taken.has(b.id)) continue;
      taken.add(b.id);
      out.push(b);
    }
    return out;
  };

  const taken = new Set();
  const strong = pick(
    [...above].filter((b) => b.physical.repeatRate >= 0.5).sort((a, b) => b.physical.repeats - a.physical.repeats),
    6, taken,
  );
  const moderate = pick(
    [...above].filter((b) => b.physical.repeatRate > 0.15 && b.physical.repeatRate < 0.5)
      .sort((a, b) => b.physical.classifiable - a.physical.classifiable),
    5, taken,
  );
  const clean = pick(
    [...above].filter((b) => b.physical.repeatRate <= 0.15).sort((a, b) => b.physical.classifiable - a.physical.classifiable),
    4, taken,
  );
  const thin = pick(
    withAddress.filter((b) => b.physical.total > 0 && b.physical.classifiable > 0 && b.physical.classifiable < VOLUME_FLOOR)
      .sort((a, b) => b.physical.classifiable - a.physical.classifiable),
    3, taken,
  );
  const adminOnly = pick(
    withAddress.filter((b) => b.physical.total === 0 && b.administrative.total > 0)
      .sort((a, b) => b.administrative.total - a.administrative.total),
    2, taken,
  );

  const groups = [
    ['strong recurrence signal', strong],
    ['moderate recurrence', moderate],
    ['above floor, little recurrence', clean],
    ['below volume floor (low-confidence flag demo)', thin],
    ['administrative records only (split demo)', adminOnly],
  ];

  const rows = [];
  let i = 0;
  for (const [profile, list] of groups) {
    for (const b of list) {
      rows.push({
        client_name: FICTIONAL_CLIENTS[i % FICTIONAL_CLIENTS.length],
        address: b.address,
        zip: b.zip ?? '',
        _profile: profile,
        _buildingId: b.id,
        _physicalClassifiable: b.physical.classifiable,
        _physicalRepeats: b.physical.repeats,
        _physicalRepeatRate: b.physical.repeatRate,
        _administrativeTotal: b.administrative.total,
      });
      i += 1;
    }
  }
  return rows;
}

function writeSample(rows) {
  const jsonPath = path.join(OUT_DIR, 'sample-clients.json');
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        note: 'SAMPLE DATA — real Bronx buildings, fictional client names. Not a real client roster.',
        clients: rows.map(({ client_name, address, zip }) => ({ client_name, address, zip })),
      },
      null,
      2,
    ),
  );

  const csv = ['client_name,address,zip']
    .concat(rows.map((r) => `"${r.client_name}","${r.address}","${r.zip}"`))
    .join('\n');
  fs.writeFileSync(path.join(OUT_DIR, 'sample-clients.csv'), csv + '\n');

  log(`\nDemo client set — ${rows.length} buildings, fictional company names on real Bronx addresses:`);
  let profile = null;
  for (const r of rows) {
    if (r._profile !== profile) {
      profile = r._profile;
      log(`\n  [${profile}]`);
    }
    const rate = r._physicalRepeatRate === null ? '—' : `${(r._physicalRepeatRate * 100).toFixed(0)}%`;
    log(
      `    ${r.client_name.padEnd(30)} ${r.address.slice(0, 28).padEnd(28)} ` +
        `class ${String(r._physicalClassifiable).padStart(3)}  repeats ${String(r._physicalRepeats).padStart(3)}  ` +
        `rate ${rate.padStart(4)}  admin ${String(r._administrativeTotal).padStart(3)}`,
    );
  }
  log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const offline = args.has('--offline');
  const token = offline ? null : loadToken();

  if (args.has('--probe')) {
    await probe(token);
    return;
  }

  let raw = readCache();
  if (!raw || args.has('--refresh')) {
    if (offline) {
      console.error('No cache present and --offline was set. Nothing to do.');
      process.exit(1);
    }
    await pull(token);
    raw = readCache();
  } else {
    log(`\nUsing cached pull (${raw.length} rows). Pass --refresh to re-fetch.`);
  }

  const rows = prepare(raw);
  // "As of" = the newest thing the dataset knows about, which is what censoring
  // must be measured against — not today's clock, since HPD data lags.
  const dataAsOf = rows.reduce((max, r) => (r.inspection > max ? r.inspection : max), new Date(0));

  classifyRecurrence(rows, dataAsOf);
  const buildings = aggregate(rows);

  const sample = buildSample(buildings);
  report(buildings, rows, dataAsOf);
  writeOutputs(buildings, rows, dataAsOf, raw.length, new Set(sample.map((s) => s._buildingId)));
  writeSample(sample);
}

main().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
