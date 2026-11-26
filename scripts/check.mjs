#!/usr/bin/env node
// Post-build checks on dist/: JSON-LD parses and is sane, internal links
// resolve, sitemap matches the pages, titles/descriptions are sane, and no
// page claims "Free" for an app whose pricing is unknown.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWhatsNew, currentWhatsNew } from './lib/whatsnew.mjs';

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
        for (const k of ['name', 'operatingSystem', 'softwareVersion', 'downloadUrl']) if (!part[k] && !(k === 'downloadUrl' && html.includes('is-dead'))) bad(rel, `platform part missing ${k}`); // a platform whose every download link is dead has no downloadUrl
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
  if (/\bfor free\b/i.test(title) && rel !== 'index.html' && ['unknown', 'paid'].includes(pricing.get(rel.split('/')[0]))) bad(rel, `title says free but pricing is ${pricing.get(rel.split('/')[0])}`);
  if ((html.match(/<h1[ >]/g) || []).length !== 1) bad(rel, 'expected exactly one <h1>');
  if (!/<link rel="canonical"/.test(html)) bad(rel, 'no canonical');

  // internal links
  for (const [, href] of html.matchAll(/href="(\/[^"]*)"/g)) if (!exists(href)) bad(rel, `broken internal link ${href}`);
}

