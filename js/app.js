import { WEEKS, WEEK_BY_ID, scorePick, computeTotals, computeStandings, bonusEnabledForWeek } from './scoring.js';
import { load, save, defaultState, exportToFile, importFromFile } from './store.js';

let state = load();
let activeView = 'entry';
let selectedWeek = '1';
let selectedTeam = state.league.teams[0].id;

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

function commit() {
  save(state);
  render();
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
  bonusBox.addEventListener('change', (e) => {
    state.settings.bonusEnabledByWeek[week.id] = e.target.checked;
    commit();
  });
  bonusToggle.append(bonusBox, el('span', null, `Bonus skins active for ${week.label}`));
  controls.append(bonusToggle);

  root.append(controls);

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
    row.append(nameCell);

    const resultSelect = el('select');
    for (const [value, label] of [['', 'Did not play'], ['W', 'Won'], ['L', 'Lost'], ['T', 'Tied']]) {
      const opt = el('option', null, label);
      opt.value = value;
      opt.selected = (entry?.result ?? '') === value;
      resultSelect.append(opt);
    }
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
  if (!result) {
    delete state.results[weekId]?.[pickId];
  } else {
    state.results[weekId] ??= {};
    const existing = state.results[weekId][pickId];
    state.results[weekId][pickId] = {
      result,
      pointsFor: existing?.pointsFor ?? null,
      pointsAgainst: existing?.pointsAgainst ?? null,
    };
  }
  commit();
}

function setPoints(weekId, pickId, key, rawValue) {
  const entry = state.results[weekId]?.[pickId];
  if (!entry) return; // set a result first
  const parsed = rawValue === '' ? null : Number(rawValue);
  entry[key] = Number.isFinite(parsed) ? parsed : null;
  commit();
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

// --------------------------------------------------------------------- shell

const VIEWS = {
  entry: { label: 'Weekly Entry', render: renderEntry },
  standings: { label: 'Standings', render: renderStandings },
  matrix: { label: 'Skins by Week', render: renderMatrix },
  draft: { label: 'Draft Board', render: renderDraft },
};

function render() {
  const nav = $('#nav');
  nav.replaceChildren();
  for (const [id, view] of Object.entries(VIEWS)) {
    const button = el('button', id === activeView ? 'tab active' : 'tab', view.label);
    button.addEventListener('click', () => {
      activeView = id;
      render();
    });
    nav.append(button);
  }

  const root = $('#view');
  root.replaceChildren();
  VIEWS[activeView].render(root);
}

function initToolbar() {
  const skinValueInput = $('#skin-value');
  skinValueInput.value = state.settings.skinValue;
  skinValueInput.addEventListener('change', (e) => {
    const parsed = Number(e.target.value);
    state.settings.skinValue = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    e.target.value = state.settings.skinValue;
    commit();
  });

  $('#export').addEventListener('click', () => exportToFile(state));

  $('#import-file').addEventListener('change', async (e) => {
    const [file] = e.target.files;
    if (!file) return;
    try {
      state = await importFromFile(file);
      selectedTeam = state.league.teams[0].id;
      $('#skin-value').value = state.settings.skinValue;
      commit();
    } catch (err) {
      alert(`Could not read that file: ${err.message}`);
    }
    e.target.value = '';
  });

  $('#reset').addEventListener('click', () => {
    if (!confirm('Erase all entered results and settings? Export first if you want a backup.')) return;
    state = defaultState();
    selectedTeam = state.league.teams[0].id;
    $('#skin-value').value = state.settings.skinValue;
    commit();
  });
}

initToolbar();
render();
