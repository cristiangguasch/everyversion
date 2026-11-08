#!/usr/bin/env node
// Flathub (Linux / Flatpak) source: adds a `linux` platform to catalog apps from the Flathub API.
//
//   node scripts/flathub.mjs                 every winget app: use flathub=<id> from config/apps.txt, else look for a match
//   node scripts/flathub.mjs --only=slug,slug  just those apps
//   node scripts/flathub.mjs --recheck       search again even for apps that had no match recently
//
// config/apps.txt:  flathub=<app-id>  pins the Flathub app (e.g. flathub=net.cozic.joplin_desktop)
//                   flathub=none      says the app is not on Flathub (or must not be matched)
// An app without the key is searched for: it is matched automatically only when the Flathub app has the same name AND the
// same website / code-host owner. Anything less is reported under "needs a look" and never applied. Auto-matches are written
// back to the config line, like cask=.
//
// Safe to re-run: a record and its provenance only change when Flathub's data for the app changed. If Flathub is
// unreachable the existing record is left untouched and the run exits 1.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAppstream, getSummary, isAppId, normaliseFlathub, suggestFlathub } from './lib/flathub.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data', 'apps');
const CFG = join(ROOT, 'config', 'apps.txt');
const CACHE_DIR = join(ROOT, 'data', 'custom');
const SEARCH_CACHE = join(CACHE_DIR, 'flathub-search.json');
const RECHECK_DAYS = 14;
const args = process.argv.slice(2);
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const RECHECK = args.includes('--recheck');
const PLATFORM_ORDER = ['windows', 'macos', 'linux'];
const LABEL_NOTE = ' Linux (Flatpak) installs come from Flathub, whose repository is signed; Flathub publishes no file checksum.';

const readJson = (f, fallback) => {
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return fallback;
  }
};

/** winget id -> flathub token ("net.cozic.joplin_desktop", "none" or null) from config/apps.txt. */
function readConfig() {
  const map = new Map();
  for (const raw of readFileSync(CFG, 'utf8').split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [id, ...rest] = line.split(/\s+/);
    const tok = rest.find((t) => t.startsWith('flathub='));
    map.set(id, tok ? tok.slice(8) : null);
  }
  return map;
}

/** Remove everything this script owns from a record (used before re-adding, and when an app leaves Flathub). */
function stripLinux(rec) {
  const out = { ...rec, ids: { ...rec.ids } };
  delete out.ids.flathub;
  delete out.flathub;
  out.platforms = rec.platforms.filter((p) => p !== 'linux');
  out.latest_versions = { ...rec.latest_versions };
  delete out.latest_versions.linux;
  out.versions_total = { ...rec.versions_total };
  delete out.versions_total.linux;
  out.versions = rec.versions.filter((v) => v.platform !== 'linux');
  out.provenance = rec.provenance.filter((p) => p.platform !== 'linux');
  if (out.verification?.label) out.verification = { ...out.verification, label: out.verification.label.replace(LABEL_NOTE, '') };
  return out;
}

function withLinux(rec, norm, prev) {
  const base = stripLinux(rec);
  const versions = PLATFORM_ORDER.flatMap((p) => (p === 'linux' ? [norm.version] : base.versions.filter((v) => v.platform === p)));
  const old = prev?.provenance?.find((e) => e.platform === 'linux');
  const provenance = old && old.content_sha256 === norm.provenance.content_sha256 ? old : norm.provenance; // moves only when Flathub's data changed
  const out = {
    ...base,
    ids: { ...base.ids, flathub: norm.flathub.app_id },
    platforms: PLATFORM_ORDER.filter((p) => p === 'linux' || base.platforms.includes(p)),
    latest_versions: { ...base.latest_versions, linux: norm.version.version },
    versions_total: { ...base.versions_total, linux: 1 },
    versions,
    verification: { ...base.verification, label: base.verification.label.replace(LABEL_NOTE, '') + LABEL_NOTE },
    provenance: [...base.provenance, provenance],
    flathub: norm.flathub,
  };
  return out;
}