// sitemap
// sitemap.xml is an index: sitemap-pages.xml (home, about, listings, categories), sitemap-software.xml (app pages) and
// sitemap-old-versions.xml. Every child it names must exist; locs below are the pages and software sitemaps together.
const locsOf = (file) => (existsSync(join(DIST, file)) ? [...readFileSync(join(DIST, file), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace('https://everyversion.net', '')) : null);
const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
if (!/<sitemapindex /.test(sitemap)) bad('sitemap.xml', 'is not a sitemap index');
const children = (locsOf('sitemap.xml') || []).map((l) => l.replace(/^\//, ''));
for (const c of children) if (!existsSync(join(DIST, c))) bad('sitemap.xml', `names a missing sitemap ${c}`);
for (const c of ['sitemap-pages.xml', 'sitemap-software.xml']) if (!children.includes(c)) bad('sitemap.xml', `does not name ${c}`);
const softwareLocs = locsOf('sitemap-software.xml') || [];
if (softwareLocs.length !== apps.length || softwareLocs.some((l) => !/^\/[^/]+\/$/.test(l))) bad('sitemap-software.xml', `expected the ${apps.length} app pages only, found ${softwareLocs.length} urls`);
const locs = [...(locsOf('sitemap-pages.xml') || []), ...softwareLocs];
const STATIC = 6 + (exists('/linux/') ? 1 : 0); // about, contact, security, API, Windows and Mac listings, and the Linux listing when an app has a Linux build (the legal pages and Stats are noindex and not in the sitemap)
let catPages = [];
try {
  catPages = JSON.parse(readFileSync(join(DIST, 'api/v1/categories.json'), 'utf8')).categories.filter((c) => c.url);
} catch {}
const CATEGORY_PAGES = catPages.length ? catPages.length + 1 : 0; // one page per category with 5+ apps, plus the /categories/ hub
if (locs.length !== apps.length + 1 + STATIC + CATEGORY_PAGES) bad('sitemap-pages.xml + sitemap-software.xml', `expected ${apps.length + 1 + STATIC + CATEGORY_PAGES} urls, found ${locs.length}`);

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
  const alt = /<div class="ov-similar">[\s\S]*?<\/div>/.exec(h)?.[0]; // the alternatives sidebar
  if (!alt) continue;
  const links = [...alt.matchAll(/<li><a href="\/([^/"]+)\/"/g)].map((m) => m[1]);
  if (links.includes(a.slug)) bad(a.slug, 'lists itself as an alternative');
  if (links.length < 1 || links.length > 6) bad(a.slug, `alternatives has ${links.length} links`);
}
for (const l of locs) if (!exists(l)) bad('sitemap-pages.xml + sitemap-software.xml', `missing page ${l}`);

// old-versions pages: one per app with more than 25 old versions, in their own sitemap, linked both ways
const oldFiles = htmlFiles.filter((f) => /-old-versions\.html$/.test(f)).map((f) => f.replace(DIST, ''));
const oldSitemapPath = join(DIST, 'sitemap-old-versions.xml');
const oldLocs = existsSync(oldSitemapPath) ? [...readFileSync(oldSitemapPath, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace('https://everyversion.net', '')) : [];
if (oldFiles.length && !children.includes('sitemap-old-versions.xml')) bad('sitemap.xml', 'does not name sitemap-old-versions.xml');
if (oldLocs.length !== oldFiles.length) bad('sitemap-old-versions.xml', `lists ${oldLocs.length} pages, dist has ${oldFiles.length}`);
for (const l of oldLocs) if (!exists(l)) bad('sitemap-old-versions.xml', `missing page ${l}`);
for (const l of locs) if (/-old-versions\.html$/.test(l)) bad('sitemap', `old-versions page belongs in sitemap-old-versions.xml: ${l}`);
for (const f of oldFiles) {
  const slug = f.split('/')[1];
  const o = readFileSync(join(DIST, f), 'utf8');
  const main = readFileSync(join(DIST, slug, 'index.html'), 'utf8');
  if (!main.includes(`href="${f}"`)) bad(slug, 'main page does not link to its old-versions page');
  if (!(/<nav aria-label="Jump to">[\s\S]*?<\/nav>/.exec(main)?.[0] || '').includes(`<a href="${f}">Older versions</a>`)) bad(slug, 'the Older versions link in Downloads does not go to the old-versions page');
  if (!new RegExp(`<a class="btn ov-latest" href="/${slug}/">Get latest version</a>`).test(o)) bad(f, 'no "Get latest version" link back to the main page');
  if (!/<aside class="ov-side"/.test(o)) bad(f, 'no sidebar');
}

// .htaccess: canonical https, no listings, hidden files
const ht = exists('/.htaccess') || existsSync(join(DIST, '.htaccess')) ? readFileSync(join(DIST, '.htaccess'), 'utf8') : null;
if (!ht) bad('.htaccess', 'missing from dist/ (the build copies assets/htaccess)');
else for (const [what, re] of [['https redirect', /RewriteCond %\{HTTPS\} !=on/], ['canonical host', /https:\/\/everyversion\.net\/\$1 \[R=301/], ['no listings', /Options -Indexes/], ['404 for folders without index.html', /REQUEST_FILENAME\}\/index\.html !-f/], ['hidden files', /well-known/]]) if (!re.test(ht)) bad('.htaccess', `missing rule: ${what}`);
// robots.txt: one group for everyone and a single Sitemap line (the index). Nothing blocks the .json / .md twins.
const robots = existsSync(join(DIST, 'robots.txt')) ? readFileSync(join(DIST, 'robots.txt'), 'utf8') : '';
if (!/User-Agent: \*\n[^\n]*\nAllow: \/\n/i.test(robots)) bad('robots.txt', 'the general group must still allow everything (AI agents read the twins)');
if (/Disallow: \/\*\.(json|md)\$/.test(robots)) bad('robots.txt', 'blocks the .json/.md twins');
const robotSitemaps = [...robots.matchAll(/^Sitemap: (.+)$/gm)].map((m) => m[1]);
if (robotSitemaps.join() !== 'https://everyversion.net/sitemap.xml') bad('robots.txt', `should list only the sitemap index, found: ${robotSitemaps.join(', ') || 'none'}`);
// Stray macOS Finder files would be served (they list file names). The .htaccess hides them, but they should not be deployed.
const strays = files.filter((f) => /(^|\/)\.DS_Store$/.test(f));
if (strays.length) warn.push(`${strays.length} .DS_Store file(s) in dist/ (Finder droppings, hidden by .htaccess; delete before you upload): ${strays.slice(0, 3).map((f) => f.replace(DIST + '/', '')).join(', ')}`);

// twins
// dead download links (data/links.json: HTTP 404/410): no enabled Download button may point at one
const deadLinks = new Set();
try {
  for (const [u, v] of Object.entries(JSON.parse(readFileSync(join(ROOT, 'data', 'links.json'), 'utf8')))) if (/^(404|410):/.test(v)) deadLinks.add(u);
} catch {}
let disabledButtons = 0;
for (const a of apps) {
  const oldFile = join(DIST, a.slug, `${a.slug}-old-versions.html`);
  const h = readFileSync(join(DIST, a.slug, 'index.html'), 'utf8') + (existsSync(oldFile) ? readFileSync(oldFile, 'utf8') : '');
  for (const m of h.matchAll(/<a class="btn[^"]*" href="([^"]+)"/g)) if (deadLinks.has(m[1].replace(/&amp;/g, '&'))) bad(a.slug, `enabled Download button for a dead link: ${m[1]}`);
  disabledButtons += (h.match(/class="btn[^"]*is-dead" disabled/g) || []).length;
}
if (deadLinks.size) console.log(`  ${deadLinks.size} dead download link(s) on record; ${disabledButtons} disabled button(s) on the pages`);

// checksum mismatches: an app whose downloads do not match the published checksum is never rated Safe
try {
  const verif = JSON.parse(readFileSync(join(ROOT, 'data', 'verification.json'), 'utf8'));
  for (const a of apps) {
    const v = verif[a.slug];
    if (!v?.installers?.some((i) => i.hash === 'MISMATCH')) continue;
    const h = readFileSync(join(DIST, a.slug, 'index.html'), 'utf8');
    const badge = /<span class="pill (\w+)">[^<]*<\/svg>([^<]*)<\/span>/.exec(h.slice(h.indexOf('safe-badge')));
    if (!badge) continue; // verification was stale and is ignored by the build
    if (badge[1] === 'ok' || /^Safe/.test(badge[2])) bad(a.slug, `hash mismatch but the page rates it "${badge[2]}"`);
  }
} catch {}

// disabled Homebrew casks: a warning in the Downloads card, no brew command, and the Download button is not switched off just because of it
for (const a of apps) {
  const rec = JSON.parse(readFileSync(join(ROOT, 'data', 'apps', `${a.slug}.json`), 'utf8'));
  const h = readFileSync(join(DIST, a.slug, 'index.html'), 'utf8');
  const dl = /<section id="download"[\s\S]*?<\/section>/.exec(h)?.[0] || '';
  if (rec.homebrew_cask_disabled) {
    if (!/class="dl-warn"/.test(dl)) bad(a.slug, 'disabled Homebrew cask but no warning in Downloads');
    if (/brew install --cask/.test(h)) bad(a.slug, 'page still shows a brew install command for a disabled cask');
  } else if (/class="dl-warn"/.test(dl)) bad(a.slug, 'Homebrew warning on an app whose cask is not disabled');
}

// features notes (inside Description): present exactly for the apps that have a content file, with 5-8 bullets and the Best for line
const featureSlugs = existsSync(join(ROOT, 'config', 'features')) ? readdirSync(join(ROOT, 'config', 'features')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')) : [];
for (const a of apps) {
  const h = readFileSync(join(DIST, a.slug, 'index.html'), 'utf8');
  const overview = /<section id="overview"[\s\S]*?<\/section>/.exec(h)?.[0] || '';
  const ul = /<ul class="feat">([\s\S]*?)<\/ul>/.exec(overview)?.[1];
  if (featureSlugs.includes(a.slug)) {
    if (!ul) { bad(a.slug, 'features file exists but Description has no feature bullets'); continue; }
    const n = (ul.match(/<li>/g) || []).length;
    if (n < 5 || n > 8) bad(a.slug, `feature list has ${n} bullets`);
    if (!/Best for:/.test(overview)) bad(a.slug, 'Description is missing the "Best for" line');
    if (!readFileSync(join(DIST, a.slug, `${a.slug}.md`), 'utf8').includes('**Best for:**')) bad(a.slug, 'features missing from the .md twin');
    const fd = JSON.parse(readFileSync(join(ROOT, 'config', 'features', `${a.slug}.json`), 'utf8')).description;
    if (fd) {
      const first = fd.split(/\n\s*\n/)[0].trim().slice(0, 60).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');
      if (!overview.includes(first)) bad(a.slug, 'our own description is not shown in Description');
      if (!readFileSync(join(DIST, a.slug, `${a.slug}.md`), 'utf8').includes(fd.split(/\n\s*\n/)[0].trim().slice(0, 60))) bad(a.slug, 'our own description is missing from the .md twin');
    }
  } else if (ul) bad(a.slug, 'Description has feature bullets but no content file');
  if (/id="features"|In the package data/.test(h)) bad(a.slug, 'old features section still on the page');
}
// "What's new" summaries: shown in the changelog section and the .md twin exactly when the file matches the latest version
{
  const wns = loadWhatsNew();
  for (const a of apps) {
    const rec = JSON.parse(readFileSync(join(ROOT, 'data', 'apps', `${a.slug}.json`), 'utf8'));
    const w = currentWhatsNew(wns.get(a.slug), rec);
    const sec = /<section id="changelog"[\s\S]*?<\/section>/.exec(readFileSync(join(DIST, a.slug, 'index.html'), 'utf8'))?.[0] || '';
    if (w && !/<p class="wn">/.test(sec)) bad(a.slug, '“What’s new” summary file exists but the section does not show it');
    if (!w && /<p class="wn">/.test(sec)) bad(a.slug, '“What’s new” summary shown without a current file');
    if (w && !readFileSync(join(DIST, a.slug, `${a.slug}.md`), 'utf8').includes(`## What’s new in ${w.version}`)) bad(a.slug, '“What’s new” summary missing from the .md twin');
  }
}
// renamed apps: "New (formerly Old)" in the H1 and <title> of the app page and its old-versions page, at the old slug
for (const a of apps) {
  const rec = JSON.parse(readFileSync(join(ROOT, 'data', 'apps', `${a.slug}.json`), 'utf8'));
  if (!rec.formerly) continue;
  const want = `${rec.name} (formerly ${rec.formerly})`.replace(/&/g, '&amp;');
  for (const page of [join(DIST, a.slug, 'index.html'), join(DIST, a.slug, `${a.slug}-old-versions.html`)]) {
    if (!existsSync(page)) continue;
    const h = readFileSync(page, 'utf8');
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(h)?.[1] || '';
    const title = /<title>([\s\S]*?)<\/title>/.exec(h)?.[1] || '';
    if (!h1.includes(want)) bad(a.slug, `H1 lacks "${want}" (${page.slice(DIST.length)})`);
    if (!title.includes(want)) bad(a.slug, `<title> lacks "${want}" (${page.slice(DIST.length)})`);
  }
}
for (const a of apps) for (const ext of ['json', 'md']) if (!exists(`/${a.slug}/${a.slug}.${ext}`)) bad(a.slug, `missing .${ext} twin`);

// screenshots (scripts/screenshots.mjs): every image the page shows is in the app folder, and the Flathub credit is there
for (const a of apps) {
  const h = readFileSync(join(DIST, a.slug, 'index.html'), 'utf8');
  const sec = /<section id="screenshots"[\s\S]*?<\/section>/.exec(h)?.[0];
  if (!sec) continue;
  const files = [...sec.matchAll(/<img src="\/[^/]+\/(screenshot-\d\d\.webp)\?v=/g)].map((m) => m[1]);
  if (!files.length) bad(a.slug, 'Screenshots section has no images');
  for (const f of files) if (!existsSync(join(DIST, a.slug, f))) bad(a.slug, `${f} missing from dist`);
  if (!/from <a [^>]*href="https:\/\/flathub\.org\/apps\//.test(sec)) bad(a.slug, 'Screenshots section is missing the Flathub credit');
  if (!/<script src="\/gallery\.js\?v=/.test(h)) bad(a.slug, 'Screenshots section without gallery.js');
  // the same screenshots, in the same order, in the SoftwareApplication structured data
  const ldShots = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .flatMap((m) => { const d = JSON.parse(m[1]); return d['@graph'] || [d]; })
    .find((n) => n['@type'] === 'SoftwareApplication')?.screenshot || [];
  const ldFiles = ldShots.map((s) => s.contentUrl?.split('/').pop());
  if (ldFiles.join() !== files.join()) bad(a.slug, `structured data screenshots (${ldFiles.length}) differ from the page (${files.length})`);
}

// share images (scripts/og.mjs): every app page names its own og.png, the file is there, and it is a 1200x630 PNG
for (const a of apps) {
  const h = readFileSync(join(DIST, a.slug, 'index.html'), 'utf8');
  const url = /<meta property="og:image" content="([^"]+)">/.exec(h)?.[1];
  if (!url) { bad(a.slug, 'no og:image (run node scripts/og.mjs)'); continue; }
  if (!url.startsWith(`https://everyversion.net/${a.slug}/og.png?v=`)) bad(a.slug, `og:image points elsewhere: ${url}`);
  if (!/<meta name="twitter:card" content="summary_large_image">/.test(h)) bad(a.slug, 'twitter:card is not summary_large_image');
  const file = join(DIST, a.slug, 'og.png');
  if (!existsSync(file)) { bad(a.slug, 'og.png missing from dist'); continue; }
  const png = readFileSync(file);
  if (png.toString('ascii', 1, 4) !== 'PNG' || png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630) bad(a.slug, 'og.png is not a 1200x630 PNG');
}

if (warn.length) console.warn(`warnings (${warn.length}):\n  ${warn.slice(0, 15).join('\n  ')}`);
if (problems.length) {
  console.error(`\n✗ ${problems.length} problem(s):\n  ${problems.slice(0, 40).join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ ${htmlFiles.length} html pages, ${apps.length} apps: JSON-LD, links, sitemap and twins OK`);
