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
  if (/\bfor Free\b/.test(title) && rel !== 'index.html' && pricing.get(rel.split('/')[0]) === 'unknown') bad(rel, 'title says Free but pricing unknown');
  if ((html.match(/<h1[ >]/g) || []).length !== 1) bad(rel, 'expected exactly one <h1>');
  if (!/<link rel="canonical"/.test(html)) bad(rel, 'no canonical');

  // internal links
  for (const [, href] of html.matchAll(/href="(\/[^"]*)"/g)) if (!exists(href)) bad(rel, `broken internal link ${href}`);
}

// sitemap
const sitemap = readFileSync(join(DIST, 'sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace('https://everyversion.net', ''));
const STATIC = 6 + (exists('/linux/') ? 1 : 0); // about, contact, security, API, Windows and Mac listings, and the Linux listing when an app has a Linux build (the legal pages and Stats are noindex and not in the sitemap)
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
// Search engines must not read or index the .json / .md twins: robots.txt groups for the main crawlers, and a noindex header in .htaccess.
const robots = existsSync(join(DIST, 'robots.txt')) ? readFileSync(join(DIST, 'robots.txt'), 'utf8') : '';
const seGroup = /User-Agent: Googlebot\n[\s\S]*?\n\n/i.exec(robots)?.[0] || '';
for (const [what, re] of [['Googlebot group', /Disallow: \/\*\.json\$/], ['Googlebot group (md)', /Disallow: \/\*\.md\$/], ['Bingbot in the same group', /User-Agent: Bingbot/i]]) if (!re.test(seGroup)) bad('robots.txt', `search-engine group lacks: ${what}`);
if (!/User-Agent: \*\n[^\n]*\nAllow: \/\n/i.test(robots)) bad('robots.txt', 'the general group must still allow everything (AI agents read the twins)');
if (ht && !/X-Robots-Tag "noindex/.test(ht)) bad('.htaccess', 'no X-Robots-Tag noindex for .json/.md');
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
  const h = readFileSync(join(DIST, a.slug, 'index.html'), 'utf8');
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
  } else if (ul) bad(a.slug, 'Description has feature bullets but no content file');
  if (/id="features"|In the package data/.test(h)) bad(a.slug, 'old features section still on the page');
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
