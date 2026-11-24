#!/usr/bin/env node
// Build the static site: data/apps/*.json -> dist/
//   /                      home (searchable list)
//   /<slug>/               one page per app (flat URLs), SoftwareApplication JSON-LD
//   /<slug>.json  .md      machine-readable twins for agents and LLMs
//   /categories/           category hub; /categories/<slug>/ one page per category with 5+ apps (data/categories.json)
//   /api/v1/apps.json      index of all apps
//   /llms.txt /robots.txt /sitemap.xml /404.html
// No framework, no runtime JS needed for app pages.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarise } from './lib/summary.mjs';
import { statsPage } from './lib/stats-page.mjs';
import { CASK_REPO, caskDisabledSentence } from './lib/cask.mjs';
import { loadFeatures, featuresHtml, featuresMd } from './lib/features.mjs';
import { PLATFORM_PATHS } from './lib/platform-icons.mjs';
import { aboutPage, apiPage, contactPage, legalHub, privacyPage, termsPage, cookiesPage, disclaimerPage, contentPage, securityPage, AUTHOR, AUTHOR_ID, PERSON } from './lib/pages.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const SITE = { url: 'https://everyversion.net', name: 'Everyversion' };
// Full logo (mark + outlined wordmark) inlined in the header; the text takes the page colors so it works in dark mode.
const LOGO = readFileSync(join(ROOT, 'brand', 'logo.svg'), 'utf8')
  .replace(/ width="224" height="32"/, ' class="logo" aria-hidden="true"')
  .replace(/ role="img" aria-label="[^"]*"/, '')
  .replace(/<path fill="#15181d"/, '<path class="lw"')
  .replace(/<path fill="#5b6472"/, '<path class="ln"')
  .trim();
const CSS = readFileSync(join(ROOT, 'assets', 'site.css'), 'utf8').replace(/\n\s*/g, '');
const meta = JSON.parse(readFileSync(join(ROOT, 'data', 'meta.json'), 'utf8'));
// Curated categories (scripts/categories.mjs). Optional: without the file the site builds with no category pages or alternatives.
let CATS = null;
try {
  CATS = JSON.parse(readFileSync(join(ROOT, 'data', 'categories.json'), 'utf8'));
} catch {}
const CAT_BY_SLUG = CATS ? Object.fromEntries(CATS.categories.map((c) => [c.slug, c])) : {};
const catPath = (slug) => `/categories/${slug}/`;
const ALT_LIMIT = 6; // most alternatives shown on an app page
// Short content hash of a file in assets/, used as ?v= so a changed script is never served from the browser or CDN cache.
const assetHash = (name) => createHash('sha256').update(readFileSync(join(ROOT, 'assets', name))).digest('hex').slice(0, 10);
let SEARCH_V = ''; // set in main(): hash of search.js + the search index, so browsers refetch both when either changes (the server caches them for days)
let HAS_LINUX = false; // set in main(): the header links to /linux/ only when at least one app has a Linux build
let RECS_BY_SLUG = new Map(); // filled in main(); lets pages link to other apps
const FEATURES = loadFeatures(); // hand-written notes inside Description (config/features/<slug>.json), checked by scripts/validate.mjs
const WINGET_REPO = 'https://github.com/microsoft/winget-pkgs';
const PAGE_VERSIONS = 20; // versions rendered in HTML; the .json/.md twins carry everything we ingest

// ------------------------------------------------------------------ helpers

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const withCode = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
const trunc = (s, n) => {
  s = String(s).replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1);
  return cut.slice(0, cut.lastIndexOf(' ') > n * 0.6 ? cut.lastIndexOf(' ') : cut.length).replace(/[,;:.\-–\s]+$/, '') + '…';
};
const jsonLd = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
const write = (rel, content) => {
  const p = join(DIST, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
};
const link = (url, text, extra = '') => `<a href="${esc(url)}" rel="noopener"${extra}>${esc(text ?? url)}</a>`;
const safeId = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '-');

const PLATFORM = { windows: 'Windows', macos: 'Mac', linux: 'Linux' }; // names shown on the pages
const svg = (d) => `<svg class="ico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON_ROCKET = svg('<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.9A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>');
const ICON_UPDOWN = svg('<path d="M7 15l5 5 5-5M7 9l5-5 5 5"/>');
const ICON_COPY = svg('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>');
const ICON_EXTERNAL = svg('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/>');
// The text behind the homepage "For Agents" menu. All three options use it exactly as written here.
const AGENT_PROMPT = `Read ${SITE.url}/llms.txt so I can ask you to find software to download.`;
const PLATFORM_PATH = { windows: '/windows/', macos: '/mac/', linux: '/linux/' }; // one listing page per platform
// Platform logos (inline SVG, drawn in the text colour) shown next to the download headings. The glyphs live in
// scripts/lib/platform-icons.mjs so the share images (scripts/og.mjs) draw the same ones.
const PLATFORM_ICON = Object.fromEntries(Object.entries(PLATFORM_PATHS).map(([p, g]) => [p,
  `<svg class="plat-icon" viewBox="0 0 24 24" width="22" height="22" ${g.stroke ? 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' : 'fill="currentColor"'} aria-hidden="true">${g.body}</svg>`]));
const OS_NAME = { windows: 'Windows', macos: 'macOS', linux: 'Linux' }; // names used in structured data and the Markdown/llms files
const platformList = (ps) => {
  const n = ps.map((p) => PLATFORM[p]);
  return n.length <= 2 ? n.join(' & ') : `${n.slice(0, -1).join(', ')} & ${n.at(-1)}`;
};
const FORMAT = { dmg: 'DMG', pkg: 'PKG', tar: 'TAR', unknown: 'Not stated', exe: 'EXE', nullsoft: 'NSIS', inno: 'Inno Setup', wix: 'MSI (WiX)', msi: 'MSI', burn: 'Burn', msix: 'MSIX', appx: 'APPX', zip: 'ZIP', portable: 'Portable', pwa: 'PWA', flatpak: 'Flatpak', swu: 'SWUpdate package', sit: 'StuffIt archive (.sit)', hqx: 'BinHex archive (.hqx)' };
const SCOPE = { user: 'Per user', machine: 'All users' };
const ARCH_ORDER = ['universal', 'x64', 'arm64', 'x86', 'arm', 'neutral'];
const ARCH = { x64: 'x64 (64-bit)', x86: 'x86 (32-bit)', arm64: 'ARM64', arm: 'ARM', neutral: 'Any' };
const PRICE_LABEL = {
  'open-source': 'Free and open source',
  freeware: 'Freeware',
  'free-to-download': 'Free to download (may offer paid tiers)',
  paid: 'Paid (free trial available)',
  unknown: 'Not stated in winget-pkgs',
};
const isFree = (rec) => !['unknown', 'paid'].includes(rec.pricing.status);

// Display order of the downloads of one version when a source offers several (Live editions first, then Push downloads).
const VARIANT_ORDER = ['Live Suite', 'Live Standard', 'Live Intro', 'Live Lite', 'Free Trial', 'Live', 'Live LE', 'Push 3 update', 'Push 3 recovery image', 'Push USB audio driver', 'Push legacy audio driver', 'Push 3 GPL source code'];
const sortInstallers = (list) =>
  [...list].sort(
    (a, b) =>
      ARCH_ORDER.indexOf(a.architecture) - ARCH_ORDER.indexOf(b.architecture) ||
      (a.variant ? VARIANT_ORDER.indexOf(a.variant) : 0) - (b.variant ? VARIANT_ORDER.indexOf(b.variant) : 0) ||
      a.type.localeCompare(b.type) ||
      (a.scope || '').localeCompare(b.scope || '') ||
      (a.locale || '').localeCompare(b.locale || ''),
  );
const gh = (commit, path) => `${WINGET_REPO}/tree/${commit}/${path}`;

function paragraphs(text) {
  const out = [];
  let para = [];
  let bullets = [];
  const flushP = () => para.length && (out.push(`<p>${esc(para.join(' '))}</p>`), (para = []));
  const flushB = () => bullets.length && (out.push(`<ul class="clean">${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`), (bullets = []));
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line) (flushP(), flushB());
    else if (/^[-*•]\s+/.test(line)) (flushP(), bullets.push(line.replace(/^[-*•]\s+/, '')));
    else (flushB(), para.push(line));
  }
  flushP();
  flushB();
  return out.join('\n');
}

// ------------------------------------------------------------------ platform guidance

