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

/**
 * Per-building violation timeline. Only buildings with at least one repeat
 * pair have a file (Phase 0 skipped the rest — nobody opens a timeline for a
 * building with zero repeats), so a missing file here means "no repeat
 * history to show", not a load failure — returned as an empty array.
 *
 * Can't key that off HTTP status alone: an SPA dev server (and many static
 * hosts configured with a catch-all rewrite) answers an unmatched path with
 * `index.html` at status 200, not a real 404. Checking the content-type
 * catches that case too — an HTML body was never going to parse as JSON.
 */
export async function loadTimeline(buildingId) {
  const res = await fetch(`data/timelines/${buildingId}.json`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Could not load timeline for building ${buildingId} (HTTP ${res.status})`);
  if (!(res.headers.get('content-type') ?? '').includes('json')) return [];
  return res.json();
}
