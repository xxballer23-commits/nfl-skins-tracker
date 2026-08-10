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
- **Draft Setup** — start a new season: edit team names and rosters, randomise the
  draft order, and work down the 30-slot snake board. Hidden on archived seasons.

## Scoring

Base skin, one per pick per week the drafted team plays:

- **Win pick** — 1 skin if the team wins.
- **Lose pick** — 1 skin if the team loses.
- Bye week or no game — 0 skins, leave the row on "did not play".

Bonus skins stack on top of the base skin. The two conditions are independent
checks, so one pick can earn all three skins in a week (a Win pick that wins 42-6
gets base + held-to-10-or-fewer + scored-40-or-more):

| Pick type | Condition | Bonus |
|---|---|---|
| Win  | Wins AND holds opponent to 10 or fewer | +1 |
| Win  | Wins AND scores 40 or more | +1 |
| Lose | Loses AND scores 10 or fewer | +1 |
| Lose | Loses AND opponent scores 40 or more | +1 |

**On the low threshold:** the spec doc says "under 9.5". Replaying the 2025
season against real ESPN scores showed the league actually played "10 or fewer" —
25 of 114 team-weeks disagreed under 9.5 versus 1 under 10.5, with 29 pick-weeks
hinging on a team held to exactly 10. The engine uses 10.5. The high threshold
(39.5) was confirmed correct as written.

**Postseason rule:** during Wild Card, Divisional, Conf. Champ and Super Bowl,
every Lose pick scores 0 regardless of the result or the margin. Only Win picks
can score in those weeks.

**Payout:** Mendoza Line is the average total skins across all 6 teams.
`Team $ = (team total - Mendoza) x skin value`, halved for the per-teammate
figure. Zero-sum by construction.

Skin value (default $100) is editable in the header. Bonus skins can be toggled
per week from the Weekly Entry screen; every week including Week 1 defaults to on.

## How results get in

Results pull themselves. A GitHub Action runs daily, fetches finished games from
ESPN, and commits the refreshed season files, so the published scoreboard updates
without anyone touching it. Everyone who opens the site sees the same numbers.

Two layers, deliberately kept apart:

- **Published** — `data/<season>-season.json`, committed to the repo and
  refreshed by the Action. This is what every visitor sees.
- **Corrections** — your edits on the Weekly Entry screen, held in `localStorage`
  in your browser only. They get an `EDITED` badge and change what *you* see
  immediately, but nobody else sees them yet.

To publish a correction: hit **Export corrections**, which downloads
`<season>-overrides.json`, and commit that file to `data/`. The next pull folds
it back in, so an auto-update can never overwrite one of your rulings. Reverting
an edit to the published value drops it from the file rather than storing a
no-op. Archived seasons render read-only.

That is why the site needs no logins — editing changes nothing for anyone else
until you commit the file.

## Commissioner mode

Editing is hidden by default, so the plain link gives the league a clean,
read-only board. Open `?edit=cummiskey` once and the browser remembers it;
`?edit=off` signs back out. Because the page is public this is a signpost rather
than a lock — the key is visible in `js/app.js` and anyone could work around it.
It does not need to be stronger: the published data only ever changes by commit.

Switch seasons from the header. `data/seasons.json` lists what is available and
which one loads by default.

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
Falls back to `node` if present. Three suites, 1290 assertions:

- `test/scoring.test.mjs` — 44 assertions covering the scoring rules directly:
  each bonus in isolation, both bonuses stacking, the 10.5/39.5 boundaries,
  byes, ties, the bonus toggle, and the postseason Lose-pick rule.
- `test/validate.mjs` — 391 assertions replaying last season through the engine
  and comparing against the Excel tracker.
- `test/validate-real.mjs` — 855 assertions replaying last season from **real
  ESPN game scores** and comparing against the same tracker. This is the
  end-to-end check the spreadsheet alone could not support.

## Season data

Two generated files per season, both plain JSON:

- `data/2025-games.json` — every NFL team's result for every week, straight from
  ESPN's public scoreboard API. No league knowledge, so rosters can change
  without refetching.
- `data/2025-season.json` — the games file mapped onto the draft picks, ready to
  **Import JSON** into the app.

```sh
python3 tools/fetch_results.py 2025 --out data/2025-games.json
python3 tools/build_season.py data/2025-games.json --out data/2025-season.json \
  --fixture test/2025-season.fixture.mjs --skip-week 1
```

`fetch_results.py` uses no API key and no dependencies, and only writes completed
games, so it is safe to re-run mid-week. `--skip-week 1` records that the league
did not play Week 1 in 2025; that does not apply from 2026 on.

### Starting a new season

1. Open **Draft Setup**. It starts from last season's rosters, so edit the team
   names and members, then hit **Randomise draft order**. Reordering clears the
   board, so randomise before you pick.
2. Work down the 30 slots. A team+direction combination disappears from every
   other slot once it is taken, but the same NFL team may be drafted once as WIN
   and once as LOSE, so picking a team whose WIN is gone defaults to LOSE.
3. Hit **Export league file** and commit the download as `data/<season>-league.json`.
4. Point the builder at it, and the Action takes over from there:

```sh
python3 tools/build_season.py data/2026-games.json --league data/2026-league.json \
  --out data/2026-season.json
```

Until step 3, the draft only exists in your browser. Everyone else keeps seeing
the published board.

### 2025 vs. the spreadsheet

The 2025 archive is recomputed from real scores, so it differs from the
spreadsheet in exactly three places. All three are asserted by name in
`test/validate-real.mjs`:

1. **Cummiskey / Culp, Week 6** — the sheet credited a base skin for "Bengals W",
   but the Bengals lost 18-27. Data-entry error, now corrected.
2. **Alec / Nick, Week 13** — Bills won 26-7, which earns the held-under bonus.
   The sheet missed it.
3. **Duriez / Cam, Conf. Champ** — the workbook was last saved after the
   Divisional round and has no Conf. Champ or Super Bowl results at all. The
   Patriots then won 10-7, worth base + held-under.

Net effect on the final table: Duriez / Cam +2, Alec / Nick +1, Cummiskey / Culp
-1. The finishing order is unchanged.

### About `data/last-season-validation.json`

This is the older fixture built from the spreadsheet alone, kept so the original
comparison still runs. Prefer `data/2025-season.json` for anything real — the
spreadsheet never recorded game scores, so this file synthesises them and its
per-pick bonus splits are arbitrary. Team-level numbers are faithful; the
Draft Board bonus column is not.

`test/extract_spreadsheet.py` regenerates it. It needs `openpyxl` and only has
to be rerun if the spreadsheet changes:

```sh
python3 test/extract_spreadsheet.py "../NFL Skins League (01.25.26)_v1.xlsx" \
  data/last-season-validation.json
```

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