// Plain-sentence advice built only from what the package data declares: which architectures are published and the
// minimum OS version each installer states. Nothing is added from outside the data.
const WIN_BUILD = { 17134: '10 version 1803', 17763: '10 version 1809', 18362: '10 version 1903', 19041: '10 version 2004' };
const MAC_NAME = { '10.13': 'High Sierra', '10.14': 'Mojave', '10.15': 'Catalina', 11: 'Big Sur', 12: 'Monterey', 13: 'Ventura', 14: 'Sonoma', 15: 'Sequoia', 26: 'Tahoe' };
const verParts = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0);
const verCmp = (a, b) => {
  const x = verParts(a), y = verParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
function minOsLabel(platform, v) {
  const s = String(v);
  if (platform === 'macos') {
    const key = s.startsWith('10.') ? s.split('.').slice(0, 2).join('.') : s.split('.')[0];
    return `macOS ${key}${MAC_NAME[key] ? ` ${MAC_NAME[key]}` : ''}`;
  }
  const [maj, min, build] = verParts(s);
  if (maj === 6) return { 1: 'Windows 7', 2: 'Windows 8', 3: 'Windows 8.1' }[min] || `Windows ${s}`;
  if (maj === 10) return build >= 22000 ? 'Windows 11' : WIN_BUILD[build] ? `Windows ${WIN_BUILD[build]}` : build > 0 ? `Windows 10 (build ${build})` : 'Windows 10';
  return `Windows ${s}`;
}
const joinList = (a) => (a.length <= 1 ? a.join('') : a.length === 2 ? a.join(' and ') : `${a.slice(0, -1).join(', ')}, and ${a.at(-1)}`);
function platformGuidance(platform, installers, src = platform === 'macos' ? 'cask' : 'winget') {
  const win = platform === 'windows';
  const mac = platform === 'macos';
  const keyOf = (i) => (i.architecture === 'neutral' || i.architecture === 'universal' ? (win ? 'any' : 'universal') : i.architecture);
  const arch = new Set(installers.map(keyOf));
  const out = [];
  if (win) {
    const [x64, a64, x86] = ['x64', 'arm64', 'x86'].map((a) => arch.has(a));
    if (x64 && a64) out.push(`Choose the x64 (64-bit) installer for Intel or AMD PCs and the ARM64 installer for ARM PCs.${x86 ? ' The x86 (32-bit) installer is only for 32-bit Windows.' : ''}`);
    else if (x64 && x86) out.push('Choose the x64 (64-bit) installer for Intel or AMD PCs. The x86 (32-bit) installer is only for 32-bit Windows.');
    else if (x64) out.push('The publisher offers a 64-bit (x64) build for Intel or AMD PCs.');
    else if (a64 && !x86) out.push('The publisher offers only an ARM64 build, for ARM PCs.');
    else if (x86 && !a64) out.push('The publisher offers only a 32-bit (x86) build.');
  } else if (mac) {
    const [uni, arm, x64] = ['universal', 'arm64', 'x64'].map((a) => arch.has(a));
    if (uni) out.push('The Universal build runs on both Intel and Apple silicon Macs.');
    else if (arm && x64) out.push('Choose the Apple silicon (ARM64) build for Macs with an M-series chip and the Intel (x64) build for older Intel Macs.');
    else if (arm) out.push('The publisher offers only an Apple silicon (ARM64) build, for Macs with an M-series chip.');
    else if (x64) out.push('The publisher offers only an Intel (x64) build.');
  } else {
    const [x64, a64] = ['x64', 'arm64'].map((a) => arch.has(a));
    if (x64 && a64) out.push('Choose the x64 (64-bit) download for Intel or AMD computers and the ARM64 download for ARM computers.');
    else if (x64) out.push('The publisher offers a 64-bit (x64) build for Intel or AMD computers.');
    else if (a64) out.push('The publisher offers only an ARM64 build, for ARM computers.');
  }
  // Minimum OS: the strictest value declared for each architecture, grouped by the label it produces.
  const NAME = win ? { x64: 'x64', arm64: 'ARM64', x86: 'x86', any: '' } : { universal: 'Universal', arm64: mac ? 'Apple silicon' : 'ARM64', x64: mac ? 'Intel' : 'x64' };
  const strictest = new Map();
  for (const i of installers) {
    if (!i.min_os_version) continue;
    const k = keyOf(i);
    if (!strictest.has(k) || verCmp(i.min_os_version, strictest.get(k)) > 0) strictest.set(k, i.min_os_version);
  }
  if (!strictest.size) {
    const from = src === 'custom' ? 'The publisher’s release data' : src === 'flathub' ? 'The Flathub listing' : win ? 'The package data' : 'The Homebrew cask';
    out.push(
      win
        ? `${from} states no minimum Windows version, so check the publisher’s system requirements before installing on an older PC.`
        : mac
          ? `${from} states no minimum macOS version, so check the publisher’s system requirements before installing on an older Mac.`
          : `${from} states no minimum Linux version or distribution, so check the publisher’s system requirements before installing.`,
    );
  } else {
    const groups = new Map();
    for (const [k, v] of strictest) (groups.get(minOsLabel(platform, v)) || groups.set(minOsLabel(platform, v), []).get(minOsLabel(platform, v))).push(k);
    if (groups.size === 1 && strictest.size === arch.size) out.push(arch.size === 1 ? `This build needs ${[...groups.keys()][0]} or later.` : `Every build needs ${[...groups.keys()][0]} or later.`);
    else {
      const parts = [...groups].map(([label, ks]) => {
        const names = ks.map((k) => NAME[k]).filter(Boolean);
        return `the ${names.length ? joinList(names) + ' ' : ''}build${ks.length > 1 ? 's' : ''} ${ks.length > 1 ? 'need' : 'needs'} ${label} or later`;
      });
      const sentence = joinList(parts);
      out.push(sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.');
    }
  }
  return out;
}

// ------------------------------------------------------------------ license type

// Classifies a declared license by fixed rules. Only licenses we recognise get a family; anything else gets none (we do not guess).
const FAMILY = {
  permissive: ['Permissive', 'Few conditions on reuse; the copyright notice has to stay.'],
  weak: ['Weak copyleft', 'Changes to the licensed files must be shared under the same license.'],
  strong: ['Strong copyleft', 'Software built on it must be shared under the same license.'],
  network: ['Network copyleft', 'Like the GPL, and it also applies when the software is offered over a network.'],
};
function familyOf(token) {
  const t = token.trim().replace(/\s+License$/i, '').replace(/-(only|or-later)$/i, '').replace(/^GPLv(\d)$/i, 'GPL-$1.0');
  if (/^(MIT|BSD-\d-Clause|Apache-2\.0|ISC|PostgreSQL|PSF-2\.0|Zlib)$/i.test(t)) return 'permissive';
  if (/^AGPL/i.test(t)) return 'network';
  if (/^(LGPL|MPL|EPL)/i.test(t)) return 'weak';
  if (/^GPL/i.test(t)) return 'strong';
  return null;
}
/** { kind, text, note } for the Details row, or null. */
function licenseType(rec) {
  const status = rec.pricing.status;
  if (status === 'unknown') return null;
  if (status !== 'open-source') return { text: status === 'freeware' ? 'Proprietary · Freeware' : status === 'paid' ? 'Proprietary · Paid' : 'Proprietary', note: null };
  const toks = String(rec.license.spdx || rec.license.name).split(/\s+(?:AND|OR|or|and)\s+/);
  const fams = toks.map(familyOf);
  if (fams.every(Boolean) && new Set(fams).size === 1) return { text: `Open source · ${FAMILY[fams[0]][0]}`, note: FAMILY[fams[0]][1] };
  return { text: 'Open source', note: null };
}

// ------------------------------------------------------------------ layout

// Every absolute http(s) link leaves the site, so it opens in a new tab. rel stays noopener.
const openExternalInNewTab = (html) =>
  html.replace(/<a (?![^>]*\btarget=)([^>]*\bhref="https?:\/\/[^"]*"[^>]*)>/g, (m, attrs) =>
    `<a target="_blank" ${/\brel="[^"]*noopener/.test(attrs) ? attrs : `${attrs} rel="noopener"`}>`,
  );
const layout = (opts) => openExternalInNewTab(layoutRaw(opts));

// Share image tags. `image` = { url, alt } (absolute URL, 1200x630 PNG); pages without one keep the small summary card.
const imageMeta = (image) => image
  ? `<meta property="og:image" content="${esc(image.url)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(image.alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(image.url)}">
<meta name="twitter:image:alt" content="${esc(image.alt)}">`
  : '<meta name="twitter:card" content="summary">';

// `notice` (trusted HTML) puts a grey bar at the top of the sticky header, so it stays in view while scrolling.
function layoutRaw({ title, description, path, body, ld = [], alternates = '', noindex = false, image = null, notice = '' }) {
  const canonical = `${SITE.url}${path}`;
  const isHome = path === '/'; // the home page keeps its own header and its big search box
  return `<!doctype html>
<html lang="en-US"${isHome ? '' : ` class="has-sticky${notice ? ' has-notice' : ''}"`}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${noindex ? '<meta name="robots" content="noindex,follow">\n' : ''}${alternates}<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:locale" content="en_US">
${imageMeta(image)}
<meta name="color-scheme" content="light dark">
<link rel="preload" href="/fonts/geist.woff2" as="font" type="font/woff2" crossorigin>
<link rel="icon" type="image/x-icon" href="https://everyversion.net/favicon.ico" sizes="48x48">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<script>try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
<style>${CSS}</style>
${ld.map(jsonLd).join('\n')}
${isHome ? '' : `<script src="/search.js?v=${SEARCH_V}" defer></script>\n`}<script src="/t.js?v=${assetHash('t.js')}" defer></script>
</head>
<body>
<header class="site-header${isHome ? '' : ' sticky'}">${notice && !isHome ? `<div class="notice-bar" role="note"><div class="wrap">${notice}</div></div>` : ''}<div class="wrap">
<a class="brand" href="/" aria-label="Everyversion home">${LOGO}</a>
<nav aria-label="Site"><a href="/windows/">Windows</a><a href="/mac/">Mac</a>${HAS_LINUX ? '<a href="/linux/">Linux</a>' : ''}<a href="/categories/">Software</a><a href="/api/">API</a><a href="/about/">About</a><a href="/security/">Security</a><button type="button" class="theme-btn" id="theme-btn" aria-label="Switch between light and dark mode" title="Light / dark mode"><svg class="i-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg><svg class="i-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></button></nav>
</div>${isHome ? '' : `
<div class="wrap hs-wrap"><form class="header-search" role="search" action="/">
<label class="sr" for="hq">Search apps</label>
<input id="hq" type="search" placeholder="Search apps by name, publisher or tag" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="hsuggest" aria-autocomplete="list" aria-haspopup="listbox">
<ul id="hsuggest" class="suggest" role="listbox" aria-label="Matching apps" hidden></ul>
</form></div>`}</header>
<script>document.getElementById('theme-btn').addEventListener('click',function(){var r=document.documentElement,d=r.dataset.theme?r.dataset.theme==='dark':matchMedia('(prefers-color-scheme:dark)').matches,n=d?'light':'dark';r.dataset.theme=n;try{localStorage.setItem('theme',n)}catch(e){}})</script>
<main><div class="wrap">
${body}
</div></main>
<footer class="site-footer"><div class="wrap"><p>We host no installers, and we’re not affiliated with any software publisher.</p><nav aria-label="Legal"><a href="/about/">About</a><a href="/contact/">Contact</a><a href="/security/">Security</a><a href="/legal/">Legal</a><a href="/statistics/">Stats</a><a href="/legal/privacy/">Privacy</a><a href="/legal/terms/">Terms</a></nav></div></footer>
</body>
</html>
`;
}


// App icons fetched by scripts/icons.mjs (data/icons/<file>, index in data/icons.json). Apps without an entry show no icon.
let ICONS = {};
try {
  ICONS = JSON.parse(readFileSync(join(ROOT, 'data', 'icons.json'), 'utf8'));
} catch {}
// Share images made by scripts/og.mjs (data/og/<slug>.png, index in data/og.json). Apps without one keep the small card.
let OG = {};
try {
  OG = JSON.parse(readFileSync(join(ROOT, 'data', 'og.json'), 'utf8'));
} catch {}
// Screenshots from Flathub (scripts/screenshots.mjs: data/screenshots/<slug>/screenshot-NN.webp, index in data/screenshots.json).
let SHOTS = {};
try {
  SHOTS = JSON.parse(readFileSync(join(ROOT, 'data', 'screenshots.json'), 'utf8'));
} catch {}
const shotsOf = (rec) => (SHOTS[rec.slug]?.items || []).filter((it) => existsSync(join(ROOT, 'data', 'screenshots', rec.slug, it.file)));
const shotUrl = (rec, it) => `/${rec.slug}/${it.file}?v=${SHOTS[rec.slug].hash.slice(0, 8)}`;
const CHEVRON = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
function shotsHtml(rec) {
  const items = shotsOf(rec);
  if (!items.length) return '';
  const n = items.length;
  return `<section id="screenshots" aria-label="Screenshots">
<div class="shots" data-shots>
<button type="button" class="shots-btn shots-prev" aria-label="Previous screenshots" hidden>${CHEVRON('M15 6l-6 6 6 6')}</button>
<ul class="shots-track">
${items.map((it, i) => `<li><a class="shot" href="${shotUrl(rec, it)}"${it.caption ? ` data-caption="${esc(it.caption)}"` : ''}><img src="${shotUrl(rec, it)}" width="${it.width}" height="${it.height}" alt="${esc(it.caption || `${rec.name} screenshot ${i + 1} of ${n}`)}" loading="lazy" decoding="async"></a></li>`).join('\n')}
</ul>
<button type="button" class="shots-btn shots-next" aria-label="Next screenshots"${n > 3 ? '' : ' hidden'}>${CHEVRON('M9 6l6 6-6 6')}</button>
</div>
<p class="shots-credit">Screenshots of the Linux version, from <a href="${esc(SHOTS[rec.slug].page)}">Flathub</a>.</p>
</section>`;
}
const ogImage = (rec) => OG[rec.slug] && existsSync(join(ROOT, 'data', 'og', `${rec.slug}.png`))
  ? { url: `${SITE.url}/${rec.slug}/og.png?v=${OG[rec.slug].hash.slice(0, 8)}`, alt: `${rec.name} on ${SITE.name}` }
  : null;
// VirusTotal results (scripts/virustotal.mjs). Keyed by SHA-256. Absent = not looked up yet; nothing is ever guessed.
let VT = {};
try {
  VT = JSON.parse(readFileSync(join(ROOT, 'data', 'virustotal.json'), 'utf8'));
} catch {}
const vtUrl = (sha) => `https://www.virustotal.com/gui/file/${sha}`;
// Per-installer results of our own checks, by app slug then download URL (filled by mergeVerification).
const VERIF_FILES = new Map();

// Download URLs known to be gone (HTTP 404/410): from scripts/linkcheck.mjs (data/links.json) and from installer downloads that
// scripts/verify.mjs could not fetch because of a 404. The buttons for these URLs are disabled (see deadBtn). A URL that the
// link check now sees as alive is never treated as dead, so a file that comes back is enabled again.
const DEAD_LINKS = (() => {
  const out = new Map();
  const alive = new Set();
  try {
    for (const [u, v] of Object.entries(JSON.parse(readFileSync(join(ROOT, 'data', 'links.json'), 'utf8')))) {
      const [st, day] = String(v).split(':');
      if (st === '404' || st === '410') out.set(u, { status: Number(st), checked: day });
      else if (Number(st) >= 200 && Number(st) < 400) alive.add(u);
    }
  } catch {}
  try {
    for (const r of Object.values(JSON.parse(readFileSync(join(ROOT, 'data', 'verification.json'), 'utf8')))) {
      for (const i of [...(r.installers || []), ...(r.installers_attempted || [])]) {
        const m = /returned error: (404|410)\b/.exec(i.error || '');
        if (m && !alive.has(i.url) && !out.has(i.url)) out.set(i.url, { status: Number(m[1]), checked: r.checked_at });
      }
    }
  } catch {}
  return out;
})();
const deadOf = (i) => DEAD_LINKS.get(i.url);
// A hash we computed ourselves when the source lists none (scripts/verify.mjs, for the newest version).
const ownSha = (slug, i) => (i.sha256 ? null : VERIF_FILES.get(slug)?.get(i.url)?.computed_sha256 || null);
const deadDay = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
// A disabled stand-in for the Download button: the publisher's link answers 404/410, so there is nothing to download.
const deadBtn = (i, cls) => {
  const d = deadOf(i);
  // The wrapper takes the hover, focus and tap (a disabled button receives none of them) and shows the tooltip from data-tip.
  return `<span class="dead-tip" tabindex="0" data-tip="Download Unavailable"><button type="button" class="${cls} is-dead" disabled aria-disabled="true" aria-label="Download ${esc(i.filename)}: unavailable, the link returns HTTP ${d.status}">Download</button></span>`;
};

// ------------------------------------------------------------------ verification (level 1)

// data/verification.json is written by scripts/verify.mjs. Apps without an entry stay at level 0 and show no name.
function mergeVerification(recs) {
  const file = join(ROOT, 'data', 'verification.json');
  let results = {};
  try {
    results = JSON.parse(readFileSync(file, 'utf8'));
  } catch {}
  for (const rec of recs) {
    const r = results[rec.slug];
    if (!r?.installers?.length) continue;
    const it = r.installers;
    // Stale guard: results only count while they cover exactly the installers now listed as latest.
    const latestUrls = rec.platforms.flatMap((p) => rec.versions.find((v) => v.platform === p).installers.filter((i) => i.type !== 'flatpak').map((i) => i.url)); // Flatpaks from Flathub have no file to hash, so they are never part of the check
    const checkedUrls = new Set(it.map((i) => i.url));
    if (latestUrls.some((u) => !checkedUrls.has(u))) {
      console.warn(`stale verification ignored for ${rec.slug}: the latest installers changed since they were checked`);
      continue;
    }
    const hashed = it.filter((i) => i.hash !== 'download-failed');
    const hash = { total: it.length, match: it.filter((i) => i.hash === 'match').length, mismatch: it.filter((i) => i.hash === 'MISMATCH').length, no_upstream: it.filter((i) => i.hash === 'no-upstream-hash').length };
    const sig = {
      valid: it.filter((i) => i.signature.status === 'valid').length,
      unsigned: it.filter((i) => i.signature.status === 'unsigned').length,
      invalid: it.filter((i) => i.signature.status === 'invalid').length,
      not_applicable: it.filter((i) => i.signature.status === 'not-applicable').length,
    };
    VERIF_FILES.set(rec.slug, new Map(it.map((i) => [i.url, i])));
    const hashDone = hashed.length > 0;
    const sigDone = it.some((i) => i.signature.tool);
    rec.verification = {
      level: hashDone ? 1 : 0,
      label: hashDone
        ? `Hashes re-computed from the publisher’s download: ${hash.match} of ${hash.total} installers match the upstream manifest.`
        : rec.verification.label,
      checks: { hash_in_manifest: true, hash_recomputed: hashDone, signature_checked: sigDone },
      checked_at: r.checked_at,
      summary: { hash, signature: sig },
    };
  }
}

// ------------------------------------------------------------------ app page

function installerTable(installers, platform = 'windows', ver = '', slug = '') {
  const mac = platform === 'macos';
  const rows = sortInstallers(installers)
    .map(
      (i) => `<tr>
<td>${i.variant ? `${esc(i.variant)}<span class="host">${esc(archLabel(i))}</span>` : esc(archLabel(i))}</td>
<td>${esc(fmtOf(i))}${i.nested_type ? `<span class="host">in ${esc(FORMAT[i.nested_type] || i.nested_type)}</span>` : ''}</td>
${mac ? '' : `<td>${esc(SCOPE[i.scope] || '—')}${i.locale ? `<span class="host">${esc(i.locale)}</span>` : ''}</td>
`}${mac ? `<td>${esc(i.min_os_version ? `macOS ${i.min_os_version}+` : '—')}</td>
<td><span class="fn">${esc(i.filename)}</span>${i.version ? `<span class="host">version ${esc(i.version)}</span>` : ''}<span class="host">${esc(i.host)}</span></td>
` : ''}<td>${i.sha256 || ownSha(slug, i) ? `<code class="hash">${esc(i.sha256 || ownSha(slug, i))}</code>${i.sha256 ? '' : '<span class="host">Computed by us</span>'}` : '<span class="host">Not provided</span>'}</td>
<td>${deadOf(i) ? `${deadBtn(i, 'btn')}<span class="host">Link returns ${deadOf(i).status}</span>` : `<a class="btn" href="${esc(i.url)}" rel="noopener nofollow" data-t="download" data-slot="version" data-pl="${platform}" data-ar="${esc(i.architecture)}" data-ty="${esc(i.type)}" data-h="${esc(i.host)}"${ver ? ` data-v="${esc(ver)}"` : ''} aria-label="Download ${esc(i.filename)} from ${esc(i.host)}">Download</a>`}</td>
</tr>`,
    )
    .join('\n');
  return `<div class="scroll"><table>
<thead><tr><th scope="col">Architecture</th><th scope="col">Format</th>${mac ? '<th scope="col">Requires</th><th scope="col">File &amp; source</th>' : '<th scope="col">Scope</th>'}<th scope="col">SHA-256</th><th scope="col"><span class="sr">Download</span></th></tr></thead>
<tbody>
${rows}
</tbody></table></div>`;
}

// How Flathub verified the publisher, in words (website: proved control of the app id's domain; login: a GitHub/GitLab/... account; manual: Flathub staff).
const flathubVerifiedText = (f) => {
  const v = f.verification || {};
  const how = v.method === 'website' ? `by proving control of ${v.website || 'the publisher’s website'}` : v.method === 'login_provider' ? `through a ${v.login_provider || 'code host'} login${v.login_name ? ` (${v.login_name})` : ''}` : v.method === 'manual' ? 'manually by Flathub' : '';
  return `Publisher verified on Flathub${how ? ` ${how}` : ''}${v.verified_on ? `, ${v.verified_on}` : ''}`;
};
// Shown for every Flathub app without the verified badge.
const flathubUnverifiedText = (f) => `The ownership of the ${f.app_id} app ID has not been verified and it may be a community package.`;
const pinCmd = (rec, v) => (rec.ids.winget ? `winget install --id ${rec.ids.winget} --version ${v.version} --exact` : null);

const PLAT_ORDER = ['windows', 'macos', 'linux'];
const platsOf = (rec) => PLAT_ORDER.filter((p) => rec.platforms.includes(p));
const versionsOf = (rec, p) => rec.versions.filter((v) => v.platform === p);
const provOf = (rec, p) => rec.provenance.find((e) => e.platform === p);
const isCustom = (e) => e?.source === 'custom';
const isFlathub = (e) => e?.source === 'flathub';
const sourceName = (e) => (isCustom(e) ? 'publisher release feed' : isFlathub(e) ? 'Flathub' : e.source === 'winget-pkgs' ? 'winget-pkgs' : 'Homebrew cask');
const sourceTree = (e) => (isCustom(e) || isFlathub(e) ? e.repo : e.source === 'winget-pkgs' ? `${WINGET_REPO}/tree/${e.commit}/${e.path}` : `${CASK_REPO}/blob/${e.commit}/${e.path}`);
const sourceHistory = (e) => (isCustom(e) || isFlathub(e) ? e.repo : e.source === 'winget-pkgs' ? `${WINGET_REPO}/tree/master/${e.path}` : `${CASK_REPO}/commits/master/${e.path}`);
// Download format shown to people: .tgz files are compressed tar archives.
const fmtOf = (i) => (i.type === 'tar' && /\.t(ar\.)?gz$/i.test(i.filename || '') ? 'TGZ (compressed tar)' : FORMAT[i.type] || i.type.toUpperCase());
// Icon URLs carry a short hash of the icon file (?v=...). The server lets browsers and the CDN keep images for 30 days, so a replaced icon
// would otherwise stay stale; a new hash is a new URL.
const iconHash = (slug) => (ICONS[slug]?.sha256 || '').slice(0, 8);
const iconSrc = (slug, ext) => `/${slug}/icon.${ext}${iconHash(slug) ? `?v=${iconHash(slug)}` : ''}`;
// Card for the app grids: the icon (when we have one) beside name, publisher and version line.
const gridIcon = (r) => {
  const icon = ICONS[r.slug];
  return icon ? `<img class="card-icon${icon.source === 'macos-app-bundle' ? ' app-icon-native' : ''}" src="${iconSrc(r.slug, icon.ext)}" width="40" height="40" alt="" loading="lazy" decoding="async">` : '';
};
// Version line for a grid card: platform logo + version, one pair per platform.
const gridVersions = (r, plats) =>
  plats.map((p) => `<span class="ver" title="${esc(PLATFORM[p])}">${PLATFORM_ICON[p] || ''}${esc(r.latest_versions[p])}</span>`).join('');
const MAC_ARCH = { universal: 'Universal (Apple silicon + Intel)', arm64: 'Apple silicon (ARM64)', x64: 'Intel (x64)' };
const archLabel = (i) => (i.platform === 'macos' ? MAC_ARCH[i.architecture] || i.architecture : ARCH[i.architecture] || i.architecture);
// Package-manager commands exist only where a package manager lists the app; custom-source downloads have none.
const installCmd = (rec, p) => (p === 'windows' ? (rec.ids.winget ? `winget install --id ${rec.ids.winget} --exact` : null) : p === 'macos' ? (rec.ids.homebrew_cask && !rec.homebrew_cask_disabled ? `brew install --cask ${rec.ids.homebrew_cask}` : null) : p === 'linux' ? (rec.flathub ? rec.flathub.install_command : null) : null);
const verifyCmd = (p) => (p === 'windows' ? 'Get-FileHash .\\<file> -Algorithm SHA256 (PowerShell)' : p === 'linux' ? 'sha256sum ~/Downloads/<file> (Terminal)' : 'shasum -a 256 ~/Downloads/<file> (Terminal)');

function primary(list, platform) {
  const order = platform === 'macos' ? ['universal', 'arm64', 'x64'] : ARCH_ORDER;
  return [...list].sort((a, b) => order.indexOf(a.architecture) - order.indexOf(b.architecture))[0];
}

function appPage(rec) {
  const plats = platsOf(rec);
  const platText = platformList(plats);
  const free = isFree(rec);
  const hasOld = Object.values(rec.versions_total).some((n) => n > 1);
  const h1 = `Download ${rec.name}`;
  const latestOf = Object.fromEntries(plats.map((p) => [p, versionsOf(rec, p)[0]]));
  // The version in the <title>: the first platform's, unless another platform's version is the same number without a build suffix.
  const titleVersion = (() => {
    const first = latestOf[plats[0]].version;
    return plats.map((p) => latestOf[p].version).find((v) => v !== first && first.startsWith(`${v}.`)) || first;
  })();
  const title = hasOld ? `${h1} ${titleVersion} and older versions` : `${h1} ${titleVersion}`; // the <title> tag; the H1 stays "Download X"
  const customOf = (p) => isCustom(provOf(rec, p)); // this platform's data comes from a custom source
  const allCustom = plats.every(customOf);
  const summaries = Object.fromEntries(plats.map((p) => [p, summarise(latestOf[p], { custom: customOf(p) })]));
  const latestText = plats.map((p) => `${OS_NAME[p]} ${latestOf[p].version}`).join(', ');
  const desc = trunc(`${rec.name} ${titleVersion} download links${hasOld ? ', old versions' : ''}, SHA-256 checksums, license and a plain summary of what the installer does.`, 160);
  const path = `/${rec.slug}/`;
  const canonical = `${SITE.url}${path}`;
  const u = rec.urls || {};
  const primaryCat = CATS?.apps?.[rec.slug] ? CAT_BY_SLUG[CATS.apps[rec.slug].primary] : null;
  const totalVersions = Object.values(rec.versions_total).reduce((a, b) => a + b, 0);

  // ---- JSON-LD: one parent application, one child per platform
  const byAuthor = `<a href="/about/" rel="author">${esc(AUTHOR)}</a>`;
  const verified = !!(rec.verification.checks?.hash_recomputed || rec.verification.checks?.signature_checked);
  const partNodes = plats.map((p) => {
    const lv = latestOf[p];
    const live = lv.installers.filter((i) => !deadOf(i));
    const prim = live.length ? primary(live, p) : null;
    const arches = [...new Set(lv.installers.map((i) => i.architecture))].filter((a) => !['neutral', 'universal'].includes(a));
    const minOs = [...new Set(lv.installers.map((i) => i.min_os_version).filter(Boolean))];
    return {
      '@type': 'SoftwareApplication',
      '@id': `${canonical}#${p}`,
      name: rec.name,
      operatingSystem: OS_NAME[p],
      softwareVersion: lv.version,
      ...(prim ? { downloadUrl: prim.url } : {}),
      ...(p === 'windows' && rec.last_updated ? { dateModified: rec.last_updated } : {}),
      ...(minOs.length === 1 ? { softwareRequirements: `${OS_NAME[p]} ${minOs[0]} or later` } : {}),
      ...(arches.length ? { processorRequirements: arches.join(', ') } : {}),
      associatedMedia: sortInstallers(lv.installers)
        .filter((i) => i.sha256 && !deadOf(i))
        .map((i) => ({ '@type': 'MediaObject', name: i.filename, contentUrl: i.url, sha256: i.sha256 })),
    };
  });
  const software = {
    '@type': 'SoftwareApplication',
    '@id': `${canonical}#software`,
    name: rec.name,
    url: canonical,
    ...(ICONS[rec.slug] && ICONS[rec.slug].source !== 'github-project' ? { image: `${SITE.url}/${rec.slug}/icon.${ICONS[rec.slug].ext}` } : {}), // the generic GitHub mark is not the app's own image
    description: trunc(rec.description || rec.summary || rec.name, 500),
    operatingSystem: plats.map((p) => OS_NAME[p]).join(', '),
    inLanguage: 'en-US',
    publisher: { '@id': `${canonical}#publisher` },
    ...(!['unknown', 'paid'].includes(rec.pricing.status) ? { offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', url: canonical, availability: 'https://schema.org/InStock' } } : {}),
    ...(rec.author && rec.author !== rec.publisher ? { author: { '@type': 'Organization', name: rec.author } } : {}),
    ...(rec.tags?.length ? { keywords: rec.tags.join(', ') } : {}),
    ...(rec.license.url ? { license: rec.license.url } : {}),
    ...(rec.license.copyright ? { copyrightNotice: rec.license.copyright } : {}),
    ...(u.support ? { softwareHelp: { '@type': 'CreativeWork', url: u.support } } : {}),
    ...(u.release_notes || latestOf.windows?.release_notes_url ? { releaseNotes: u.release_notes || latestOf.windows.release_notes_url } : {}),
    ...(u.homepage || rec.flathub ? { sameAs: [u.homepage, rec.flathub?.page_url].filter(Boolean) } : {}),
    identifier: [
      ...(rec.ids.winget ? [{ '@type': 'PropertyValue', propertyID: 'winget', value: rec.ids.winget }] : []),
      ...(rec.ids.homebrew_cask ? [{ '@type': 'PropertyValue', propertyID: 'homebrew-cask', value: rec.ids.homebrew_cask }] : []),
      ...(rec.ids.flathub ? [{ '@type': 'PropertyValue', propertyID: 'flathub', value: rec.ids.flathub }] : []),
      ...(rec.ids.custom ? [{ '@type': 'PropertyValue', propertyID: 'everyversion-source', value: rec.ids.custom }] : []),
    ],
    hasPart: partNodes,
  };
  const publisherNode = { '@type': 'Organization', '@id': `${canonical}#publisher`, name: rec.publisher, ...(u.publisher ? { url: u.publisher } : {}) };
  const websiteNode = { '@type': 'WebSite', '@id': `${SITE.url}/#website`, name: SITE.name, url: `${SITE.url}/`, inLanguage: 'en-US' };
  const webpageNode = {
    '@type': 'WebPage',
    '@id': `${canonical}#webpage`,
    url: canonical,
    name: title,
    inLanguage: 'en-US',
    isPartOf: { '@id': `${SITE.url}/#website` },
    breadcrumb: { '@id': `${canonical}#breadcrumb` },
    mainEntity: { '@id': `${canonical}#software` },
    ...(verified ? { reviewedBy: { '@id': AUTHOR_ID } } : {}),
  };
  const verifiedNodes = [webpageNode, ...(verified ? [PERSON] : [])];
  const crumbs = {
    '@type': 'BreadcrumbList',
    '@id': `${canonical}#breadcrumb`,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE.url}/` },
      { '@type': 'ListItem', position: 2, name: rec.name, item: canonical },
    ],
  };

  // ---- facts
  const licType = licenseType(rec);
  const fmtDate = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : null;
  };
  const dateOf = (p) => latestOf[p].release_date || (p === 'windows' ? rec.last_updated : null) || null;
  // "What it is": the publisher's own one-line summary; failing that, the first sentence of its description. Absent otherwise.
  const whatItIs = rec.summary || ((rec.description || '').replace(/\s+/g, ' ').match(/^.+?[.!?](?=\s|$)/) || [])[0] || null;
  // Source code: only for open-source apps, and only when a metadata URL from the manifests already points at a code-host repository.
  const repoOf = (() => {
    if (rec.pricing.status !== 'open-source') return null;
    const cands = [u.bug_tracker, u.release_notes, rec.license.url, u.homepage, u.publisher, u.support, ...(u.documentation || []).map((d) => d.url)].filter(Boolean);
    for (const c of cands) {
      const m = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#]|$)/.exec(c);
      if (m && !['sponsors', 'orgs', 'topics', 'apps'].includes(m[1])) return `github.com/${m[1]}/${m[2]}`;
    }
    return null;
  })();
  const hostOnly = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
  const sameRelease = new Set(plats.map((p) => `${latestOf[p].version}|${dateOf(p)}`)).size === 1;
  const versionCell = sameRelease
    ? `<strong>${esc(latestOf[plats[0]].version)}</strong>${fmtDate(dateOf(plats[0])) ? ` (${esc(fmtDate(dateOf(plats[0])))})` : ''}`
    : plats
    .map((p) => `${plats.length > 1 ? `${esc(PLATFORM[p])} ` : ''}<strong>${esc(latestOf[p].version)}</strong>${fmtDate(dateOf(p)) ? ` (${esc(fmtDate(dateOf(p)))})` : ''}`)
    .join('<br>');
  const links = [
    u.homepage && ['Official website', u.homepage],
    u.support && ['Support', u.support],
    u.bug_tracker && ['Bug tracker', u.bug_tracker],
    ...(u.documentation || []).map((d) => [d.label, d.url]),
    u.privacy && ['Privacy policy', u.privacy],
    u.release_notes && ['Release notes', u.release_notes],
    u.purchase && ['Pricing / purchase', u.purchase],
  ].filter(Boolean);

  const moreLinks = links.filter(([, h]) => h !== u.homepage); // the homepage already has its own "Official website" row

  const glance = [
    whatItIs && ['What it is', esc(whatItIs)],
    ['Latest version', versionCell],
    ['Price', esc(PRICE_LABEL[rec.pricing.status]) + (rec.pricing.source === 'curated' ? ' <span class="host">curated by hand</span>' : '')],
    ['Open source', rec.pricing.status === 'open-source' ? 'Yes' : rec.pricing.status === 'unknown' ? 'Not stated' : 'No'],
    ['License', rec.license.url ? link(rec.license.url, rec.license.name) : esc(rec.license.name)],
    licType && licType.text !== rec.license.name && ['License type', `${esc(licType.text)}${licType.note ? ` <span class="host">${esc(licType.note)}</span>` : ''}`],
    rec.license.copyright && ['Copyright', esc(rec.license.copyright)],
    ['Made by', u.publisher ? link(u.publisher, rec.publisher) : esc(rec.publisher)],
    primaryCat && ['Category', primaryCat.page ? `<a href="${catPath(primaryCat.slug)}">${esc(primaryCat.name)}</a>` : esc(primaryCat.name)],
    ['Runs on', plats.map((p) => `<a href="${PLATFORM_PATH[p]}">${esc(PLATFORM[p])}</a>`).join(', ')],
    u.homepage && ['Official website', link(u.homepage, hostOnly(u.homepage))],
    moreLinks.length && ['More links', moreLinks.map(([l, h]) => link(h, l)).join(' · ')],
    repoOf && ['Source code', link(`https://${repoOf}`, repoOf)],
    rec.tags?.length && ['Tags', rec.tags.map((t) => `<span class="badge">${esc(t)}</span>`).join(' ')],
    rec.ids.winget && ['winget ID', `<code>${esc(rec.ids.winget)}</code>`],
    rec.ids.homebrew_cask && ['Homebrew cask', `<code>${esc(rec.ids.homebrew_cask)}</code>`],
    rec.flathub && ['Flathub', `${link(rec.flathub.page_url, rec.flathub.app_id)}${rec.flathub.verified ? ' <span class="badge free" title="The app’s publisher has been verified by Flathub">Verified</span>' : ` <span class="badge" title="${esc(flathubUnverifiedText(rec.flathub))}">Unverified · community</span>`} <span class="host">data from Flathub</span>`],
    rec.flathub && ['Flathub verification', esc(rec.flathub.verified ? flathubVerifiedText(rec.flathub) : flathubUnverifiedText(rec.flathub))],
    rec.flathub?.license && ['License on Flathub', `${esc(rec.flathub.license)} <span class="host">as listed on Flathub</span>`],
    rec.ids.moniker && ['winget moniker', `<code>${esc(rec.ids.moniker)}</code>`],
    ['Check your download', '<a href="#download">SHA-256 checksums in the download tables</a> · <a href="#security">Security scan</a>'],
  ].filter(Boolean);

  // ---- sections
  // Downloads card: one row per latest installer (architecture, format, scope, SHA-256, button), then a footer with
  // where the files come from, the platform guidance, the install/verify commands and the license link.
  const KIND = { dmg: 'disk image', pkg: 'installer package', flatpak: 'Flatpak app', zip: 'archive', tar: 'archive', portable: 'portable build' };
  // Linux (Flathub): an "Install" dropdown that copies the install command, then the run command, instead of a file download.
  const flatpakMenu = (i, p) => {
    if (!(p === 'linux' && rec.flathub && i.type === 'flatpak') && deadOf(i)) return deadBtn(i, 'btn dl-btn');
    if (!(p === 'linux' && rec.flathub && i.type === 'flatpak')) return `<a class="btn dl-btn" href="${esc(i.url)}" rel="noopener nofollow" data-t="download" data-slot="row" data-pl="${p}" data-ar="${esc(i.architecture)}" data-ty="${esc(i.type)}" data-h="${esc(i.host)}" aria-label="Download ${esc(i.filename)} from ${esc(i.host)}">Download</a>`;
    const opts = [['Copy install command', rec.flathub.install_command, 'copy-install'], ['Copy run command', rec.flathub.run_command, 'copy-run']].filter(([, c]) => c);
    return `<div class="dl-menu">
<button type="button" class="btn dl-btn dl-install" data-t="install" data-slot="install" data-pl="linux" data-ar="${esc(i.architecture)}" data-ty="${esc(i.type)}" data-h="${esc(i.host)}" aria-haspopup="menu" aria-expanded="false" aria-label="Install ${esc(rec.name)} with Flatpak: copy a command">Install</button>
<div class="dl-pop" role="menu" hidden>
${opts.map(([label, cmd, slot]) => `<button type="button" role="menuitem" class="dl-opt" data-t="copy" data-slot="${slot}" data-pl="linux" data-copy="${esc(cmd)}"><span class="lbl">${esc(label)}</span><code>${esc(cmd)}</code></button>`).join('\n')}
</div>
</div>`;
  };
  const installerRows = (installers, p) =>
    sortInstallers(installers)
      .map((i) => {
        const sub = [
          fmtOf(i),
          i.nested_type ? `in ${FORMAT[i.nested_type] || i.nested_type}` : null,
          p === 'windows' ? SCOPE[i.scope] : null,
          p === 'macos' && i.min_os_version ? `macOS ${i.min_os_version}+` : null,
          i.locale || null,
        ].filter(Boolean);
        return `<div class="dl-row">
<div class="dl-main">
<div class="dl-title">${esc(PLATFORM[p])} ${i.variant ? `${esc(i.variant)}${i.architecture === 'neutral' ? '' : ` · ${esc(archLabel(i))}`}` : `${esc(archLabel(i))} ${esc(KIND[i.type] || 'installer')}`}</div>
<div class="dl-sub">${esc(sub.join(' · '))}</div>
${deadOf(i) ? `<div class="dl-dead">The publisher’s link returns HTTP ${deadOf(i).status} (checked ${esc(deadDay(deadOf(i).checked))}), so the download is switched off.</div>` : ''}
${i.sha256 || ownSha(rec.slug, i) ? `<details class="dl-hash"><summary>Show SHA-256${i.sha256 ? '' : ' (computed by us)'}</summary><div><code class="hash">${esc(i.sha256 || ownSha(rec.slug, i))}</code> <button type="button" class="copy" data-copy="${esc(i.sha256 || ownSha(rec.slug, i))}" aria-label="Copy SHA-256 of ${esc(i.filename)}">Copy</button></div></details>` : `<div class="dl-hash"><span class="host">${rec.flathub && p === 'linux' ? 'No file checksum: Flatpak checks the app against Flathub’s signed repository' : 'SHA-256 not provided by the publisher'}</span></div>`}
</div>
${flatpakMenu(i, p)}
</div>`;
      })
      .join('\n');
  const allHosts = [...new Set(plats.flatMap((p) => latestOf[p].installers.map((i) => i.host)))];
  // Homebrew disabled this app's cask: say why in one sentence. The Download button stays enabled (it goes to the publisher), so people can still choose to download it.
  const caskWarn = rec.homebrew_cask_disabled
    ? `<div class="dl-warn" role="note"><strong>Homebrew warning:</strong> ${withCode(caskDisabledSentence(rec.homebrew_cask_disabled.reason))} You can still download it below from the publisher, at your own judgement. <a href="https://formulae.brew.sh/cask/${esc(encodeURIComponent(rec.ids.homebrew_cask))}" rel="noopener">Homebrew’s cask page</a></div>\n`
    : '';
  const downloadHtml = `<div class="dl-card">
${plats
  .map((p) => `<div class="dl-plat">${PLATFORM_ICON[p] || ''}<h3 id="${p}">${esc(PLATFORM[p])} <span class="sub">${esc(latestOf[p].version)}</span></h3></div>
${p === 'macos' && rec.homebrew_cask_disabled ? caskWarn : ''}${installerRows(latestOf[p].installers, p)}`)
  .join('\n')}
<div class="dl-foot">
<p>${plats.flatMap((p) => platformGuidance(p, latestOf[p].installers, customOf(p) ? 'custom' : p === 'macos' ? 'cask' : p === 'linux' && rec.flathub ? 'flathub' : 'winget')).map(esc).join(' ')}</p>
${plats
  .filter((p) => installCmd(rec, p))
  .map(
    (p) => `<p class="pin">Install with ${p === 'windows' ? 'winget' : p === 'linux' ? 'Flatpak (Flathub)' : 'Homebrew'}: <code>${esc(installCmd(rec, p))}</code> <button type="button" class="copy" data-t="copy" data-slot="${p === 'windows' ? 'copy-winget' : p === 'linux' ? 'copy-flatpak' : 'copy-brew'}" data-pl="${p}" data-copy="${esc(installCmd(rec, p))}" aria-label="Copy ${esc(PLATFORM[p])} install command">Copy</button></p>`,
  )
  .join('\n')}
${plats.some((p) => latestOf[p].installers.some((i) => i.sha256)) ? `<p class="pin">Check a download: ${[...new Set(plats.filter((p) => latestOf[p].installers.some((i) => i.sha256)).map((p) => verifyCmd(p)))].map((c) => `<code>${esc(c)}</code>`).join(' or ')} and compare it with the SHA-256 above.</p>` : ''}
${rec.flathub ? `<p class="pin">Linux (Flatpak): Flathub publishes no file checksum; Flatpak checks the app against Flathub’s signed repository when it installs. ${esc(rec.flathub.verified ? 'Flathub shows this app as publisher-verified.' : flathubUnverifiedText(rec.flathub))} ${link(rec.flathub.page_url, 'App page on Flathub')}.</p>` : ''}
${rec.license.url ? `<p class="pin">${link(rec.license.url, 'Read the license')}.</p>` : ''}
</div>
</div>`;

  // System requirements per platform: only what the package data holds (minimum OS, CPU architectures, dependencies, Flathub sizes).
  const REQ_TITLE = { windows: 'PC requirements', macos: 'Mac requirements', linux: 'Linux requirements' };
  const winName = (v) => {
    const [maj, min, build] = String(v).split('.').map(Number);
    const name = maj === 10 ? (build >= 22000 ? 'Windows 11' : 'Windows 10') : { '6.3': 'Windows 8.1', '6.2': 'Windows 8', '6.1': 'Windows 7', '6.0': 'Windows Vista', '5.1': 'Windows XP' }[`${maj}.${min}`] || 'Windows';
    return `${name} (${v}) or later`;
  };
  const fmtBytes = (n) => (n >= 2 ** 30 ? `${(n / 2 ** 30).toFixed(n >= 10 * 2 ** 30 ? 0 : 1)} GiB` : `${Math.max(1, Math.round(n / 2 ** 20))} MiB`);
  const requirementsOf = (p) => {
    const ins = latestOf[p].installers;
    const uniq = (a) => [...new Set(a.filter(Boolean))];
    const rows = [];
    const mins = uniq(ins.map((i) => i.min_os_version));
    if (p === 'windows' && mins.length) rows.push(['Minimum Windows version', mins.map(winName).join('; ')]);
    if (p === 'macos' && mins.length) rows.push(['Minimum macOS version', mins.map((v) => `macOS ${v} or later`).join('; ')]);
    const archs = p === 'linux' && rec.flathub?.arches?.length ? rec.flathub.arches : uniq(ins.map((i) => i.architecture));
    rows.push([p === 'linux' ? 'Architectures' : 'CPU architecture', archs.map((a) => (p === 'macos' ? MAC_ARCH[a] : null) || ARCH[a] || a).join(', ')]);
    const deps = [];
    if (p === 'windows') {
      for (const d of ins.map((i) => i.dependencies).filter(Boolean)) {
        deps.push(...(d.packages || []).map((x) => `\`${x}\` (winget package)`), ...(d.windows_features || []).map((x) => `${x} (Windows feature)`), ...(d.windows_libraries || []).map((x) => `${x} (Windows library)`));
      }
    }
    if (p === 'macos') {
      const d = latestOf[p].cask?.depends_on;
      deps.push(...(d?.casks || []).map((x) => `\`${x}\` (Homebrew cask)`), ...(d?.formulae || []).map((x) => `\`${x}\` (Homebrew package)`));
    }
    if (deps.length) rows.push([p === 'macos' ? 'Dependencies (Homebrew)' : 'Dependencies', uniq(deps).join('; ')]);
    if (p === 'linux' && rec.flathub) {
      if (rec.flathub.download_size) rows.push(['Download size', fmtBytes(rec.flathub.download_size)]);
      if (rec.flathub.installed_size) rows.push(['Installed size', fmtBytes(rec.flathub.installed_size)]);
    }
    return rows;
  };
  const installerHtml = `<div class="plat-cols">
${plats
    .map(
      (p) => `<div class="plat-col">
<h3>${esc(PLATFORM[p])}</h3>
<ul class="clean">
${summaries[p].map((s) => `<li>${withCode(s)}</li>`).join('\n')}
</ul>
${latestOf[p].cask?.caveats ? `<p class="pin">Homebrew note shown after install: ${esc(trunc(latestOf[p].cask.caveats, 300))}</p>` : ''}
<h3>${esc(REQ_TITLE[p])}</h3>
<ul class="clean req">
${requirementsOf(p).map(([k, v]) => `<li><strong>${esc(k)}:</strong> ${withCode(v)}</li>`).join('\n')}
</ul>
</div>`,
    )
    .join('\n')}
</div>`;

  // Publisher changelog: the app-level release-notes URL if upstream gives one, else the GitHub releases page
  // of the repo the installers are published from. Null when neither exists.
  const changelog =
    u.release_notes ||
    (() => {
      for (const v of rec.versions) for (const i of v.installers) {
        const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\//.exec(i.url);
        if (m) return `https://github.com/${m[1]}/${m[2]}/releases`;
      }
      return null;
    })();
  // Shown only when there is something to show; otherwise the block is omitted.
  const notesBlock = (v) => {
    const parts = [];
    if (v.release_notes) parts.push(`<p class="notes">${esc(trunc(v.release_notes, 1500))}</p>`);
    const url = v.release_notes_url || changelog;
    if (url) parts.push(`<p class="pin">${link(url, v.release_notes ? 'Full release notes from the publisher' : v.release_notes_url ? 'Read the release notes on the publisher’s site' : 'Publisher changelog')}</p>`);
    return parts.length ? `<h4>Release notes</h4>\n${parts.join('\n')}` : '';
  };

  // Dated changelog for the newest release: the publisher's own notes text, its date, and a link to the full notes.
  // Taken from the first platform that has notes text or a notes link; omitted when the publisher gives neither.
  const clPlat = plats.find((p) => latestOf[p].release_notes || latestOf[p].release_notes_url) || (changelog ? plats[0] : null);
  const changelogHtml = (() => {
    if (!clPlat) return '';
    const v = latestOf[clPlat];
    const url = v.release_notes_url || changelog;
    const iso = v.release_date || (clPlat === 'windows' ? rec.last_updated : null);
    const shown = fmtDate(iso);
    const sameVersion = new Set(plats.map((p) => latestOf[p].version)).size === 1;
    return `<section id="changelog" aria-labelledby="h-changelog">
<h2 id="h-changelog">What’s new in ${esc(rec.name)} ${esc(v.version)}${shown ? ` <span class="sub"><time datetime="${esc(iso)}">${esc(shown)}</time></span>` : ''}</h2>
${plats.length > 1 && !sameVersion ? `<p class="pin">Notes for the ${esc(PLATFORM[clPlat])} release.</p>` : ''}
${v.release_notes ? `<p class="notes">${esc(trunc(v.release_notes, 1500))}</p>` : `<p>The publisher gives no notes text for this release.</p>`}
${url ? `<p class="pin">${link(url, v.release_notes ? 'Read the full release notes on the publisher’s site' : 'Release notes on the publisher’s site')}</p>` : ''}
<p class="pin">Notes for older versions are inside each version below.</p>
</section>`;
  })();

  const versionBlock = (p, v, idx) => {
    const sub = [v.release_date, v.series ? `series ${v.series}` : null, `${v.installers.length} ${customOf(p) ? 'download' : 'installer'}${v.installers.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    const pin =
      p === 'windows' && pinCmd(rec, v)
        ? `<p class="pin">Pin this version: <code>${esc(pinCmd(rec, v))}</code></p>`
        : '';
    return `<details id="${p}-${esc(safeId(v.version))}"${idx === 0 && plats.length === 1 ? ' open' : ''}>
<summary>${esc(v.version)}${idx === 0 ? ' <span class="badge free">latest</span>' : ''}${v.lts ? ' <span class="badge">LTS</span>' : ''} <span class="sub">· ${esc(sub)}</span> ${v.release_notes || v.release_notes_url ? '<span class="badge">notes</span>' : ''}</summary>
<div class="body">
${installerTable(v.installers, p, v.version, rec.slug)}
${pin}
${notesBlock(v)}
${v.manifest_dir ? `<p class="pin">Manifest: ${link(`${WINGET_REPO}/tree/master/${v.manifest_dir}`, v.manifest_dir)}</p>` : ''}
</div>
</details>`;
  };

  const versionsHtml = plats
    .map((p) => {
      const all = versionsOf(rec, p);
      const total = rec.versions_total[p];
      const e = provOf(rec, p);
      // Apps with series_label (Ableton Live): every version, grouped by series, the newest series open.
      const groups = rec.series_label ? [...new Set(all.map((v) => v.series).filter(Boolean))] : [];
      if (groups.length > 1) {
        return `<h3 id="${p}-versions">${esc(PLATFORM[p])} versions</h3>
<p>${all.length} versions listed, grouped by ${esc(rec.series_label)} version. Open a version for its downloads and checksums.</p>
${groups
  .map((g, gi) => {
    const vs = all.filter((v) => v.series === g);
    return `<details class="vgroup"${gi === 0 ? ' open' : ''}>
<summary>${esc(rec.series_label)} ${esc(g)} <span class="sub">${vs.length === 1 ? esc(vs[0].version) : `${vs.length} versions · ${esc(vs[0].version)} to ${esc(vs.at(-1).version)}`}</span></summary>
${vs.map((v) => versionBlock(p, v, all.indexOf(v))).join('\n')}
</details>`;
  })
  .join('\n')}`;
      }
      const shown = all.slice(0, PAGE_VERSIONS);
      const note =
        p === 'linux' && rec.flathub
          ? `Flathub lists only the current release, and Flatpak installs the newest build; earlier versions cannot be chosen from the listing.`
          : p === 'macos' && !customOf(p)
          ? `Homebrew casks list only the current release. Earlier builds appear in the cask’s history on GitHub, and Homebrew cannot install them directly.`
          : `${total > shown.length ? `Showing the newest ${shown.length} of ${total} versions${all.length > shown.length ? ` (the <a href="/${rec.slug}/${rec.slug}.json">JSON</a> and <a href="/${rec.slug}/${rec.slug}.md">Markdown</a> versions list ${all.length})` : ''}. ` : `${total} version${total === 1 ? '' : 's'} listed. `}Open a version for its ${customOf(p) ? 'downloads and checksums' : 'installers, checksums and a command that pins it'}.`;
      return `<h3 id="${p}-versions">${esc(PLATFORM[p])} versions</h3>
<p>${note}</p>
${shown.map((v, i) => versionBlock(p, v, i)).join('\n')}
${total > shown.length && (p === 'windows' || customOf(p)) ? `<p class="pin">${customOf(p) ? 'The publisher’s full release list' : 'All older versions'}: ${link(sourceHistory(e), e.path)}</p>` : ''}`;
    })
    .join('\n');

  const hashState = (p) => {
    const ins = latestOf[p].installers;
    const n = ins.filter((i) => i.sha256).length;
    return n === ins.length ? 'Yes' : n === 0 ? 'No: the source declares no checksum' : `Partly (${n} of ${ins.length} downloads)`;
  };
  // A check shows my name only once it has actually been done.
  const sum = rec.verification.summary;
  const hashRow = sum && rec.verification.checks.hash_recomputed
    ? `${sum.hash.match} of ${sum.hash.total} installers match${sum.hash.mismatch ? `, <strong>${sum.hash.mismatch} do not</strong>` : ''}${sum.hash.no_upstream ? `, ${sum.hash.no_upstream} had no upstream hash` : ''}.`
    : 'Not yet';
  const sigRow = sum && rec.verification.checks.signature_checked
    ? `${sum.signature.valid} valid${sum.signature.unsigned ? `, ${sum.signature.unsigned} unsigned` : ''}${sum.signature.invalid ? `, <strong>${sum.signature.invalid} could not be validated</strong> (signature present, but its certificate chain does not reach a root we trust)` : ''}${sum.signature.not_applicable ? `, ${sum.signature.not_applicable} not signable (ZIP/portable)` : ''}.`
    : 'Not yet';
  const verifyRows = plats
    .map((p) => {
      const e = provOf(rec, p);
      if (isCustom(e)) {
        return `<tr><th scope="row">${esc(PLATFORM[p])}: source</th><td>${link(e.repo, e.path)}${e.api_url ? ` and ${link(e.api_url, new URL(e.api_url).pathname.split('/').pop())}` : ''} (the publisher’s release feeds)</td></tr>
<tr><th scope="row">${esc(PLATFORM[p])}: SHA-256 from the publisher</th><td>${esc(hashState(p))}${latestOf[p].installers.some((i) => i.sha256 && !i.checksum_source) ? ' (the .sha256sum file next to each download)' : latestOf[p].installers.some((i) => i.checksum_source) ? ' (hashes pinned by a Homebrew cask, not posted by the publisher)' : ''}</td></tr>
<tr><th scope="row">${esc(PLATFORM[p])}: feed content</th><td><code>${esc(e.content_sha256.slice(0, 12))}</code> · retrieved ${esc(e.retrieved_at.slice(0, 10))}</td></tr>`;
      }
      if (isFlathub(e)) {
        return `<tr><th scope="row">${esc(PLATFORM[p])}: source</th><td>${link(rec.flathub.page_url, 'Flathub')} · ${link(e.api_url, 'Flathub API')} · ${link(e.repo, 'github.com/flathub/' + rec.flathub.app_id)}</td></tr>
<tr><th scope="row">${esc(PLATFORM[p])}: checksum</th><td>None published. Flatpak checks the app against Flathub’s signed repository when it installs.</td></tr>
<tr><th scope="row">${esc(PLATFORM[p])}: publisher verified</th><td>${rec.flathub.verified ? esc(flathubVerifiedText(rec.flathub)) : esc(flathubUnverifiedText(rec.flathub))}</td></tr>
<tr><th scope="row">${esc(PLATFORM[p])}: data retrieved</th><td>${esc(e.retrieved_at.slice(0, 10))} · attribution: app data from Flathub${rec.flathub.license ? `, license listed there: ${esc(rec.flathub.license)}` : ''}</td></tr>`;
      }
      return `<tr><th scope="row">${esc(PLATFORM[p])}: source</th><td>${link(e.repo, e.source === 'winget-pkgs' ? 'microsoft/winget-pkgs' : 'Homebrew/homebrew-cask')}</td></tr>
<tr><th scope="row">${esc(PLATFORM[p])}: SHA-256 in upstream manifest</th><td>${esc(hashState(p))}</td></tr>
<tr><th scope="row">${esc(PLATFORM[p])}: observed at commit</th><td>${link(sourceTree(e), e.commit.slice(0, 12))} · retrieved ${esc(e.retrieved_at.slice(0, 10))}</td></tr>`;
    })
    .join('\n');

  const checked = provOf(rec, plats[0]).retrieved_at.slice(0, 10);
  // One date: when we last checked this app (our verification date, else when we last read its listing).
  const updatedOn = verified ? rec.verification.checked_at : checked;
  const updatedLine = `<p class="updated">Last updated: <time datetime="${esc(updatedOn)}">${esc(updatedOn)}</time>${verified ? ` · Verification by ${byAuthor}` : ''}</p>`;

  // ---- security section: VirusTotal score + our own file checks
  const secFiles = [];
  const seenUrls = new Set();
  for (const p of plats) {
    for (const i of sortInstallers(latestOf[p].installers)) {
      if (seenUrls.has(i.url)) continue;
      seenUrls.add(i.url);
      const vf = VERIF_FILES.get(rec.slug)?.get(i.url);
      const sha = (vf?.computed_sha256 || i.sha256 || '').toLowerCase();
      const vt = sha ? VT[sha] : null;
      let score = null;
      let flagged = 0;
      let engines = 0;
      if (vt?.found) {
        const st = vt.stats || {};
        engines = (st.malicious || 0) + (st.suspicious || 0) + (st.harmless || 0) + (st.undetected || 0);
        flagged = (st.malicious || 0) + (st.suspicious || 0);
        if (engines > 0) score = Math.round((100 * (engines - flagged)) / engines);
      }
      secFiles.push({ p, i, vf, sha, vt, score, flagged, engines });
    }
  }
  const scanned = secFiles.filter((f) => f.score !== null);
  const worst = scanned.length ? scanned.reduce((a, b) => (b.score < a.score ? b : a)) : null;
  const flaggedAll = scanned.reduce((n, f) => n + f.flagged, 0);
  const maxFlagged = scanned.reduce((n, f) => Math.max(n, f.flagged), 0);
  const partial = scanned.length < secFiles.length;
  // Three colours only. Green: at most 1 engine flagged any scanned file (a lone flag among 50+ engines is usually a
  // false alarm, and it is still listed under Detections). Orange: 2-3 engines flagged one file. Red: 4 or more.
  // No score, no ring.
  const ringClass = !worst ? 'none' : maxFlagged <= 1 ? 'ok' : maxFlagged <= 3 ? 'warn' : 'bad';
  const resultLabel = !worst ? 'Not scanned yet' : maxFlagged === 0 ? (partial ? 'No detections so far' : 'Clean') : maxFlagged === 1 ? 'Mostly clean' : maxFlagged <= 3 ? 'Some detections' : 'Many detections';
  const scanDates = scanned.map((f) => f.vt.scanned_at).filter(Boolean).sort();
  const hashCell = (f) =>
    f.vf?.hash === 'match' ? 'Matches the manifest (re-computed)'
    : f.vf?.hash === 'MISMATCH' ? '<strong>Does not match the manifest</strong>'
    : f.vf?.hash === 'no-upstream-hash' ? 'Computed by us; the source lists no hash'
    : 'Copied from the manifest, not re-computed';
  const SIG = { valid: 'Valid', unsigned: 'Not signed', invalid: 'Could not be validated', 'not-applicable': 'Not applicable', 'not-checked': 'Not checked' };
  const sigCell = (f) => (f.vf ? SIG[f.vf.signature.status] || 'Not checked' : 'Not checked');
  const vtCell = (f) =>
    !f.sha ? '—'
    : f.score !== null ? `${link(vtUrl(f.sha), `${f.flagged}/${f.engines} flagged`)}`
    : f.vt && f.vt.found === false ? `${link(vtUrl(f.sha), 'Open')} <span class="host">not on VirusTotal</span>`
    : `${link(vtUrl(f.sha), 'Look up')} <span class="host">not looked up yet</span>`;
  const fileRows = secFiles
    .map(
      (f) => `<tr>
<td><span class="fn">${esc(f.i.filename)}</span><span class="host">${esc(PLATFORM[f.p])} · ${esc(archLabel(f.i))}</span></td>
<td>${f.sha ? `<code class="hash">${esc(f.sha)}</code>` : '<span class="host">Not provided</span>'}</td>
<td>${hashCell(f)}</td>
<td>${sigCell(f)}</td>
<td>${vtCell(f)}</td>
</tr>`,
    )
    .join('\n');
  // ---- Flathub-style fact row: platforms, license/price, safety. Every value comes from data we hold.
  const ICON = {
    platforms: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    license: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7zM19 7l-3 7a3 3 0 0 0 6 0l-3-7z"/></svg>',
    history: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>',
    safe: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>',
    medium: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M12 8v5M12 16.5v.5"/></svg>',
    high: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/></svg>',
    none: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9.7 9.8a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1.1.9-1.1 1.7M12 16.5v.5"/></svg>',
  };
  const flaggedWorst = scanned.length ? scanned.reduce((a, b) => (b.flagged > a.flagged ? b : a)) : null;
  // A file whose re-computed SHA-256 does not match the published checksum is never rated better than Medium risk, whatever VirusTotal says.
  const hashMis = rec.verification.summary?.hash || { mismatch: 0, total: 0 };
  const safetyScan = !worst
    ? { cls: 'none', icon: ICON.none, label: 'Not scanned', cap: 'No VirusTotal result yet' }
    : ringClass === 'ok'
      ? { cls: 'ok', icon: ICON.safe, label: partial ? 'Safe so far' : 'Safe', cap: partial ? `${scanned.length} of ${secFiles.length} files scanned${maxFlagged === 1 ? ', 1 engine flagged' : ''}` : maxFlagged === 1 ? `1 of ${flaggedWorst.engines} engines flagged` : 'VirusTotal scan' }
      : ringClass === 'warn'
        ? { cls: 'warn', icon: ICON.medium, label: 'Medium risk', cap: `${flaggedWorst.flagged} of ${flaggedWorst.engines} engines flagged` }
        : { cls: 'bad', icon: ICON.high, label: 'High risk', cap: `${flaggedWorst.flagged} of ${flaggedWorst.engines} engines flagged` };
  const safety = hashMis.mismatch && safetyScan.cls !== 'bad'
    ? { cls: 'warn', icon: ICON.medium, label: 'Medium risk', cap: `${hashMis.mismatch} of ${hashMis.total} downloads do not match the published checksum` }
    : safetyScan;
  const safeBadge = `<a class="safe-badge" href="#security" title="${esc(safety.cap)}" aria-label="Safety: ${esc(safety.label)}. ${esc(safety.cap)}. Jump to the security details"><span class="pill ${safety.cls}">${safety.icon}${esc(safety.label)}</span></a>`;

  // Flagged files: list each engine and its label exactly as VirusTotal reports it. We add no interpretation.
  const flaggedFiles = secFiles.filter((f) => f.flagged > 0 && f.vt?.detections?.length);
  const detectionsHtml = flaggedFiles.length
    ? `<details class="det"><summary>Detections (${flaggedFiles.reduce((n, f) => n + f.vt.detections.length, 0)} from ${flaggedFiles.length} file${flaggedFiles.length === 1 ? '' : 's'})</summary>
<div class="body">
${flaggedFiles
  .map(
    (f) => `<h4>${esc(f.i.filename)}: flagged by ${f.flagged} of ${f.engines} engines</h4>
<div class="scroll"><table><thead><tr><th scope="col">Engine</th><th scope="col">Type</th><th scope="col">Label</th></tr></thead><tbody>
${f.vt.detections.map((d) => `<tr><td>${esc(d.engine)}</td><td>${esc(d.category)}</td><td>${esc(d.result || '')}</td></tr>`).join('\n')}
</tbody></table></div>
<p class="pin">${link(vtUrl(f.sha), 'Full VirusTotal report')}${f.vt.scanned_at ? ` · scanned ${esc(f.vt.scanned_at)}` : ''}</p>`,
  )
  .join('\n')}
<p class="pin">These are the security vendors’ own labels, shown exactly as VirusTotal reports them. We do not edit or interpret them. A detection does not by itself mean a file is malicious. Read the full report and see our <a href="/security/">Security and Trust Center</a>.</p>
</div></details>`
    : '';
  const firstReport = (scanned[0] || secFiles.find((f) => f.sha))?.sha;
  const securityHtml = `<section id="security" aria-labelledby="h-security">
<h2 id="h-security">Is ${esc(rec.name)} safe?</h2>
<div class="sec-score">
${worst ? `<div class="ring ${ringClass}" style="--p:${worst.score}" role="img" aria-label="Score ${worst.score} out of 100"><span><strong>${worst.score}</strong><small>/100</small></span></div>` : ''}
<div>
<p class="sec-result">Score result: <strong class="r-${ringClass}">${resultLabel}</strong></p>
${hashMis.mismatch ? `<p class="sec-warn"><strong>Checksum mismatch:</strong> ${hashMis.mismatch} of ${hashMis.total} downloads we fetched do not match the checksum in the package catalog. The score above covers only VirusTotal’s scan, so we rate ${esc(rec.name)} no better than Medium risk until this is explained.</p>` : ''}
${worst
    ? `<p>${maxFlagged === 0
        ? `None of the ${worst.engines} security engines on VirusTotal flagged ${scanned.length === 1 ? 'the scanned file' : `any of the ${scanned.length} scanned files`}.`
        : `${scanned.filter((f) => f.flagged).slice(0, 3).map((f) => `<strong>${esc(f.i.filename)}</strong> was flagged by ${f.flagged} of ${f.engines} engines`).join('; ')}${scanned.filter((f) => f.flagged).length > 3 ? ' (and more)' : ''}. ${maxFlagged === 1 ? 'One engine alone does not change the rating, and its label is listed under Detections.' : 'Open the full report before you run it.'}`}</p>
${partial ? `<p><strong>Covers ${scanned.length} of ${secFiles.length} files.</strong> The rest have no VirusTotal report yet, so this result does not speak for them.</p>` : ''}
<ul class="checks"><li>${flaggedAll} flagged in total</li><li>${scanned.length} of ${secFiles.length} files scanned</li><li>${worst.engines} engines</li></ul>`
    : `<p>We have no VirusTotal result for this software yet, so we show no score. The links below open VirusTotal's own page for each file.</p>`}
</div>
</div>
<div class="partner"><strong>${worst ? 'Scanned with VirusTotal' : 'Scores come from VirusTotal'}</strong><span>Score = share of engines that did not flag the lowest-scoring file. 100 means none flagged. <a href="/security/">How we score</a></span></div>

<h3>Scan info</h3>
<div class="card"><dl class="facts">
<dt>Last scan</dt><dd>${scanDates.length ? `<time datetime="${esc(scanDates.at(-1))}">${esc(scanDates.at(-1))}</time>` : 'Not scanned yet'}</dd>
<dt>Scan provider</dt><dd>VirusTotal${firstReport ? ` · ${link(vtUrl(firstReport), 'Full report')}` : ''}</dd>
</dl></div>

<h3>File integrity</h3>
<div class="scroll"><table>
<thead><tr><th scope="col">File</th><th scope="col">SHA-256</th><th scope="col">Hash check</th><th scope="col">Signature</th><th scope="col">VirusTotal</th></tr></thead>
<tbody>
${fileRows}
</tbody></table></div>
<div class="scroll" style="margin-top:12px"><table>
<tbody>
<tr><th scope="row">Hash re-computed by Everyversion</th><td>${hashRow}</td></tr>
<tr><th scope="row">Code signature checked</th><td>${sigRow}</td></tr>
</tbody></table></div>

${detectionsHtml}
<div class="commit"><strong>Everyversion security commitment</strong>
<p>We host no installers. Every download link goes to the download location named in the package listing, normally the publisher’s own server. ${rec.verification.level >= 1 ? 'For this software we downloaded the files from that source ourselves, re-computed each checksum and checked the code signature where our tools could, as shown above.' : 'For this software the checksums are copied from the package manifest and we have not re-computed them yet.'} A passing check shows a file is the one that was published; it is not a guarantee it is free of problems. For more information, visit our <a href="/security/">Security and Trust Center</a>.</p></div>

<details class="prov"><summary>Source and provenance</summary>
<div class="body"><div class="scroll"><table><tbody>
${verifyRows}
</tbody></table></div></div></details>
</section>`;

  const nm = esc(rec.name);
  // ---- FAQ: every answer is built from data we hold (our checks, VirusTotal, the package catalogs, the publisher's own links).
  const site = u.homepage ? `${nm}’s official website` : null; // plain text: the FAQ carries no links
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const sumV = rec.verification.summary;
  const safeA = [];
  safeA.push(rec.verification.level >= 1 ? `We host no installers. Every download button goes to the download location named in the package listing, and the checks below were run on those files.` : `We host no installers. Every download button goes to the download location named in the package listing.`);
  if (rec.verification.level >= 1 && sumV) {
    const h = sumV.hash;
    const g = sumV.signature;
    safeA.push(
      `On ${esc(rec.verification.checked_at)} we downloaded the latest ${h.total === 1 ? 'installer' : plural(h.total, 'installer')} from those sources and re-computed the SHA-256${h.total === 1 ? '' : ' of each'}: ${h.total === 1 ? (h.match ? 'it matches' : h.mismatch ? 'it does not match' : 'there was no catalog hash to compare') : `${h.match} of ${h.total} match`} the package catalog’s value${h.total === 1 ? '' : `${h.mismatch ? `, ${h.mismatch} do not` : ''}${h.no_upstream ? `, ${h.no_upstream} had no catalog hash to compare` : ''}`}. Code signatures: ${g.valid} valid${g.unsigned ? `, ${g.unsigned} not signed` : ''}${g.invalid ? `, ${g.invalid} could not be validated` : ''}${g.not_applicable ? `, ${g.not_applicable} not applicable (archives and similar)` : ''}.`,
    );
  } else {
    safeA.push(`The checksums on this page are ${allCustom ? 'taken from the SHA-256 files the publisher posts next to each download' : 'copied from the package catalog'}. We have not re-computed them or checked signatures for ${nm} yet.`);
  }
  if (!worst) {
    safeA.push(`VirusTotal has no report for these files yet, so we show no safety rating.`);
  } else {
    const flaggedF = scanned.filter((f) => f.flagged > 0);
    safeA.push(
      maxFlagged === 0
        ? `VirusTotal: none of its ${worst.engines} security engines flagged ${scanned.length === 1 ? 'the scanned file' : `any of the ${scanned.length} scanned files`}.`
        : maxFlagged === 1
          ? `VirusTotal: one engine out of ${flaggedWorst.engines} flagged ${esc(flaggedWorst.i.filename)}. A single flag among that many engines is usually a false alarm. We still list it under Detections.`
          : `VirusTotal: ${flaggedWorst.flagged} of ${flaggedWorst.engines} engines flagged ${esc(flaggedWorst.i.filename)}${flaggedF.length > 1 ? ` (and ${flaggedF.length - 1} other file${flaggedF.length === 2 ? '' : 's'})` : ''}. Read the full report before you run it.`,
    );
    if (partial) safeA.push(`Reports exist for ${scanned.length} of ${secFiles.length} files, so the rating does not cover the rest.`);
    if (rec.verification.level < 1) safeA.push(`These VirusTotal results are for the file hashes listed in the ${allCustom ? 'publisher’s checksum files' : 'package catalog'}. We have not downloaded the files ourselves.`);
  }
  if (hashMis.mismatch) safeA.push(`Because ${hashMis.mismatch === 1 ? 'one download does' : `${hashMis.mismatch} downloads do`} not match the published checksum, we rate ${esc(rec.name)} no better than Medium risk until the difference is explained. The publisher may have replaced the file after the catalog entry was written.`);
  safeA.push(`Our rating: <strong>${esc(safety.label)}</strong>. No check is a guarantee. See the security details above and our Security and Trust Center.${site ? ` Publisher’s website: ${site}.` : ''}`);

  const mac = latestOf.macos;
  const autoUpd = mac?.cask?.auto_updates === true;
  const docsLink = u.documentation?.length || u.support ? `${nm}’s documentation` : null;
  const where = docsLink ? ` (see ${docsLink})` : site ? ` (see ${site})` : '';
  const multi = plats.length > 1;
  const updateA = multi
    ? `For Windows, we have no information on whether ${nm} updates itself, and for Mac, ${autoUpd ? 'the app is listed as updating itself, so an older build will likely offer, or simply install, the newest release when you open it' : 'we have no confirmation that the app updates itself, although many apps check for updates and offer to install them'}. ${autoUpd ? `To keep an old version, look for an automatic-update setting in ${nm}${where} and turn it off before you rely on it.` : `Look for an update setting in ${nm}${where} before you rely on an older version.`}`
    : `We cannot say for certain. We do not have data on whether ${nm} updates itself, and many apps check for updates and offer to install them. Look for an update setting in ${nm}${where} before you rely on an older version.`;

  const priceA = {
    'open-source': `No. ${nm} is free and open source (license: ${esc(rec.license.name)}).`,
    freeware: `No. ${nm} is freeware (license: ${esc(rec.license.name)}).`,
    'free-to-download': `It is free to download and use, but ${nm} may also offer paid plans or extra features (license: ${esc(rec.license.name)}).`,
    paid: `${nm} is paid software (license: ${esc(rec.license.name)}). The publisher offers a free trial.`,
    unknown: `We could not tell from the package catalog whether ${nm} costs anything.`,
  }[rec.pricing.status] + (['free-to-download', 'paid', 'unknown'].includes(rec.pricing.status) ? (u.purchase ? ' For current pricing, see the publisher’s pricing page.' : site ? ` For current pricing, see ${site}.` : '') : '');

  const verClause = (p) => {
    const all = versionsOf(rec, p);
    const oldest = all.at(-1);
    const total = rec.versions_total[p];
    if (p === 'macos' && !customOf(p)) return `only the current release (${esc(all[0].version)}) is listed, because older Mac builds are not kept in the package listing`;
    return `we list ${plural(all.length, 'version')}, from ${esc(oldest.version)}${oldest.release_date ? ` (${esc(oldest.release_date)})` : ''} up to ${esc(all[0].version)}${total > all.length ? ` (the catalog has ${total}, and we keep the newest ${all.length})` : ''}`;
  };
  const winAll = plats.includes('windows') ? versionsOf(rec, 'windows') : [];
  const versionsA = (plats.length > 1
    ? `For ${PLATFORM[plats[0]]}, ${verClause(plats[0])}, and for ${plats.slice(1).map((p) => `${PLATFORM[p]}, ${verClause(p)}`).join(', and for ')}.`
    : `${verClause(plats[0]).replace(/^we list/, 'We list').replace(/^only/, 'Only')}.`) +
    (!winAll.length ? '' : winAll.length <= PAGE_VERSIONS ? ` This page shows ${plats.length > 1 ? 'all of the Windows versions' : 'all of them'}.` : ` This page shows the newest ${PAGE_VERSIONS}${plats.length > 1 ? ' Windows versions' : ''}; the JSON and Markdown files for this app list all ${winAll.length}${plats.length > 1 ? ' Windows versions' : ''}.`);

  const hostsOf = (p) => [...new Set(latestOf[p].installers.map((i) => i.host))].join(', ');
  const linksA = `They go straight to the source named in the ${allCustom ? 'publisher’s release feed' : 'package catalog'}, with nothing added by us: ${plats.length > 1 ? plats.map((p, k) => `${k === 0 ? 'for' : 'and for'} ${PLATFORM[p]}, to ${esc(hostsOf(p))}`).join(', ') : `to ${esc(hostsOf(plats[0]))}`}. We host no files. Compare the SHA-256 shown next to each file with the one you compute after downloading.${site ? ` Publisher’s website: ${site}.` : ''}`;

  const faqItems = [
    { q: `Is ${rec.name} safe to download from here?`, a: safeA.map((x) => `<p>${x}</p>`).join('\n') },
    { q: `Does ${rec.name} update itself after I install an old version?`, a: `<p>${updateA}</p>` },
    { q: `Does ${rec.name} cost anything?`, a: `<p>${priceA}</p>` },
    { q: `Which versions of ${rec.name} are listed here, and how far back?`, a: `<p>${versionsA}</p>` },
    { q: 'Where do the download links go?', a: `<p>${linksA}</p>` },
  ];
  const unesc = (h) => h.replace(/<br>/g, ' ').replace(/<\/p>\s*<p>/g, ' ').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const faqHtml = `<section id="faq" aria-labelledby="h-faq">
<h2 id="h-faq">${esc(rec.name)} FAQ</h2>
${faqItems.map((f) => `<h3>${esc(f.q)}</h3>\n${f.a}`).join('\n')}
</section>`;
  const faqNode = { '@type': 'FAQPage', '@id': `${canonical}#faq`, mainEntity: faqItems.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: unesc(f.a) } })) };

  const icon = ICONS[rec.slug];
  const iconHtml = icon ? `<img class="app-icon${icon.source === 'macos-app-bundle' ? ' app-icon-native' : ''}" src="${iconSrc(rec.slug, icon.ext)}" width="96" height="96" alt="" decoding="async">` : '';

  // Alternatives: the app's peers (same sub-group) when it has any, otherwise same-category apps that share tags. Only strong matches are linked.
  const altRecs = (() => {
    if (!CATS || !primaryCat) return [];
    const all = CATS.alternatives?.[rec.slug] || [];
    const picked = all.some((a) => a.peer) ? all.filter((a) => a.peer) : all.filter((a) => a.shared_tags >= 1);
    return picked.slice(0, ALT_LIMIT).map((a) => RECS_BY_SLUG.get(a.slug)).filter(Boolean);
  })();
  const alternativesHtml = altRecs.length
    ? `<section id="alternatives" aria-labelledby="h-alt">
<h2 id="h-alt">Alternatives to ${esc(rec.name)}</h2>
<p>Similar apps in ${primaryCat.page ? `<a href="${catPath(primaryCat.slug)}">${esc(primaryCat.name)}</a>` : esc(primaryCat.name)} on Everyversion. Each one links to the download location named in the publisher’s package data, with a SHA-256 checksum.</p>
<ul class="grid">
${altRecs.map((r) => appCard(r)).join('\n')}
</ul>
${primaryCat.page ? `<p class="pin"><a href="${catPath(primaryCat.slug)}">See all ${primaryCat.count} ${esc(primaryCat.name)}</a></p>` : ''}
</section>`
    : '';

  // Release series (custom sources that publish several series in parallel): one row per series still downloadable.
  const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');
  const seriesHtml = rec.release_series?.length
    ? `<section id="series" aria-labelledby="h-series">
<h2 id="h-series">${esc(rec.name)} release series and support</h2>
<p>${esc(rec.name)} is published in several release series at once. The publisher labels each series “regular” or “innovation”; a regular series adds a long-term-support (LTS) line from the patch release shown. Dates come from the publisher’s series feed.</p>
<div class="scroll"><table>
<thead><tr><th scope="col">Series</th><th scope="col">Type</th><th scope="col">Released</th><th scope="col">Newest</th><th scope="col">LTS from</th><th scope="col">Maintenance until</th><th scope="col">Assistance until</th><th scope="col">Downloads removed</th></tr></thead>
<tbody>
${rec.release_series
  .map((r) => {
    const notes = rec.versions.find((v) => v.series === r.series)?.release_notes_url;
    const d = (x) => esc(fmtDate(x) || '—');
    return `<tr><td>${notes ? link(notes, r.series) : esc(r.series)}</td><td>${esc(cap(r.kind))}</td><td>${d(r.release_date)}</td><td>${esc(r.latest_version)}</td><td>${r.lts ? `${esc(String(r.lts.initial_patch || '').replace(/^v/, '') || '—')}${r.lts.release_date ? ` (${esc(fmtDate(r.lts.release_date))})` : ''}` : '—'}</td><td>${d(r.maintenance_ends)}</td><td>${d(r.assistance_ends)}</td><td>${d(r.binary_removal_date)}</td></tr>`;
  })
  .join('\n')}
</tbody></table></div>
</section>`
    : '';

  // Sections are separated by <hr>. Empty sections (no description, no changelog) are skipped so no double rules appear.
  const sectionsHtml = [
    `<section id="download" aria-labelledby="h-download">
<div class="dl-head"><h2 id="h-download">Downloads</h2><nav aria-label="Jump to">${changelogHtml ? '<a href="#changelog">Change log</a>' : ''}${hasOld ? '<a href="#versions">Older versions</a>' : ''}${alternativesHtml ? '<a href="#alternatives">Alternatives</a>' : ''}</nav></div>
${downloadHtml}
</section>`,
    `<section id="installer" aria-labelledby="h-installer">
<h2 id="h-installer">${allCustom ? 'What the download is' : 'What the installer does'}</h2>
${installerHtml}
</section>`,
    rec.description || rec.summary ? `<section id="overview" aria-labelledby="h-overview">
<h2 id="h-overview">Description</h2>
${paragraphs(rec.description || rec.summary)}${FEATURES.get(rec.slug) ? `\n${featuresHtml(FEATURES.get(rec.slug), { esc, code: withCode })}` : ''}
</section>` : '',
    `<section id="details" aria-labelledby="h-details">
<h2 id="h-details">${esc(rec.name)} at a glance</h2>
<div class="scroll"><table class="glance"><tbody>
${glance.map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${v}</td></tr>`).join('\n')}
</tbody></table></div>
</section>`,
    changelogHtml,
    securityHtml,
    seriesHtml,
    `<section id="versions" aria-labelledby="h-versions">
<h2 id="h-versions">${hasOld ? 'Old versions' : `All ${esc(rec.name)} versions`}</h2>
${versionsHtml}
</section>`,
    alternativesHtml,
    faqHtml,
  ]
    .filter(Boolean)
    .join('\n<hr>\n');

  const body = `
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › ${esc(rec.name)}</nav>
<article data-slug="${esc(rec.slug)}" data-ver="${esc(latestOf[plats[0]].version)}">
<div class="app-head">
${iconHtml}
<div class="app-head-text">
<div class="title-row"><h1>${esc(h1)} <span class="h1-ver"${new Set(plats.map((p) => latestOf[p].version)).size > 1 ? ` title="${esc(latestText)}"` : ''}>${esc(latestOf[plats[0]].version)}</span></h1>${safeBadge}</div>
<p class="dev">Developer: ${u.publisher || u.homepage ? link(u.publisher || u.homepage, rec.publisher) : esc(rec.publisher)}</p>
${updatedLine}
</div>
</div>
${rec.summary ? `<p class="lead app-lead">${esc(rec.summary)}</p>` : ''}

${shotsHtml(rec)}
${sectionsHtml}
</article>
${shotsOf(rec).length ? `<script src="/gallery.js?v=${assetHash('gallery.js')}" defer></script>\n` : ''}<script>
document.addEventListener('click',(e)=>{const b=e.target.closest('.copy');if(!b)return;const t=b.dataset.copy,done=()=>{b.textContent='Copied';setTimeout(()=>b.textContent='Copy',1500)},fb=()=>{const a=document.createElement('textarea');a.value=t;a.style.position='fixed';a.style.opacity='0';document.body.appendChild(a);a.select();try{if(document.execCommand('copy'))done()}catch(_){}a.remove()};
if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(t).then(done,fb);else fb()});
document.addEventListener('click',(e)=>{const shut=(m)=>{const p=m.querySelector('.dl-pop');p.hidden=true;m.querySelector('.dl-install').setAttribute('aria-expanded','false')};
const o=e.target.closest('.dl-opt');if(o){const t=o.dataset.copy,l=o.querySelector('.lbl'),old=l.textContent,done=()=>{l.textContent='Copied';setTimeout(()=>{l.textContent=old;shut(o.closest('.dl-menu'))},1200)},fb=()=>{const a=document.createElement('textarea');a.value=t;a.style.position='fixed';a.style.opacity='0';document.body.appendChild(a);a.select();try{if(document.execCommand('copy'))done()}catch(_){}a.remove()};
if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(t).then(done,fb);else fb();return}
const b=e.target.closest('.dl-install');document.querySelectorAll('.dl-menu').forEach((m)=>{if(!b||m!==b.closest('.dl-menu'))shut(m)});
if(b){const p=b.closest('.dl-menu').querySelector('.dl-pop'),show=p.hidden;p.hidden=!show;b.setAttribute('aria-expanded',String(show))}});
document.addEventListener('keydown',(e)=>{if(e.key==='Escape')document.querySelectorAll('.dl-menu').forEach((m)=>{m.querySelector('.dl-pop').hidden=true;m.querySelector('.dl-install').setAttribute('aria-expanded','false')})});
</script>`;

  const html = layout({
    title,
    description: desc,
    path,
    body,
    ld: [{ '@context': 'https://schema.org', '@graph': [websiteNode, publisherNode, software, crumbs, ...verifiedNodes, faqNode] }],
    alternates: `<link rel="alternate" type="application/json" href="/${rec.slug}/${rec.slug}.json">\n<link rel="alternate" type="text/markdown" href="/${rec.slug}/${rec.slug}.md">\n`,
    image: ogImage(rec),
    notice: '<span aria-hidden="true">✓</span> Official download links only. We host no files.',
  });

  const unavailable = rec.versions.flatMap((v) => v.installers.filter((i) => deadOf(i)).map((i) => ({ platform: v.platform, version: v.version, filename: i.filename, url: i.url, http_status: deadOf(i).status, checked: deadOf(i).checked })));
  const shots = shotsOf(rec).map((it) => ({ url: `${SITE.url}/${rec.slug}/${it.file}`, width: it.width, height: it.height, ...(it.caption ? { caption: it.caption } : {}), platform: 'linux', source: 'Flathub', source_url: it.source }));
  const twin = { ...rec, derived: { canonical_url: canonical, title, h1, installer_summary: summaries, ...(shots.length ? { screenshots: shots } : {}), ...(unavailable.length ? { unavailable_downloads: unavailable } : {}) } };

  const md = [
    `# ${h1}`,
    '',
    rec.summary ? `> ${rec.summary}` : '',
    '',
    `- Canonical page: ${canonical}`,
    `- Publisher: ${rec.publisher}`,
    `- Latest: ${latestText}${rec.last_updated ? ` (Windows build released ${rec.last_updated})` : ''}`,
    `- Platforms: ${plats.map((p) => OS_NAME[p]).join(', ')}`,
    `- License: ${rec.license.name}${rec.license.url ? ` (${rec.license.url})` : ''}`,
    `- Price: ${PRICE_LABEL[rec.pricing.status]}`,
    u.homepage ? `- Website: ${u.homepage}` : '',
    u.support ? `- Support: ${u.support}` : '',
    u.bug_tracker ? `- Bug tracker: ${u.bug_tracker}` : '',
    rec.ids.winget ? `- winget ID: ${rec.ids.winget}` : '',
    rec.ids.custom ? `- Source: ${rec.ids.custom} (publisher release feed)` : '',
    rec.ids.homebrew_cask ? `- Homebrew cask: ${rec.ids.homebrew_cask}` : '',
    rec.homebrew_cask_disabled ? `- Homebrew cask status: DISABLED${rec.homebrew_cask_disabled.date ? ` on ${rec.homebrew_cask_disabled.date}` : ''} (${rec.homebrew_cask_disabled.reason}). ${caskDisabledSentence(rec.homebrew_cask_disabled.reason).replace(/\`/g, '')} The macOS download link still works.` : '',
    rec.flathub ? `- Flathub: ${rec.flathub.app_id} — ${rec.flathub.page_url} (app data from Flathub${rec.flathub.license ? `; license listed there: ${rec.flathub.license}` : ''})` : '',
    rec.flathub ? `- Flathub publisher verified: ${rec.flathub.verified ? 'yes' : 'no'}${rec.flathub.verified ? ` (${flathubVerifiedText(rec.flathub)})` : ` (${flathubUnverifiedText(rec.flathub)})`}` : '',
    `- Verification: level ${rec.verification.level} — ${rec.verification.label}${verified ? ` Checked by ${AUTHOR}.` : ''}`,
    ...rec.provenance.map((e) => `- Source (${OS_NAME[e.platform]}): ${sourceName(e)}${e.commit ? ` @ ${e.commit}` : ''} — ${sourceTree(e)}`),
    '',
    rec.description ? `## Description\n\n${rec.description}\n` : '',
    FEATURES.get(rec.slug) ? featuresMd(FEATURES.get(rec.slug)) : '',
    shots.length ? [`## Screenshots`, '', `Screenshots of the Linux version, from Flathub (${SHOTS[rec.slug].page}).`, '', ...shots.map((s, i) => `- [Screenshot ${i + 1}${s.caption ? `: ${s.caption}` : ''}](${s.url})`), ''].join('\n') : '',
    ...plats.flatMap((p) => [
      `## ${OS_NAME[p]}`,
      '',
      allCustom ? '### What the download is' : '### What the installer does',
      ...summaries[p].map((s) => `- ${s}`),
      '',
      `### ${REQ_TITLE[p]}`,
      ...requirementsOf(p).map(([k, v]) => `- **${k}:** ${v.replace(/`/g, '')}`),
      '',
      `### Versions (newest first)${p === 'macos' && !customOf(p) ? ' — Homebrew lists only the current release' : p === 'linux' && rec.flathub ? ' — Flathub lists only the current release' : ''}`,
      '',
      ...versionsOf(rec, p).flatMap((v) => [
        `#### ${v.version}${v.release_date ? ` — ${v.release_date}` : ''}`,
        '',
        ...sortInstallers(v.installers).map((i) => `- ${i.variant ? `${i.variant}, ` : ''}${i.architecture} ${i.type}${i.scope ? ` (${i.scope})` : ''}${i.version ? ` [version ${i.version}]` : ''}: ${i.filename}\n  - url: ${i.url}${deadOf(i) ? ` (UNAVAILABLE: HTTP ${deadOf(i).status} on ${deadOf(i).checked}; the download button is disabled)` : ''}\n  - sha256: ${i.sha256 || (ownSha(rec.slug, i) ? `${ownSha(rec.slug, i)} (computed by us; the source lists none)` : 'not provided by upstream')}`),
        v.release_notes ? `Release notes: ${v.release_notes.replace(/\s+/g, ' ').trim()}` : v.release_notes_url ? `Release notes: ${v.release_notes_url}` : '',
        '',
        pinCmd(rec, v) && p === 'windows' ? `Pin: \`${pinCmd(rec, v)}\`` : installCmd(rec, p) ? `Install: \`${installCmd(rec, p)}\`` : '',
        '',
      ]),
    ]),
  ]
    .filter((l) => l !== undefined)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  return { html, twin, md, title, desc };
}

// ------------------------------------------------------------------ search index

// One small record per app, for the live suggestions: embedded in the home page, and written to /search-index.json for the header search.
const searchIndexOf = (recs) =>
  recs.map((r) => ({
    s: r.slug,
    n: r.name,
    p: r.publisher,
    k: [r.ids.winget || r.ids.custom, ...(r.tags || [])].join(' ').toLowerCase(),
    v: platsOf(r).map((p) => `${PLATFORM[p]} ${r.latest_versions[p]}`).join(' · '),
    ...(ICONS[r.slug] ? { i: ICONS[r.slug].ext, ...(iconHash(r.slug) ? { h: iconHash(r.slug) } : {}) } : {}),
  }));

// ------------------------------------------------------------------ cards

const appCard = (r, plats = platsOf(r), extra = '') => `<li><a class="item" href="/${r.slug}/">${gridIcon(r)}<span class="txt">
<span class="n">${esc(r.name)}</span><br><span class="p">${esc(r.publisher)}</span><br><span class="v">${gridVersions(r, plats)}</span>${extra ? `<br><span class="u">${extra}</span>` : ''}</span>
</a></li>`;

// ------------------------------------------------------------------ categories

const pageCategories = () => (CATS ? CATS.categories.filter((c) => c.page) : []);

function categoryPage(cat) {
  const path = catPath(cat.slug);
  const recOf = (m) => RECS_BY_SLUG.get(m.slug || m);
  const primary = cat.apps.filter((m) => m.role === 'primary').map(recOf).filter(Boolean);
  const also = cat.apps.filter((m) => m.role === 'also').map(recOf).filter(Boolean);
  const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  const grid = (list) => `<ul class="grid">\n${list.sort(byName).map((r) => appCard(r)).join('\n')}\n</ul>`;
  let sections;
  if (cat.groups?.length) {
    const grouped = new Set(cat.groups.flatMap((g) => g.apps));
    const rest = primary.filter((r) => !grouped.has(r.slug));
    sections = [
      ...cat.groups.map((g) => ({ name: g.name, list: g.apps.map((s) => RECS_BY_SLUG.get(s)).filter(Boolean) })),
      ...(rest.length ? [{ name: 'Other tools', list: rest }] : []),
    ];
  } else sections = [{ name: null, list: primary }];
  if (also.length) sections.push({ name: 'Also related', list: also });
  const n = primary.length + also.length;
  const title = cat.title || `Download ${cat.name} software`;
  const description = `${cat.description ? `${cat.description} ` : ''}${n} apps with publisher download links, older versions and SHA-256 checksums.`;
  const others = pageCategories().filter((c) => c.slug !== cat.slug);
  // Facts for the closing description, all counted from the data.
  const members = [...primary, ...also];
  const names = members.map((r) => r.name).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  const listed = members.reduce((t, r) => t + Object.keys(r.versions_total).reduce((a, p) => a + versionsOf(r, p).length, 0), 0);
  const onWin = members.filter((r) => r.platforms.includes('windows')).length;
  const onMac = members.filter((r) => r.platforms.includes('macos')).length;
  const oss = members.filter((r) => r.pricing.status === 'open-source').length;
  const hashed = members.filter((r) => r.verification.level >= 1).length;
  const lead = (cat.lead || `${n} apps in this category. Every one links to the download location named in the publisher’s package data, with a SHA-256 checksum.`).replace(/\{n\}/g, String(n));
  const where = onWin === n && onMac === n ? `All ${n} run on Windows and macOS` : onWin === n ? `All ${n} run on Windows, and ${onMac} also on macOS` : `${onWin} run on Windows and ${onMac} on macOS`;
  const proof = hashed === n ? `For all ${n} we downloaded the installers ourselves and re-computed their SHA-256.` : hashed ? `For ${hashed} of the ${n} we downloaded the installers ourselves and re-computed their SHA-256; for the others the checksums come from the published package listings and are marked as such.` : 'The checksums come from the published package listings and are marked as such.';
  const tail = `The ${n} apps listed here are ${joinList(names)}. ${where}.${oss ? ` ${oss === n ? `All ${n} are` : `Of these, ${oss} are`} open source.` : ''} Between them the site lists ${listed.toLocaleString('en-US')} versions. Older versions are mostly available for Windows; for macOS the current release is usually the one listed. Everyversion hosts no installers: every download button goes to the download location named in the publisher’s package data, normally the publisher’s own server. ${proof}`;
  const aboutHtml = cat.about
    ? `<hr>
<section aria-labelledby="h-about">
<h2 id="h-about">What you’ll find here</h2>
<p>${esc(cat.about)}</p>
<p>${esc(tail)}</p>
</section>`
    : '';
  const body = `
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › <a href="/categories/">Categories</a> › ${esc(cat.name)}</nav>
<h1>${esc(cat.name)}</h1>
<p class="lead">${esc(lead)}</p>
${sections
  .map((sec, i) => `${i ? '<hr>\n' : ''}<section aria-labelledby="h-cat-${i}">
<h2 id="h-cat-${i}"${sec.name ? '' : ' class="sr"'}>${esc(sec.name || `All ${cat.name}`)}</h2>
${grid(sec.list)}
</section>`)
  .join('\n')}
<hr>
<section aria-labelledby="h-more-cats">
<h2 id="h-more-cats">More categories</h2>
<ul class="chips">
${others.map((c) => `<li><a class="chip" href="${catPath(c.slug)}">${esc(c.name)} <span>${c.count}</span></a></li>`).join('\n')}
</ul>
</section>
${aboutHtml}`;
  return {
    path,
    title,
    description,
    body,
    ld: [
      {
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'CollectionPage', '@id': `${SITE.url}${path}#page`, name: title, url: `${SITE.url}${path}`, description, inLanguage: 'en-US', isPartOf: { '@id': `${SITE.url}/#website` } },
          {
            '@type': 'ItemList',
            name: `${cat.name} on Everyversion`,
            numberOfItems: n,
            itemListElement: [...primary, ...also].map((r, i) => ({ '@type': 'ListItem', position: i + 1, name: r.name, url: `${SITE.url}/${r.slug}/` })),
          },
          {
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE.url}/` },
              { '@type': 'ListItem', position: 2, name: 'Categories', item: `${SITE.url}/categories/` },
              { '@type': 'ListItem', position: 3, name: cat.name, item: `${SITE.url}${path}` },
            ],
          },
        ],
      },
    ],
  };
}

function categoriesHub() {
  const cats = pageCategories();
  const path = '/categories/';
  const title = 'Software categories on Everyversion';
  const description = `Browse ${RECS_BY_SLUG.size} apps by category: browsers, code editors, VPNs, audio and video tools and more, each with publisher download links and SHA-256 checksums.`;
  const sample = (c) => c.apps.filter((m) => m.role === 'primary').slice(0, 4).map((m) => RECS_BY_SLUG.get(m.slug)?.name).filter(Boolean).join(', ');
  const body = `
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › Categories</nav>
<h1>Software categories</h1>
<p class="lead">${cats.length} categories covering ${new Set(cats.flatMap((c) => c.apps.map((m) => m.slug))).size} of ${RECS_BY_SLUG.size} apps.</p>
<ul class="grid">
${cats.map((c) => `<li><a class="item" href="${catPath(c.slug)}"><span class="txt"><span class="n">${esc(c.name)}</span><br><span class="p">${c.count} apps</span><br><span class="v">${esc(sample(c))}</span></span></a></li>`).join('\n')}
</ul>`;
  return {
    path,
    title,
    description,
    body,
    ld: [
      {
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'CollectionPage', '@id': `${SITE.url}${path}#page`, name: title, url: `${SITE.url}${path}`, description, inLanguage: 'en-US', isPartOf: { '@id': `${SITE.url}/#website` } },
          { '@type': 'ItemList', name: 'Categories on Everyversion', numberOfItems: cats.length, itemListElement: cats.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, url: `${SITE.url}${catPath(c.slug)}` })) },
          { '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE.url}/` }, { '@type': 'ListItem', position: 2, name: 'Categories', item: `${SITE.url}${path}` }] },
        ],
      },
    ],
  };
}

