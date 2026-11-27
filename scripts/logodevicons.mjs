#!/usr/bin/env node
// Last-resort app icons from Logo.dev, for apps that still have no icon or only the generic GitHub mark after
// icons.mjs and macicons.mjs. Kept locally as data/icons/<slug>.png like every other icon.
//
//   node scripts/logodevicons.mjs --missing            every app with no icon or only the GitHub mark
//   node scripts/logodevicons.mjs --missing slug1 …    only those apps, and only if they still need an icon
//   node scripts/logodevicons.mjs --dry-run …          report what would happen, write nothing
//
// How, per Logo.dev's self-hosting rules: the Logo.dev API (api.logo.dev/v2/brands/logo, secret key) returns a
// download link for the brand's logo; the file is downloaded once and stored. The img.logo.dev CDN is never copied.
// The secret key comes from LOGODEV_SECRET (environment or .env) and is never printed or written anywhere else.
//
// Which domain: the hostname of the record's homepage (else publisher URL), cut to its registrable part.
// Skipped: code hosts and big platforms (github.com, sourceforge.net, microsoft.com …), whose logo is not the app's;
// domains that two or more of our apps share (mozilla.org, jetbrains.com …), whose logo would be the company's;
// sources smaller than MIN_SOURCE px. config/apps.txt can set logo_domain=<domain> to pick a domain by hand (also
// for shared or hosted ones), or logo=none to never use Logo.dev for that app (company logos, wordmarks, banners).
// Logo.dev logos are brand logos; the app page that uses one as its icon credits Logo.dev in its footer (their attribution rule).
// Results and provenance go to data/icons.json (source "logo-dev", with domain, brand id and etag).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = join(ROOT, 'data', 'icons');
const INDEX = join(ROOT, 'data', 'icons.json');
const API = 'https://api.logo.dev/v2/brands/logo';
const SIZE = 256; // px, square PNG
const MIN_SOURCE = 64; // px; smaller sources would only be blown up
const MAX_BYTES = 400_000;
const HOSTING = /(^|\.)(github\.com|github\.io|gitlab\.com|gitlab\.io|codeberg\.org|sourceforge\.net|sf\.net|bitbucket\.org|launchpad\.net|microsoft\.com|google\.com)$/i;

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const MISSING = args.includes('--missing');
const only = args.filter((a) => !a.startsWith('--'));
if (!MISSING) {
  console.log('usage: node scripts/logodevicons.mjs --missing [--dry-run] [slug …]');
  process.exit(1);
}

const envFile = existsSync(join(ROOT, '.env')) ? readFileSync(join(ROOT, '.env'), 'utf8') : '';
const SECRET = process.env.LOGODEV_SECRET || envFile.match(/^LOGODEV_SECRET=(.+)$/m)?.[1].trim();
if (!SECRET) {
  console.log('LOGODEV_SECRET is not set (environment or .env): skipping Logo.dev icons');
  process.exit(0);
}

// config/apps.txt: winget ID -> logo=none / logo_domain=<domain>
const logoCfg = {};
for (const raw of readFileSync(join(ROOT, 'config', 'apps.txt'), 'utf8').split('\n')) {
  const [id, ...rest] = raw.replace(/#.*/, '').trim().split(/\s+/);
  if (!id) continue;
  const off = rest.includes('logo=none');
  const dom = (rest.find((t) => t.startsWith('logo_domain=')) || '').slice(12) || null;
  if (off || dom) logoCfg[id] = { off, domain: dom };
}

const recs = readdirSync(join(ROOT, 'data', 'apps')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(ROOT, 'data', 'apps', f), 'utf8')));
const index = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : {};
const needsIcon = (slug) => !index[slug] || index[slug].source === 'github-project'; // never replace a real icon

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; } };
const registrable = (h) => { const p = h.split('.'); return p.length > 2 && /^(co|com|org|net|ac|gov)$/.test(p.at(-2)) ? p.slice(-3).join('.') : p.slice(-2).join('.'); };
const autoDomain = (r) => { const h = hostOf(r.urls?.homepage) || hostOf(r.urls?.publisher); return h && !HOSTING.test(h) ? registrable(h) : null; };
const sharedBy = {};
for (const r of recs) { const d = autoDomain(r); if (d) (sharedBy[d] ||= []).push(r.slug); }

