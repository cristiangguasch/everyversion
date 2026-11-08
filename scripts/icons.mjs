#!/usr/bin/env node
// Fetch an app icon and keep it locally in data/icons/<slug>.<ext> (the build copies it to /<slug>/icon.<ext>).
//
//   node scripts/icons.mjs --first=10        the first N apps, alphabetical (same order as the home page); --first=1000 for all
//   node scripts/icons.mjs slug1 slug2       only those apps
//
// Sources, in this order, and nothing else:
//   1. the icon the app's own winget manifest lists (the Icons field, checked against its SHA-256 when it gives one)
//   2. for custom-source apps: the icon URL the source's config gives (app.icon_url in config/custom-sources.json), checked the same way
//   3. for apps on Flathub (verified or not; the record says which): the 128x128 icon Flathub serves for the app (dl.flathub.org)
//   4. for projects hosted on GitHub: ONE generic GitHub mark (data/icons/github-mark.svg). Never the project's or a
//      person's profile picture.
// Apps with neither get no icon (nothing is invented or generated). Results and provenance go to data/icons.json.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { getAppstream } from './lib/flathub.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'data', 'icons');
const INDEX = join(ROOT, 'data', 'icons.json');
const GENERIC = 'github-mark.svg';
const MAX_BYTES = 400_000;
const UA = { 'user-agent': 'everyversion.net-icons' };

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const only = args.filter((a) => !a.startsWith('--'));

const recs = readdirSync(join(ROOT, 'data', 'apps'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(ROOT, 'data', 'apps', f), 'utf8')))
  .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  .filter((r, i) => (only.length ? only.includes(r.slug) : i < Number(opt.first || 0)));

mkdirSync(OUT_DIR, { recursive: true });
const index = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : {};

