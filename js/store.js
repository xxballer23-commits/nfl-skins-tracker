// Application state.
//
// Two layers, deliberately kept apart:
//
//   baseline   data/<season>-season.json, published to the site and refreshed by
//              the Update results workflow. Everyone who loads the page sees it.
//   overrides  your corrections, held in localStorage only. Export them and
//              commit the file to publish; tools/build_season.py folds them back
//              into the baseline on the next pull.
//
// Scoring always runs on the merge of the two, so an auto-pull can never quietly
// overwrite a correction, and a stale browser can never hide a fresh result.

import { WEEKS } from './scoring.js';

const OVERRIDES_KEY = (seasonId) => `nfl-skins-tracker-v2:overrides:${seasonId}`;
const DRAFT_KEY = (seasonId) => `nfl-skins-tracker-v2:draft:${seasonId}`;
export const SCHEMA_VERSION = 2;

const RESULTS = ['W', 'L', 'T'];

export function emptyOverrides(seasonId) {
  return { season: seasonId, settings: {}, weeks: {} };
}

function emptyBaseline(seasonId) {
  return {
    season: seasonId,
    updated: null,
    settings: {
      skinValue: 100,
      // Bonus skins are on for every week by default, including Week 1.
      bonusEnabledByWeek: Object.fromEntries(WEEKS.map((w) => [w.id, true])),
    },
    league: { teams: [], picks: [] },
    results: {},
  };
}

/** A result entry, or null if the input is not one. */
function cleanEntry(entry) {
  if (!entry || !RESULTS.includes(entry.result)) return null;
  return {
    result: entry.result,
    pointsFor: Number.isFinite(entry.pointsFor) ? entry.pointsFor : null,
    pointsAgainst: Number.isFinite(entry.pointsAgainst) ? entry.pointsAgainst : null,
  };
}

/** Fill in anything a fetched baseline is missing, and drop unknown keys. */
function normalizeBaseline(raw, seasonId) {
  const baseline = emptyBaseline(seasonId);
  if (!raw || typeof raw !== 'object') return baseline;

  if (typeof raw.updated === 'string') baseline.updated = raw.updated;
  if (Number.isFinite(raw.settings?.skinValue)) baseline.settings.skinValue = raw.settings.skinValue;
  for (const week of WEEKS) {
    if (raw.settings?.bonusEnabledByWeek?.[week.id] === false) {
      baseline.settings.bonusEnabledByWeek[week.id] = false;
    }
  }
  if (Array.isArray(raw.league?.teams) && Array.isArray(raw.league?.picks)) baseline.league = raw.league;

  const validPickIds = new Set(baseline.league.picks.map((p) => p.id));
  for (const week of WEEKS) {
    for (const [pickId, entry] of Object.entries(raw.results?.[week.id] ?? {})) {
      const clean = validPickIds.has(pickId) ? cleanEntry(entry) : null;
      if (!clean) continue;
      baseline.results[week.id] ??= {};
      baseline.results[week.id][pickId] = clean;
    }
  }
  return baseline;
}

/**
 * Corrections keep null entries: null means "this pick did not play", which is a
 * real correction and has to survive the round trip to the overrides file.
 */
export function normalizeOverrides(raw, seasonId) {
  const overrides = emptyOverrides(seasonId);
  if (!raw || typeof raw !== 'object') return overrides;

  if (Number.isFinite(raw.settings?.skinValue)) overrides.settings.skinValue = raw.settings.skinValue;
  for (const week of WEEKS) {
    const flag = raw.settings?.bonusEnabledByWeek?.[week.id];
    if (typeof flag === 'boolean') {
      overrides.settings.bonusEnabledByWeek ??= {};
      overrides.settings.bonusEnabledByWeek[week.id] = flag;
    }
  }
  for (const week of WEEKS) {
    for (const [pickId, entry] of Object.entries(raw.weeks?.[week.id] ?? {})) {
      const clean = entry === null ? null : cleanEntry(entry);
      if (entry !== null && !clean) continue;
      overrides.weeks[week.id] ??= {};
      overrides.weeks[week.id][pickId] = clean;
    }
  }
  return overrides;
}

/** Baseline + overrides, in the shape computeTotals expects. */
export function merge(baseline, overrides) {
  const settings = {
    skinValue: overrides.settings?.skinValue ?? baseline.settings.skinValue,
    bonusEnabledByWeek: {
      ...baseline.settings.bonusEnabledByWeek,
      ...(overrides.settings?.bonusEnabledByWeek ?? {}),
    },
  };

  const results = {};
  for (const week of WEEKS) {
    const merged = { ...(baseline.results[week.id] ?? {}) };
    for (const [pickId, entry] of Object.entries(overrides.weeks?.[week.id] ?? {})) {
      if (entry === null) delete merged[pickId];
      else merged[pickId] = entry;
    }
    if (Object.keys(merged).length) results[week.id] = merged;
  }

  return { version: SCHEMA_VERSION, season: baseline.season, settings, league: baseline.league, results };
}

/** True when this pick's entry in this week differs from what was published. */
export function isOverridden(overrides, weekId, pickId) {
  return pickId in (overrides.weeks?.[weekId] ?? {});
}

export function countOverrides(overrides) {
  return Object.values(overrides.weeks ?? {}).reduce((n, week) => n + Object.keys(week).length, 0);
}

// ------------------------------------------------------------------ loading

export async function fetchSeasons() {
  const res = await fetch('data/seasons.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`seasons.json: ${res.status}`);
  return res.json();
}

export async function fetchBaseline(seasonId) {
  const res = await fetch(`data/${seasonId}-season.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${seasonId}-season.json: ${res.status}`);
  return normalizeBaseline(await res.json(), seasonId);
}

export function loadOverrides(seasonId) {
  try {
    const saved = localStorage.getItem(OVERRIDES_KEY(seasonId));
    return saved ? normalizeOverrides(JSON.parse(saved), seasonId) : emptyOverrides(seasonId);
  } catch (err) {
    console.warn('Could not read saved corrections, starting fresh.', err);
    return emptyOverrides(seasonId);
  }
}

export function saveOverrides(seasonId, overrides) {
  try {
    localStorage.setItem(OVERRIDES_KEY(seasonId), JSON.stringify(overrides));
    return true;
  } catch (err) {
    console.warn('Could not autosave corrections.', err);
    return false;
  }
}

export function clearOverrides(seasonId) {
  localStorage.removeItem(OVERRIDES_KEY(seasonId));
}

// ------------------------------------------------------------------- draft
//
// The draft in progress lives in localStorage too. It only becomes the
// published roster once you export it and commit data/<season>-league.json.

export function loadDraft(seasonId) {
  try {
    const saved = localStorage.getItem(DRAFT_KEY(seasonId));
    return saved ? JSON.parse(saved) : null;
  } catch (err) {
    console.warn('Could not read the saved draft, starting fresh.', err);
    return null;
  }
}

export function saveDraft(seasonId, draft) {
  try {
    localStorage.setItem(DRAFT_KEY(seasonId), JSON.stringify(draft));
    return true;
  } catch (err) {
    console.warn('Could not autosave the draft.', err);
    return false;
  }
}

export function clearDraft(seasonId) {
  localStorage.removeItem(DRAFT_KEY(seasonId));
}

// ------------------------------------------------------------ import/export

function download(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportOverrides(seasonId, overrides) {
  download(`${seasonId}-overrides.json`, overrides);
}

export function exportLeague(seasonId, league) {
  download(`${seasonId}-league.json`, league);
}

export async function importOverrides(file, seasonId) {
  return normalizeOverrides(JSON.parse(await file.text()), seasonId);
}