function sniffPng(buf) {
  return buf.length > 24 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG' ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null;
}

const todo = recs
  .filter((r) => (!only.length || only.includes(r.slug)) && needsIcon(r.slug))
  .sort((a, b) => a.slug.localeCompare(b.slug));
const tally = { saved: 0, skipped: 0, none: 0, failed: 0 };

for (const r of todo) {
  const cfg = logoCfg[r.ids?.winget] || {};
  const label = r.slug.padEnd(36);
  if (cfg.off) { console.log(`${label} skipped (logo=none)`); tally.skipped++; continue; }
  const domain = cfg.domain || autoDomain(r);
  if (!domain) { console.log(`${label} skipped (no own domain: code host or none)`); tally.skipped++; continue; }
  if (!cfg.domain && sharedBy[domain]?.length > 1) { console.log(`${label} skipped (${domain} is shared with ${sharedBy[domain].filter((s) => s !== r.slug).join(', ')}; set logo_domain= to choose)`); tally.skipped++; continue; }
  try {
    const res = await fetch(`${API}?domain=${encodeURIComponent(domain)}`, { headers: { authorization: `Bearer ${SECRET}` } });
    if (res.status === 404) { console.log(`${label} ${domain}: no logo at Logo.dev`); tally.none++; continue; }
    if (res.status === 202) { console.log(`${label} ${domain}: still being indexed at Logo.dev, try again later`); tally.none++; continue; }
    if (!res.ok) throw new Error(`API HTTP ${res.status}`);
    const d = (await res.json())?.data;
    if (d?.status !== 'ready' || !d.url) { console.log(`${label} ${domain}: not ready (${d?.status || 'no data'})`); tally.none++; continue; }
    const src = d.source || {};
    if (!src.is_vector && Math.min(src.width || 0, src.height || 0) < MIN_SOURCE) { console.log(`${label} ${domain}: source only ${src.width}x${src.height}, too small`); tally.none++; continue; }
    if (DRY) { console.log(`${label} ${domain}: would save (source ${src.width}x${src.height} ${src.format})`); tally.saved++; continue; }
    const dl = new URL(d.url);
    dl.searchParams.set('format', 'png');
    dl.searchParams.set('size', String(SIZE));
    const img = await fetch(dl);
    if (!img.ok) throw new Error(`download HTTP ${img.status}`);
    const buf = Buffer.from(await img.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error(`too large (${buf.length} bytes)`);
    const dim = sniffPng(buf);
    if (!dim) throw new Error('not a PNG');
    const file = `${r.slug}.png`;
    writeFileSync(join(ICONS, file), buf);
    index[r.slug] = {
      file, source: 'logo-dev', domain, brand_id: d.brand_id, etag: d.etag, url: `https://logo.dev/`,
      sha256: createHash('sha256').update(buf).digest('hex'), ext: 'png', bytes: buf.length, size: `${dim.w}x${dim.h}`,
      fetched_at: new Date().toISOString().slice(0, 10),
    };
    console.log(`${label} ${domain}: saved ${file} (${dim.w}x${dim.h}, ${buf.length} bytes)`);
    tally.saved++;
  } catch (e) {
    console.log(`${label} ${domain}: error: ${e.message}`);
    tally.failed++;
  }
}
if (!DRY) writeFileSync(INDEX, JSON.stringify(index, null, 2) + '\n');
console.log(`\nLogo.dev: ${DRY ? 'would save' : 'saved'} ${tally.saved}, skipped ${tally.skipped}, no usable logo ${tally.none}, failed ${tally.failed}`);
