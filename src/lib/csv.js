/**
 * PestLoop — client-list CSV parsing.
 *
 * Runs entirely in the browser (PapaParse). The file never leaves the machine,
 * and matching happens against the static building JSON, so no server and no
 * credential are involved.
 */

import Papa from 'papaparse';

/** Accepted header spellings, normalized case-insensitively. Extra columns are ignored. */
const HEADERS = {
  client_name: ['client_name', 'client name', 'client', 'account', 'account_name', 'account name', 'company'],
  address: ['address', 'street_address', 'street address', 'property_address', 'property address'],
  zip: ['zip', 'zipcode', 'zip_code', 'zip code', 'postal_code', 'postcode'],
};

const normalizeHeader = (h) => String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function mapHeaders(fields) {
  const found = {};
  for (const field of fields ?? []) {
    const norm = normalizeHeader(field);
    for (const [canonical, aliases] of Object.entries(HEADERS)) {
      if (!found[canonical] && aliases.includes(norm)) found[canonical] = field;
    }
  }
  return found;
}

/**
 * @returns {Promise<{rows:Array, errors:Array, missing:Array}>}
 *   `missing` lists required columns not present, so the UI can say exactly
 *   what's wrong instead of silently producing zero matches.
 */
export function parseClientCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const map = mapHeaders(results.meta?.fields);
        const missing = ['client_name', 'address'].filter((k) => !map[k]);
        if (missing.length) return resolve({ rows: [], errors: [], missing });

        const rows = results.data
          .map((row, i) => ({
            rowNumber: i + 2, // +2: 1-indexed, plus the header line
            client_name: String(row[map.client_name] ?? '').trim(),
            address: String(row[map.address] ?? '').trim(),
            zip: map.zip ? String(row[map.zip] ?? '').trim() : '',
          }))
          .filter((row) => row.client_name || row.address);

        resolve({ rows, errors: results.errors ?? [], missing: [] });
      },
      error: reject,
    });
  });
}
