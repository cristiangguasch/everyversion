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

## Deploying (Apache)

Upload **all of `dist/`, including the hidden `dist/.htaccess`**. Many FTP and upload tools skip hidden files by default; turn that off, or the rules below are not applied. The file is generated from `assets/htaccess` on every build.

What it does: sends every http, `www` and other-hostname request to `https://everyversion.net/` in a single 301; answers 404 (never a file list) for any folder without an `index.html` (today `/api/v1/`, `/brand/`, `/fonts/`, `/schema/`); hides dotfiles and backup files (`.DS_Store`, `.git`, `*.sql`, `*~`); and serves `404.html` for missing pages. It needs Apache 2.4 with `mod_rewrite` and `AllowOverride All` (or `FileInfo` and `Options`) for the site folder. If a host answers 500, remove the `Options -Indexes` line; the listing protection does not depend on it.

Delete any `.DS_Store` files from `dist/` before uploading (`npm run check` warns about them). After a deploy, these should all be 404: `/api/v1/`, `/fonts/`, `/brand/`, `/schema/`, `/.DS_Store`. And `http://www.everyversion.net/` should answer one 301 to `https://everyversion.net/`.
