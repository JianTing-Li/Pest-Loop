/**
 * PestLoop — address normalization.
 *
 * Shared deliberately between the build-time fetch script and the browser app:
 * the script writes match keys into the static JSON using these rules, and the
 * app looks addresses up using the same rules. If the two sides ever diverged,
 * searches would silently miss. Write once, use in both places.
 *
 * Scope is capped on purpose. No fuzzy/Levenshtein matching, no geocoding, no
 * multi-frontage resolution. Unmatched rows are surfaced to the user by design.
 */

/** Street-suffix abbreviations, normalized to the long form HPD tends to use. */
const SUFFIXES = {
  ST: 'STREET',
  STR: 'STREET',
  STREET: 'STREET',
  AVE: 'AVENUE',
  AV: 'AVENUE',
  AVEN: 'AVENUE',
  AVENUE: 'AVENUE',
  RD: 'ROAD',
  ROAD: 'ROAD',
  BLVD: 'BOULEVARD',
  BLVD_: 'BOULEVARD',
  BOULEVARD: 'BOULEVARD',
  PL: 'PLACE',
  PLACE: 'PLACE',
  DR: 'DRIVE',
  DRIVE: 'DRIVE',
  CT: 'COURT',
  COURT: 'COURT',
  LN: 'LANE',
  LANE: 'LANE',
  PKWY: 'PARKWAY',
  PKY: 'PARKWAY',
  PARKWAY: 'PARKWAY',
  TER: 'TERRACE',
  TERR: 'TERRACE',
  TERRACE: 'TERRACE',
  CRES: 'CRESCENT',
  CRESCENT: 'CRESCENT',
  CIR: 'CIRCLE',
  CIRCLE: 'CIRCLE',
  SQ: 'SQUARE',
  SQUARE: 'SQUARE',
  HWY: 'HIGHWAY',
  HIGHWAY: 'HIGHWAY',
  EXPY: 'EXPRESSWAY',
  EXPWY: 'EXPRESSWAY',
  EXPRESSWAY: 'EXPRESSWAY',
  CONC: 'CONCOURSE',
  CONCOURSE: 'CONCOURSE',
};

/** Directional prefixes/suffixes. */
const DIRECTIONALS = {
  E: 'EAST',
  EAST: 'EAST',
  W: 'WEST',
  WEST: 'WEST',
  N: 'NORTH',
  NORTH: 'NORTH',
  S: 'SOUTH',
  SOUTH: 'SOUTH',
  NE: 'NORTHEAST',
  NW: 'NORTHWEST',
  SE: 'SOUTHEAST',
  SW: 'SOUTHWEST',
};

/** Unit/apartment designators to strip off a user-entered address. */
const UNIT_PATTERN =
  /\b(?:APT|APARTMENT|UNIT|STE|SUITE|RM|ROOM|FL|FLOOR|BSMT|BASEMENT|PH)\b\.?\s*[-#]?\s*[\w-]*$/i;

/** Collapse punctuation and whitespace, uppercase. */
function scrub(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[.,;:'"`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strip a trailing unit designator ("1229 Franklin Ave Apt 3B", "12 Main St #4").
 * Only touches the tail — a leading house number is never a unit.
 */
export function stripUnit(value) {
  let out = scrub(value);
  out = out.split(',')[0].trim();
  out = out.replace(/\s+#\s*[\w-]+$/, '');
  out = out.replace(UNIT_PATTERN, '');
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * "169TH" -> "169", "1ST" -> "1", "2ND" -> "2", "3RD" -> "3".
 * Applied before suffix expansion so the "ST" in "1ST" is never read as Street.
 */
function stripOrdinal(token) {
  const m = /^(\d+)(ST|ND|RD|TH)$/.exec(token);
  return m ? m[1] : token;
}

/**
 * Normalize a street name into a canonical token string.
 * "E 169th St" and "EAST 169 STREET" both become "EAST 169 STREET".
 */
export function normalizeStreet(street) {
  const tokens = scrub(street).split(' ').filter(Boolean);
  if (tokens.length === 0) return '';

  const out = tokens.map(stripOrdinal).map((token, index, arr) => {
    // Directionals only at the head or tail; "NORTH" mid-name is part of the name.
    const positional = index === 0 || index === arr.length - 1;
    if (positional && DIRECTIONALS[token]) return DIRECTIONALS[token];
    if (SUFFIXES[token]) return SUFFIXES[token];
    return token;
  });

  return out.join(' ');
}

/**
 * Normalize a house number. HPD records ranges ("1229-1231") and letter
 * suffixes ("204A"); we keep the raw normalized form and let the caller decide
 * which variants to index.
 */
export function normalizeHouseNumber(house) {
  return scrub(house).replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
}

/**
 * Every house-number spelling a given record should be findable under.
 * "1229-1231" -> ["1229-1231", "1229", "1231"] so a client CSV listing either
 * end of the range still matches the building HPD files under the other.
 */
export function houseNumberVariants(house) {
  const norm = normalizeHouseNumber(house);
  if (!norm) return [];
  const variants = new Set([norm]);
  const range = /^(\d+[A-Z]?)-(\d+[A-Z]?)$/.exec(norm);
  if (range) {
    variants.add(range[1]);
    variants.add(range[2]);
  }
  return [...variants];
}

/**
 * Split a single free-text address field into house number + street.
 * CRM exports store the whole address in one column, while HPD keeps them
 * separate, so this is the bridge between the two shapes.
 */
export function parseAddress(input) {
  const cleaned = stripUnit(input);
  if (!cleaned) return { houseNumber: '', street: '' };

  const m = /^(\d+[A-Z]?(?:\s*-\s*\d+[A-Z]?)?)\s+(.*)$/.exec(cleaned);
  if (!m) return { houseNumber: '', street: cleaned };

  return {
    houseNumber: normalizeHouseNumber(m[1]),
    street: m[2].trim(),
  };
}

/** The key both sides join on: normalized house number + normalized street. */
export function makeMatchKey(houseNumber, street) {
  const h = normalizeHouseNumber(houseNumber);
  const s = normalizeStreet(street);
  if (!h || !s) return '';
  return `${h}|${s}`;
}

/** All match keys a building record should be indexed under. */
export function matchKeysFor(houseNumber, street) {
  const s = normalizeStreet(street);
  if (!s) return [];
  return houseNumberVariants(houseNumber)
    .map((h) => `${h}|${s}`)
    .filter(Boolean);
}

/** Match keys for a free-text address typed by a user or read from a CSV. */
export function matchKeysForInput(input) {
  const { houseNumber, street } = parseAddress(input);
  if (!houseNumber || !street) return [];
  return matchKeysFor(houseNumber, street);
}

/** Display form: "1229 FRANKLIN AVENUE" -> "1229 Franklin Avenue". */
export function titleCase(value) {
  return scrub(value)
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase());
}
