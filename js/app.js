import { WEEKS, WEEK_BY_ID, scorePick, computeTotals, computeStandings, bonusEnabledForWeek } from './scoring.js';
import {
  fetchSeasons,
  fetchBaseline,
  loadOverrides,
  saveOverrides,
  clearOverrides,
  emptyOverrides,
  merge,
  isOverridden,
  countOverrides,
  exportOverrides,
  exportLeague,
  importOverrides,
  loadDraft,
  saveDraft,
  clearDraft,
} from './store.js';
import { shuffle, snakeSlots, toLeague, draftProblems, availableSelections, draftFromLeague } from './draft.js';
import { NFL_TEAMS } from './nfl-teams.js';

let seasons = [];      // entries from data/seasons.json
let season = null;     // the selected one
let baseline = null;   // published results for that season
let overrides = null;  // local corrections layered on top
let draft = null;      // a local draft in progress, or null to use the published board
let state = null;      // baseline + overrides, what every view renders from

let activeView = 'entry';
let selectedWeek = '1';
let selectedTeam = null;

/**
 * Editing is off by default so the league can share the plain link without
 * anyone landing on a screen full of live inputs. Visiting ?edit=<key> once
 * turns it on and the browser remembers it. This is a signpost, not security:
 * the page is public and anyone can read the key here. Nothing a viewer does
 * leaves their own browser anyway, since publishing needs a commit.
 */
const EDIT_KEY = 'cummiskey';
const EDITOR_FLAG = 'nfl-skins-tracker-v2:editor';

function resolveEditor() {
  const asked = new URLSearchParams(location.search).get('edit');
  if (asked === null) return localStorage.getItem(EDITOR_FLAG) === 'yes';
  const granted = asked === EDIT_KEY;
  try {
    if (granted) localStorage.setItem(EDITOR_FLAG, 'yes');
    else localStorage.removeItem(EDITOR_FLAG); // ?edit=off signs you out
  } catch (err) {
    console.warn('Could not remember editor mode.', err);
  }
  return granted;
}

const isEditor = resolveEditor();

/** Archived seasons are settled, and viewers never edit, so both render read-only. */
const readOnly = () => season?.archived === true || !isEditor;

