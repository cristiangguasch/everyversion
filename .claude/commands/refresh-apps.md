---
description: Refresh every app to its latest versions (winget, Homebrew, Flathub, custom sources), run every check, then deploy changed files with rsync
argument-hint: (optional) winget IDs to refresh only those, comma-separated
allowed-tools: Bash(npm run *), Bash(node scripts/*), Bash(node -e *), Bash(git status*), Bash(git diff*), Bash(git log*), Bash(rsync * --dry-run *)
---

Refresh the apps on everyversion to their latest versions. Do not add or remove apps from `config/apps.txt`.

Scope: $ARGUMENTS
- If the scope is empty, refresh every app.
- If it lists winget IDs (for example `Zoom.Zoom,Mozilla.Firefox`), refresh only those.

## 1. Snapshot

- Run `git status --short` and note any files that are already modified, so they stay out of the commit later.
- Save a snapshot of every app's `latest_versions` (from `data/apps/*.json`) to a file in the scratchpad, so you can compare it after the run.

## 2. Run the full process

- Every app: `npm run daily -- --refresh`
- Only some apps: `npm run daily -- --only=<IDs>`
- Run it in the background, logging to a file in the scratchpad, and give me a short progress update at each stage (ingest, custom sources, Flathub, verify, link check, VirusTotal, build, check).
- This re-reads winget and the Homebrew casks, re-checks every custom source (including the JetBrains supplement, which adds the releases winget and Homebrew lack to the 13 JetBrains apps) and Flathub, validates, fetches icons for re-read apps, re-verifies every app whose installers changed (SHA-256 and signatures), checks links, looks new hashes up on VirusTotal, and rebuilds the tags, categories and site with all checks.
- If a step fails, read the error, fix the cause if it is in the data or config, and run the same command again (finished steps are not repeated). If the fix would change a script, stop and ask me first.
- If `npm run check` or `npm run categories` reports a problem, fix it until both pass.

## 3. Report

- Compare against the snapshot and list each app whose latest version changed: name, platform, old version → new version.
- Say how many apps did not change.
- For every changed app: hash result, signatures, VirusTotal rating. Call out anything MEDIUM or HIGH risk, with the engines and detection names. Do not change a rating by hand.
- **Renamed apps:** look for apps whose publisher renamed them (a new PackageName, a new winget ID from the same publisher, or a rename on the publisher's site or in the release notes). List each one and, after I confirm, apply the rename rule: the URL never changes: keep the old slug (add `slug=<old-slug>` when the new name would make a different one), set `name=<New_Name> formerly=<Old_Name>` in `config/apps.txt` (`app.name` and `app.formerly` for a custom source), and the H1 and `<title>` of the app page and its old-versions page then read "New name (formerly Old name)". `npm run check` fails if they do not. When the rename came with a new winget ID, switch the line to the new ID and add `previous=<OldId>` so the old versions stay on the same page; then verify, link-check and look up the new installers on VirusTotal, and update the app's feature notes.
- Say how many versions the supplement feeds added per app when that changed, and name any app whose latest version came from a feed rather than winget or Homebrew.
- List apps whose record was removed or that winget no longer has, Homebrew casks that became disabled or deprecated, Flathub apps that went end-of-life, failed downloads (403/404), and new dead download links.

## 4. Deploy only what changed

- Read `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER` and `DEPLOY_PATH` from `.env`. If one is missing, stop and ask me for it; never write it into a tracked file. Never read, print or use `DEPLOY_PASS`: the upload must log in with an SSH key, and if it asks for a password, stop and tell me.
- Dry run first, comparing by checksum (the build rewrites every file, so time-based comparison would upload everything):

  `rsync -avzc --dry-run --itemize-changes --exclude='.DS_Store' --exclude='_data/' -e "ssh -p $DEPLOY_PORT" dist/ "$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/"`

- Show me how many files would be uploaded (lines starting with `<f` whose flags include `c` or `+`) and list them grouped by app. Ignore lines that only differ in time (`.f..t....`).
- Never use `--delete`. Never touch `_data/` on the server.
- Run the real upload (the same command without `--dry-run`) only after I say yes, then report how many files were sent.
- If rsync is not available on the server or the SSH login fails, stop and tell me; do not fall back to another tool on your own.

## 5. Commit

- After I confirm, commit `config/` and `data/` with a message that names the apps with new versions (or the count, if there are many). Leave out any files that were already modified before this run. Do not push.
