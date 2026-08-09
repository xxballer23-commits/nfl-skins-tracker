// Unit tests for the scoring engine.
// Run with:  ./test/run.sh        (uses jsc, built into macOS)
// or:        node test/scoring.test.mjs

import { scorePick, computeTotals, computeStandings, WEEKS } from '../js/scoring.js';

const out = typeof console !== 'undefined' && console.log ? console.log.bind(console) : print;
let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed += 1;
  else failures.push(`${name}\n    expected ${e}\n    actual   ${a}`);
}

function skins(direction, entry, opts) {
  const { base, bonus, total } = scorePick(direction, entry, opts);
  return { base, bonus, total };
}

const game = (result, pointsFor, pointsAgainst) => ({ result, pointsFor, pointsAgainst });

// ---- base skins ----
check('Win pick wins', skins('W', game('W', 24, 17)), { base: 1, bonus: 0, total: 1 });
check('Win pick loses', skins('W', game('L', 17, 24)), { base: 0, bonus: 0, total: 0 });
check('Lose pick loses', skins('L', game('L', 17, 24)), { base: 1, bonus: 0, total: 1 });
check('Lose pick wins', skins('L', game('W', 24, 17)), { base: 0, bonus: 0, total: 0 });
check('Bye week, Win pick', skins('W', null), { base: 0, bonus: 0, total: 0 });
check('Bye week, Lose pick', skins('L', undefined), { base: 0, bonus: 0, total: 0 });
check('Tie earns nothing for Win pick', skins('W', game('T', 20, 20)), { base: 0, bonus: 0, total: 0 });
check('Tie earns nothing for Lose pick', skins('L', game('T', 20, 20)), { base: 0, bonus: 0, total: 0 });

// ---- Win pick bonuses ----
check('Win + held under 10.5', skins('W', game('W', 20, 9)), { base: 1, bonus: 1, total: 2 });
check('Win + scored over 39.5', skins('W', game('W', 40, 20)), { base: 1, bonus: 1, total: 2 });
check('Win + both bonuses (42-6)', skins('W', game('W', 42, 6)), { base: 1, bonus: 2, total: 3 });
check('Win, opponent exactly 10, bonus', skins('W', game('W', 20, 10)), { base: 1, bonus: 1, total: 2 });
check('Win, opponent exactly 11, no bonus', skins('W', game('W', 20, 11)), { base: 1, bonus: 0, total: 1 });
check('Win, scored exactly 40, bonus', skins('W', game('W', 40, 20)), { base: 1, bonus: 1, total: 2 });
check('Win, scored exactly 39, no bonus', skins('W', game('W', 39, 20)), { base: 1, bonus: 0, total: 1 });
check('Win, shutout 45-0 gets both', skins('W', game('W', 45, 0)), { base: 1, bonus: 2, total: 3 });

// ---- Lose pick bonuses ----
check('Loss + scored under 10.5', skins('L', game('L', 6, 20)), { base: 1, bonus: 1, total: 2 });
check('Loss + opponent over 39.5', skins('L', game('L', 20, 42)), { base: 1, bonus: 1, total: 2 });
check('Loss + both bonuses (3-45)', skins('L', game('L', 3, 45)), { base: 1, bonus: 2, total: 3 });
check('Loss, scored exactly 10, bonus', skins('L', game('L', 10, 30)), { base: 1, bonus: 1, total: 2 });
check('Loss, scored exactly 11, no bonus', skins('L', game('L', 11, 30)), { base: 1, bonus: 0, total: 1 });
check('Loss, opponent exactly 40, bonus', skins('L', game('L', 14, 40)), { base: 1, bonus: 1, total: 2 });
check('Loss, opponent exactly 39, no bonus', skins('L', game('L', 14, 39)), { base: 1, bonus: 0, total: 1 });

// ---- bonuses never apply without the base skin ----
check('Win pick that loses 3-45 earns nothing', skins('W', game('L', 3, 45)), { base: 0, bonus: 0, total: 0 });
check('Lose pick that wins 45-3 earns nothing', skins('L', game('W', 45, 3)), { base: 0, bonus: 0, total: 0 });

