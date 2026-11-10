#!/usr/bin/env node
// Validate every data/apps/*.json against schema/app.schema.json plus a few
// cross-record invariants that JSON Schema cannot express.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { compareVersions } from './lib/version.mjs';
import { loadFeatures, featureProblems } from './lib/features.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(ROOT, 'schema', 'app.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

const dir = join(ROOT, 'data', 'apps');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
let bad = 0;
const slugs = new Set();
const ids = new Set();

const fail = (f, msg) => {
  bad++;
  console.error(`✗ ${f}: ${msg}`);
};

for (const f of files) {
  const rec = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  if (!validate(rec)) {
    for (const e of validate.errors.slice(0, 5)) fail(f, `${e.instancePath || '/'} ${e.message}`);
    continue;
  }
  if (f !== `${rec.slug}.json`) fail(f, `filename must equal slug (${rec.slug})`);
  if (slugs.has(rec.slug)) fail(f, 'duplicate slug');
  const idKey = rec.ids.winget ? `winget:${rec.ids.winget}` : `custom:${rec.ids.custom}`;
  if (ids.has(idKey)) fail(f, 'duplicate source id');
  slugs.add(rec.slug);
  ids.add(idKey);

  for (const plat of rec.platforms) {
    const vs = rec.versions.filter((v) => v.platform === plat);
    if (!vs.length) fail(f, `no ${plat} versions`);
    if (vs[0] && vs[0].version !== rec.latest_versions[plat]) fail(f, `latest_versions.${plat} != newest ${plat} version`);
    if (!rec.versions_total[plat] || vs.length > rec.versions_total[plat]) fail(f, `versions_total.${plat} inconsistent`);
    for (let i = 1; i < vs.length; i++) if (compareVersions(vs[i - 1].version, vs[i].version) < 0) fail(f, `${plat} versions not sorted newest-first`);
    if (!rec.provenance.some((p) => p.platform === plat)) fail(f, `no provenance for ${plat}`);
  }
  for (const v of rec.versions) {
    if (!rec.platforms.includes(v.platform)) fail(f, `version ${v.version} on undeclared platform ${v.platform}`);
    for (const i of v.installers) {
      if (i.platform !== v.platform) fail(f, `installer platform mismatch in ${v.version}`);
      if (i.platform === 'windows' && !i.sha256 && !(i.no_checksum && rec.ids.custom)) fail(f, `windows installer without sha256 in ${v.version}`);
      // macOS (a cask with :no_check) and Linux from Flathub (a signed OSTree repo, no per-file hash) may declare no checksum; any other Linux build needs one.
      if (i.platform === 'macos' && !i.sha256 && !i.no_checksum) fail(f, `macos installer without sha256 or no_checksum in ${v.version}`);
      if (i.platform === 'linux' && !i.sha256 && !(i.no_checksum && rec.ids.flathub)) fail(f, `linux installer without sha256 in ${v.version}`);
    }
  }
  if (rec.homebrew_cask_disabled && !rec.ids.homebrew_cask) fail(f, 'homebrew_cask_disabled without ids.homebrew_cask');
  // Apps from winget get macOS only through a matched Homebrew cask; custom-source apps carry their own macOS builds.
  if (rec.ids.winget && rec.platforms.includes('macos') !== Boolean(rec.ids.homebrew_cask)) fail(f, 'macos platform and ids.homebrew_cask disagree');
  // Flathub: the Linux platform, ids.flathub, the flathub block and the flathub provenance entry stand or fall together.
  const flatProv = rec.provenance.filter((p) => p.source === 'flathub');
  if (rec.ids.flathub) {
    if (!rec.platforms.includes('linux')) fail(f, 'ids.flathub set but no linux platform');
    if (!rec.flathub || rec.flathub.app_id !== rec.ids.flathub) fail(f, 'flathub block missing or its app_id differs from ids.flathub');
    if (rec.flathub && rec.flathub.page_url !== `https://flathub.org/apps/${rec.ids.flathub}`) fail(f, 'flathub.page_url must be the Flathub page of ids.flathub');
    if (rec.flathub && rec.flathub.verified !== Boolean(rec.flathub.verification)) fail(f, 'flathub.verified and flathub.verification disagree');
    if (flatProv.length !== 1 || flatProv[0].platform !== 'linux') fail(f, 'expected exactly one flathub provenance entry, for linux');
    if (flatProv[0]?.repo !== `https://github.com/flathub/${rec.ids.flathub}`) fail(f, 'flathub provenance repo does not match ids.flathub');
    const lv = rec.versions.filter((v) => v.platform === 'linux');
    if (lv.some((v) => !v.installers.every((i) => i.type === 'flatpak' && i.url === `https://dl.flathub.org/repo/appstream/${rec.ids.flathub}.flatpakref`))) fail(f, 'flathub installers must be the app\'s .flatpakref');
  } else {
    if (rec.flathub) fail(f, 'flathub block without ids.flathub');
    if (flatProv.length) fail(f, 'flathub provenance without ids.flathub');
    if (rec.ids.winget && rec.platforms.includes('linux')) fail(f, 'linux platform on a winget app needs ids.flathub');
  }
  if (rec.ids.custom && !rec.provenance.every((p) => p.source === 'custom')) fail(f, 'custom-source app has provenance from another source');
  if (rec.pricing.status === 'unknown' && rec.pricing.source !== 'none') fail(f, 'unknown pricing must have source "none"');
  for (const v of rec.versions) for (const i of v.installers) if (!/^https:\/\//.test(i.url)) fail(f, `non-https installer URL in ${v.version}`);
}

// Editorial features sections (config/features/<slug>.json): shape, sources and a known app for each file.
const features = loadFeatures();
for (const [slug, feat] of features) {
  const rec = slugs.has(slug) ? JSON.parse(readFileSync(join(dir, `${slug}.json`), 'utf8')) : undefined;
  for (const p of featureProblems(slug, feat, rec)) fail(`config/features/${slug}.json`, p);
}

if (bad) {
  console.error(`\n${bad} problem(s) in ${files.length} files`);
  process.exit(1);
}
console.log(`✓ ${files.length} records valid${features.size ? `, ${features.size} features sections` : ''}`);
