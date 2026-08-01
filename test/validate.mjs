// Replays last season through the real scoring engine and compares every number
// against the Excel tracker. Run with ./test/run.sh.

import { WEEKS, computeTotals, computeStandings } from '../js/scoring.js';
import { defaultLeague } from '../js/league.js';
import fixture from './last-season.fixture.mjs';

const out = typeof console !== 'undefined' && console.log ? console.log.bind(console) : print;
let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const near = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9;
  if (near(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected)) passed += 1;
  else failures.push(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const league = defaultLeague();
const teamName = Object.fromEntries(league.teams.map((t) => [t.id, t.name]));

// ---------------------------------------------------------------- draft board
// Two pick numbers were corrected against snake order; everything else must match.
const KNOWN_TYPOS = { 'Colts-L': 16, 'Packers-W': 26 };
for (const pick of league.picks) {
  const sheet = fixture.expected.draft[pick.id];
  check(`draft team ${pick.id}`, pick.teamId, sheet.team);
  check(`draft round ${pick.id}`, pick.round, sheet.round);
  if (!(pick.id in KNOWN_TYPOS)) check(`draft pick# ${pick.id}`, pick.pickNo, sheet.pickNo);
}
const pickNos = league.picks.map((p) => p.pickNo).sort((a, b) => a - b);
check('draft pick numbers are 1..30 with no duplicates', pickNos, [...Array(30)].map((_, i) => i + 1));

// ------------------------------------------------------- full season, weeks 2+
const state = { ...fixture.state, league };
const { byTeam, byPick } = computeTotals(state);

for (const team of league.teams) {
  const expectedWeeks = fixture.expected.byWeek[team.id];
  for (const week of WEEKS) {
    check(
      `${teamName[team.id]} — ${week.label}`,
      byTeam[team.id].byWeek[week.id].total,
      expectedWeeks[week.id]
    );
  }
  const season = fixture.expected.season[team.id];
  check(`${teamName[team.id]} season base skins`, byTeam[team.id].base, season.base);
  check(`${teamName[team.id]} season bonus skins`, byTeam[team.id].bonus, season.bonus);
  check(`${teamName[team.id]} season total skins`, byTeam[team.id].total, season.total);
}

// Per-pick base skins are real spreadsheet data, so they must match exactly.
//
// Caveat: the Team Performance tab's "Raw Skins" column counts the regular season
// only, while Summary / Weekly Scores include the playoffs. So that column is
// compared against regular-season base skins, and the playoff remainder is
// asserted separately below.
let bonusSum = 0;
let expectedBonusSum = 0;
for (const pick of league.picks) {
  const byWeek = byPick[pick.id].byWeek;
  const regularSeason = WEEKS.filter((w) => !w.postseason).reduce((s, w) => s + byWeek[w.id].base, 0);
  check(`${pick.id} regular season base skins`, regularSeason, fixture.expected.picks[pick.id].base);
  bonusSum += byPick[pick.id].bonus;
  expectedBonusSum += fixture.expected.picks[pick.id].bonus;
}
check('league-wide bonus skins', bonusSum, expectedBonusSum);

// Known spreadsheet gap #1: playoff base skins are missing from the Team
// Performance tab. Asserted explicitly so a future data change gets caught
// instead of being silently absorbed.
const EXPECTED_PLAYOFF_BASE = {
  'Patriots-W': 2, 'Rams-W': 2, 'Texans-W': 1, 'Bills-W': 1, 'Broncos-W': 1, '49ers-W': 1,
};
for (const pick of league.picks) {
  const playoffBase = WEEKS.filter((w) => w.postseason)
    .reduce((s, w) => s + byPick[pick.id].byWeek[w.id].base, 0);
  check(`${pick.id} playoff base skins`, playoffBase, EXPECTED_PLAYOFF_BASE[pick.id] ?? 0);
}

// Known spreadsheet gap #2: the Team Performance bonus column attributes one
// bonus skin to Alec / Nick that Weekly Scores gives to Duriez / Cam. The
// league-wide total is unaffected, which is why that tab's "Bonus Check" reads 0.
const tabBonusByTeam = {};
for (const pick of league.picks) {
  tabBonusByTeam[pick.teamId] =
    (tabBonusByTeam[pick.teamId] ?? 0) + fixture.expected.picks[pick.id].bonus;
}
const EXPECTED_BONUS_DELTA = { duriez: -1, alec: 1 };
for (const team of league.teams) {
  check(
    `Team Performance bonus delta for ${team.name}`,
    tabBonusByTeam[team.id] - fixture.expected.season[team.id].bonus,
    EXPECTED_BONUS_DELTA[team.id] ?? 0
  );
}

// ------------------------------------------------------- payouts / Mendoza line
const { mendoza, rows } = computeStandings(Object.values(byTeam), state.settings.skinValue);
check('Mendoza Line', mendoza, fixture.expected.mendoza);
check(
  'standings order',
  rows.map((r) => r.name),
  ['Little / Banks', 'Joe / Aidan', 'Duriez / Cam', 'Corley / Goddard', 'Alec / Nick', 'Cummiskey / Culp']
);

const EXPECTED_PAYOUTS = {
  little: [8.166666666666671, 816.6666666666672, 408.3333333333336],
  joe: [6.166666666666671, 616.6666666666672, 308.3333333333336],
  duriez: [0.1666666666666714, 16.66666666666714, 8.33333333333357],
  corley: [-1.8333333333333286, -183.33333333333286, -91.66666666666643],
  alec: [-3.8333333333333286, -383.33333333333286, -191.66666666666643],
  cummiskey: [-8.833333333333329, -883.3333333333328, -441.6666666666664],
};
for (const row of rows) {
  const [diff, team, teammate] = EXPECTED_PAYOUTS[row.teamId];
  check(`${row.name} Mendoza +/-`, row.diff, diff);
  check(`${row.name} $ per team`, row.dollarsTeam, team);
  check(`${row.name} $ per teammate`, row.dollarsPerTeammate, teammate);
}
check('payouts are zero sum', Math.abs(rows.reduce((s, r) => s + r.dollarsTeam, 0)) < 1e-9, true);

// ---------------------------------- postseason rule holds across the whole season
for (const pick of league.picks.filter((p) => p.direction === 'L')) {
  for (const week of WEEKS.filter((w) => w.postseason)) {
    check(`${pick.id} scores 0 in ${week.label}`, byPick[pick.id].byWeek[week.id].total, 0);
  }
}

// ------------------------------------------- Week 1 tab (bonus skins toggled off)
const week1State = {
  settings: {
    skinValue: 20, // the Week 1 tab used a $20 skin
    bonusEnabledByWeek: Object.fromEntries(WEEKS.map((w) => [w.id, w.id !== '1'])),
  },
  league,
  results: { 1: fixture.week1.results },
};
const week1Totals = computeTotals(week1State).byTeam;
for (const team of league.teams) {
  check(
    `Week 1 tab — ${teamName[team.id]}`,
    week1Totals[team.id].total,
    fixture.week1.expectedTotals[team.id]
  );
}
check(
  'Week 1 tab Mendoza Line',
  computeStandings(Object.values(week1Totals), 20).mendoza,
  fixture.week1.mendoza
);
check(
  'Week 1 bonus toggle produced zero bonus skins',
  Object.values(week1Totals).reduce((s, t) => s + t.bonus, 0),
  0
);

// ------------------------------------------------------------------- report
out(`\nvalidation vs spreadsheet: ${passed} passed, ${failures.length} failed`);
for (const f of fixture.problems) out(`  FIXTURE PROBLEM: ${f}`);
for (const f of failures) out(`  MISMATCH ${f}`);
if (failures.length) throw new Error(`${failures.length} spreadsheet mismatch(es)`);
