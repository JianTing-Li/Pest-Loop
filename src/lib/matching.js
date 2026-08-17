/**
 * PestLoop — address matching.
 *
 * ONE implementation, used by both entry points (single-address search and
 * batch CSV upload). It runs entirely against the precomputed static building
 * JSON — there is no live API call and no token anywhere in the browser.
 *
 * Scope is capped per spec: normalization + suffix/directional/ordinal handling
 * + a street-prefix fallback. No fuzzy/Levenshtein matching, no geocoding.
 * Unmatched and ambiguous rows are surfaced to the user, never guessed at.
 */

import { matchKeysForInput, normalizeHouseNumber, normalizeStreet, parseAddress } from '../../shared/address.js';

/**
 * Build the lookup structures once, at load.
 * - byKey: exact "house|street" -> buildings
 * - byHouse: house number -> [{street, building}] for the partial-street fallback
 */
export function buildIndex(buildings) {
  const byKey = new Map();
  const byHouse = new Map();

  for (const building of buildings) {
    for (const key of building.matchKeys ?? []) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(building);

      const [house, street] = key.split('|');
      if (!byHouse.has(house)) byHouse.set(house, []);
      byHouse.get(house).push({ street, building });
    }
  }
  return { byKey, byHouse, buildings };
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const b of list) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    out.push(b);
  }
  return out;
}

/**
 * Resolve one free-text address.
 *
 * @returns {{status:'exact'|'partial'|'none', matches:Array, parsed:object}}
 *   'exact'   — matched on full house number + street
 *   'partial' — matched by street prefix (e.g. "1229 Franklin"); may be several
 *   'none'    — nothing matched; caller must show this to the user
 */
export function lookupAddress(index, input, zip) {
  const parsed = parseAddress(input);
  const result = (status, matches) => ({ status, matches: applyZip(matches, zip), parsed });

  const keys = matchKeysForInput(input);
  const exact = dedupe(keys.flatMap((k) => index.byKey.get(k) ?? []));
  if (exact.length) return result('exact', exact);

  // Fallback: right house number, street name typed only partially. Not fuzzy —
  // a strict prefix on the normalized street token string.
  if (parsed.houseNumber && parsed.street) {
    const house = normalizeHouseNumber(parsed.houseNumber);
    const street = normalizeStreet(parsed.street);
    const candidates = (index.byHouse.get(house) ?? [])
      .filter((entry) => entry.street.startsWith(street))
      .map((entry) => entry.building);
    if (candidates.length) return result('partial', dedupe(candidates));
  }

  return result('none', []);
}

/**
 * Zip is a tiebreaker, never a filter that can empty a result set. If the zip
 * narrows things down, use it; if it would eliminate everything (stale CRM zip,
 * building spanning a boundary), keep the wider set rather than showing the
 * user a false "no match".
 */
function applyZip(matches, zip) {
  const wanted = String(zip ?? '').trim().slice(0, 5);
  if (!wanted || matches.length <= 1) return matches;
  const narrowed = matches.filter((b) => String(b.zip ?? '').slice(0, 5) === wanted);
  return narrowed.length ? narrowed : matches;
}

/**
 * Live suggestions for the search box. Same index, same rules, capped for the
 * dropdown.
 */
export function suggest(index, input, limit = 8) {
  const parsed = parseAddress(input);
  if (!parsed.houseNumber) return [];
  const house = normalizeHouseNumber(parsed.houseNumber);
  const street = normalizeStreet(parsed.street ?? '');
  const entries = index.byHouse.get(house) ?? [];
  const hits = street ? entries.filter((e) => e.street.startsWith(street)) : entries;
  return dedupe(hits.map((e) => e.building)).slice(0, limit);
}

/**
 * Autosuggest index — one slim entry per building (canonical address only, not
 * every historical spelling variant `matchKeys` carries), with house/street
 * pre-normalized once so every keystroke only does cheap string comparisons,
 * not re-parsing 22k+ addresses. Derived from the already-loaded `buildings`
 * array rather than fetched separately — `buildings.json` already carries
 * address/zip/nta on every record and is downloaded before this ever runs, so
 * a second file would be pure additional bytes for data already in memory.
 *
 * This trades a sliver of completeness for simplicity: a building known only
 * under an old alternate spelling won't surface here. `lookupAddress` (full
 * `matchKeys` variant support) is unaffected and remains the authoritative
 * path for the Look-up button and Enter-with-nothing-highlighted.
 */
export function buildStreetIndex(buildings) {
  return buildings.map((b) => {
    const { street } = parseAddress(b.address);
    return {
      id: b.id,
      address: b.address,
      zip: b.zip ?? null,
      nta: b.nta ?? null,
      // parseAddress already normalizes the house number internally.
      house: parseAddress(b.address).houseNumber,
      street: normalizeStreet(street),
    };
  });
}

/**
 * Suggestions for the autosuggest dropdown — unlike `suggest()` above, this
 * does NOT require a house number first: "Franklin" alone should surface
 * "1229 Franklin Ave". If a house number IS present it must match exactly
 * (same rule `suggest()` already uses); only the street portion is
 * prefix/contains-matched. "Prefix-first but not prefix-only": buildings whose
 * street starts with the typed text rank ahead of ones where it merely
 * appears elsewhere in the name.
 *
 * @returns {{matches: object[], total: number}} `total` is the full match
 *   count before capping to `limit`, so the caller can show "N more — keep
 *   typing to narrow" when the list was truncated.
 */
export function suggestAddresses(streetIndex, input, limit = 8) {
  const { houseNumber, street } = parseAddress(input);
  const normStreet = normalizeStreet(street);
  if (!normStreet) return { matches: [], total: 0 };

  const pool = houseNumber ? streetIndex.filter((e) => e.house === houseNumber) : streetIndex;

  const prefixHits = [];
  const containsHits = [];
  for (const e of pool) {
    if (e.street.startsWith(normStreet)) prefixHits.push(e);
    else if (e.street.includes(normStreet)) containsHits.push(e);
  }
  const ranked = prefixHits.concat(containsHits);
  return { matches: ranked.slice(0, limit), total: ranked.length };
}

/**
 * Batch-match a parsed client list. Rows resolve to exactly one building, or
 * they land in `needsReview` — silently dropping a row would hide a match
 * failure, which is the opposite of what an account manager needs.
 */
export function matchClients(index, rows) {
  const matched = [];
  const needsReview = [];

  for (const row of rows) {
    const { status, matches } = lookupAddress(index, row.address, row.zip);

    if (status === 'none' || matches.length === 0) {
      needsReview.push({ ...row, reason: 'no-match', candidates: [] });
    } else if (matches.length === 1) {
      matched.push({ ...row, building: matches[0], matchType: status });
    } else {
      needsReview.push({ ...row, reason: 'ambiguous', candidates: matches.slice(0, 6) });
    }
  }
  return { matched, needsReview };
}
