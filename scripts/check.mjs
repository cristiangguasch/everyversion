#!/usr/bin/env node
// Post-build checks on dist/: JSON-LD parses and is sane, internal links
// resolve, sitemap matches the pages, titles/descriptions are sane, and no
// page claims "Free" for an app whose pricing is unknown.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const problems = [];
const warn = [];
const bad = (f, m) => problems.push(`${f}: ${m}`);

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const files = walk(DIST);
const htmlFiles = files.filter((f) => f.endsWith('.html'));

const exists = (urlPath) => {
  const p = decodeURIComponent(urlPath.split('#')[0].split('?')[0]);
  if (!p || p === '/') return true;
  const abs = join(DIST, p);
  return existsSync(abs) && (statSync(abs).isFile() || existsSync(join(abs, 'index.html')));
};

const apps = JSON.parse(readFileSync(join(DIST, 'api/v1/apps.json'), 'utf8')).apps;
const pricing = new Map(apps.map((a) => [a.slug, a.pricing]));

for (const f of htmlFiles) {
  const rel = f.replace(DIST + '/', '');
  const html = readFileSync(f, 'utf8');

  // JSON-LD
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  if (!blocks.length && rel !== '404.html') bad(rel, 'no JSON-LD');
  for (const [, raw] of blocks) {
    let j;
    try {
      j = JSON.parse(raw);
    } catch (e) {
      bad(rel, `JSON-LD does not parse: ${e.message}`);
      continue;
    }
    const nodes = (j['@graph'] || []).filter((n) => n['@type'] === 'SoftwareApplication');
    const main = nodes.find((n) => n.hasPart);
    if (main) {
      for (const k of ['name', 'operatingSystem', 'publisher', 'url']) if (!main[k]) bad(rel, `SoftwareApplication missing ${k}`);
      if (main.offers && pricing.get(rel.split('/')[0]) === 'unknown') bad(rel, 'offers price 0 on an app with unknown pricing');
      if (!main.hasPart.length) bad(rel, 'no platform parts');
      for (const part of main.hasPart) {
        for (const k of ['name', 'operatingSystem', 'softwareVersion', 'downloadUrl']) if (!part[k]) bad(rel, `platform part missing ${k}`);
        for (const m of part.associatedMedia || []) if (!/^[0-9a-f]{64}$/.test(m.sha256)) bad(rel, 'bad sha256 in JSON-LD');
      }
    }
  }

  // meta
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
  const desc = /<meta name="description" content="([^"]*)"/.exec(html)?.[1] ?? '';
  if (!title) bad(rel, 'missing <title>');
  if (title.length > 90) warn.push(`${rel}: long title (${title.length})`);
  if (desc.length < 50 || desc.length > 165) warn.push(`${rel}: description length ${desc.length}`);
  if (/\bfor Free\b/.test(title) && rel !== 'index.html' && pricing.get(rel.split('/')[0]) === 'unknown') bad(rel, 'title says Free but pricing unknown');
  if ((html.match(/<h1[ >]/g) || []).length !== 1) bad(rel, 'expected exactly one <h1>');
  if (!/<link rel="canonical"/.test(html)) bad(rel, 'no canonical');

  // internal links
  for (const [, href] of html.matchAll(/href="(\/[^"]*)"/g)) if (!exists(href)) bad(rel, `broken internal link ${href}`);
}

// sitemap
const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace('https://everyversion.net', ''));
const STATIC = 13 + (exists('/linux/') ? 1 : 0); // about, contact, security, API, legal hub + 5 policies, Stats, Windows and Mac listings, and the Linux listing when an app has a Linux build
let catPages = [];
try {
  catPages = JSON.parse(readFileSync(join(DIST, 'api/v1/categories.json'), 'utf8')).categories.filter((c) => c.url);
} catch {}
const CATEGORY_PAGES = catPages.length ? catPages.length + 1 : 0; // one page per category with 5+ apps, plus the /categories/ hub
if (locs.length !== apps.length + 1 + STATIC + CATEGORY_PAGES) bad('sitemap.xml', `expected ${apps.length + 1 + STATIC + CATEGORY_PAGES} urls, found ${locs.length}`);

// categories: every page exists with the right number of app links, and app pages never recommend themselves
for (const c of catPages) {
  const p = c.url.replace('https://everyversion.net', '');
  if (!exists(p)) { bad('categories', `missing page ${p}`); continue; }
  const h = readFileSync(join(DIST, p, 'index.html'), 'utf8');
  const linked = new Set([...h.matchAll(/<a class="item" href="\/([^/"]+)\/"/g)].map((m) => m[1]));
  if (linked.size !== c.apps.length) bad(p, `lists ${linked.size} apps, expected ${c.apps.length}`);
}
for (const a of apps) {
  const h = readFileSync(join(DIST, a.slug, 'index.html'), 'utf8');
  const alt = /<section id="alternatives"[\s\S]*?<\/section>/.exec(h)?.[0];
  if (!alt) continue;
  const links = [...alt.matchAll(/<a class="item" href="\/([^/"]+)\/"/g)].map((m) => m[1]);
  if (links.includes(a.slug)) bad(a.slug, 'lists itself as an alternative');
  if (links.length < 1 || links.length > 6) bad(a.slug, `alternatives has ${links.length} links`);
}
for (const l of locs) if (!exists(l)) bad('sitemap.xml', `missing page ${l}`);

// .htaccess: canonical https, no listings, hidden files
const ht = exists('/.htaccess') || existsSync(join(DIST, '.htaccess')) ? readFileSync(join(DIST, '.htaccess'), 'utf8') : null;
if (!ht) bad('.htaccess', 'missing from dist/ (the build copies assets/htaccess)');
else for (const [what, re] of [['https redirect', /RewriteCond %\{HTTPS\} !=on/], ['canonical host', /https:\/\/everyversion\.net\/\$1 \[R=301/], ['no listings', /Options -Indexes/], ['404 for folders without index.html', /REQUEST_FILENAME\}\/index\.html !-f/], ['hidden files', /well-known/]]) if (!re.test(ht)) bad('.htaccess', `missing rule: ${what}`);
// Stray macOS Finder files would be served (they list file names). The .htaccess hides them, but they should not be deployed.
const strays = files.filter((f) => /(^|\/)\.DS_Store$/.test(f));
if (strays.length) warn.push(`${strays.length} .DS_Store file(s) in dist/ (Finder droppings, hidden by .htaccess; delete before you upload): ${strays.slice(0, 3).map((f) => f.replace(DIST + '/', '')).join(', ')}`);

// twins
for (const a of apps) for (const ext of ['json', 'md']) if (!exists(`/${a.slug}/${a.slug}.${ext}`)) bad(a.slug, `missing .${ext} twin`);

if (warn.length) console.warn(`warnings (${warn.length}):\n  ${warn.slice(0, 15).join('\n  ')}`);
if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):\n  ${problems.slice(0, 40).join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ ${htmlFiles.length} html pages, ${apps.length} apps: JSON-LD, links, sitemap and twins OK`);
