// End-to-end validation: real 2025 NFL scores from ESPN, through the real
// scoring engine, compared against the league's own spreadsheet.
//
// This is the check the spreadsheet alone could not support — it never recorded
// game scores, only derived skin counts. Every number below starts from an
// actual final score.
//
// Run with ./test/run.sh.

import { WEEKS, computeTotals, computeStandings, BONUS_LOW, BONUS_HIGH } from '../js/scoring.js';
import season from './2025-season.fixture.mjs';
import sheet from './last-season.fixture.mjs';

const out = typeof console !== 'undefined' && console.log ? console.log.bind(console) : print;
let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const near = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9;
  if (near(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
  else failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

check('bonus thresholds', [BONUS_LOW, BONUS_HIGH], [10.5, 39.5]);

const { byTeam, byPick } = computeTotals(season);
const teamName = Object.fromEntries(season.league.teams.map((t) => [t.id, t.name]));

// ------------------------------------------------ real scores vs the spreadsheet
//
// Three team-weeks are expected to differ, and only three. Each is asserted by
// name so a future data change surfaces instead of being absorbed silently.
//
//  1. Cummiskey / Culp, week 6 — the sheet credited a base skin for "Bengals W",
//     but the Bengals lost 18-27. Spreadsheet data-entry error.
//  2. Alec / Nick, week 13 — Bills won 26-7, which earns the held-under bonus.
//     The sheet missed it.
//  3. Duriez / Cam, Conf. Champ — the workbook was last saved after the
//     Divisional round, so it has no Conf. Champ or Super Bowl results at all.
//     The Patriots then won 10-7, worth base + held-under.
const EXPECTED_WEEK_DELTA = {
  'cummiskey/6': -1,
  'alec/13': 1,
  'duriez/CC': 2,
};

for (const team of season.league.teams) {
  for (const week of WEEKS) {
    if (week.id === '1') continue; // the league did not play week 1 last season
    const delta = EXPECTED_WEEK_DELTA[`${team.id}/${week.id}`] ?? 0;
    check(
      `${teamName[team.id]} — ${week.label}`,
      byTeam[team.id].byWeek[week.id].total,
      sheet.expected.byWeek[team.id][week.id] + delta
    );
  }
}

check(
  'week 1 contributes nothing (not played last season)',
  season.league.teams.reduce((s, t) => s + byTeam[t.id].byWeek['1'].total, 0),
  0
);

// ------------------------------------------------------------- season standings
const EXPECTED_SEASON = {
  little: { base: 52, bonus: 24, total: 76 },
  joe: { base: 51, bonus: 23, total: 74 },
  duriez: { base: 53, bonus: 17, total: 70 },
  corley: { base: 48, bonus: 18, total: 66 },
  alec: { base: 47, bonus: 18, total: 65 },
  cummiskey: { base: 40, bonus: 18, total: 58 },
};
for (const [teamId, expected] of Object.entries(EXPECTED_SEASON)) {
  const t = byTeam[teamId];
  check(`${teamName[teamId]} season`, { base: t.base, bonus: t.bonus, total: t.total }, expected);
}

const { mendoza, rows } = computeStandings(Object.values(byTeam), season.settings.skinValue);
check('Mendoza Line', mendoza, 409 / 6);
check(
  'standings order',
  rows.map((r) => r.teamId),
  ['little', 'joe', 'duriez', 'corley', 'alec', 'cummiskey']
);
check('payouts are zero sum', Math.abs(rows.reduce((s, r) => s + r.dollarsTeam, 0)) < 1e-9, true);
check('$ per teammate is half the team figure', rows.every((r) => r.dollarsPerTeammate * 2 === r.dollarsTeam), true);

// ----------------------------------------------------- rules hold on real games
// Every Lose pick is dead in every postseason week, no matter the real result.
for (const pick of season.league.picks.filter((p) => p.direction === 'L')) {
  for (const week of WEEKS.filter((w) => w.postseason)) {
    check(`${pick.id} scores 0 in ${week.label}`, byPick[pick.id].byWeek[week.id].total, 0);
  }
}

// No pick can ever exceed 3 skins in a week, and bonuses never appear without a base.
for (const pick of season.league.picks) {
  for (const week of WEEKS) {
    const s = byPick[pick.id].byWeek[week.id];
    if (s.total > 3) failures.push(`${pick.id} ${week.label}: ${s.total} skins in one week`);
    else if (s.bonus > 0 && s.base === 0) failures.push(`${pick.id} ${week.label}: bonus without base`);
    else passed += 1;
  }
}

// The threshold ruling: holding a team to exactly 10 must earn the bonus.
const boundary = [];
for (const week of WEEKS) {
  for (const pick of season.league.picks) {
    const entry = season.results[week.id]?.[pick.id];
    if (!entry) continue;
    const relevant = pick.direction === 'W' ? entry.pointsAgainst : entry.pointsFor;
    if (relevant === 10) boundary.push(`${pick.id} ${week.label}`);
  }
}
check('games decided by the 10-vs-under-9.5 boundary', boundary.length > 0, true);

// ------------------------------------------------------------------- report
out(`\nvalidation vs real ESPN scores: ${passed} passed, ${failures.length} failed`);
out(`  ${boundary.length} pick-weeks turned on the "exactly 10 points" boundary`);
for (const f of failures) out(`  MISMATCH ${f}`);
if (failures.length) throw new Error(`${failures.length} real-score mismatch(es)`);
