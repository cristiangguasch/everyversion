# Everyversion

**[everyversion.net](https://everyversion.net)** is a free index of older and current versions of the software people use. It's for anyone stuck on an update they never asked for: a release that no longer runs on their computer, dropped a feature they relied on, or came bundled with adware.

Every app page links straight to the official download (we host no files) and shows:

- the SHA-256 checksum of each file, so you can check it before you run it
- the release date, the license and a plain summary of what the installer does
- the safety check: our own download, checksum and code-signature check, and the file's VirusTotal result
- older versions, with the same details for each one

Today that's 442 apps for Windows, macOS and Linux. The [About page](https://everyversion.net/about/) tells the story behind it. The site is built by [Cristian Gonzalez Guasch](https://cristianguasch.com/), and the project is open source: [MIT](LICENSE) for the code, [CC BY 4.0](LICENSE-DATA.md) for the data.

## Use the data (API)

All the data behind the site is available as plain JSON files, with no key, signup or price. The [API page](https://everyversion.net/api/) has examples you can run.

| Link | What you get |
|---|---|
| [`/api/v1/apps.json`](https://everyversion.net/api/v1/apps.json) | The index: one short entry per app (name, publisher, platforms, newest version on each, license, price label, category, links). Start here. |
| `/{slug}/{slug}.json`, e.g. [`/vlc/vlc.json`](https://everyversion.net/vlc/vlc.json) | One app's full record: every version we list (up to 100 per platform), and for each one every installer with its download URL, file name, architecture and SHA-256. |
| `/{slug}/{slug}.md`, e.g. [`/vlc/vlc.md`](https://everyversion.net/vlc/vlc.md) | The same facts as Markdown, for pasting into a prompt or for an AI agent. |
| [`/api/v1/categories.json`](https://everyversion.net/api/v1/categories.json) | The categories, each with its apps. |
| [`/schema/app.schema.json`](https://everyversion.net/schema/app.schema.json) | The JSON Schema for an app record. |
| [`/llms.txt`](https://everyversion.net/llms.txt) | A plain-text map of the site for AI agents. |

```bash
curl -s https://everyversion.net/api/v1/apps.json | jq '.apps[] | select(.slug=="vlc") | .latest_versions'
```

The data is under [CC BY 4.0](LICENSE-DATA.md): use it for anything, including commercially, and credit Everyversion.

**Found a wrong version, a dead link or a mistake?** [Open an issue](https://github.com/cristiangguasch/everyversion/issues), or use the [contact form](https://everyversion.net/contact/).

---

## Quick start

You can build and preview the whole site from the data in this repository. No keys and no network access are needed.

**You need:** [Node.js](https://nodejs.org/) 20 or newer, and Python 3 for the local preview server.

```bash
npm install
npm run build    # data/ -> dist/ (the finished site)
npm run check    # checks the built pages (structured data, links, sitemaps, titles)
npm run serve    # preview at http://localhost:4173
```

To update the data itself (read the catalogs again, check installers, look files up on VirusTotal), see [Updating the data](#updating-the-data).

## How it works

Everyversion is a static site. There is no framework and no database: Node scripts turn JSON files into plain HTML.

```
 package catalogs                  data/                 checks                 dist/            the server
 winget-pkgs (Windows)                                   SHA-256, signatures,
 Homebrew casks (macOS)    --->    one JSON file  --->   VirusTotal, dead  ---> HTML, sitemaps, ---> rsync over SSH
 Flathub (Linux)                   per app               links                  .json/.md files
 publisher release feeds
```

1. **Read the catalogs.** `ingest` reads the winget-pkgs manifests and matches each app to its Homebrew cask. `flathub` adds the Linux version, and `custom` reads a few publishers' own release feeds (Ableton, CockroachDB). The result is one record per app in `data/apps/<slug>.json`, following `schema/app.schema.json`.
2. **Check the files.** `verify` downloads each app's latest installers, re-computes their SHA-256 and checks their code signatures. `virustotal` looks the hashes up on VirusTotal. `linkcheck` finds download links that no longer work.
3. **Build the site.** `build` writes every page to `dist/`, along with a `.json` and `.md` copy of each app's data, the API files, the sitemaps, `robots.txt` and `llms.txt`.
4. **Check the site.** `check` fails the build if a page breaks a rule: broken internal links, invalid structured data, a missing sitemap entry, a dead link behind an enabled Download button, and more.
5. **Deploy.** `dist/` is uploaded to the server with rsync.

**The data rules.** Every field is copied from a catalog or worked out by a fixed rule. Anything the sources don't provide (file size, categories, pros and cons) is left out, not guessed. A page only says an app is free when its license says so or the price was checked by hand. A checksum only counts as verified for the exact file that was checked.

## Project layout

```
config/apps.txt            the apps to list: winget IDs, with an optional price label, slug or Homebrew cask
config/categories.json     hand-curated categories and sub-groups
config/custom-sources.json apps read from a publisher's own release feed
config/features/           hand-written "Best for" notes for some app pages

data/apps/                 one record per app (the main data)
data/verification.json     results of our own download and signature checks
data/virustotal.json       VirusTotal results, by SHA-256
data/links.json            results of the dead-link check
data/icons/ og/ screenshots/   app icons, share images and Flathub screenshots

scripts/daily.mjs          the whole routine in one command (see below)
scripts/ingest.mjs         winget-pkgs + Homebrew  -> data/apps/
scripts/flathub.mjs        Flathub (Linux)         -> data/apps/
scripts/custom.mjs         publisher feeds (scripts/sources/) -> data/apps/
scripts/validate.mjs       checks every record against the schema
scripts/verify.mjs         downloads installers, re-computes SHA-256, checks signatures
scripts/virustotal.mjs     VirusTotal lookups by hash
scripts/linkcheck.mjs      finds dead download links
scripts/icons.mjs, macicons.mjs, og.mjs, screenshots.mjs   icons, share images, screenshots
scripts/tags.mjs, categories.mjs   tags and categories for the listings
scripts/build.mjs          data -> dist/ (static pages in scripts/lib/pages.mjs)
scripts/check.mjs          checks on the built site

assets/                    CSS, small browser scripts, fonts and the .htaccess template
server/                    PHP for the first-party analytics
brand/                     logo and brand guidelines
schema/app.schema.json     the record format (also published at /schema/app.schema.json)
```

## Updating the data

The data pipeline runs on **macOS**: signature checks use `codesign` and the system keychain, and Mac icons are taken out of disk images. It also needs:

- `git` and `curl`
- [ImageMagick](https://imagemagick.org/) (`magick`) for screenshots
- [osslsigncode](https://github.com/mtrojnar/osslsigncode) for Windows signatures (`brew install imagemagick osslsigncode`)
- a free VirusTotal API key in `.env` (copy `.env.example` to `.env`)

**One command does everything:** read the catalogs, validate, fetch icons and screenshots, verify installers, check links, look hashes up on VirusTotal, build, check, and print a report.

```bash
npm run add -- "Joplin.Joplin" "AnyDesk.AnyDesk free-to-download"   # add apps (winget IDs, optional price label), then run everything
npm run daily                                                       # catch up on anything in config/apps.txt that isn't done yet
npm run daily -- --only=Joplin.Joplin                               # re-read one app (for example after adding cask=<token> to its line)
npm run daily -- --refresh                                          # re-read every app; apps whose installers changed are verified again
```

Options: `--max-mb=N` (leave apps with a bigger installer unchecked; no limit by default), `--jobs=3`, `--no-verify`, `--no-vt`, `--no-icons`, `--no-og`, `--no-screenshots`, `--no-links`, `--no-build`.

Good to know:

- **Safe to re-run.** Every step skips what's already done, so after a failure you can simply run the same command again.
- **Homebrew matches** are made automatically only when the app's name and its website (or download source) both agree. Anything less is listed under "needs a look" in the report. `@beta` and `@insiders` casks are ignored.
- **Verification belongs to the exact files it checked.** When an app moves to a new version, the old result is ignored and the app is checked again on the next run.
- **VirusTotal's free key allows about 4 lookups a minute,** so a big run takes a while. Only the hash is sent, never the file.
- **Versions per app:** the import keeps up to 100 versions per platform (`--max-versions` in `scripts/ingest.mjs`).

## Deploying

The site is uploaded over SSH with rsync. Put `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER` and `DEPLOY_PATH` in `.env`, and log in with an SSH key.

1. Build and check: `npm run build && npm run check`.
2. Dry run, comparing files by checksum (the build rewrites every file, so comparing by date would upload everything):

   ```bash
   set -a; source .env; set +a
   rsync -avzc --dry-run --itemize-changes --exclude='.DS_Store' --exclude='_data/' -e "ssh -p $DEPLOY_PORT" dist/ "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/"
   ```

3. If the list looks right, run the same command without `--dry-run`.
4. Purge the Cloudflare cache (Caching → Configuration), or visitors keep getting the old pages for a while.

Never use `--delete`, and never touch `_data/` on the server: it holds the analytics data. `dist/.htaccess` is a hidden file and must be uploaded too; rsync includes it.

### Server requirements

Apache 2.4 with `mod_rewrite` and `AllowOverride All` (or `FileInfo` and `Options`), and PHP 8 or newer for the analytics. The `.htaccess` (generated from `assets/htaccess` on every build):

- sends every http, `www` and other-hostname request to `https://everyversion.net/` in a single 301
- answers 404, never a file list, for folders without an `index.html` (`/api/v1/`, `/brand/`, `/fonts/`, `/schema/`)
- hides dotfiles and backup files (`.DS_Store`, `.git`, `*.sql`, `*~`)
- serves `404.html` for missing pages

If a host answers 500, remove the `Options -Indexes` line; the listing protection doesn't depend on it. After a deploy, `/api/v1/`, `/fonts/`, `/brand/`, `/schema/` and `/.DS_Store` should all answer 404, and `http://www.everyversion.net/` should answer one 301 to `https://everyversion.net/`.

---

## Reference

### Old versions pages

An app with more than 25 old versions (`OLD_SPLIT` in `scripts/build.mjs`, counted on the platform with the most) gets a second page, `/<slug>/<slug>-old-versions.html`. It lists every old version with its downloads and checksums, links back with "Get latest version", and has a sidebar with the latest version per platform and alternatives. The app page then names only the 5 newest old versions, as plain text, plus a link to the full page. Other apps list all their versions on their own page.

`npm run check` fails if an old versions page is missing from its sitemap, has no sidebar or no link back, or if the app page doesn't link to it.

### Search engines and sitemaps

- `robots.txt` has a single `User-Agent: *` group (`Allow: /`, `Disallow: /stats-data.php`) and one `Sitemap:` line pointing to `sitemap.xml`.
- `sitemap.xml` is an index of three sitemaps, so each group can be watched on its own in Search Console:
  - `sitemap-pages.xml`: the home page, static pages and category pages (noindex pages such as the legal pages are left out)
  - `sitemap-software.xml`: one URL per app page
  - `sitemap-old-versions.xml`: the old versions pages
- The per-app `.json` and `.md` files, `/api/v1/*.json` and `llms.txt` are made for AI agents and tools. Nothing blocks them, so search engines may index them too.

`npm run check` fails if `robots.txt` blocks the `.json` and `.md` files or lists any sitemap other than the index.

### Dead download links

`scripts/linkcheck.mjs` requests every download URL the pages show and stores the results in `data/links.json`. A URL that answers 404 or 410 (also after a one-byte GET, since some hosts mishandle HEAD) gets a disabled Download button, a note on the page and an UNAVAILABLE flag in the `.json` and `.md` files, and is left out of the structured data. A download that `verify` couldn't fetch because of a 404 is treated the same way. Timeouts, 403s and 429s count as "unknown" and leave the button enabled. Every run checks the dead URLs again, so a file that comes back is enabled again. `npm run linkcheck -- --refresh` checks everything (about 8,000 requests).

### Homebrew casks that Homebrew disabled

A cask that Homebrew has disabled (for example `fails_gatekeeper_check`, `unmaintained` or `discontinued`) is still matched, and its macOS download is kept. The record gets `homebrew_cask_disabled` (reason and date). The Downloads card shows a one-sentence warning with a link to the cask page and leaves out the `brew install` command. The Download button stays enabled, since it goes to the publisher, unless the link check finds the file dead. Deprecated casks that aren't disabled are skipped.

### Custom sources (Ableton, CockroachDB)

Some apps aren't in winget-pkgs or need more than it has, so they're read from the publisher's own pages (`scripts/sources/`, configured in `config/custom-sources.json`).

- **Ableton Live and Push** come from Ableton's release-notes pages and download server.
- **Live releases:** each run reads only Live 12 and newer again (`active_from` in the config; it also looks for a Live 13 release-notes page). Live 11 and older are kept as they are, and Live 9 to 1 come from the `legacy` table in the config.
- **Verifying Live:** a new Live 12 release adds its entries, and verification then downloads and hashes the newest files: about 35 GB, one file at a time.
- `node scripts/custom.mjs --only=ableton-live --full` reads every version again.
- **Push** downloads are a fixed list in the config; update the URLs there when Ableton ships new firmware.

### Renamed apps

When a publisher renames an app, its page keeps its URL and carries both names. In `config/apps.txt`, keep the old slug (add `slug=<old-slug>` if the new name would make a different one) and set `name=<New_Name> formerly=<Old_Name>`, with underscores for spaces. For a custom source, set `app.name` and `app.formerly` in `config/custom-sources.json`. The H1 and `<title>` of the app page and of its old-versions page then read "New name (formerly Old name)", for example "Cloudflare One Client (formerly WARP)". The rest of the site uses the new name, and search finds the app under both.

If the rename also brought a new winget ID, switch the line to the new ID and add `previous=<OldId>` (for example `PawelSalawa.Letos slug=sqlitestudio name=Letos formerly=SQLiteStudio previous=PawelSalawa.SQLiteStudio`). The ingest then reads both IDs into one page: old versions keep their own `winget_id`, so their `winget install` commands and manifest links stay right, and the facts table lists the earlier ID. `npm run check` fails when a record with `formerly` lacks it in either place.

### Feature notes (editorial)

Some app pages carry hand-written notes in the Description section: a one-line "Best for", then 5 to 8 bullets on what the app does and where it stops. Each lives in `config/features/<slug>.json` and is shown on the page and in the `.md` file by `scripts/lib/features.mjs`. Apps without a file show only the description.

```
{ "slug", "reviewed": "YYYY-MM-DD",
  "best_for": "one line, written for the reader: their system, their job, their problem",
  "points": [{ "title", "text" }],          5 to 8 bullets; titles are free, so the structure differs per app
  "sources": [{ "label", "url" }] }          the official pages the text is based on (https only); not shown on the page
```

Rules:

- Write in our own words; never copy sentences.
- Say what the app doesn't do: plan limits, account needs, platform gaps, differences between platforms.
- Include only what was confirmed on a page, and leave out anything unconfirmed.
- `sources` and `reviewed` are the audit trail. Check a file again when the app's plans or platforms change, and update `reviewed`.

`npm run validate` checks each file, and `npm run check` checks the notes appear exactly on the apps that have a file.

### Share images (og:image)

Every app page has a 1200×630 image for link previews, drawn by `scripts/og.mjs` with Satori and resvg. It shows:

- the app icon (or its first letter on a blue tile when there's no icon)
- the app name and the page's lead line
- the Everyversion logo and the platform icons

Each image is made once and kept in `data/og/<slug>.png`. `data/og.json` stores a hash of the app's name and icon, and the image is only made again when one of them changes (`--force` remakes it anyway). The build copies it to `/<slug>/og.png?v=<hash>`, so a new image never hits a stale cache.

```bash
npm run og                                   # make missing or outdated images
node scripts/og.mjs --only=vlc --force       # remake one app's image
node scripts/og.mjs --only=vlc --out=/tmp/og # preview without touching data/og
```

### Screenshots (Flathub)

Flathub is the only source we use that publishes screenshots, so app pages show the Linux version's screenshots, say so, and credit Flathub with a link.

- **Fetching:** `scripts/screenshots.mjs` takes up to 8 screenshots per app from Flathub's API.
- **Storage:** each is saved as WebP (at most 1200px wide) in `data/screenshots/<slug>/`.
- **Updates:** screenshots are fetched again only when Flathub's list changes (`--force` to refetch).
- **On the page:** they sit in a row that scrolls with arrows, swipe or trackpad. `assets/gallery.js` adds a lightbox with arrow keys and Esc.

```bash
npm run screenshots                               # fetch new or changed apps
node scripts/screenshots.mjs --only=vlc --force   # refetch one app
```

### Analytics (first-party, no cookies)

Pageviews and clicks on the Download, Install and copy-command buttons are counted by our own code and stored as files on the server. There's no database and no third party. Nothing is stored in the browser, and IP addresses are never stored. The totals are public at [/statistics/](https://everyversion.net/statistics/).

```
assets/t.js            browser beacon, loaded on every page (buttons carry data-t / data-slot / data-pl / data-ar / data-ty / data-h)
server/collect.php     receives the beacons and appends one line to <data dir>/events-YYYY-MM-DD.ndjson
server/stats-data.php  public totals for the statistics page (daily rollups in <data dir>/rollup-YYYY-MM-DD.json)
assets/stats.js        draws /statistics/ from stats-data.php
```

- **Data folder:** `EVERYVERSION_DATA` if set; otherwise `<parent of the web root>/everyversion-data` (recommended, since the web can't reach it); otherwise `<web root>/_data`, protected by a deny-all `.htaccess`. PHP must be able to write to it. Back it up: it's the only copy of the raw events.
- **Visitors are counted per day only.** A visitor is `sha256(today's random salt + IP + user agent)`, and the salt is deleted when the day changes, so visitors can't be followed across days. Raw events are deleted after 400 days; the daily totals, which hold no hashes, stay.
- **Country** comes from Cloudflare's `CF-IPCountry` header. In Cloudflare, Network → **IP Geolocation** must be on, or every country shows as "Unknown".
- **Opt-outs:** nothing is sent when the browser has Do Not Track or Global Privacy Control on, and bots are ignored.
- **Why `/statistics/` and not `/stats/`:** the host reserves `/stats` for its own tools.

**Keep Cloudflare from caching the analytics.** `collect.php` answers `no-store` and `stats-data.php` answers `private, max-age=60`, which Cloudflare respects. To keep it that way even if someone adds a "Cache Everything" rule later, add a rule in Cloudflare: Caching → Cache Rules → Create rule, URI Path **is in** `/collect.php` `/stats-data.php`, then **Bypass cache**, placed above any other rule. To check:

```bash
curl -sI "https://everyversion.net/stats-data.php?days=30" | grep -i -E "cache-control|cf-cache-status|age"
curl -si -X POST https://everyversion.net/collect.php | grep -i -E "HTTP|cache-control|cf-cache-status|age"
```

`cf-cache-status` must be `DYNAMIC` or `BYPASS`, never `HIT`, and there must be no `age` header.

---

## License

- **Code:** the scripts, server code and site assets are under the [MIT License](LICENSE).
- **Data:** `data/`, `config/`, and the `.json` and `.md` files and `/api/v1/` on the site are under [CC BY 4.0](LICENSE-DATA.md). Reuse it freely and credit Everyversion.
- **Third-party content keeps its own terms:**
  - fields copied from winget-pkgs, Homebrew and Flathub
  - app icons and screenshots
  - VirusTotal results
  - the Everyversion name and logo
  - the Geist fonts

[LICENSE-DATA.md](LICENSE-DATA.md) has the details.
