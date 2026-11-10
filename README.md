# Everyversion — MVP

Static software-version resolver. Source: winget-pkgs only. 100 apps. No framework, no database.

```
config/apps.txt      the 100 winget IDs (+ curated pricing label, slug override)
schema/app.schema.json   record schema (also published at /schema/app.schema.json)
scripts/ingest.mjs   sparse clone of microsoft/winget-pkgs -> data/apps/<slug>.json
scripts/validate.mjs schema + invariants
scripts/build.mjs    data -> dist/ (plain HTML, JSON-LD, .json/.md twins, sitemap, llms.txt)
scripts/check.mjs    JSON-LD, links, sitemap, title checks on dist/
```

```bash
npm install
npm run all      # ingest -> validate -> build -> check
npm run serve    # http://localhost:4173
```

Rules the data follows: every field is copied from a manifest or derived by a fixed rule. Anything winget does not provide
(file size, SHA-1, categories, translation link, signature status, pros/cons) is absent, not guessed.
Page "free" wording appears only when pricing is derived from an open-source/freeware license or curated by hand.

## Daily routine

One command does everything for new apps: add to config, ingest from winget, match the Homebrew cask, download and
verify installers (SHA-256 + code signatures), look the hashes up on VirusTotal, build the site, run the checks and print a report.

```bash
npm run add -- "Joplin.Joplin" "AnyDesk.AnyDesk free-to-download"   # add apps (winget IDs; optional pricing label), then run everything
npm run daily                                                       # catch up on anything in config/apps.txt that is not done yet
npm run daily -- --only=Joplin.Joplin                               # re-read just one app (e.g. after adding cask=<token> to its line)
npm run daily -- --refresh                                          # re-read every app from winget; changed apps are re-verified
```

Options: `--max-mb=N` (optional; leaves apps with a bigger installer unchecked, and there is no size limit by default), `--jobs=3`, `--no-verify`, `--no-vt`, `--no-icons`, `--no-build`.

- **Homebrew match:** a cask is matched automatically only when the name AND the website (or download source) agree. Anything less is
  reported under "needs a look". `@beta` and `@insiders` casks are ignored.
- **Safe to re-run:** every step skips what is already done; a failed step can simply be run again.
- **VirusTotal** needs a free key in `.env` (`VT_API_KEY=...`, git-ignored). The free key allows about 4 lookups a minute.
- **Verification is only valid for the exact installers it checked.** If winget moves an app to a new version, the old result is
  ignored by the build and the app is re-verified on the next run.
- Raw results live in `data/verification.json` and `data/virustotal.json`; trusted extra roots in `data/roots/`.

## Feature notes (editorial)

Some app pages carry hand-written notes inside the Description section: a one-line "Best for" under the description, then 5 to 8 bullets on what the app does and where it stops. The text lives in `config/features/<slug>.json` (one file per app) and is rendered on the page and in the `.md` twin by `scripts/lib/features.mjs`. Apps without a file show only the description.

```
{ "slug", "reviewed": "YYYY-MM-DD",
  "best_for": "one line, written for the reader: their system, their job, their problem",
  "points": [{ "title", "text" }],          5 to 8 bullets; titles are free, so the structure differs per app
  "sources": [{ "label", "url" }] }          the official pages the text is based on (https only); not printed on the page
```

Rules: write in our own words, never copy sentences; say what the app does not do (plan limits, account needs, platform gaps, per-platform differences); include only what was confirmed on a page, and leave out anything unconfirmed. `sources` and `reviewed` are the audit trail: re-check a file when the app's plans or platforms change and update `reviewed`. `npm run validate` checks each file; `npm run check` checks the notes appear exactly for the apps with a file.

## Deploying (Apache)

Upload **all of `dist/`, including the hidden `dist/.htaccess`**. Many FTP and upload tools skip hidden files by default; turn that off, or the rules below are not applied. The file is generated from `assets/htaccess` on every build.

