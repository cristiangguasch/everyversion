#!/usr/bin/env node
// Custom sources: apps read straight from a publisher's own release feeds (config/custom-sources.json), not from winget-pkgs or Homebrew.
//
//   node scripts/custom.mjs                 check every enabled source and write/refresh data/apps/<slug>.json
//   node scripts/custom.mjs --only=<id>     just that source
//   node scripts/custom.mjs --full          do not reuse the existing record (an adapter that freezes old releases, like ableton, re-reads them all)
//
// Runs on every `npm run ingest` / `npm run daily`, next to the winget and Homebrew steps. Safe to re-run: a record and its
// timestamps only change when the feed content changed. If a feed is unreachable the existing record is left untouched and
// the run exits 1 (the daily routine reports it and carries on).
//
// A source = a config entry + an adapter in scripts/sources/<adapter>.mjs exporting `fetchSource(cfg, ctx)`, which returns
// { versions, versions_total, release_series?, stats }. This file turns that into a record that matches schema/app.schema.json.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data', 'apps');
const CACHE_DIR = join(ROOT, 'data', 'custom');
const args = process.argv.slice(2);
const FULL = args.includes('--full'); // ignore the existing record, so an adapter that freezes old releases re-reads all of them
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const PLATFORM_ORDER = ['windows', 'macos', 'linux'];
const UA = { 'user-agent': 'everyversion.net-custom-sources' };

const clean = (o) => {
  if (Array.isArray(o)) return o.map(clean);
  if (o && typeof o === 'object') return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).map(([k, v]) => [k, clean(v)]));
  return o;
};
const sha = (x) => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');

async function get(url, as) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return as === 'json' ? await res.json() : await res.text();
    } catch (e) {
      last = e;
      if (/HTTP 4\d\d/.test(e.message)) break; // a 404 will not get better
    }
  }
  throw last;
}

function buildRecord(src, out, prev, now) {
  const a = src.app;
  const versions = PLATFORM_ORDER.flatMap((p) => out.versions.filter((v) => v.platform === p));
  const platforms = PLATFORM_ORDER.filter((p) => versions.some((v) => v.platform === p));
  const latest = (p) => versions.find((v) => v.platform === p);
  const dates = versions.map((v) => v.release_date).filter(Boolean).sort();

  // One provenance entry per platform. It only moves (new retrieved_at) when that platform's content changed.
  const provenance = platforms.map((p) => {
    const content = sha({ versions: versions.filter((v) => v.platform === p), series: out.release_series || [] });
    const old = prev?.provenance?.find((e) => e.platform === p);
    return old && old.content_sha256 === content
      ? old
      : { source: 'custom', source_id: src.id, platform: p, repo: src.feeds.releases, retrieved_at: now, path: new URL(src.feeds.releases).pathname.replace(/^\//, ''), api_url: src.feeds.series, content_sha256: content };
  });

  return clean({
    schema_version: 2,
    slug: src.slug,
    name: a.name,
    publisher: a.publisher,
    ids: { custom: src.id },
    platforms,
    summary: a.summary,
    description: a.description,
    tags: a.tags,
    series_label: a.series_label,
    locale: 'en-US',
    urls: a.urls,
    license: a.license,
    pricing: { status: a.pricing, source: 'curated' },
    latest_versions: Object.fromEntries(platforms.map((p) => [p, latest(p).version])),
    last_updated: dates.at(-1),
    versions_total: Object.fromEntries(platforms.map((p) => [p, Math.max(out.versions_total[p] || 0, versions.filter((v) => v.platform === p).length)])),
    versions,
    release_series: out.release_series,
    verification: {
      level: 0,
      label: src.verification_label || 'Hashes taken from the SHA-256 files the publisher posts next to each download (.sha256sum). Not independently re-computed; signatures not checked.',
      checks: { hash_in_manifest: true, hash_recomputed: false, signature_checked: false },
    },
    provenance,
  });
}

async function runSource(src) {
  const mod = await import(pathToFileURL(join(ROOT, 'scripts', 'sources', `${src.adapter}.mjs`)).href);
  mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = join(CACHE_DIR, `${src.id}.sha256.json`);
  const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  const log = (m) => console.log(m);
  const recFile = join(DATA, `${src.slug}.json`);
  const existingRecord = !FULL && existsSync(recFile) ? JSON.parse(readFileSync(recFile, 'utf8')) : null; // adapters may keep old entries as they are
  const out = await mod.fetchSource(src, { getJson: (u) => get(u, 'json'), getText: (u) => get(u, 'text'), cache, log, today: new Date().toISOString().slice(0, 10), prev: existingRecord });
  if (!out.versions.length) throw new Error('the feeds produced no versions; leaving the existing record alone');
  writeFileSync(cacheFile, JSON.stringify(Object.fromEntries(Object.entries(cache).sort(([x], [y]) => x.localeCompare(y))), null, 1) + '\n');

  // Refuse to take over another app's slug.
  mkdirSync(DATA, { recursive: true });
  for (const f of readdirSync(DATA).filter((f) => f.endsWith('.json'))) {
    const r = JSON.parse(readFileSync(join(DATA, f), 'utf8'));
    if (r.slug === src.slug && r.ids?.custom !== src.id) throw new Error(`slug "${src.slug}" is already used by another app (${f})`);
  }
  const file = join(DATA, `${src.slug}.json`);
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const rec = buildRecord(src, out, prev, new Date().toISOString());
  const same = prev && JSON.stringify(prev) === JSON.stringify(rec);
  if (!same) writeFileSync(file, JSON.stringify(rec, null, 2) + '\n');

  const per = rec.platforms.map((p) => `${p} ${rec.latest_versions[p]} (${rec.versions.filter((v) => v.platform === p).length} listed of ${rec.versions_total[p]})`).join(', ');
  console.log(`${rec.name}: ${per}`);
  console.log(`  ${out.stats.eligible} releases are still downloadable; ${out.stats.fetched} new checksum(s) fetched${out.stats.failed ? `, ${out.stats.failed} file(s) skipped` : ''}; ${prev ? (same ? 'record unchanged' : 'record updated') : 'record created'}`);
  return { slug: rec.slug, created: !prev, changed: !same };
}

async function main() {
  const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'custom-sources.json'), 'utf8'));
  const sources = cfg.sources.filter((s) => s.enabled !== false && (!ONLY.length || ONLY.includes(s.id)));
  console.log(`custom sources: ${sources.length} to check${sources.length ? ` (${sources.map((s) => s.id).join(', ')})` : ''}`);
  let failed = 0;
  for (const src of sources) {
    try {
      await runSource(src);
    } catch (e) {
      failed++;
      console.error(`✗ ${src.id}: ${e.message}`);
    }
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
