---
description: Add N new winget apps, match Homebrew/Flathub/custom sources, run every check, then deploy changed files with rsync
argument-hint: <number of apps, e.g. 20>
allowed-tools: Bash(npm run *), Bash(node scripts/*), Bash(git status*), Bash(git diff*), Bash(git log*), Bash(curl -s *), Bash(rsync * --dry-run *)
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
- Use `free-to-download` for proprietary apps that are free to download, `slug=` and `name=` when the manifest's PackageName makes a bad slug or name.
- Before running anything, show me the table of winget ID, cask, Flathub ID and the reason for every non-match.

## 3. Run the full process

- Run `npm run add -- "<Id> [label] cask=<token> flathub=<id>" ...` with all the apps in one call, in the background, logging to a file in the scratchpad. It ingests, reads custom sources and Flathub, validates, fetches icons, verifies installers (SHA-256 and signatures), checks links, looks hashes up on VirusTotal, builds and checks.
- Give me a short progress update at each stage (verify, link check, VirusTotal, build).
- Add every new app to `config/categories.json` (one primary category, the right group when the category has groups, `also` where it fits), then run `npm run tags`, `npm run categories`, `npm run validate`, `npm run build`, `npm run check` until the check passes with every app categorised.

## 4. Report

- One line per new app: platforms, cask, Flathub ID, hash result, signatures, VirusTotal rating.
- Call out anything MEDIUM or HIGH risk, with the engines and detection names, and do not change a rating by hand.
- List failed downloads, new dead links and other problems, saying which belong to existing apps.

## 5. Deploy only what changed

- Read `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER` and `DEPLOY_PATH` (the web root on the server) from `.env`. If one is missing, stop and ask me for it; never write it into a tracked file. Never read, print or use `DEPLOY_PASS`: the upload must log in with an SSH key, and if it asks for a password, stop and tell me.
- Dry run first, comparing by checksum (the build rewrites every file, so time-based comparison would upload everything):

  `rsync -avzc --dry-run --itemize-changes --exclude='.DS_Store' --exclude='_data/' -e "ssh -p $DEPLOY_PORT" dist/ "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/"`

- Show me how many files would be uploaded and the list (the new app pages, plus the shared pages that changed). Confirm `.htaccess` is included when it changed.
- Never use `--delete`. Never touch `_data/` on the server.
- Run the real upload (the same command without `--dry-run`) only after I say yes, then report how many files were sent.
- If rsync is not available on the server (`rsync: command not found`), stop and tell me; do not fall back to another tool on your own.

## 6. Commit

- After I confirm, commit `config/` and `data/` with a message listing the new apps. Leave out any files that were already modified before this run. Do not push.