// ------------------------------------------------------------------ home

function homePage(recs) {
  // Two grids of HOME_GRID apps each: the most recently updated (newest release first), then the newest additions
  // to the catalog that are not already in the first grid. Search covers every app, and every app is linked from
  // its category page and the Windows / Mac listings.
  const HOME_GRID = 9;
  const releasedOn = (r) => r.versions.map((v) => v.release_date).filter(Boolean).sort().at(-1) || r.last_updated || null;
  const shortDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const recent = recs
    .map((r) => ({ r, d: releasedOn(r) }))
    .filter((x) => x.d)
    .sort((x, y) => y.d.localeCompare(x.d) || x.r.name.localeCompare(y.r.name))
    .slice(0, HOME_GRID);
  const items = recent.map(({ r, d }) => appCard(r, platsOf(r), `Updated ${esc(shortDay(d))}`)).join('\n');
  // Newest additions: config/apps.txt is appended to in the order apps are added, under "# added YYYY-MM-DD" lines.
  const shown = new Set(recent.map((x) => x.r.slug));
  const byWinget = new Map(recs.filter((r) => r.ids.winget).map((r) => [r.ids.winget, r]));
  const addedOrder = [];
  let addedOn = null;
  for (const line of readFileSync(join(ROOT, 'config', 'apps.txt'), 'utf8').split('\n')) {
    const t = line.trim();
    const m = t.match(/^#\s*added\s+(\d{4}-\d{2}-\d{2})/);
    if (m) addedOn = m[1];
    else if (t && !t.startsWith('#')) addedOrder.push({ id: t.split(/\s+/)[0], d: addedOn });
  }
  const fresh = addedOrder
    .reverse()
    .map((x) => ({ r: byWinget.get(x.id), d: x.d }))
    .filter((x) => x.r && !shown.has(x.r.slug))
    .slice(0, HOME_GRID);
  const freshItems = fresh.map(({ r, d }) => appCard(r, platsOf(r), d ? `Added ${esc(shortDay(d))}` : '')).join('\n');
  // Search index for the live suggestions: every app, small fields only.
  const searchIndex = JSON.stringify(searchIndexOf(recs)).replace(/</g, '\\u003c');

  const totalVersions = recs.reduce((n, r) => n + Object.values(r.versions_total).reduce((a, b) => a + b, 0), 0);
  const title = 'Everyversion – Find the version that still runs on your machine';
  const description = `Find older versions of ${recs.length} popular apps. Publisher download links, SHA-256 checksums, release notes and a JSON API. No installers hosted.`;
  const nV = totalVersions.toLocaleString('en-US');

  const AGENTS_HTML = `<div class="agents-wrap">
<button type="button" class="agents-btn" id="agents-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="agents-menu">${ICON_ROCKET}For Agents${ICON_UPDOWN}</button>
<div class="agents-menu" id="agents-menu" role="menu" aria-labelledby="agents-btn" hidden>
<button type="button" role="menuitem" class="agents-item" data-copy="${esc(AGENT_PROMPT)}"><span class="lbl">Copy LLMs.txt</span>${ICON_COPY}</button>
<a role="menuitem" class="agents-item" href="https://chatgpt.com/?q=${encodeURIComponent(AGENT_PROMPT)}" rel="noopener"><span>Ask ChatGPT</span>${ICON_EXTERNAL}</a>
<a role="menuitem" class="agents-item" href="https://claude.ai/new?q=${encodeURIComponent(AGENT_PROMPT)}" rel="noopener"><span>Ask Claude</span>${ICON_EXTERNAL}</a>
</div>
</div>`;
  const popular = ['qbittorrent', 'audacity', 'vlc', 'obs-studio', 'gimp', '7-zip', 'blender', 'notepad-plus-plus']
    .map((sl) => recs.find((r) => r.slug === sl))
    .filter(Boolean)
    .map((r) => `<a href="/${r.slug}/">${esc(r.name)}</a>`)
    .join(' · ');
  const browseCats = pageCategories().slice(0, 9);
  const browseHtml = browseCats.length
    ? `<section class="browse" aria-labelledby="h-browse">
<h2 id="h-browse">Browse by category</h2>
<div class="cat-grid">
${browseCats.map((c) => `<a class="cat-cell" href="${catPath(c.slug)}"><span class="top"><span class="nm">${esc(c.name)}</span><span class="ct">${c.count} apps</span></span>${c.description ? `<span class="ds">${esc(c.description)}</span>` : ''}</a>`).join('\n')}
</div>
<p><a class="btn-outline" href="/categories/">Browse all categories</a></p>
</section>

<hr>
`
    : '';
  const body = `
<section class="hero">
<h1>Find the version that still runs on your machine</h1>
<p class="lead">Newer isn’t always better. Every update can add weight, hide the features you used, or slip in adware. Here are ${nV} versions of ${recs.length} apps, each linked to the publisher’s download location, each with a checksum you can verify before you run it.</p>
<form class="hero-search" id="hero-search" role="search" action="/">
<div class="search-box">
<label class="sr" for="q">Search apps</label>
<input id="q" type="search" placeholder="Search apps by name, publisher or tag" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="suggest" aria-autocomplete="list" aria-haspopup="listbox">
<ul id="suggest" class="suggest" role="listbox" aria-label="Matching apps" hidden></ul>
</div>
<button type="submit" class="btn search-btn">Search Everyversion</button>
${AGENTS_HTML}
</form>
<p class="popular">Popular: ${popular}</p>
<ul class="trust" aria-label="What we stand for">
<li><span class="tip" tabindex="0" aria-describedby="t1">Open-source first</span><span class="tipbox" role="tooltip" id="t1">We prioritize open-source and freeware apps. Their licenses generally allow older builds to be kept and shared, so old versions stay legitimate to download.</span></li>
<li><span class="tip" tabindex="0" aria-describedby="t2">Publisher download links</span><span class="tipbox" role="tooltip" id="t2">Each download button points to the location named in the publisher’s package data, normally the publisher’s own server. We can’t guarantee what is there. We host zero installers, so nobody wraps a file in a download manager or bundles extras.</span></li>
<li><span class="tip" tabindex="0" aria-describedby="t3">Paid options clearly labeled</span><span class="tipbox" role="tooltip" id="t3">If an app is paid or has paid tiers, the listing says so. “Free” only appears when the license or the publisher says it.</span></li>
<li><span class="tip" tabindex="0" aria-describedby="t4">Old hardware friendly</span><span class="tipbox" role="tooltip" id="t4">New releases often want more RAM, a newer OS or a faster CPU. We list older versions with the minimum OS each installer declares, so you know before you download.</span></li>
<li><span class="tip" tabindex="0" aria-describedby="t5">Privacy first</span><span class="tipbox" role="tooltip" id="t5">We host zero installers, so no download manager sits between you and the file. Compare the SHA-256 checksum on each listing before you run it.</span></li>
</ul>
</section>

${browseHtml}<section id="apps" aria-labelledby="h-apps">
<h2 id="h-apps">Recently updated</h2>
<p class="pin">The ${recent.length} apps with the newest releases, newest first. Search above finds all ${recs.length} apps.</p>
<ul class="grid" id="list">
${items}
</ul>
</section>
${freshItems ? `
<section id="new-apps" aria-labelledby="h-new">
<h2 id="h-new">New in the catalog</h2>
<p class="pin">The latest apps added to Everyversion, newest first.</p>
<ul class="grid">
${freshItems}
</ul>
</section>
` : ''}
<section aria-label="Request an app">
<aside class="req-cta" aria-labelledby="h-cta">
<div><h2 id="h-cta">Don’t see yours?</h2>
<p>Tell me which app you need. The list grows from your requests.</p></div>
<a class="btn cta-btn" href="/contact/">Request an app</a>
</aside>
</section>
<script>
(()=>{const btn=document.getElementById('agents-btn'),menu=document.getElementById('agents-menu');if(!btn||!menu)return;
const open=(v)=>{menu.hidden=!v;btn.setAttribute('aria-expanded',v?'true':'false')};
btn.addEventListener('click',(e)=>{e.stopPropagation();open(menu.hidden)});
document.addEventListener('click',(e)=>{if(!menu.hidden&&!menu.contains(e.target))open(false)});
document.addEventListener('keydown',(e)=>{if(e.key==='Escape'&&!menu.hidden){open(false);btn.focus()}});
menu.addEventListener('click',(e)=>{const b=e.target.closest('[data-copy]');if(!b)return;const t=b.dataset.copy,l=b.querySelector('.lbl'),old=l.textContent,done=()=>{l.textContent='Copied';setTimeout(()=>{l.textContent=old;open(false)},1200)},
fb=()=>{const a=document.createElement('textarea');a.value=t;a.style.position='fixed';a.style.opacity='0';document.body.appendChild(a);a.select();try{if(document.execCommand('copy'))done()}catch(_){}a.remove()};
if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(t).then(done,fb);else fb()})})();
</script>
<script type="application/json" id="app-index">${searchIndex}</script>
<script>
(()=>{const q=document.getElementById('q'),box=document.getElementById('suggest'),form=document.getElementById('hero-search'),src=document.getElementById('app-index');if(!q||!box||!form||!src)return;
const apps=JSON.parse(src.textContent),MAX=8;let shown=[],act=-1;
const score=(a,t)=>{const n=a.n.toLowerCase();if(n===t)return 100;if(n.startsWith(t))return 90;if(n.split(/[^a-z0-9]+/).some(w=>w.startsWith(t)))return 80;if(n.includes(t))return 70;
if(t.length>1){if(a.p.toLowerCase().includes(t))return 40;if(a.k.includes(t))return 30}return 0};
const find=(t)=>apps.map(a=>({a,s:score(a,t)})).filter(x=>x.s>0).sort((x,y)=>y.s-x.s||x.a.n.localeCompare(y.a.n));
const mk=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e};
const hl=(el,text,t)=>{const i=text.toLowerCase().indexOf(t);if(i<0||!t){el.textContent=text;return}el.append(text.slice(0,i));const m=mk('mark',null,text.slice(i,i+t.length));el.append(m,text.slice(i+t.length))};
const open=(v)=>{box.hidden=!v;q.setAttribute('aria-expanded',v?'true':'false');if(!v){act=-1;q.removeAttribute('aria-activedescendant')}};
const mark=(i)=>{[...box.children].forEach((li,j)=>{const on=j===i;li.classList.toggle('on',on);li.setAttribute('aria-selected',on?'true':'false');if(on){q.setAttribute('aria-activedescendant',li.id);li.scrollIntoView({block:'nearest'})}});act=i};
const render=()=>{const t=q.value.trim().toLowerCase();box.textContent='';shown=[];if(!t){open(false);return}
const all=find(t);shown=all.slice(0,MAX).map(x=>x.a);
shown.forEach((a,i)=>{const li=mk('li','opt');li.id='sg'+i;li.setAttribute('role','option');li.setAttribute('aria-selected','false');
const link=mk('a');link.href='/'+a.s+'/';link.tabIndex=-1;
if(a.i){const im=mk('img','ico');im.src='/'+a.s+'/icon.'+a.i+(a.h?'?v='+a.h:'');im.width=28;im.height=28;im.alt='';im.loading='lazy';link.append(im)}else link.append(mk('span','ico ph'));
const tx=mk('span','tx');const nm=mk('span','nm');hl(nm,a.n,t);tx.append(nm,mk('span','sub',a.p+' · '+a.v));link.append(tx);li.append(link);
li.addEventListener('mousemove',()=>{if(act!==i)mark(i)});box.append(li)});
if(all.length>MAX){const li=mk('li','more','Showing '+MAX+' of '+all.length+' matches. Keep typing to narrow it down.');li.setAttribute('role','presentation');box.append(li)}
if(!shown.length){const li=mk('li','none');li.setAttribute('role','presentation');li.append('No app matches “'+q.value.trim()+'”. ');const a=mk('a',null,'Request it');a.href='/contact/';li.append(a,'.');box.append(li)}
open(true);act=-1};
q.addEventListener('input',render);
q.addEventListener('focus',()=>{if(q.value.trim())render()});
q.addEventListener('keydown',(e)=>{if(box.hidden&&e.key==='ArrowDown'&&q.value.trim()){render();e.preventDefault();return}
if(box.hidden)return;
if(e.key==='ArrowDown'){e.preventDefault();if(shown.length)mark((act+1)%shown.length)}
else if(e.key==='ArrowUp'){e.preventDefault();if(shown.length)mark((act-1+shown.length)%shown.length)}
else if(e.key==='Escape'){open(false)}});
form.addEventListener('submit',(e)=>{e.preventDefault();const t=q.value.trim().toLowerCase();if(!t)return;const pick=act>=0?shown[act]:(shown[0]||(find(t)[0]||{}).a);if(pick)location.href='/'+pick.s+'/';else render()});
document.addEventListener('click',(e)=>{if(!form.contains(e.target))open(false)});
})();
</script>`;

  return layout({
    title,
    description,
    path: '/',
    body,
    ld: [
      {
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'WebSite', '@id': `${SITE.url}/#website`, name: SITE.name, url: `${SITE.url}/`, inLanguage: 'en-US', description },
          {
            '@type': 'ItemList',
            name: 'Apps on Everyversion',
            numberOfItems: recs.length,
            itemListElement: recs.map((r, i) => ({ '@type': 'ListItem', position: i + 1, name: r.name, url: `${SITE.url}/${r.slug}/` })),
          },
        ],
      },
    ],
  });
}

