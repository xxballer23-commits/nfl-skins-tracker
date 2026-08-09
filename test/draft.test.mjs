// Unit tests for the draft setup rules. Run with ./test/run.sh.

import { shuffle, snakeSlots, toLeague, draftProblems, availableSelections, pickId, draftFromLeague } from '../js/draft.js';
import { NFL_TEAMS } from '../js/nfl-teams.js';

const out = typeof console !== 'undefined' && console.log ? console.log.bind(console) : print;
let passed = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) passed += 1;
  else failures.push(`${name}\n    expected ${e}\n    actual   ${a}`);
}

const ORDER = ['a', 'b', 'c', 'd', 'e', 'f'];

// ---- the team list ----
check('32 NFL teams', NFL_TEAMS.length, 32);
check('NFL teams are unique', new Set(NFL_TEAMS).size, 32);

// ---- snake order ----
const slots = snakeSlots(ORDER);
check('30 slots for 6 teams x 5 rounds', slots.length, 30);
check('pick numbers are 1..30', slots.map((s) => s.pickNo), [...Array(30)].map((_, i) => i + 1));
check('round 1 runs down the order', slots.slice(0, 6).map((s) => s.teamId), ORDER);
check('round 2 runs back up', slots.slice(6, 12).map((s) => s.teamId), [...ORDER].reverse());
check('round 3 runs down again', slots.slice(12, 18).map((s) => s.teamId), ORDER);
check('round 5 runs down', slots.slice(24, 30).map((s) => s.teamId), ORDER);
check('rounds are numbered 1..5', [...new Set(slots.map((s) => s.round))], [1, 2, 3, 4, 5]);
check(
  'every team gets exactly 5 picks',
  ORDER.map((id) => slots.filter((s) => s.teamId === id).length),
  [5, 5, 5, 5, 5, 5]
);
check(
  'first and last pick belong to opposite ends of the order',
  [slots[0].teamId, slots[29].teamId],
  ['a', 'f']
);

// ---- shuffle ----
const cyclingRandom = (() => {
  // Deterministic sequence so the assertion is stable.
  const values = [0.9, 0.1, 0.7, 0.3, 0.5];
  let i = 0;
  return () => values[i++ % values.length];
})();
const shuffled = shuffle(ORDER, cyclingRandom);
check('shuffle keeps every team exactly once', [...shuffled].sort(), [...ORDER].sort());
check('shuffle does not mutate the input', ORDER, ['a', 'b', 'c', 'd', 'e', 'f']);
check('shuffle actually reorders', shuffled.join('') !== ORDER.join(''), true);

// ---- league assembly ----
const teams = ORDER.map((id) => ({ id, name: `Team ${id.toUpperCase()}`, members: ['One', 'Two'] }));
const selections = {};
snakeSlots(ORDER).forEach((slot, i) => {
  selections[slot.pickNo] = { nflTeam: NFL_TEAMS[i], direction: i % 2 === 0 ? 'W' : 'L' };
});
const draft = { season: '2026', teams, order: ORDER, selections };

const league = toLeague(draft);
check('league has 30 picks', league.picks.length, 30);
check('pick ids are unique', new Set(league.picks.map((p) => p.id)).size, 30);
check('pick id format', league.picks[0].id, pickId(NFL_TEAMS[0], 'W'));
check('pick carries its slot', { no: league.picks[0].pickNo, round: league.picks[0].round }, { no: 1, round: 1 });
check('a complete draft has no problems', draftProblems(draft), []);

// ---- partially finished draft ----
const partial = { ...draft, selections: { 1: selections[1], 2: selections[2] } };
check('partial league only includes made picks', toLeague(partial).picks.length, 2);
check('partial draft reports what is left', draftProblems(partial), ['28 of 30 picks still to make.']);

// ---- duplicate detection ----
const dupes = { ...draft, selections: { ...selections, 4: { ...selections[1] } } };
check(
  'duplicate team+direction is flagged',
  draftProblems(dupes).filter((p) => p.includes('duplicates')).length,
  1
);

// The same NFL team taken once as WIN and once as LOSE is legal.
const bothDirections = {
  ...draft,
  selections: { ...selections, 2: { nflTeam: NFL_TEAMS[0], direction: 'L' } },
};
check('same team as WIN and LOSE is allowed', draftProblems(bothDirections), []);

// ---- availability ----
const empty = { ...draft, selections: {} };
check('64 combinations available at the start', availableSelections(empty, NFL_TEAMS).length, 64);
check('taking a pick removes only that combination', availableSelections({ ...draft, selections: { 1: { nflTeam: 'Eagles', direction: 'W' } } }, NFL_TEAMS).length, 63);
check(
  'the other direction stays available',
  availableSelections({ ...draft, selections: { 1: { nflTeam: 'Eagles', direction: 'W' } } }, NFL_TEAMS)
    .some((o) => o.nflTeam === 'Eagles' && o.direction === 'L'),
  true
);
check(
  'a slot can keep its own current selection',
  availableSelections({ ...draft, selections: { 1: { nflTeam: 'Eagles', direction: 'W' } } }, NFL_TEAMS, 1).length,
  64
);

// ---- seeding from a published league ----
const seeded = draftFromLeague(league, '2027');
check('seeded draft keeps the season', seeded.season, '2027');
check('seeded draft recovers the order', seeded.order, ORDER);
check('seeded draft round-trips to the same board', toLeague(seeded).picks, league.picks);
check('seeded draft copies rosters', seeded.teams[0], { id: 'a', name: 'Team A', members: ['One', 'Two'] });
seeded.teams[0].members.push('Three');
check('seeded rosters are detached from the source', teams[0].members, ['One', 'Two']);
check(
  'seeding an empty league falls back to team order',
  draftFromLeague({ teams, picks: [] }, '2027').order,
  ORDER
);

// ---- missing team name ----
const unnamed = { ...draft, teams: [{ id: 'a', name: '  ', members: [] }, ...teams.slice(1)] };
check('blank team name is flagged', draftProblems(unnamed).includes('Every team needs a name.'), true);

// ---- report ----
out(`\ndraft: ${passed} passed, ${failures.length} failed`);
for (const failure of failures) out(`  FAIL ${failure}`);
if (failures.length) throw new Error(`${failures.length} draft test(s) failed`);
