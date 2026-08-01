// Hardcoded league for v1: 6 teams of 2, 5 picks each, snake draft.
//
// Pick numbers follow 6-team snake order (R1 1-6, R2 7-12 reversed, R3 13-18,
// R4 19-24 reversed, R5 25-30). Two pick numbers in the source spreadsheet were
// typos and are corrected here: Colts L was listed as #16 (now #11) and
// Packers W was listed as #26 (now #21).

export const TEAMS = [
  { id: 'duriez', name: 'Duriez / Cam', members: ['Duriez', 'Cam'] },
  { id: 'alec', name: 'Alec / Nick', members: ['Alec', 'Nick'] },
  { id: 'joe', name: 'Joe / Aidan', members: ['Joe', 'Aidan'] },
  { id: 'cummiskey', name: 'Cummiskey / Culp', members: ['Cummiskey', 'Culp'] },
  { id: 'little', name: 'Little / Banks', members: ['Little', 'Banks'] },
  { id: 'corley', name: 'Corley / Goddard', members: ['Corley', 'Goddard'] },
];

const RAW_PICKS = [
  // teamId, nflTeam, direction, pickNo
  ['duriez', 'Eagles', 'W', 1],
  ['alec', 'Bills', 'W', 2],
  ['joe', 'Ravens', 'W', 3],
  ['cummiskey', 'Chiefs', 'W', 4],
  ['little', 'Lions', 'W', 5],
  ['corley', 'Commanders', 'W', 6],

  ['corley', 'Saints', 'L', 7],
  ['little', 'Browns', 'L', 8],
  ['cummiskey', 'Jets', 'L', 9],
  ['joe', 'Texans', 'W', 10],
  ['alec', 'Colts', 'L', 11],
  ['duriez', 'Giants', 'L', 12],

  ['duriez', '49ers', 'W', 13],
  ['alec', 'Panthers', 'L', 14],
  ['joe', 'Titans', 'L', 15],
  ['cummiskey', 'Bengals', 'W', 16],
  ['little', 'Chargers', 'W', 17],
  ['corley', 'Buccaneers', 'W', 18],

  ['corley', 'Rams', 'W', 19],
  ['little', 'Raiders', 'L', 20],
  ['cummiskey', 'Packers', 'W', 21],
  ['joe', 'Cowboys', 'L', 22],
  ['alec', 'Broncos', 'W', 23],
  ['duriez', 'Patriots', 'W', 24],

  ['duriez', 'Seahawks', 'L', 25],
  ['alec', 'Jaguars', 'L', 26],
  ['joe', 'Dolphins', 'L', 27],
  ['cummiskey', 'Falcons', 'L', 28],
  ['little', 'Falcons', 'W', 29],
  ['corley', 'Cardinals', 'L', 30],
];

export const PICKS = RAW_PICKS.map(([teamId, nflTeam, direction, pickNo]) => ({
  id: `${nflTeam}-${direction}`,
  teamId,
  nflTeam,
  direction,
  pickNo,
  round: Math.floor((pickNo - 1) / TEAMS.length) + 1,
}));

export function defaultLeague() {
  return { teams: TEAMS, picks: PICKS };
}