async function main() {
  const cfg = readConfig();
  const files = readdirSync(DATA).filter((f) => f.endsWith('.json'));
  const searchCache = readJson(SEARCH_CACHE, {});
  const now = new Date().toISOString();
  const notes = [];
  const autoMatched = [];
  let matched = 0;
  let changed = 0;
  let failed = 0;

  for (const f of files) {
    const file = join(DATA, f);
    const rec = JSON.parse(readFileSync(file, 'utf8'));
    if (!rec.ids.winget) continue; // custom-source apps carry their own Linux builds
    if (ONLY.length && !ONLY.includes(rec.slug) && !ONLY.includes(rec.ids.winget)) continue;

    try {
      const pinned = cfg.get(rec.ids.winget);
      let id = pinned && pinned !== 'none' ? pinned : null;

      if (pinned === 'none') {
        if (rec.ids.flathub) {
          writeFileSync(file, JSON.stringify(stripLinux(rec), null, 2) + '\n');
          changed++;
          notes.push(`${rec.slug}: flathub=none, Linux data removed`);
        }
        continue;
      }
      if (id && !isAppId(id)) {
        notes.push(`${rec.slug}: "flathub=${id}" is not a Flathub app id (looks like net.cozic.joplin_desktop), ignored`);
        continue;
      }

      if (!id) {
        const seen = searchCache[rec.slug];
        const fresh = seen && Date.now() - Date.parse(seen.checked_at) < RECHECK_DAYS * 864e5;
        if (fresh && !RECHECK) {
          if (seen.outcome === 'review') notes.push(`${rec.slug}: possible Flathub apps need a manual decision: ${seen.others.slice(0, 4).join(', ')}`);
          continue;
        }
        const sg = await suggestFlathub(rec);
        searchCache[rec.slug] = { checked_at: now, outcome: sg.id ? 'matched' : sg.confidence === 'review' ? 'review' : 'none', others: sg.others };
        if (!sg.id) {
          if (sg.confidence === 'review') notes.push(`${rec.slug}: possible Flathub apps need a manual decision: ${sg.others.slice(0, 4).join(', ')}`);
          continue;
        }
        id = sg.id;
        autoMatched.push({ wingetId: rec.ids.winget, id });
        notes.push(`${id} (${rec.slug}): auto-matched on name and website, review it`);
      }

      const app = await getAppstream(id);
      if (!app) {
        notes.push(`${rec.slug}: ${id} not found on Flathub (kept as it was)`);
        continue;
      }
      const summary = await getSummary(id);
      const norm = normaliseFlathub(app, summary, now);
      if (norm.skip) {
        notes.push(`${id} (${rec.slug}): skipped, ${norm.skip}`);
        continue;
      }
      const next = withLinux(rec, norm, rec);
      matched++;
      if (JSON.stringify(next) !== JSON.stringify(rec)) {
        writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
        changed++;
      }
    } catch (e) {
      failed++;
      console.error(`✗ ${rec.slug}: ${e.message}`);
    }
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(SEARCH_CACHE, JSON.stringify(Object.fromEntries(Object.entries(searchCache).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n');

  // Remember auto-matched apps in the config so later runs keep them (one line at a time, first token only).
  if (autoMatched.length) {
    const lines = readFileSync(CFG, 'utf8').split('\n');
    for (const { wingetId, id } of autoMatched) {
      const i = lines.findIndex((l) => l.replace(/#.*/, '').trim().split(/\s+/)[0] === wingetId);
      if (i >= 0 && !/\bflathub=/.test(lines[i])) lines[i] = `${lines[i].trimEnd()} flathub=${id}`;
    }
    writeFileSync(CFG, lines.join('\n'));
  }

  console.log(`Flathub: ${matched} app(s) on Flathub, ${changed} record(s) written${failed ? `, ${failed} failed` : ''}`);
  for (const n of notes) console.log(`  flathub: ${n}`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
