#!/usr/bin/env python3
"""Fetch NFL results from ESPN's public scoreboard API into a games file.

The output is league-agnostic: one entry per NFL team per week, keyed by the
team nickname ESPN uses ("Bills", "49ers", "Commanders"). The app maps its own
draft picks onto that, so rosters can change without touching this script.

    python3 tools/fetch_results.py 2025 --out data/2025-games.json

No API key, no dependencies. Only completed games are written, so re-running
mid-week is safe and idempotent.
"""

import argparse
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

API = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"

# (seasontype, espn week number) -> our week id.
# seasontype 2 = regular season, 3 = postseason. Postseason week 4 is the Pro
# Bowl and is deliberately skipped.
WEEK_MAP = [(2, n, str(n)) for n in range(1, 19)] + [
    (3, 1, "WC"),
    (3, 2, "DIV"),
    (3, 3, "CC"),
    (3, 5, "SB"),
]


def fetch(season, seasontype, week, cache_dir):
    url = f"{API}?dates={season}&seasontype={seasontype}&week={week}"
    if cache_dir:
        os.makedirs(cache_dir, exist_ok=True)
        path = os.path.join(cache_dir, f"s{season}_t{seasontype}_w{week}.json")
        if os.path.exists(path):
            with open(path) as fh:
                return json.load(fh)
    with urllib.request.urlopen(url, timeout=30) as resp:
        payload = json.load(resp)
    if cache_dir:
        with open(path, "w") as fh:
            json.dump(payload, fh)
    return payload


def games_for_week(payload):
    """{ teamNickname: {result, pointsFor, pointsAgainst, opponent} } for completed games."""
    out = {}
    for event in payload.get("events", []):
        for competition in event.get("competitions", []):
            if not competition.get("status", {}).get("type", {}).get("completed"):
                continue
            competitors = competition.get("competitors", [])
            if len(competitors) != 2:
                continue
            a, b = competitors
            for side, other in ((a, b), (b, a)):
                try:
                    pf = int(side["score"])
                    pa = int(other["score"])
                except (KeyError, TypeError, ValueError):
                    continue
                result = "W" if pf > pa else "L" if pf < pa else "T"
                out[side["team"]["name"]] = {
                    "result": result,
                    "pointsFor": pf,
                    "pointsAgainst": pa,
                    "opponent": other["team"]["name"],
                }
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("season", type=int, help="season year, e.g. 2025")
    parser.add_argument("--out", required=True)
    parser.add_argument("--cache", default=None, help="optional directory to cache raw API responses")
    args = parser.parse_args()

    weeks = {}
    for seasontype, espn_week, week_id in WEEK_MAP:
        try:
            payload = fetch(args.season, seasontype, espn_week, args.cache)
        except Exception as exc:  # noqa: BLE001 - a missing week should not kill the run
            print(f"  {week_id}: fetch failed ({exc})", file=sys.stderr)
            continue
        games = games_for_week(payload)
        if games:
            weeks[week_id] = games
        print(f"  {week_id}: {len(games)} teams")

    doc = {
        "season": args.season,
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "weeks": weeks,
    }
    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w") as fh:
        json.dump(doc, fh, indent=0, sort_keys=True)
        fh.write("\n")
    print(f"wrote {args.out} ({len(weeks)} weeks)")


if __name__ == "__main__":
    main()
