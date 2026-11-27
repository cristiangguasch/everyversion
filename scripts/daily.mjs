#!/usr/bin/env node
// One command for the daily routine: add apps, ingest, verify, scan, build, check, report.
//
//   npm run add -- "Joplin.Joplin" "AnyDesk.AnyDesk free-to-download"   add apps (config lines), then run everything
//   npm run daily                                                       catch up on whatever in config/apps.txt is not done yet
//   npm run daily -- --only=Joplin.Joplin,Foo.Bar                       re-read just those apps (e.g. after fixing their cask= in the config)
//   npm run daily -- --refresh                                          also re-read every existing app from winget and re-check changed ones
//
// What it does, in order (each step only touches what is new or stale):
//   1. append new lines to config/apps.txt (duplicates are skipped)
//   2. ingest   new winget apps + auto-match their Homebrew cask (same name AND same website domain), then every custom source (config/custom-sources.json), then Flathub (Linux, matched the same way)
//   3. validate the data
//   3b. icons   winget manifest icon, else Flathub icon, else the app icon from the Homebrew cask download, else the Logo.dev logo of the app's own domain (needs LOGODEV_SECRET), else a generic GitHub mark for GitHub projects, else none
//   3c. share images (og:image) for apps that have none yet, or whose name or icon changed
//   3d. screenshots from Flathub for apps that have none yet, or whose Flathub screenshot list changed
//   4. verify   download installers, re-compute SHA-256, check signatures (apps with no or stale results)
//   4b. link check: new download URLs, plus every URL that was dead last time (404/410 -> the build disables that button)
//   5. VirusTotal lookup by hash (hashes not stored yet; needs VT_API_KEY or .env)
//   6. build the site and run the checks
//   7. print a report of the new apps
//
// Options: --refresh  --max-mb=N (optional: leave apps with a bigger installer unchecked; there is no limit by default)  --jobs=3  --no-verify  --no-vt  --no-icons  --no-logodev  --no-og  --no-screenshots  --no-links  --no-build

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flags = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')).map(([k, v]) => [k, v ?? true]));
const lines = argv.filter((a) => !a.startsWith('--'));
const MAX_MB = flags['max-mb'] || null; // no size limit by default; pass --max-mb=N to skip apps with a bigger installer
const JOBS = flags.jobs || 3;

const read = (rel, fallback) => {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
  } catch {
    return fallback;
  }
};
const apps = () => Object.fromEntries(readdirSync(join(ROOT, 'data', 'apps')).filter((f) => f.endsWith('.json')).map((f) => [f.replace(/\.json$/, ''), read(`data/apps/${f}`)]));
const step = (title) => console.log(`\n━━ ${title}`);
function run(script, args = [], { allowFail = false } = {}) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { stdio: 'inherit', cwd: ROOT });
  if (r.status !== 0 && !allowFail) {
    console.error(`\n✗ ${script} failed (exit ${r.status}). Fix that and run again; finished steps are not repeated.`);
    process.exit(r.status || 1);
  }
  return r.status === 0;
}

const before = new Set(Object.keys(apps()));
let addedIds = [];

// ---- 1. config
const cfgPath = join(ROOT, 'config', 'apps.txt');
if (lines.length) {
  step('Adding to config/apps.txt');
  const have = new Set(readFileSync(cfgPath, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim().split(/\s+/)[0]).filter(Boolean));
  const added = [];
  for (const raw of lines) {
    const line = raw.trim();
    const id = line.split(/\s+/)[0];
    if (!/^[A-Za-z0-9][\w+-]*(\.[\w+-]+)+$/.test(id)) {
      console.log(`  skipped "${line}": not a winget PackageIdentifier (expected Publisher.Package)`);
    } else if (have.has(id)) {
      console.log(`  skipped ${id}: already in config`);
    } else {
      added.push(line);
      have.add(id);
    }
  }
  if (added.length) {
    appendFileSync(cfgPath, `\n# added ${new Date().toISOString().slice(0, 10)}\n${added.join('\n')}\n`);
    addedIds = added.map((l) => l.split(/\s+/)[0]);
    console.log(`  added ${added.length}: ${addedIds.join(', ')}`);
  }
}