// ---- bonus toggle ----
check(
  'Bonus disabled strips bonuses but keeps base',
  skins('W', game('W', 42, 6), { bonusEnabled: false }),
  { base: 1, bonus: 0, total: 1 }
);
check(
  'Bonus disabled on a losing Win pick still zero',
  skins('W', game('L', 6, 42), { bonusEnabled: false }),
  { base: 0, bonus: 0, total: 0 }
);

// ---- postseason ----
check(
  'Postseason Lose pick that loses earns nothing',
  skins('L', game('L', 3, 45), { postseason: true }),
  { base: 0, bonus: 0, total: 0 }
);
check(
  'Postseason Lose pick that wins earns nothing',
  skins('L', game('W', 45, 3), { postseason: true }),
  { base: 0, bonus: 0, total: 0 }
);
check(
  'Postseason Win pick scores normally with both bonuses',
  skins('W', game('W', 41, 7), { postseason: true }),
  { base: 1, bonus: 2, total: 3 }
);
check(
  'Postseason Win pick that loses earns nothing',
  skins('W', game('L', 7, 41), { postseason: true }),
  { base: 0, bonus: 0, total: 0 }
);

// ---- missing scores still award the base skin ----
check(
  'Result entered without scores gives base only',
  skins('W', { result: 'W', pointsFor: null, pointsAgainst: null }),
  { base: 1, bonus: 0, total: 1 }
);

// ---- aggregation and payouts ----
const league = {
  teams: [
    { id: 'a', name: 'Team A', members: ['a1', 'a2'] },
    { id: 'b', name: 'Team B', members: ['b1', 'b2'] },
  ],
  picks: [
    { id: 'Eagles-W', teamId: 'a', nflTeam: 'Eagles', direction: 'W', pickNo: 1, round: 1 },
    { id: 'Giants-L', teamId: 'a', nflTeam: 'Giants', direction: 'L', pickNo: 2, round: 1 },
    { id: 'Bills-W', teamId: 'b', nflTeam: 'Bills', direction: 'W', pickNo: 3, round: 1 },
  ],
};

const state = {
  settings: { skinValue: 100, bonusEnabledByWeek: Object.fromEntries(WEEKS.map((w) => [w.id, true])) },
  league,
  results: {
    1: {
      'Eagles-W': game('W', 42, 6), // 3 skins
      'Giants-L': game('L', 3, 41), // 3 skins
      'Bills-W': game('W', 20, 17), // 1 skin
    },
    2: {
      'Eagles-W': game('L', 10, 20), // 0
      'Bills-W': game('W', 30, 3), // 2 skins
      // Giants on bye
    },
    WC: {
      'Eagles-W': game('W', 24, 3), // 2 skins
      'Giants-L': game('L', 0, 50), // 0, postseason Lose pick
    },
  },
};

const { byTeam, byPick } = computeTotals(state);
check('Team A week 1 total', byTeam.a.byWeek['1'].total, 6);
check('Team A week 2 total (bye counts as zero)', byTeam.a.byWeek['2'].total, 0);
check('Team A Wild Card total', byTeam.a.byWeek.WC.total, 2);
check('Team A season', { base: byTeam.a.base, bonus: byTeam.a.bonus, total: byTeam.a.total }, { base: 3, bonus: 5, total: 8 });
check('Team B season', { base: byTeam.b.base, bonus: byTeam.b.bonus, total: byTeam.b.total }, { base: 2, bonus: 1, total: 3 });
check('Giants-L season total ignores postseason', byPick['Giants-L'].total, 3);

const { mendoza, rows } = computeStandings(Object.values(byTeam), state.settings.skinValue);
check('Mendoza Line', mendoza, 5.5);
check('Standings ordered by total skins', rows.map((r) => r.teamId), ['a', 'b']);
check('Team A payout', rows[0].dollarsTeam, 250);
check('Team A per teammate', rows[0].dollarsPerTeammate, 125);
check('Team B payout', rows[1].dollarsTeam, -250);
check('Payouts are zero sum', rows.reduce((sum, r) => sum + r.dollarsTeam, 0), 0);

// ---- report ----
out(`\nscoring: ${passed} passed, ${failures.length} failed`);
for (const failure of failures) out(`  FAIL ${failure}`);
if (failures.length) throw new Error(`${failures.length} scoring test(s) failed`);