What it does: sends every http, `www` and other-hostname request to `https://everyversion.net/` in a single 301; answers 404 (never a file list) for any folder without an `index.html` (today `/api/v1/`, `/brand/`, `/fonts/`, `/schema/`); hides dotfiles and backup files (`.DS_Store`, `.git`, `*.sql`, `*~`); and serves `404.html` for missing pages. It needs Apache 2.4 with `mod_rewrite` and `AllowOverride All` (or `FileInfo` and `Options`) for the site folder. If a host answers 500, remove the `Options -Indexes` line; the listing protection does not depend on it.

Delete any `.DS_Store` files from `dist/` before uploading (`npm run check` warns about them). After a deploy, these should all be 404: `/api/v1/`, `/fonts/`, `/brand/`, `/schema/`, `/.DS_Store`. And `http://www.everyversion.net/` should answer one 301 to `https://everyversion.net/`.


## Analytics (first-party, no cookies)

Pageviews and clicks on the Download / Install / copy-command buttons are counted by our own code and stored as NDJSON files on the server. No database, no third parties, no cookies, no IP addresses stored. The totals are public at `/statistics/`.

```
assets/t.js            browser beacon (sendBeacon), loaded on every page. Buttons carry data-t / data-slot / data-pl / data-ar / data-ty / data-h attributes (set in scripts/build.mjs)
server/collect.php     receives the beacons, validates them, appends one JSON line to <data dir>/events-YYYY-MM-DD.ndjson
server/stats-data.php  public aggregated JSON for the stats page (per-day rollups in <data dir>/rollup-YYYY-MM-DD.json)
assets/stats.js        draws /statistics/ from stats-data.php (plain SVG)
```

- **Needs PHP 8+ on the host.** `npm run build` copies the three PHP files and both scripts into `dist/`.
- **Data folder:** `EVERYVERSION_DATA` if set, else `<parent of the web root>/everyversion-data` (recommended: not reachable from the web), else `<web root>/_data` (then it is protected by a deny-all `.htaccess`). It must be writable by PHP. Back it up; it is the only copy of the raw events.
- **Visitors per day only:** a visitor is `sha256(today's random salt + IP + user agent)`. The salt file is deleted when the day changes, so hashes cannot be recomputed or followed across days. Raw events are deleted after 400 days (the rollups, which hold no hashes, stay).
- **Country** comes from Cloudflare's `CF-IPCountry` header: in the Cloudflare dashboard, Network -> **IP Geolocation** must be ON. Without it every country shows as "Unknown".
- Sends nothing when the browser has Do Not Track or Global Privacy Control on. Bots are ignored.

### Keep Cloudflare from caching the endpoints

`collect.php` answers `Cache-Control: no-store, no-cache, must-revalidate, max-age=0, private` and `/stats-data.php` answers `private, max-age=60`. Cloudflare does not cache `.php` or JSON by default, never caches POST, and respects `no-store`/`private`. To make sure it stays that way even if someone adds a "Cache Everything" rule later: Cloudflare dashboard -> **Caching -> Cache Rules -> Create rule**, name "Analytics never cached", When *URI Path* **is in** `/collect.php` `/stats-data.php`, Then **Bypass cache**, and place it above any other cache rule. Check with:

```bash
curl -sI "https://everyversion.net/stats-data.php?days=30" | grep -i -E "cache-control|cf-cache-status|age"
curl -si -X POST https://everyversion.net/collect.php | grep -i -E "HTTP|cache-control|cf-cache-status|age"
```

`cf-cache-status` must be `DYNAMIC` or `BYPASS` (never `HIT`), and there must be no `age` header.

**Why `/statistics/` and not `/stats/`:** the host reserves the `/stats` path for its own tooling (it answered 403 and 404 for anything under `/stats/` with Apache's default page), so the public page lives at `/statistics/`. The data endpoint `/stats-data.php` and the script `/stats.js` are not affected.