// ---- 2-3. ingest + validate
step(flags.only ? `Ingest (re-reading ${String(flags.only).split(',').length} app(s))` : flags.refresh ? 'Ingest (full refresh of every app)' : 'Ingest (new apps only)');
run('ingest.mjs', flags.only ? [`--only=${flags.only}`] : flags.refresh ? [] : ['--new']);
// ---- custom sources: checked on every run, right after winget and Homebrew (config/custom-sources.json)
step('Custom sources');
run('custom.mjs', [], { allowFail: true });
// ---- Flathub: the Linux (Flatpak) platform for catalog apps, matched on name AND website or pinned with flathub=<id> in the config
step('Flathub (Linux)');
run('flathub.mjs', [], { allowFail: true });
// IDs that winget does not know: take them back out of the config so it stays clean.
const ingested = new Set(Object.values(apps()).map((r) => r.ids.winget));
const unknown = addedIds.filter((id) => !ingested.has(id));
if (unknown.length) {
  const kept = readFileSync(cfgPath, 'utf8').split('\n').filter((l) => !unknown.includes(l.replace(/#.*/, '').trim().split(/\s+/)[0]));
  writeFileSync(cfgPath, kept.join('\n'));
  console.log(`\n  not found in winget-pkgs, removed from config: ${unknown.join(', ')}`);
}
step('Validate');
run('validate.mjs');

// ---- icons (new or re-read apps only: winget, custom source or Flathub icon, else the Mac app icon, else Logo.dev, else the generic GitHub mark, else none)
if (!flags['no-icons']) {
  const onlySet = new Set(String(flags.only || '').split(',').filter(Boolean));
  const iconSlugs = Object.entries(apps()).filter(([slug, r]) => !before.has(slug) || onlySet.has(r.ids.winget)).map(([slug]) => slug);
  step(`Icons (${iconSlugs.length} app${iconSlugs.length === 1 ? '' : 's'})`);
  if (iconSlugs.length) run('icons.mjs', iconSlugs, { allowFail: true });
  // Still no icon (or only the generic GitHub mark)? Take the app's own icon out of its Homebrew cask download.
  if (iconSlugs.length) run('macicons.mjs', ['--missing', ...iconSlugs], { allowFail: true });
  // Still nothing? The Logo.dev logo of the app's own domain (skips code hosts, shared domains and logo=none apps).
  if (iconSlugs.length && !flags['no-logodev']) run('logodevicons.mjs', ['--missing', ...iconSlugs], { allowFail: true });
  if (!iconSlugs.length) console.log('  nothing new');
}

// ---- share images: made once per app, remade only when its name or icon changed (scripts/og.mjs keeps the hashes in data/og.json)
if (!flags['no-og']) {
  step('Share images (og:image)');
  run('og.mjs', [], { allowFail: true });
}

// ---- screenshots from Flathub: fetched once per app, again only when Flathub's screenshot list changes (data/screenshots.json)
if (!flags['no-screenshots']) {
  step('Screenshots (Flathub)');
  run('screenshots.mjs', [], { allowFail: true });
}

// ---- 4. verification
const current = apps();
if (!flags['no-verify']) {
  const results = read('data/verification.json', {});
  const needs = Object.entries(current)
    .filter(([slug, rec]) => {
      const r = results[slug];
      if (!r) return true;
      if (r.skipped) return true; // anything left unchecked is tried again (failed downloads, or an earlier size limit)
      const checked = new Set(r.installers.map((i) => i.url));
      return rec.platforms.flatMap((p) => rec.versions.find((v) => v.platform === p).installers.filter((i) => i.type !== 'flatpak').map((i) => i.url)).some((u) => !checked.has(u));
    })
    .map(([slug]) => slug);
  step(`Verify installers (${needs.length} app${needs.length === 1 ? '' : 's'}: ${needs.slice(0, 12).join(', ')}${needs.length > 12 ? ', …' : ''})`);
  if (needs.length) run('verify.mjs', [...needs, ...(MAX_MB ? [`--max-mb=${MAX_MB}`] : []), `--jobs=${JOBS}`]);
  else console.log('  nothing to verify');
}

// ---- 4b. link check: download URLs that answer 404/410 get their button disabled by the build (data/links.json)
if (!flags['no-links']) {
  step('Link check (download buttons)');
  run('linkcheck.mjs', [], { allowFail: true });
}

// ---- 5. VirusTotal
if (!flags['no-vt']) {
  step('VirusTotal lookups');
  const hasKey = process.env.VT_API_KEY || (existsSync(join(ROOT, '.env')) && /VT_API_KEY\s*=/.test(readFileSync(join(ROOT, '.env'), 'utf8')));
  if (hasKey) run('virustotal.mjs', [], { allowFail: true });
  else console.log('  skipped: no VT_API_KEY (set it in the environment or in .env)');
}

// ---- 6. build + check
if (!flags['no-build']) {
  step('Build');
  run('tags.mjs', [], { allowFail: true });
  run('categories.mjs', [], { allowFail: true });
  run('build.mjs');
  step('Check');
  run('check.mjs');
}

// ---- 7. report
step('Report');
const verif = read('data/verification.json', {});
const vt = read('data/virustotal.json', {});
const onlyIds = new Set(String(flags.only || '').split(',').filter(Boolean));
const fresh = Object.entries(apps()).filter(([slug, r]) => !before.has(slug) || onlyIds.has(r.ids.winget));
if (!fresh.length) console.log('  no new or re-read apps this run');
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
if (fresh.length) {
  console.log(`  ${pad('app', 28)} ${pad('platforms', 14)} ${pad('cask', 20)} ${pad('hash', 13)} ${pad('signature', 15)} virustotal / safety`);
}
for (const [slug, rec] of fresh) {
  const v = verif[slug];
  const items = v?.installers || [];
  const hash = v?.skipped ? 'unchecked' : items.length ? `${items.filter((i) => i.hash === 'match').length}/${items.length} match${items.some((i) => i.hash === 'MISMATCH') ? ' !' : ''}` : 'unchecked';
  const sig = items.length ? `${items.filter((i) => i.signature.status === 'valid').length} valid, ${items.filter((i) => i.signature.status === 'invalid').length} bad` : '-';
  const hashes = [...new Set(rec.platforms.flatMap((p) => rec.versions.find((x) => x.platform === p).installers.map((i) => (items.find((x) => x.url === i.url)?.computed_sha256 || i.sha256 || '').toLowerCase())))];
  const found = hashes.map((h) => vt[h]).filter((x) => x?.found);
  const flagged = found.map((x) => (x.stats.malicious || 0) + (x.stats.suspicious || 0));
  const max = flagged.length ? Math.max(...flagged) : null;
  const mis = items.some((i) => i.hash === 'MISMATCH');
  const safety0 = max === null ? 'not scanned' : max <= 1 ? (found.length < hashes.length ? 'safe so far' : 'safe') : max <= 3 ? 'MEDIUM RISK' : 'HIGH RISK';
  const safety = mis && !/RISK/.test(safety0) ? 'MEDIUM RISK (hash mismatch)' : safety0;
  console.log(`  ${pad(rec.name, 28)} ${pad(rec.platforms.join('+'), 14)} ${pad(rec.ids.homebrew_cask || '-', 20)} ${pad(hash, 13)} ${pad(sig, 15)} ${found.length}/${hashes.length} scanned${max ? `, max ${max} flagged` : ''} → ${safety}`);
}
const problems = [];
for (const [slug] of fresh) if (verif[slug]?.skipped) problems.push(`${slug}: left at level 0 (${verif[slug].reason})`);
for (const [slug] of fresh) if (!current[slug]?.ids?.homebrew_cask && !current[slug]?.ids?.custom) problems.push(`${slug}: no Homebrew cask matched (Windows only). If one exists, add cask=<token> to its line in config/apps.txt and run npm run daily -- --refresh`);
if (problems.length) console.log(`\n  needs a look:\n    ${problems.join('\n    ')}`);
console.log(`\n  ${Object.keys(apps()).length} apps total. Deploy dist/ when you are happy with it.`);
