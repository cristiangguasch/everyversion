---
description: Add N new winget apps, match Homebrew/Flathub/custom sources, write their feature notes, run every check, then deploy changed files with rsync
argument-hint: <number of apps, e.g. 20>
allowed-tools: Bash(npm run *), Bash(node scripts/*), Bash(git status*), Bash(git diff*), Bash(git log*), Bash(curl -s *), Bash(rsync * --dry-run *), WebFetch, WebSearch, Edit(config/features/**)
---

Add $ARGUMENTS new apps to everyversion. If no number was given, add 20.

## 1. Pick the apps

- Choose well-known desktop apps that are not in `config/apps.txt` yet.
- Confirm each winget PackageIdentifier exists in winget-pkgs (the sparse clone in `.cache/winget-pkgs`: `git fetch --depth=1 origin`, then `git ls-tree FETCH_HEAD manifests/<letter>/<Publisher>/<Package>/`). Drop any ID that is not there.
- Read each manifest's PackageName, PackageUrl, PublisherUrl and License.

## 2. Match the other sources

- **Homebrew:** look the cask up at `https://formulae.brew.sh/api/cask/<token>.json`. Match only when the name AND the website (or download host) agree with the winget manifest. A third-party build of the same app is not a match. A disabled cask is still matched (the build shows a warning); skip deprecated-only and `@beta`/`@insiders` casks.
- **Flathub:** look the app up at `https://flathub.org/api/v2/appstream/<id>`, or search with `POST https://flathub.org/api/v2/search`. Same rule: the name and the homepage or developer must agree. Use `flathub=none` when it is not on Flathub.
- **Custom source:** only for software winget does not have (see `config/custom-sources.json`). Say so if none of the new apps needs one.
- **Supplement feed:** a new JetBrains app gets its winget ID and product code added to `products` in the `jetbrains` source of `config/custom-sources.json`, so the releases winget and Homebrew lack are filled in.
- Use `free-to-download` for proprietary apps that are free to download, `slug=` and `name=` when the manifest's PackageName makes a bad slug or name.
- **Renamed apps:** if a new app turns out to be a renamed one already listed (same publisher and product, new name, sometimes a new winget ID), do not add a second page. Tell me, and follow the rename rule: the URL never changes: keep the old slug (add `slug=<old-slug>` when the new name would make a different one), set `name=<New_Name> formerly=<Old_Name>` in `config/apps.txt` (`app.name` and `app.formerly` for a custom source), and the H1 and `<title>` of the app page and its old-versions page then read "New name (formerly Old name)". `npm run check` fails if they do not. When the rename came with a new winget ID, switch the line to the new ID and add `previous=<OldId>` so the old versions stay on the same page; then verify, link-check and look up the new installers on VirusTotal, and update the app's feature notes.
- Before running anything, show me the table of winget ID, cask, Flathub ID and the reason for every non-match.

## 3. Run the full process

- Run `npm run add -- "<Id> [label] cask=<token> flathub=<id>" ...` with all the apps in one call, in the background, logging to a file in the scratchpad. It ingests, reads custom sources and Flathub, validates, fetches icons, verifies installers (SHA-256 and signatures), checks links, looks hashes up on VirusTotal, builds and checks.
- Give me a short progress update at each stage (verify, link check, VirusTotal, build).
- Add every new app to `config/categories.json` (one primary category, the right group when the category has groups, `also` where it fits).

## 4. Write the feature notes

Every new app gets `config/features/<slug>.json` (format and rules in README, "Feature notes (editorial)"; checks in `scripts/lib/features.mjs`). Read two or three existing files first, such as `1password.json` and `7-zip.json`, to match the tone.

- **Research from official pages only:** the publisher's site, its pricing, system requirements, docs and FAQ pages, the project's own repo or release notes, and the Flathub or Homebrew listing. No review sites, no forums, no AI summaries. Every page you use goes in `sources`, and each `url` must load (check with `curl -s -o /dev/null -w '%{http_code}' -L <url>`). Flathub's `flathub.org/apps/<id>` pages return 404 to curl, so check those through `https://flathub.org/api/v2/appstream/<id>` and keep the `/apps/` link as the source.
- **Use our own data for listing facts:** platforms, installer types and architectures, how many versions each platform keeps, and the license come from `data/apps/<slug>.json`, so write the notes after the ingest has finished.
- **`best_for`:** one sentence about the reader (their system, their job, their problem), not a slogan for the app.
- **5 to 8 points,** titles of 70 characters or fewer, texts of 520 or fewer, titles unique. Pick what this app's reader needs to know; the titles are free, so the set differs from app to app. Cover where the app stops: price and plan limits, account or sign-in needs, what the free version lacks, platform gaps and differences between the Windows, Mac and Linux builds, minimum OS versions, and when only the latest version is listed for a platform. Mention silent-install switches or machine-wide installs when the manifest shows them.
- **Our own words, confirmed facts only.** Never copy a sentence. Leave out anything you could not confirm on a page; never write UNCONFIRMED, TODO or a guess. Prices and plans carry "at the time of reading" wording, since `reviewed` dates them.
- `"reviewed"` is today's date. `"slug"` equals the file name.
- For more than five apps, split the research across parallel subagents (about five apps each), giving each one these rules, the two example files and the app records. Read every file they write before keeping it.
- Then run `npm run tags`, `npm run categories`, `npm run validate`, `npm run build`, `npm run check` until the check passes with every app categorised and every new app showing its feature notes.

## 5. Report

- One line per new app: platforms, cask, Flathub ID, hash result, signatures, VirusTotal rating, and the feature-note count with its `best_for` line.
- Name any app whose notes came out thin (few official pages, only five points) so I can review it.
- Call out anything MEDIUM or HIGH risk, with the engines and detection names, and do not change a rating by hand.
- List failed downloads, new dead links and other problems, saying which belong to existing apps.

## 6. Deploy only what changed

- Read `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER` and `DEPLOY_PATH` (the web root on the server) from `.env`. If one is missing, stop and ask me for it; never write it into a tracked file. Never read, print or use `DEPLOY_PASS`: the upload must log in with an SSH key, and if it asks for a password, stop and tell me.
- Dry run first, comparing by checksum (the build rewrites every file, so time-based comparison would upload everything):

  `rsync -avzc --dry-run --itemize-changes --exclude='.DS_Store' --exclude='_data/' -e "ssh -p $DEPLOY_PORT" dist/ "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/"`

- Show me how many files would be uploaded and the list (the new app pages, plus the shared pages that changed). Confirm `.htaccess` is included when it changed.
- Never use `--delete`. Never touch `_data/` on the server.
- Run the real upload (the same command without `--dry-run`) only after I say yes, then report how many files were sent.
- If rsync is not available on the server (`rsync: command not found`), stop and tell me; do not fall back to another tool on your own.

## 7. Commit

- After I confirm, commit `config/` (including the new `config/features/` files) and `data/` with a message listing the new apps. Leave out any files that were already modified before this run. Do not push.
