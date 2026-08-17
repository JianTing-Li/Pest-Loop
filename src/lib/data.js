/**
 * PestLoop — static data loading.
 *
 * The app reads ONLY files produced by scripts/fetch-data.js and served from
 * /public/data. There is no runtime call to Socrata and no API token in the
 * browser. Refreshing the data means re-running the Node script and committing
 * the changed JSON.
 */

import { buildIndex } from './matching.js';

async function getJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load ${path} (HTTP ${res.status})`);
  return res.json();
}

export async function loadData() {
  const [buildings, meta] = await Promise.all([
    getJSON('data/buildings.json'),
    getJSON('data/meta.json'),
  ]);
  return { buildings, meta, index: buildIndex(buildings) };
}

export async function loadSampleClients() {
  const data = await getJSON('data/sample-clients.json');
  return data.clients ?? [];
}