const $ = (sel) => document.querySelector(sel);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const money = (n) =>
  `${n < 0 ? '-' : '+'}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const signed = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;

/** A local draft, once started, replaces the published board everywhere. */
function rebuild() {
  state = merge(baseline, overrides);
  if (draft) state.league = toLeague(draft);
}

function commit() {
  rebuild();
  saveOverrides(season.id, overrides);
  render();
}

function commitDraft() {
  saveDraft(season.id, draft);
  rebuild();
  render();
}

const sameEntry = (a, b) =>
  a === null || b === null
    ? a === b
    : a.result === b.result && a.pointsFor === b.pointsFor && a.pointsAgainst === b.pointsAgainst;

/**
 * Record a correction. If it turns out to match what was published, drop it
 * instead of storing a no-op, so the exported file only ever lists real changes.
 */
function setOverride(weekId, pickId, entry) {
  const published = baseline.results[weekId]?.[pickId] ?? null;
  if (sameEntry(entry, published)) {
    delete overrides.weeks[weekId]?.[pickId];
    if (overrides.weeks[weekId] && !Object.keys(overrides.weeks[weekId]).length) {
      delete overrides.weeks[weekId];
    }
  } else {
    overrides.weeks[weekId] ??= {};
    overrides.weeks[weekId][pickId] = entry;
  }
  commit();
}

// ---------------------------------------------------------------- entry view

function renderEntry(root) {
  const week = WEEK_BY_ID[selectedWeek];
  const team = state.league.teams.find((t) => t.id === selectedTeam);
  const picks = state.league.picks.filter((p) => p.teamId === selectedTeam);
  const bonusOn = bonusEnabledForWeek(state.settings, week.id);

  const controls = el('div', 'controls');

  const weekSelect = el('select');
  for (const w of WEEKS) {
    const opt = el('option', null, w.label);
    opt.value = w.id;
    opt.selected = w.id === selectedWeek;
    weekSelect.append(opt);
  }
  weekSelect.addEventListener('change', (e) => {
    selectedWeek = e.target.value;
    render();
  });

  const teamSelect = el('select');
  for (const t of state.league.teams) {
    const opt = el('option', null, t.name);
    opt.value = t.id;
    opt.selected = t.id === selectedTeam;
    teamSelect.append(opt);
  }
  teamSelect.addEventListener('change', (e) => {
    selectedTeam = e.target.value;
    render();
  });

  controls.append(labeled('Week', weekSelect), labeled('Team', teamSelect));

  const bonusToggle = el('label', 'toggle');
  const bonusBox = el('input');
  bonusBox.type = 'checkbox';
  bonusBox.checked = bonusOn;
  bonusBox.disabled = readOnly();
  bonusBox.addEventListener('change', (e) => {
    overrides.settings.bonusEnabledByWeek ??= {};
    overrides.settings.bonusEnabledByWeek[week.id] = e.target.checked;
    commit();
  });
  bonusToggle.append(bonusBox, el('span', null, `Bonus skins active for ${week.label}`));
  controls.append(bonusToggle);

  root.append(controls);

  if (season.archived) {
    root.append(el('p', 'notice', `${season.label} is archived and cannot be edited. ${season.note ?? ''}`));
  } else if (readOnly()) {
    root.append(el('p', 'notice', 'Results come straight from ESPN and update on their own. Only the commissioner can enter corrections.'));
  }

  if (week.postseason) {
    root.append(
      el('p', 'notice', 'Postseason week: Lose picks earn 0 skins regardless of result. Only Win picks can score.')
    );
  }

  const table = el('table', 'grid');
  table.innerHTML = `
    <thead><tr>
      <th>Pick</th><th>Result</th><th>Points For</th><th>Points Against</th><th class="num">Skins</th>
    </tr></thead>`;
  const tbody = el('tbody');

  let weekTotal = 0;
  for (const pick of picks) {
    const entry = state.results[week.id]?.[pick.id] ?? null;
    const skins = scorePick(pick.direction, entry, {
      postseason: week.postseason,
      bonusEnabled: bonusOn,
    });
    weekTotal += skins.total;

    const row = el('tr');
    if (week.postseason && pick.direction === 'L') row.className = 'muted';

    const nameCell = el('td');
    nameCell.append(
      el('span', 'pick-name', pick.nflTeam),
      el('span', `badge badge-${pick.direction}`, pick.direction === 'W' ? 'WIN' : 'LOSE')
    );
    if (isOverridden(overrides, week.id, pick.id)) {
      nameCell.append(el('span', 'badge badge-edited', 'EDITED'));
    }
    row.append(nameCell);

    const resultSelect = el('select');
    for (const [value, label] of [['', 'Did not play'], ['W', 'Won'], ['L', 'Lost'], ['T', 'Tied']]) {
      const opt = el('option', null, label);
      opt.value = value;
      opt.selected = (entry?.result ?? '') === value;
      resultSelect.append(opt);
    }
    resultSelect.disabled = readOnly();
    resultSelect.addEventListener('change', (e) => setResult(week.id, pick.id, e.target.value));
    row.append(wrapCell(resultSelect));

    row.append(wrapCell(scoreInput(week.id, pick.id, 'pointsFor', entry?.pointsFor)));
    row.append(wrapCell(scoreInput(week.id, pick.id, 'pointsAgainst', entry?.pointsAgainst)));

    const skinsCell = el('td', 'num');
    skinsCell.append(el('span', skins.total > 0 ? 'skins skins-on' : 'skins', String(skins.total)));
    if (skins.bonus > 0) skinsCell.append(el('span', 'breakdown', `${skins.base} base + ${skins.bonus} bonus`));
    row.append(skinsCell);

    tbody.append(row);

    const warning = mismatchWarning(entry);
    if (warning) {
      const warnRow = el('tr', 'warn-row');
      const cell = el('td', null, warning);
      cell.colSpan = 5;
      warnRow.append(cell);
      tbody.append(warnRow);
    }
  }

  table.append(tbody);
  const tfoot = el('tfoot');
  const totalRow = el('tr');
  const totalLabel = el('th', null, `${team.name} — ${week.label} total`);
  totalLabel.colSpan = 4;
  totalRow.append(totalLabel, el('th', 'num', String(weekTotal)));
  tfoot.append(totalRow);
  table.append(tfoot);
  root.append(table);
}

function labeled(text, control) {
  const wrap = el('label', 'field');
  wrap.append(el('span', null, text), control);
  return wrap;
}

function wrapCell(control) {
  const cell = el('td');
  cell.append(control);
  return cell;
}

function scoreInput(weekId, pickId, key, value) {
  const input = el('input');
  input.type = 'number';
  input.min = '0';
  input.value = value ?? '';
  input.placeholder = '—';
  input.disabled = readOnly();
  input.addEventListener('change', (e) => setPoints(weekId, pickId, key, e.target.value));
  return input;
}

function mismatchWarning(entry) {
  if (!entry || !Number.isFinite(entry.pointsFor) || !Number.isFinite(entry.pointsAgainst)) return null;
  const implied =
    entry.pointsFor > entry.pointsAgainst ? 'W' : entry.pointsFor < entry.pointsAgainst ? 'L' : 'T';
  if (implied === entry.result) return null;
  const word = { W: 'a win', L: 'a loss', T: 'a tie' }[implied];
  return `Scores say ${word} (${entry.pointsFor}-${entry.pointsAgainst}) but the result is set to "${entry.result}". Skins use the result field.`;
}

function setResult(weekId, pickId, result) {
  const existing = state.results[weekId]?.[pickId];
  setOverride(
    weekId,
    pickId,
    result
      ? { result, pointsFor: existing?.pointsFor ?? null, pointsAgainst: existing?.pointsAgainst ?? null }
      : null
  );
}

function setPoints(weekId, pickId, key, rawValue) {
  const entry = state.results[weekId]?.[pickId];
  if (!entry) return; // set a result first
  const parsed = rawValue === '' ? null : Number(rawValue);
  setOverride(weekId, pickId, { ...entry, [key]: Number.isFinite(parsed) ? parsed : null });
}

// ------------------------------------------------------------ standings view

function renderStandings(root) {
  const { byTeam } = computeTotals(state);
  const { mendoza, rows } = computeStandings(Object.values(byTeam), state.settings.skinValue);

  const summary = el('div', 'summary');
  summary.append(stat('Mendoza Line', mendoza.toFixed(2)), stat('Skin Value', `$${state.settings.skinValue}`));
  root.append(summary);

  const table = el('table', 'grid');
  table.innerHTML = `
    <thead><tr>
      <th class="num">#</th><th>Team</th><th class="num">Skins</th><th class="num">Bonus Skins</th>
      <th class="num">Total Skins</th><th class="num">Mendoza +/-</th>
      <th class="num">$ +/- Team</th><th class="num">$ +/- Teammate</th>
    </tr></thead>`;
  const tbody = el('tbody');
  rows.forEach((row, i) => {
    const tr = el('tr');
    tr.append(
      el('td', 'num', String(i + 1)),
      el('td', null, row.name),
      el('td', 'num', String(row.base)),
      el('td', 'num', String(row.bonus)),
      el('td', 'num strong', String(row.total)),
      el('td', `num ${row.diff >= 0 ? 'pos' : 'neg'}`, signed(row.diff)),
      el('td', `num ${row.dollarsTeam >= 0 ? 'pos' : 'neg'}`, money(row.dollarsTeam)),
      el('td', `num ${row.dollarsTeam >= 0 ? 'pos' : 'neg'}`, money(row.dollarsPerTeammate))
    );
    tbody.append(tr);
  });
  table.append(tbody);
  root.append(table);
}

function stat(label, value) {
  const box = el('div', 'stat');
  box.append(el('span', 'stat-label', label), el('span', 'stat-value', value));
  return box;
}

// --------------------------------------------------------- skins by week view

function renderMatrix(root) {
  const { byTeam } = computeTotals(state);
  const teams = state.league.teams;

  const table = el('table', 'grid matrix');
  const head = el('tr');
  head.append(el('th', null, 'Week'));
  for (const team of teams) head.append(el('th', 'num', team.name));
  const thead = el('thead');
  thead.append(head);
  table.append(thead);

  const tbody = el('tbody');
  for (const week of WEEKS) {
    const tr = el('tr');
    if (week.postseason) tr.className = 'postseason';
    tr.append(el('th', null, week.label));
    for (const team of teams) {
      tr.append(el('td', 'num', String(byTeam[team.id].byWeek[week.id].total)));
    }
    tbody.append(tr);
  }
  table.append(tbody);

  const tfoot = el('tfoot');
  const totalRow = el('tr');
  totalRow.append(el('th', null, 'Season'));
  for (const team of teams) totalRow.append(el('th', 'num', String(byTeam[team.id].total)));
  tfoot.append(totalRow);
  table.append(tfoot);

  root.append(table);
}

// ----------------------------------------------------------- draft board view

function renderDraft(root) {
  const { byPick } = computeTotals(state);
  const teamName = Object.fromEntries(state.league.teams.map((t) => [t.id, t.name]));

  const table = el('table', 'grid');
  table.innerHTML = `
    <thead><tr>
      <th class="num">Pick</th><th class="num">Round</th><th>Team</th><th>Selection</th>
      <th class="num">Skins</th><th class="num">Bonus</th><th class="num">Total</th>
    </tr></thead>`;
  const tbody = el('tbody');

  for (const pick of [...state.league.picks].sort((a, b) => a.pickNo - b.pickNo)) {
    const totals = byPick[pick.id];
    const tr = el('tr');
    const selection = el('td');
    selection.append(
      el('span', 'pick-name', pick.nflTeam),
      el('span', `badge badge-${pick.direction}`, pick.direction === 'W' ? 'WIN' : 'LOSE')
    );
    tr.append(
      el('td', 'num', String(pick.pickNo)),
      el('td', 'num', String(pick.round)),
      el('td', null, teamName[pick.teamId]),
      selection,
      el('td', 'num', String(totals.base)),
      el('td', 'num', String(totals.bonus)),
      el('td', 'num strong', String(totals.total))
    );
    tbody.append(tr);
  }
  table.append(tbody);
  root.append(table);
}

// ----------------------------------------------------------- draft setup view

function renderSetup(root) {
  root.append(
    el(
      'p',
      'notice',
      'Edit the rosters, randomise the order, then work down the board. Everything here ' +
        'stays in this browser until you export the league file and commit it.'
    )
  );

  root.append(el('h2', 'section-title', 'Teams'));
  const roster = el('table', 'grid');
  roster.innerHTML = '<thead><tr><th>Team name</th><th>Members (comma separated)</th></tr></thead>';
  const rosterBody = el('tbody');
  for (const team of draft.teams) {
    const tr = el('tr');

    const nameInput = el('input');
    nameInput.value = team.name;
    nameInput.placeholder = 'Team name';
    nameInput.addEventListener('change', (e) => {
      team.name = e.target.value;
      commitDraft();
    });

    const membersInput = el('input');
    membersInput.value = team.members.join(', ');
    membersInput.placeholder = 'e.g. Pat, Sam';
    membersInput.addEventListener('change', (e) => {
      team.members = e.target.value.split(',').map((m) => m.trim()).filter(Boolean);
      commitDraft();
    });

    tr.append(wrapCell(nameInput), wrapCell(membersInput));
    rosterBody.append(tr);
  }
  roster.append(rosterBody);
  root.append(roster);

  root.append(el('h2', 'section-title', 'Draft order'));
  const orderRow = el('div', 'controls');
  const teamName = Object.fromEntries(draft.teams.map((t) => [t.id, t.name]));
  const chips = el('div', 'order-chips');
  draft.order.forEach((teamId, i) => {
    const chip = el('span', 'chip');
    chip.append(el('span', 'chip-no', String(i + 1)), el('span', null, teamName[teamId] || '—'));
    chips.append(chip);
  });
  const randomize = el('button', 'btn', 'Randomise draft order');
  randomize.addEventListener('click', () => {
    if (Object.keys(draft.selections).length && !confirm('Reordering clears every pick already made. Continue?')) {
      return;
    }
    draft.order = shuffle(draft.order);
    draft.selections = {};
    commitDraft();
  });
  orderRow.append(randomize);
  root.append(orderRow, chips);

  root.append(el('h2', 'section-title', 'Board'));
  const board = el('table', 'grid');
  board.innerHTML =
    '<thead><tr><th class="num">Pick</th><th class="num">Rd</th><th>Team</th><th>NFL team</th><th>Direction</th></tr></thead>';
  const boardBody = el('tbody');

  for (const slot of snakeSlots(draft.order)) {
    const selection = draft.selections[slot.pickNo] ?? {};
    const tr = el('tr');
    if (!selection.nflTeam) tr.className = 'muted';

    // Only teams still on the board for the chosen direction, plus this slot's
    // own current pick so it does not vanish from its own dropdown.
    const available = availableSelections(draft, NFL_TEAMS, slot.pickNo);

    const teamSelect = el('select');
    const blank = el('option', null, '— on the clock —');
    blank.value = '';
    teamSelect.append(blank);
    for (const nflTeam of NFL_TEAMS) {
      const free = available.some((o) => o.nflTeam === nflTeam);
      const opt = el('option', null, free ? nflTeam : `${nflTeam} (taken)`);
      opt.value = nflTeam;
      opt.disabled = !free;
      opt.selected = selection.nflTeam === nflTeam;
      teamSelect.append(opt);
    }
    teamSelect.addEventListener('change', (e) => setDraftPick(slot.pickNo, 'nflTeam', e.target.value));

    const dirSelect = el('select');
    for (const [value, label] of [['W', 'WIN'], ['L', 'LOSE']]) {
      const taken =
        selection.nflTeam && !available.some((o) => o.nflTeam === selection.nflTeam && o.direction === value);
      const opt = el('option', null, taken ? `${label} (taken)` : label);
      opt.value = value;
      opt.disabled = taken;
      opt.selected = (selection.direction ?? 'W') === value;
      dirSelect.append(opt);
    }
    dirSelect.disabled = !selection.nflTeam;
    dirSelect.addEventListener('change', (e) => setDraftPick(slot.pickNo, 'direction', e.target.value));

    tr.append(
      el('td', 'num', String(slot.pickNo)),
      el('td', 'num', String(slot.round)),
      el('td', null, teamName[slot.teamId] || '—'),
      wrapCell(teamSelect),
      wrapCell(dirSelect)
    );
    boardBody.append(tr);
  }
  board.append(boardBody);
  root.append(board);

  const problems = draftProblems(draft);
  const status = el('div', 'draft-status');
  if (problems.length) {
    const list = el('ul', 'problems');
    for (const problem of problems) list.append(el('li', null, problem));
    status.append(list);
  } else {
    status.append(el('p', 'notice ok', 'Draft complete. Export the league file and commit it to publish.'));
  }
  root.append(status);

  const actions = el('div', 'controls');
  const exportBtn = el('button', 'btn', 'Export league file');
  exportBtn.addEventListener('click', () => exportLeague(season.id, toLeague(draft)));
  const resetBtn = el('button', 'btn btn-danger', 'Discard draft');
  resetBtn.addEventListener('click', () => {
    if (!confirm('Discard this draft and go back to the published board?')) return;
    clearDraft(season.id);
    draft = draftFromLeague(baseline.league, season.id);
    commitDraft();
  });
  actions.append(exportBtn, resetBtn);
  root.append(actions);
}

/**
 * A pick is only real once it has both halves, so choosing an NFL team defaults
 * the direction to whichever of WIN/LOSE is still free.
 */
function setDraftPick(pickNo, key, value) {
  if (key === 'nflTeam' && !value) {
    delete draft.selections[pickNo];
    commitDraft();
    return;
  }
  const current = draft.selections[pickNo] ?? {};
  const next = { ...current, [key]: value };
  if (key === 'nflTeam') {
    const free = availableSelections(draft, NFL_TEAMS, pickNo).filter((o) => o.nflTeam === value);
    if (!free.some((o) => o.direction === next.direction)) next.direction = free[0]?.direction ?? 'W';
  }
  draft.selections[pickNo] = next;
  commitDraft();
}

// --------------------------------------------------------------------- shell

const VIEWS = {
  entry: { label: 'Weekly Entry', render: renderEntry },
  standings: { label: 'Standings', render: renderStandings },
  matrix: { label: 'Skins by Week', render: renderMatrix },
  draft: { label: 'Draft Board', render: renderDraft },
  setup: { label: 'Draft Setup', render: renderSetup, editableOnly: true },
};

function render() {
  const nav = $('#nav');
  nav.replaceChildren();
  for (const [id, view] of Object.entries(VIEWS)) {
    if (view.editableOnly && readOnly()) continue;
    const button = el('button', id === activeView ? 'tab active' : 'tab', view.label);
    button.addEventListener('click', () => {
      activeView = id;
      render();
    });
    nav.append(button);
  }

  renderToolbar();

  const root = $('#view');
  root.replaceChildren();
  VIEWS[activeView].render(root);
}

function renderToolbar() {
  const skinValueInput = $('#skin-value');
  skinValueInput.value = state.settings.skinValue;
  skinValueInput.disabled = readOnly();

  const seasonSelect = $('#season');
  seasonSelect.replaceChildren();
  for (const s of seasons) {
    const opt = el('option', null, s.label);
    opt.value = s.id;
    opt.selected = s.id === season.id;
    seasonSelect.append(opt);
  }

  const pending = countOverrides(overrides);
  const status = $('#status');
  status.replaceChildren();
  if (baseline.updated) {
    status.append(el('span', null, `Results updated ${new Date(baseline.updated).toLocaleString()}`));
  }
  if (pending) {
    status.append(
      el('span', 'pending', `${pending} unpublished correction${pending === 1 ? '' : 's'} — export and commit to publish`)
    );
  }

  $('#export').disabled = pending === 0;
  $('#reset').disabled = pending === 0;

  $('#corrections').hidden = !isEditor;
  $('#footnote').textContent = isEditor
    ? 'Standings come from the published results. Corrections you make here stay in this browser until you export the file and commit it.'
    : 'Standings come from the published results, which update automatically from ESPN.';
}

function initToolbar() {
  $('#season').addEventListener('change', (e) => selectSeason(e.target.value));

  $('#skin-value').addEventListener('change', (e) => {
    const parsed = Number(e.target.value);
    const value = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    if (value === baseline.settings.skinValue) delete overrides.settings.skinValue;
    else overrides.settings.skinValue = value;
    commit();
  });

  $('#export').addEventListener('click', () => exportOverrides(season.id, overrides));

  $('#import-file').addEventListener('change', async (e) => {
    const [file] = e.target.files;
    if (file) {
      try {
        overrides = await importOverrides(file, season.id);
        commit();
      } catch (err) {
        alert(`Could not read that file: ${err.message}`);
      }
    }
    e.target.value = '';
  });

  $('#reset').addEventListener('click', () => {
    if (!confirm('Discard your unpublished corrections and go back to the published results?')) return;
    clearOverrides(season.id);
    overrides = emptyOverrides(season.id);
    commit();
  });
}

// --------------------------------------------------------------- bootstrap

async function selectSeason(seasonId) {
  season = seasons.find((s) => s.id === seasonId) ?? seasons[0];
  baseline = await fetchBaseline(season.id);
  overrides = readOnly() ? emptyOverrides(season.id) : loadOverrides(season.id);
  draft = readOnly() ? null : loadDraft(season.id) ?? draftFromLeague(baseline.league, season.id);
  if (readOnly() && VIEWS[activeView].editableOnly) activeView = 'standings';
  rebuild();
  selectedTeam = state.league.teams[0]?.id ?? null;
  render();
}

async function start() {
  try {
    const manifest = await fetchSeasons();
    seasons = manifest.seasons;
    initToolbar();
    await selectSeason(manifest.current);
  } catch (err) {
    $('#view').replaceChildren(
      el('p', 'notice', `Could not load season data: ${err.message}. The site needs to be served over HTTP.`)
    );
  }
}

start();
