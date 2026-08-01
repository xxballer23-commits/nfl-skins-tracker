// Application state: in-memory, autosaved to localStorage, portable via JSON export/import.

import { WEEKS } from './scoring.js';
import { defaultLeague } from './league.js';

const STORAGE_KEY = 'nfl-skins-tracker-v1';
export const SCHEMA_VERSION = 1;

export function defaultState() {
  return {
    version: SCHEMA_VERSION,
    settings: {
      skinValue: 100,
      // Bonus skins are on for every week by default, including Week 1.
      bonusEnabledByWeek: Object.fromEntries(WEEKS.map((w) => [w.id, true])),
    },
    league: defaultLeague(),
    // results[weekId][pickId] = { result: 'W'|'L'|'T', pointsFor, pointsAgainst }
    results: {},
  };
}

/** Fill in anything a saved or imported file is missing, and drop unknown keys. */
function normalize(raw) {
  const state = defaultState();
  if (!raw || typeof raw !== 'object') return state;

  if (Number.isFinite(raw.settings?.skinValue)) {
    state.settings.skinValue = raw.settings.skinValue;
  }
  for (const week of WEEKS) {
    if (raw.settings?.bonusEnabledByWeek?.[week.id] === false) {
      state.settings.bonusEnabledByWeek[week.id] = false;
    }
  }
  if (Array.isArray(raw.league?.teams) && Array.isArray(raw.league?.picks)) {
    state.league = raw.league;
  }

  const validPickIds = new Set(state.league.picks.map((p) => p.id));
  for (const week of WEEKS) {
    const weekResults = raw.results?.[week.id];
    if (!weekResults) continue;
    for (const [pickId, entry] of Object.entries(weekResults)) {
      if (!validPickIds.has(pickId) || !entry || !['W', 'L', 'T'].includes(entry.result)) continue;
      state.results[week.id] ??= {};
      state.results[week.id][pickId] = {
        result: entry.result,
        pointsFor: Number.isFinite(entry.pointsFor) ? entry.pointsFor : null,
        pointsAgainst: Number.isFinite(entry.pointsAgainst) ? entry.pointsAgainst : null,
      };
    }
  }
  return state;
}

export function load() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? normalize(JSON.parse(saved)) : defaultState();
  } catch (err) {
    console.warn('Could not read saved data, starting fresh.', err);
    return defaultState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.warn('Could not autosave.', err);
    return false;
  }
}

export function exportToFile(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `skins-league-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function importFromFile(file) {
  return normalize(JSON.parse(await file.text()));
}
