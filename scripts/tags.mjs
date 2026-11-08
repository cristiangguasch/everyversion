#!/usr/bin/env node
// Builds data/tags.json: every tag found on any app, how many apps carry it, and which apps.
//
//   node scripts/tags.mjs          (also: npm run tags)
//
// Tags are copied from each app's `tags` field (winget manifest Tags). Nothing is invented, translated or merged by meaning.
// The only normalisation is spelling: tags that differ only by case, hyphens, spaces or punctuation ("audio-editor",
// "audioeditor", "Audio Editor") count as one tag, labelled with its most common spelling. The spellings stay listed under `variants`.
//
// Output shape:
//   summary   totals and how many tags have N apps
//   tags[]    { tag, key, count, apps[], variants[]? }   sorted by count (desc), then tag
//   apps{}    slug -> [tag, ...]                          the reverse lookup, for alternatives and related-app links

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'data', 'apps');
const OUT = join(ROOT, 'data', 'tags.json');

// + and # carry meaning in tags (c, c++, c#), so they are spelled out before punctuation is dropped.
const keyOf = (t) => t.toLowerCase().replace(/\+/g, 'plus').replace(/#/g, 'sharp').replace(/[^a-z0-9]+/g, '');

const recs = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')))
  .sort((a, b) => a.slug.localeCompare(b.slug));

const byKey = new Map(); // key -> { spellings: Map(spelling -> n), apps: Set(slug) }
const appTags = {};
for (const r of recs) {
  const seen = new Set();
  const list = [];
  for (const raw of r.tags || []) {
    const spelling = String(raw).trim();
    const key = keyOf(spelling);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const e = byKey.get(key) || { spellings: new Map(), apps: new Set() };
    e.spellings.set(spelling, (e.spellings.get(spelling) || 0) + 1);
    e.apps.add(r.slug);
    byKey.set(key, e);
    list.push(key);
  }
  appTags[r.slug] = list;
}

// Label = most common spelling (ties: the one with a hyphen, then alphabetical), so the label is stable between runs.
const label = (e) => [...e.spellings].sort((a, b) => b[1] - a[1] || (b[0].includes('-') ? 1 : 0) - (a[0].includes('-') ? 1 : 0) || a[0].localeCompare(b[0]))[0][0];
const labelOfKey = new Map([...byKey].map(([k, e]) => [k, label(e)]));

const tags = [...byKey]
  .map(([key, e]) => ({
    tag: labelOfKey.get(key),
    key,
    count: e.apps.size,
    apps: [...e.apps].sort(),
    ...(e.spellings.size > 1 ? { variants: [...e.spellings.keys()].sort() } : {}),
  }))
  .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

const apps = Object.fromEntries(Object.entries(appTags).map(([slug, keys]) => [slug, keys.map((k) => labelOfKey.get(k)).sort()]));

const dist = {};
for (const t of tags) dist[t.count] = (dist[t.count] || 0) + 1;
const atLeast = (n) => tags.filter((t) => t.count >= n).length;

const out = {
  summary: {
    generated_at: new Date().toISOString().slice(0, 10),
    apps_total: recs.length,
    apps_with_tags: recs.filter((r) => (r.tags || []).length).length,
    distinct_tags: tags.length,
    tags_with_1_app: dist[1] || 0,
    tags_with_at_least: { 2: atLeast(2), 3: atLeast(3), 5: atLeast(5), 8: atLeast(8), 10: atLeast(10) },
    apps_per_tag_histogram: dist,
  },
  tags,
  apps,
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
console.log(`data/tags.json: ${tags.length} tags across ${out.summary.apps_with_tags} of ${recs.length} apps (${out.summary.tags_with_1_app} appear on only one app)`);
