# NFL Skins League Tracker

Manual-entry scoreboard for a 6-team NFL skins league. Static HTML/CSS/JS, no
backend, no build step, no dependencies.

## Views

- **Weekly Entry** — pick a week and a team, enter win/loss + points for + points
  against for each of that team's 5 picks. Skins calculate as you type.
- **Standings** — skins, bonus skins, total skins, Mendoza Line +/-, $ per team,
  $ per teammate.
- **Skins by Week** — weeks down, teams across, weekly totals in the cells.
- **Draft Board** — read-only pick #, round, team, selection, and season skins.

## Scoring

Base skin, one per pick per week the drafted team plays:

- **Win pick** — 1 skin if the team wins.
- **Lose pick** — 1 skin if the team loses.
- Bye week or no game — 0 skins, leave the row on "did not play".

Bonus skins stack on top of the base skin. The two conditions are independent
checks, so one pick can earn all three skins in a week (a Win pick that wins 42-6
gets base + held-under-9.5 + scored-over-39.5):

| Pick type | Condition | Bonus |
|---|---|---|
| Win  | Wins AND holds opponent under 9.5 | +1 |
| Win  | Wins AND scores over 39.5 | +1 |
| Lose | Loses AND scores under 9.5 | +1 |
| Lose | Loses AND opponent scores over 39.5 | +1 |

**Postseason rule:** during Wild Card, Divisional, Conf. Champ and Super Bowl,
every Lose pick scores 0 regardless of the result or the margin. Only Win picks
can score in those weeks.

**Payout:** Mendoza Line is the average total skins across all 6 teams.
`Team $ = (team total - Mendoza) x skin value`, halved for the per-teammate
figure. Zero-sum by construction.

Skin value (default $100) is editable in the header. Bonus skins can be toggled
per week from the Weekly Entry screen; every week including Week 1 defaults to on.

## Data

Everything lives in the browser. Entries autosave to `localStorage`, so a refresh
or a closed tab is safe, but **that is per browser and not a backup**. Use
**Export JSON** at the end of each week and keep the file somewhere real. **Import
JSON** restores it.

## Running locally

ES modules need to be served over HTTP; opening `index.html` straight off disk
will not work.

```sh
cd nfl-skins-tracker
python3 -m http.server 8000
# then open http://localhost:8000
```

## Tests

```sh
./test/run.sh
```

Uses `jsc`, the JavaScript engine bundled with macOS, so nothing needs installing.
Falls back to `node` if present. Two suites:

- `test/scoring.test.mjs` — 40 assertions covering the scoring rules directly:
  each bonus in isolation, both bonuses stacking, the 9.5/39.5 boundaries,
  byes, ties, the bonus toggle, and the postseason Lose-pick rule.
- `test/validate.mjs` — 391 assertions replaying last season through the engine
  and comparing against the Excel tracker.

`test/extract_spreadsheet.py` regenerates the validation fixture from the
spreadsheet. It needs `openpyxl` and only has to be rerun if the spreadsheet
changes:

```sh
python3 test/extract_spreadsheet.py "../NFL Skins League (01.25.26)_v1.xlsx" \
  data/last-season-validation.json
```

### About `data/last-season-validation.json`

Importing this file loads last season into the app. Standings, Skins by Week and
season totals are exact. **Per-pick bonus splits on the Draft Board are not.**

The spreadsheet never recorded game scores — it stored a hand-entered 0/1 base
skin per pick and a single bonus-skin total per team per week. The fixture works
backwards from those numbers by synthesising scores that reproduce them, which
means bonus skins get spread across a team's scoring picks arbitrarily. Every
team-level number is faithful; the per-pick bonus column is not. Real per-pick
numbers require real scores.

## Publishing to GitHub Pages

The repo is already initialised and committed locally. To get it online:

1. Create an empty repo on GitHub — go to <https://github.com/new>, name it
   `nfl-skins-tracker`, choose **Public** (Pages is free on public repos), and do
   **not** tick "Add a README", "Add .gitignore" or "Choose a license". You want a
   completely empty repo, otherwise the first push will conflict.

2. Connect this folder to it and push. Replace `YOUR-USERNAME`:

   ```sh
   cd nfl-skins-tracker
   git remote add origin https://github.com/YOUR-USERNAME/nfl-skins-tracker.git
   git branch -M main
   git push -u origin main
   ```

   If it asks for a password, GitHub wants a personal access token rather than
   your account password. Easiest route is to install the GitHub CLI
   (`brew install gh`), run `gh auth login`, and push again.

3. Turn on Pages — in the repo on GitHub go to **Settings** > **Pages** (left
   sidebar). Under "Build and deployment" set **Source** to *Deploy from a
   branch*, **Branch** to `main`, folder `/ (root)`, and hit **Save**.

4. Wait about a minute, then load
   `https://YOUR-USERNAME.github.io/nfl-skins-tracker/`. The Pages settings page
   shows the live URL once it has deployed.

After that, any future change goes live with:

```sh
git add -A
git commit -m "Week 4 results"
git push
```

Note that the site is public, though it holds no data — entries live only in
whoever's browser is using it.
