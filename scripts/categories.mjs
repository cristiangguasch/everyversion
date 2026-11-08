#!/usr/bin/env node
// Builds data/categories.json from the hand-curated config/categories.json and data/tags.json.
//
//   npm run tags && npm run categories
//
// What it does:
//   1. validates the map: every slug is a real app, every app is the primary member of exactly one category
//   2. counts apps per category and flags which categories are big enough for their own page
//   3. lists the tags that support each category (tags shared by several members), so the grouping can be sanity-checked
//   4. suggests alternatives for each app: other members of its categories, ranked by shared (non-generic) tags
//
// Nothing here is guessed from text: categories come from the config, tags from the manifests.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'config', 'categories.json'), 'utf8'));
const tagFile = JSON.parse(readFileSync(join(ROOT, 'data', 'tags.json'), 'utf8'));
const slugs = readdirSync(join(ROOT, 'data', 'apps')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
const names = Object.fromEntries(slugs.map((s) => [s, JSON.parse(readFileSync(join(ROOT, 'data', 'apps', `${s}.json`), 'utf8')).name]));

const MIN_PAGE = cfg.min_apps_for_page ?? 5;
const MAX_ALTERNATIVES = 6;
const generic = new Set(cfg.generic_tags.map((t) => t.toLowerCase()));
const problems = [];

// ---- 1. validate
const primaryOf = {};
const alsoOf = {};
for (const c of cfg.categories) {
  for (const s of c.apps) {
    if (!slugs.includes(s)) problems.push(`${c.slug}: unknown app "${s}"`);
    if (primaryOf[s]) problems.push(`"${s}" is primary in both ${primaryOf[s]} and ${c.slug}`);
    primaryOf[s] = c.slug;
  }
  for (const s of c.also || []) {
    if (!slugs.includes(s)) problems.push(`${c.slug}: unknown app "${s}" in also`);
    (alsoOf[s] ||= []).push(c.slug);
  }
}
for (const c of cfg.categories) {
  for (const g of c.groups || []) for (const a of g.apps) if (!c.apps.includes(a)) problems.push(`${c.slug}: group "${g.name}" lists "${a}", which is not a primary member`);
}
const uncategorized = slugs.filter((s) => !primaryOf[s]);
for (const [s, list] of Object.entries(alsoOf)) for (const c of list) if (primaryOf[s] === c) problems.push(`"${s}" is both primary and also in ${c}`);
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exit(1);
}
// A new app that is not in the map yet is not an error: it simply gets no category and no alternatives until it is added to config/categories.json.
if (uncategorized.length) console.warn(`! ${uncategorized.length} app(s) not in any category yet (add them to config/categories.json): ${uncategorized.join(', ')}`);

// ---- 2/3. categories
const tagsOfApp = tagFile.apps; // slug -> [tag labels]
const tagCount = new Map(tagFile.tags.map((t) => [t.tag, t.count]));
const categories = cfg.categories.map((c) => {
  const members = [...c.apps.map((s) => ({ slug: s, role: 'primary' })), ...(c.also || []).map((s) => ({ slug: s, role: 'also' }))];
  const tc = new Map();
  for (const m of members) for (const t of tagsOfApp[m.slug] || []) if (!generic.has(t.toLowerCase())) tc.set(t, (tc.get(t) || 0) + 1);
  const topTags = [...tc].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([tag, n]) => ({ tag, apps_in_category: n, apps_total: tagCount.get(tag) }));
  return { slug: c.slug, name: c.name, title: c.title || `Download ${c.name} software`, ...(c.description ? { description: c.description } : {}), ...(c.lead ? { lead: c.lead } : {}), ...(c.about ? { about: c.about } : {}), count: members.length, primary_count: c.apps.length, page: members.length >= MIN_PAGE, ...(c.groups ? { groups: c.groups } : {}), apps: members, top_tags: topTags };
}).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

// ---- 4. alternatives
const members = {}; // category -> [{slug, role}]
for (const c of categories) members[c.slug] = c.apps;
const idf = (t) => Math.log(slugs.length / (tagCount.get(t) || 1));
const useful = (t) => !generic.has(t.toLowerCase()) && (tagCount.get(t) || 0) <= 25;
const appCats = {};
for (const s of slugs.filter((x) => primaryOf[x])) appCats[s] = { primary: primaryOf[s], also: (alsoOf[s] || []).sort() };
const groupOf = {}; // slug -> group name (within its primary category)
for (const c of cfg.categories) for (const g of c.groups || []) for (const a of g.apps) groupOf[a] = `${c.slug}/${g.name}`;
const alternatives = {};
for (const s of slugs.filter((x) => primaryOf[x])) {
  const mine = new Set((tagsOfApp[s] || []).filter(useful));
  const cand = new Map(); // slug -> category weight
  for (const [cat, w] of [[primaryOf[s], 3], ...(alsoOf[s] || []).map((c) => [c, 1.5])]) {
    for (const m of members[cat]) if (m.slug !== s) cand.set(m.slug, Math.max(cand.get(m.slug) || 0, w * (m.role === 'primary' ? 1 : 0.5)));
  }
  alternatives[s] = [...cand]
    .map(([o, w]) => {
      const shared = (tagsOfApp[o] || []).filter((t) => mine.has(t));
      const peer = groupOf[s] && groupOf[s] === groupOf[o] ? 8 : 0; // same sub-group = true peer
      return { slug: o, score: +(w + peer + shared.reduce((a, t) => a + idf(t), 0)).toFixed(1), shared_tags: shared.length, ...(peer ? { peer: true } : {}) };
    })
    .sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug))
    .slice(0, MAX_ALTERNATIVES);
}

const pages = categories.filter((c) => c.page);
const sizes = {};
for (const c of categories) sizes[c.count] = (sizes[c.count] || 0) + 1;
const withAlt = slugs.filter((s) => (alternatives[s] || []).length >= 3).length;
const out = {
  summary: {
    generated_at: new Date().toISOString().slice(0, 10),
    apps_total: slugs.length,
    categories_total: categories.length,
    min_apps_for_page: MIN_PAGE,
    categories_with_page: pages.length,
    apps_covered_by_a_page: new Set(pages.flatMap((c) => c.apps.map((m) => m.slug))).size,
    apps_with_3_or_more_alternatives: withAlt,
    apps_without_alternatives: slugs.filter((s) => !(alternatives[s] || []).length),
    uncategorized_apps: uncategorized,
    categories_below_threshold: categories.filter((c) => !c.page).map((c) => `${c.slug} (${c.count})`),
  },
  categories,
  apps: appCats,
  alternatives,
};
writeFileSync(join(ROOT, 'data', 'categories.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`data/categories.json: ${categories.length} categories (${pages.length} with ${MIN_PAGE}+ apps), ${slugs.length - uncategorized.length} of ${slugs.length} apps categorised, ${withAlt} apps with 3+ alternatives`);