// PNG, JPEG, WebP, GIF and ICO only. SVG is refused on purpose (it can carry scripts).
function sniff(buf) {
  const h = buf.subarray(0, 12);
  if (h[0] === 0x89 && h.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (h[0] === 0xff && h[1] === 0xd8) return 'jpg';
  if (h.toString('latin1', 0, 4) === 'RIFF' && h.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (h.toString('latin1', 0, 3) === 'GIF') return 'gif';
  if (h[0] === 0 && h[1] === 0 && h[2] === 1 && h[3] === 0) return 'ico';
  return null;
}

async function download(url) {
  const res = await fetch(url, { headers: UA, redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error(`too large (${buf.length} bytes)`);
  const ext = sniff(buf);
  if (!ext) throw new Error('not a PNG/JPEG/WebP/GIF/ICO image');
  return { buf, ext };
}

// ---- 1. the winget manifest's own Icons field
async function fromWinget(rec) {
  const v = rec.versions.find((x) => x.platform === 'windows');
  const prov = rec.provenance.find((e) => e.platform === 'windows');
  if (!v?.manifest_dir || !prov?.commit) return null;
  const base = `https://raw.githubusercontent.com/microsoft/winget-pkgs/${prov.commit}/${v.manifest_dir}/${rec.ids.winget}`;
  for (const file of [`${base}.locale.${rec.locale || 'en-US'}.yaml`, `${base}.yaml`]) {
    const res = await fetch(file, { headers: UA });
    if (!res.ok) continue;
    const icons = YAML.parse(await res.text())?.Icons;
    if (!Array.isArray(icons) || !icons.length) continue;
    // Prefer a light/default theme, then the largest resolution, then PNG.
    const score = (i) => (/dark/i.test(i.IconTheme || '') ? 0 : 1) * 1e6 + (parseInt(String(i.IconResolution || '').split('x')[0], 10) || 0) * 10 + (/png/i.test(i.IconFileType || '') ? 1 : 0);
    const pick = [...icons].filter((i) => i.IconUrl).sort((a, b) => score(b) - score(a))[0];
    if (!pick) continue;
    const { buf, ext } = await download(pick.IconUrl);
    const sha = createHash('sha256').update(buf).digest('hex');
    if (pick.IconSha256 && pick.IconSha256.toLowerCase() !== sha) throw new Error('icon does not match the SHA-256 in the manifest');
    return { source: 'winget-manifest', url: pick.IconUrl, sha256: sha, buf, ext };
  }
  return null;
}

// ---- 2. the icon a custom source's config names (the publisher's own file)
async function fromCustom(rec) {
  if (!rec.ids.custom) return null;
  const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'custom-sources.json'), 'utf8'));
  const url = cfg.sources.find((x) => x.id === rec.ids.custom)?.app?.icon_url;
  if (!url) return null;
  if (!/^https:\/\//.test(url)) throw new Error('icon_url must be https');
  const { buf, ext } = await download(url);
  return { source: 'custom-source', url, sha256: createHash('sha256').update(buf).digest('hex'), buf, ext };
}

// ---- 3. the icon of a Flathub app, verified or community (instead of the generic GitHub mark)
async function fromFlathub(rec) {
  if (!rec.flathub) return null;
  const app = await getAppstream(rec.flathub.app_id);
  const url = typeof app?.icon === 'string' ? app.icon : '';
  if (!/^https:\/\/dl\.flathub\.org\//.test(url)) return null;
  const { buf, ext } = await download(url);
  return { source: 'flathub', app_id: rec.flathub.app_id, publisher_verified: rec.flathub.verified === true, url, sha256: createHash('sha256').update(buf).digest('hex'), buf, ext };
}

// ---- 4. the GitHub organization that owns the project
function githubOwners(rec) {
  const urls = [
    ...Object.values(rec.urls || {}).flat().map((x) => (typeof x === 'object' ? x?.url : x)),
    rec.license?.url,
    ...rec.versions.flatMap((v) => [v.release_notes_url, ...(v.installers || []).map((i) => i.url)]),
  ].filter((u) => typeof u === 'string');
  const count = {};
  for (const u of urls) {
    const m = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9-]+)\/[A-Za-z0-9._-]+/.exec(u);
    if (m && !['orgs', 'sponsors', 'apps', 'features', 'settings'].includes(m[1].toLowerCase())) count[m[1]] = (count[m[1]] || 0) + 1;
  }
  return Object.entries(count).sort((a, b) => b[1] - a[1]).map(([o]) => o);
}
function fromGithub(rec) {
  const found = githubOwners(rec);
  if (!found.length) return { skip: 'no GitHub project found in the winget or cask data' };
  if (!existsSync(join(OUT_DIR, GENERIC))) return { skip: `${GENERIC} is missing` };
  const file = readFileSync(join(OUT_DIR, GENERIC));
  return { source: 'github-project', owner: found[0], url: `https://github.com/${found[0]}`, sha256: createHash('sha256').update(file).digest('hex'), file: GENERIC, ext: 'svg', bytes: file.length };
}

for (const rec of recs) {
  process.stdout.write(`${rec.name.padEnd(30)} `);
  try {
    let hit = (await fromWinget(rec)) || (await fromCustom(rec)) || (await fromFlathub(rec));
    let why = '';
    if (!hit) {
      const g = fromGithub(rec);
      if (g.skip) why = g.skip;
      else hit = g;
    }
    if (!hit) {
      delete index[rec.slug];
      console.log(`no icon (${why})`);
      continue;
    }
    if (hit.buf) {
      const file = `${rec.slug}.${hit.ext}`;
      writeFileSync(join(OUT_DIR, file), hit.buf);
      const { buf, ...meta } = hit;
      index[rec.slug] = { file, ...meta, fetched_at: new Date().toISOString().slice(0, 10), bytes: buf.length };
      console.log(`${hit.source === 'custom-source' ? 'publisher icon' : hit.source === 'flathub' ? `Flathub icon (${hit.publisher_verified ? 'verified' : 'unverified'})` : 'winget manifest icon'} -> ${file} (${buf.length} bytes)`);
    } else {
      index[rec.slug] = { ...hit, fetched_at: new Date().toISOString().slice(0, 10) };
      console.log(`generic GitHub mark (project: ${hit.owner})`);
    }
  } catch (e) {
    console.log(`error: ${e.message}`);
  }
}
writeFileSync(INDEX, JSON.stringify(index, null, 2) + '\n');