// ------------------------------------------------------------------ platform pages

function platformPage(plat, recs) {
  const list = recs.filter((r) => r.platforms.includes(plat));
  const name = PLATFORM[plat];
  const path = PLATFORM_PATH[plat];
  const others = Object.keys(PLATFORM_PATH).filter((p) => p !== plat && recs.some((r) => r.platforms.includes(p)));
  const card = (r) => `<li><a class="item" href="/${r.slug}/">${gridIcon(r)}<span class="txt">
<span class="n">${esc(r.name)}</span><br><span class="p">${esc(r.publisher)}</span><br><span class="v">${gridVersions(r, [plat])}</span></span>
</a></li>`;
  // One h2 section per category (in the order of data/categories.json), each with a grid of its apps, A to Z.
  const byName = (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  const sections = [];
  if (CATS) {
    const placed = new Set();
    for (const c of CATS.categories) {
      const apps = list.filter((r) => CATS.apps[r.slug]?.primary === c.slug).sort(byName);
      if (!apps.length) continue;
      apps.forEach((r) => placed.add(r.slug));
      sections.push({ id: `cat-${c.slug}`, name: c.name, href: c.page ? catPath(c.slug) : null, apps });
    }
    const rest = list.filter((r) => !placed.has(r.slug)).sort(byName);
    if (rest.length) sections.push({ id: 'cat-other', name: 'Other software', href: null, apps: rest });
  } else sections.push({ id: 'cat-all', name: `All ${name} apps`, href: null, apps: [...list].sort(byName) });
  list.splice(0, list.length, ...sections.flatMap((x) => x.apps)); // the structured-data list follows the order shown
  const items = sections
    .map(
      (x) => `<section id="${x.id}" aria-labelledby="h-${x.id}">
<h2 id="h-${x.id}">${x.href ? `<a href="${x.href}">${esc(x.name)}</a>` : esc(x.name)} <span class="sub">${x.apps.length} app${x.apps.length === 1 ? '' : 's'}</span></h2>
<ul class="grid">
${x.apps.map(card).join('\n')}
</ul>
</section>`,
    )
    .join('\n');
  const title = `Download ${name} software: latest and old versions`;
  const description = `All ${list.length} apps for ${name} on Everyversion. Download links to the locations named in publishers’ package data, older versions and SHA-256 checksums for each.`;
  const body = `
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › ${esc(name)}</nav>
<h1 class="plat-h1">${PLATFORM_ICON[plat] || ''}${esc(name)} software</h1>
<p class="lead">${list.length} apps for ${esc(name)}. Each one has download links to the location named in the publisher’s package data, older versions, and SHA-256 checksums.${others.length ? ` Looking for another platform? ${others.map((p) => `<a href="${PLATFORM_PATH[p]}">${esc(PLATFORM[p])}</a>`).join(', ')}.` : ''}</p>
<div id="apps">
${items}
</div>
`;
  return {
    path,
    title,
    description,
    body,
    ld: [
      {
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'CollectionPage', '@id': `${SITE.url}${path}#page`, name: title, url: `${SITE.url}${path}`, description, inLanguage: 'en-US' },
          {
            '@type': 'ItemList',
            name: `${name} apps on Everyversion`,
            numberOfItems: list.length,
            itemListElement: list.map((r, i) => ({ '@type': 'ListItem', position: i + 1, name: r.name, url: `${SITE.url}/${r.slug}/` })),
          },
          {
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE.url}/` },
              { '@type': 'ListItem', position: 2, name, item: `${SITE.url}${path}` },
            ],
          },
        ],
      },
    ],
  };
}

// ------------------------------------------------------------------ main

function main() {
  const recs = readdirSync(join(ROOT, 'data', 'apps'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(ROOT, 'data', 'apps', f), 'utf8')))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  mergeVerification(recs);
  RECS_BY_SLUG = new Map(recs.map((r) => [r.slug, r]));
  SEARCH_V = createHash('sha256').update(readFileSync(join(ROOT, 'assets', 'search.js'))).update(JSON.stringify(searchIndexOf(recs))).digest('hex').slice(0, 10);
  HAS_LINUX = recs.some((r) => r.platforms.includes('linux')); // must be set before any page is written: the header is part of every page
  if (CATS) {
    const missing = recs.filter((r) => !CATS.apps[r.slug]).map((r) => r.slug);
    if (missing.length) console.warn(`! ${missing.length} app(s) are not in config/categories.json yet (no category, no alternatives): ${missing.join(', ')}`);
  }

  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });

  const index = [];
  const stats = { pages: 0, bytes: 0 };
  for (const rec of recs) {
    const { html, twin, md, title, desc } = appPage(rec);
    write(`${rec.slug}/index.html`, html);
    if (ICONS[rec.slug]) cpSync(join(ROOT, 'data', 'icons', ICONS[rec.slug].file), join(DIST, rec.slug, `icon.${ICONS[rec.slug].ext}`));
    if (ogImage(rec)) cpSync(join(ROOT, 'data', 'og', `${rec.slug}.png`), join(DIST, rec.slug, 'og.png'));
    for (const it of shotsOf(rec)) cpSync(join(ROOT, 'data', 'screenshots', rec.slug, it.file), join(DIST, rec.slug, it.file));
    write(`${rec.slug}/${rec.slug}.json`, JSON.stringify(twin, null, 2) + '\n');
    write(`${rec.slug}/${rec.slug}.md`, md);
    stats.pages++;
    stats.bytes += Buffer.byteLength(html);
    index.push({
      slug: rec.slug,
      name: rec.name,
      publisher: rec.publisher,
      summary: rec.summary,
      platforms: rec.platforms,
      latest_versions: rec.latest_versions,
      last_updated: rec.last_updated,
      pricing: rec.pricing.status,
      license: rec.license.name,
      ids: rec.ids,
      ...(CATS?.apps?.[rec.slug] ? { category: CATS.apps[rec.slug].primary } : {}),
      versions_total: rec.versions_total,
      url: `${SITE.url}/${rec.slug}/`,
      json: `${SITE.url}/${rec.slug}/${rec.slug}.json`,
      markdown: `${SITE.url}/${rec.slug}/${rec.slug}.md`,
      title,
      description: desc,
    });
  }

  write('index.html', homePage(recs));
  const totalVersions = recs.reduce((n, r) => n + Object.values(r.versions_total).reduce((a, b) => a + b, 0), 0);
  const apiBytes = JSON.stringify({ site: SITE.url, source: meta, count: index.length, apps: index }, null, 1).length;
  const staticPages = [
    apiPage({ apps: recs.length, versions: totalVersions, categories: pageCategories().length, indexKB: Math.round(apiBytes / 1024) }),
    aboutPage({ apps: recs.length, versions: totalVersions, checked: recs.filter((r) => r.verification.level >= 1).length }),
    contactPage(),
    securityPage({ apps: recs.length, checked: recs.filter((r) => r.verification.level >= 1).length, files: [...VERIF_FILES.values()].reduce((n, m) => n + m.size, 0) }),
    legalHub(),
    privacyPage(),
    termsPage(),
    cookiesPage(),
    disclaimerPage(),
    contentPage(),
    statsPage({ statsV: assetHash('stats.js') }),
  ];
  const platformPages = ['windows', 'macos', 'linux'].filter((p) => recs.some((r) => r.platforms.includes(p))).map((p) => platformPage(p, recs));
  staticPages.push(...platformPages);
  if (CATS && pageCategories().length) staticPages.push(categoriesHub(), ...pageCategories().map(categoryPage));
  for (const pg of staticPages) write(`${pg.path.slice(1)}index.html`, layout({ ...pg, ld: pg.ld || [{ '@context': 'https://schema.org', '@type': 'WebPage', name: pg.title, url: `${SITE.url}${pg.path}`, description: pg.description }] }));
  write('api/v1/apps.json', JSON.stringify({ site: SITE.url, source: meta, count: index.length, apps: index }, null, 1) + '\n');
  if (CATS)
    write(
      'api/v1/categories.json',
      JSON.stringify({ site: SITE.url, count: CATS.categories.length, categories: CATS.categories.map((c) => ({ slug: c.slug, name: c.name, count: c.count, ...(c.page ? { url: `${SITE.url}${catPath(c.slug)}` } : {}), apps: c.apps.map((m) => m.slug) })) }, null, 1) + '\n',
    );
  cpSync(join(ROOT, 'assets', 'htaccess'), join(DIST, '.htaccess')); // Apache rules: https + no www, no directory listings, hidden files
  write('search-index.json', JSON.stringify(searchIndexOf(recs)));
  cpSync(join(ROOT, 'assets', 'search.js'), join(DIST, 'search.js'));
  // First-party analytics: the browser script, the stats page script, and the PHP that collects and aggregates (see server/).
  cpSync(join(ROOT, 'assets', 't.js'), join(DIST, 't.js'));
  cpSync(join(ROOT, 'assets', 'gallery.js'), join(DIST, 'gallery.js'));
  cpSync(join(ROOT, 'assets', 'stats.js'), join(DIST, 'stats.js'));
  for (const f of ['collect.php', 'stats-data.php', 'analytics-lib.php']) cpSync(join(ROOT, 'server', f), join(DIST, f));
  mkdirSync(join(DIST, 'fonts'), { recursive: true });
  cpSync(join(ROOT, 'assets', 'fonts', 'geist.woff2'), join(DIST, 'fonts', 'geist.woff2'));
  mkdirSync(join(DIST, 'brand'), { recursive: true });
  for (const f of ['logo.svg', 'logo-dark.svg', 'logo.png', 'mark.svg', 'mark-512.png']) cpSync(join(ROOT, 'brand', f), join(DIST, 'brand', f));
  for (const f of ['favicon.ico', 'favicon-48x48.png', 'apple-touch-icon.png']) cpSync(join(ROOT, 'assets', f), join(DIST, f));
  cpSync(join(ROOT, 'schema', 'app.schema.json'), join(DIST, 'schema', 'app.schema.json'));

  write(
    '404.html',
    layout({
      title: 'Page not found – Everyversion',
      description: 'That page does not exist. Browse all apps on Everyversion.',
      path: '/404.html',
      body: '<h1>Page not found</h1><p>That app is not in the index yet. <a href="/">Browse all apps</a>.</p>',
    }).replace('<meta property="og:type"', '<meta name="robots" content="noindex">\n<meta property="og:type"'),
  );

  write('robots.txt', `# As a condition of accessing this website, you agree to
# abide by the following content signals:

# (a)  If a content-signal = yes, you may collect content
# for the corresponding use.
# (b)  If a content-signal = no, you may not collect content
# for the corresponding use.
# (c)  If the website operator does not include a content
# signal for a corresponding use, the website operator
# neither grants nor restricts permission via content signal
# with respect to the corresponding use.

# The content signals and their meanings are:

# search: building a search index and providing search
# results (e.g., returning hyperlinks and short excerpts
# from your website's contents).  Search does not include
# providing AI-generated search summaries.
# ai-input: inputting content into one or more AI models
# (e.g., retrieval augmented generation, grounding, or other
# real-time taking of content for generative AI search
# answers).
# ai-train: training or fine-tuning AI models.

# ANY RESTRICTIONS EXPRESSED VIA CONTENT SIGNALS ARE EXPRESS
# RESERVATIONS OF RIGHTS UNDER ARTICLE 4 OF THE EUROPEAN
# UNION DIRECTIVE 2019/790 ON COPYRIGHT AND RELATED RIGHTS
# IN THE DIGITAL SINGLE MARKET.

# Search engines do not crawl the machine-readable twins (the .json and .md files). They are meant for AI agents and tools, which keep
# full access below. A crawler follows only the most specific group that names it, so each group repeats the rules it needs.
User-Agent: Googlebot
User-Agent: Googlebot-News
User-Agent: Googlebot-Image
User-Agent: Bingbot
User-Agent: Slurp
User-Agent: DuckDuckBot
User-Agent: Baiduspider
User-Agent: YandexBot
User-Agent: Applebot
User-Agent: Qwantify
User-Agent: SeznamBot
User-Agent: Naverbot
User-Agent: Yeti
Content-Signal: ai-train=yes, search=yes, ai-input=yes
Allow: /
Disallow: /*.json$
Disallow: /*.md$
Disallow: /stats-data.php

User-Agent: *
Content-Signal: ai-train=yes, search=yes, ai-input=yes
Allow: /

Sitemap: ${SITE.url}/sitemap.xml
`);

  const day = meta.run_at.slice(0, 10);
  write(
    'sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      [`<url><loc>${SITE.url}/</loc><lastmod>${day}</lastmod></url>`]
        .concat(staticPages.filter((pg) => !pg.noindex).map((pg) => `<url><loc>${SITE.url}${pg.path}</loc><lastmod>${day}</lastmod></url>`))
        .concat(recs.map((r) => `<url><loc>${SITE.url}/${r.slug}/</loc><lastmod>${r.last_updated || r.provenance[0].retrieved_at.slice(0, 10)}</lastmod></url>`))
        .join('\n') +
      `\n</urlset>\n`,
  );

  write(
    'llms.txt',
    [
      `# ${SITE.name}`,
      '',
      `> A static index of downloadable software: latest and older versions, SHA-256 checksums, license and a plain summary of what each installer does. Early preview: ${recs.length} apps (${recs.filter((r) => r.platforms.includes('macos')).length} also on macOS) from winget-pkgs (Windows), Homebrew casks (macOS), Flathub (Linux, with Flathub’s publisher-verified status) and, for a few apps, the publisher's own release feeds. Download links point to the locations named in publishers' package data, normally the publishers' own servers; this site hosts no installers.`,
      '',
      '## Reading the data',
      '',
      `- Each app has one page at ${SITE.url}/{slug}/, a JSON twin at ${SITE.url}/{slug}/{slug}.json and a Markdown twin at ${SITE.url}/{slug}/{slug}.md.`,
      `- Full index: ${SITE.url}/api/v1/apps.json. JSON Schema: ${SITE.url}/schema/app.schema.json.`,
      '- Verification: level 0 means SHA-256 values are copied from winget-pkgs manifests, Homebrew cask definitions (some casks declare no checksum), Flathub (Linux Flatpaks: no file checksum is published; the repository is signed) or, for apps read from a publisher’s own feed, the SHA-256 files the publisher posts next to each download and were not re-computed; cite them as "per winget-pkgs". Level 1 means the installers were downloaded from the publisher and the SHA-256 re-computed by the site owner, with code signatures checked where tools allowed. Each page states its level and the date.',
      '- Pricing "unknown" means winget-pkgs does not say; "free-to-download" is a hand-curated label.',
      '',
      '## About',
      '',
      `- [API](${SITE.url}/api/), [Windows apps](${SITE.url}/windows/), [Mac apps](${SITE.url}/mac/), [About](${SITE.url}/about/), [Security and Trust Center](${SITE.url}/security/), [Contact](${SITE.url}/contact/), [Legal](${SITE.url}/legal/)`,
      '',
      ...(pageCategories().length ? ['## Categories', '', `- [All categories](${SITE.url}/categories/), machine-readable: ${SITE.url}/api/v1/categories.json`, ...pageCategories().map((c) => `- [${c.name}](${SITE.url}${catPath(c.slug)}): ${c.count} apps`), ''] : []),
      '## Apps',
      '',
      ...recs.map((r) => `- [${r.name}](${SITE.url}/${r.slug}/): ${r.summary ? r.summary.replace(/\s+/g, ' ') : r.publisher} (latest ${platsOf(r).map((p) => `${OS_NAME[p]} ${r.latest_versions[p]}`).join(', ')})`),
      '',
    ].join('\n'),
  );

  console.log(`built ${stats.pages} app pages + home in dist/ (avg ${(stats.bytes / stats.pages / 1024).toFixed(1)} KB per app page)`);
}

main();
