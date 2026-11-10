// Custom source adapter: Ableton (Live and Push). Two apps, one adapter: cfg.product is "live" or "push".
//
// Why custom: winget has only Live 10 Suite, and Ableton's own download archive needs a login, so there is no feed to read.
// What we use instead, all public:
//   release-notes pages   www.ableton.com/en/release-notes/live-12|11|10/ and /push-12/  -> the version list, dates and changelogs
//   Homebrew casks        formulae.brew.sh/api/cask/ableton-live-*.json                    -> the publisher's SHA-256 for the Mac build of one version per cask
//   download CDN          cdn-downloads.ableton.com/channels/<version>/...                  -> file names follow a fixed pattern; we check each file exists (HEAD)
//
// Live downloads, per version, edition and platform (the patterns were checked against the CDN):
//   Windows   ableton_live_<edition>_<version>_64.zip
//   macOS     ableton_live_<edition>_<version>_universal.dmg   (Live 11 and 12)
//             ableton_live_<edition>_<version>_64.dmg          (Live 10)
// Ableton publishes no checksum for them. The Mac files that a Homebrew cask pins keep that SHA-256; everything else is marked
// no_checksum (the verification step computes hashes for the newest version, and says "computed by us").
//
// Ongoing checks (config active_majors): only Live 12 is re-read on each run, so new Live 12 releases are picked up and Live 11 and 10, which
// never change, are kept from the record. Push is checked in full each run; it is a single page and five downloads.
//
// Push: the downloads are a fixed list from the config (Push 3 firmware and recovery image, Windows audio drivers, GPL source).
// They belong to the newest Push release only; older Push releases have no download of their own, so they appear in the changelog text.

import { compareVersions } from '../lib/version.mjs';
import { normaliseCask } from '../lib/cask.mjs';

const UA = { 'user-agent': 'everyversion.net-custom-sources' };
const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'", '&nbsp;': ' ' };
// "October 30, 2026" and the short form "Aug 6, 2024" both appear on the release-notes pages
const DATE_RE = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.? (\d{1,2}),? (\d{4})/;
const NOTES_CAP = 3000;

const isoDate = (m) => `${m[3]}-${MONTHS[m[1].slice(0, 3)]}-${String(m[2]).padStart(2, '0')}`;

export function htmlToText(html) {
  return String(html)
    .replace(/<\s*(script|style)[\s\S]*?<\/\s*\1\s*>/gi, '')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|h[1-6]|ul|ol|div|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#x27|#39|nbsp);/g, (m) => ENT[m])
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const cap = (s, n = NOTES_CAP) => (s.length <= n ? s : `${s.slice(0, n).replace(/\s+\S*$/, '')}…`);

/** Live release notes: [{ version, date, text, page, anchor }] from one page, newest first as on the page. */
export function parseLiveNotes(html, page) {
  const main = html.slice(Math.max(0, html.indexOf('<main')));
  const heads = [...main.matchAll(/<h2[^>]*>\s*(\d+(?:\.\d+)+)\s+Release Notes\s*<\/h2>/g)];
  return heads.map((h, i) => {
    const block = main.slice(h.index + h[0].length, heads[i + 1]?.index ?? main.length);
    const text = htmlToText(block);
    const d = DATE_RE.exec(text.slice(0, 600));
    const body = d ? text.replace(d[0], '').replace(/^\s+/, '') : text;
    return { version: h[1], date: d ? isoDate(d) : undefined, text: cap(body.replace(/\n{2,}/g, '\n')), page, anchor: `live-${h[1].replace(/\./g, '')}` };
  });
}

/** Push release notes: "Push 2.4.16 with Live 12.4.16 October 30, 2026 <notes>" -> [{ version, live, date, text }] */
export function parsePushNotes(html) {
  const main = html.slice(Math.max(0, html.indexOf('<main')));
  const text = htmlToText(main);
  const re = /Push (\d+(?:\.\d+)*) (?:with|and) Live (\d+(?:\.\d+)*)\s+((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4})/g;
  const heads = [...text.matchAll(re)];
  return heads.map((h, i) => {
    const body = text.slice(h.index + h[0].length, heads[i + 1]?.index ?? text.length).trim();
    return { version: h[1], live: h[2], date: isoDate(DATE_RE.exec(h[3])), text: cap(body) };
  });
}

// ---- download checks (HEAD). 200 = exists, 404 = missing; anything else (403, 429, timeouts) is "unknown" and not remembered.
async function head(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: UA, redirect: 'follow', signal: AbortSignal.timeout(30000) });
    return { status: res.status, modified: res.headers.get('last-modified') };
  } catch {
    return { status: 0 };
  }
}

async function existing(urls, cache, log, today, releasedOn) {
  // cache[url]: a SHA-256 (exists, publisher hash), "" (exists, no hash) or "x:<date>" (404 on that date).
  const known = new Map();
  const todo = [];
  for (const u of urls) {
    const c = cache[u];
    if (c === undefined) todo.push(u);
    else if (typeof c === 'string' && c.startsWith('x:')) {
      // A file that was missing shortly after the release may simply not have been uploaded yet: look again for 30 days.
      const age = (Date.parse(c.slice(2)) - Date.parse(releasedOn.get(u) || '1970-01-01')) / 86400000;
      if (age < 30 && c.slice(2) !== today) todo.push(u);
      else known.set(u, false);
    } else known.set(u, true);
  }
  let n = 0;
  const queue = [...todo];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (queue.length) {
        const u = queue.shift();
        const { status: s, modified } = await head(u);
        if (s === 200) {
          cache[u] = cache[u] && !String(cache[u]).startsWith('x:') ? cache[u] : '';
          if (modified && !Number.isNaN(Date.parse(modified))) cache[`lm:${u}`] = new Date(modified).toISOString().slice(0, 10); // when the file was uploaded
          known.set(u, true);
        }
        else if (s === 404 || s === 410) { cache[u] = `x:${today}`; known.set(u, false); }
        else known.set(u, null); // unknown: neither listed nor remembered
        if (++n % 200 === 0) log(`  checked ${n}/${todo.length} download URLs`);
      }
    }),
  );
  return known;
}

const ARCH_ORDER = ['universal', 'x64', 'arm64', 'neutral'];

// The release date of a Live version: the date in its release notes, else the day Ableton uploaded its Windows Suite download
// (the Last-Modified header of that file), which is the nearest thing to a release date for versions whose notes carry none.
// Many old files share one upload day (Ableton moved its archive to a new server in bulk), and that day says nothing about
// the release, so an upload date that more than 5 versions share is ignored.
function uploadDates(releases, candidates, cache) {
  const per = new Map();
  for (const r of releases) {
    const d = candidates.filter((c) => c.r === r).map((c) => cache[`lm:${c.url}`]).filter(Boolean).sort()[0];
    if (d) per.set(r, d);
  }
  const count = {};
  for (const d of per.values()) count[d] = (count[d] || 0) + 1;
  return new Map([...per].filter(([, d]) => count[d] <= 5));
}

// ------------------------------------------------------------------------------------------------ Live
async function fetchLive(cfg, ctx) {
  const { getJson, getText, cache, log, today } = ctx;
  // Daily runs only look at the active Live majors (config active_majors, for example [12]). Older versions never change, so the entries
  // already in the record are kept exactly as they are: no release-notes pages, cask lookups or download checks for them.
  // A first run (no record yet) or `node scripts/custom.mjs --full` reads everything.
  const active = (cfg.active_majors || []).map(String);
  const major = (v) => v.split('.')[0];
  const frozen = active.length && ctx.prev ? ctx.prev.versions.filter((v) => !active.includes(major(v.version))) : [];
  const pages = frozen.length ? cfg.feeds.notes.filter((p) => active.some((m) => p.includes(`/live-${m}/`))) : cfg.feeds.notes;
  const tokens = frozen.length ? cfg.casks.filter((t) => !t.includes('@')) : cfg.casks; // the unversioned casks are the current major's
  if (frozen.length) log(`  keeping ${frozen.length} earlier entries as they are (Live ${[...new Set(frozen.map((v) => major(v.version)))].join(', ')}); checking Live ${active.join(', ')} only`);
  const byVersion = new Map();
  for (const page of pages) {
    for (const n of parseLiveNotes(await getText(page), page)) if (!byVersion.has(n.version)) byVersion.set(n.version, n);
  }
  if (!byVersion.size) throw new Error('no Live release notes found on the release-notes pages');
  const releases = [...byVersion.values()].sort((a, b) => compareVersions(b.version, a.version));

  // Mac builds that a Homebrew cask pins: url -> installer (with the publisher's SHA-256 and minimum macOS)
  const caskInstaller = new Map();
  for (const token of tokens) {
    try {
      const norm = normaliseCask(await getJson(`${cfg.feeds.cask_api}${encodeURIComponent(token)}.json`), new Date().toISOString());
      if (norm.skip) { log(`  cask ${token}: skipped (${norm.skip})`); continue; }
      for (const i of norm.version.installers) caskInstaller.set(i.url, i);
    } catch (e) {
      log(`  cask ${token}: ${e.message}`);
    }
  }

  const slug = { Suite: 'suite', Standard: 'standard', Intro: 'intro', Lite: 'lite' };
  const candidates = [];
  const releasedOn = new Map();
  for (const r of releases) {
    const major = Number(r.version.split('.')[0]);
    for (const ed of cfg.editions) {
      const base = `${cfg.download_base}/${r.version}/ableton_live_${slug[ed]}_${r.version}`;
      candidates.push({ r, ed, platform: 'windows', arch: 'x64', type: 'zip', url: `${base}_64.zip` });
      candidates.push(major >= 11
        ? { r, ed, platform: 'macos', arch: 'universal', type: 'dmg', url: `${base}_universal.dmg` }
        : { r, ed, platform: 'macos', arch: 'x64', type: 'dmg', url: `${base}_64.dmg` });
    }
  }
  for (const c of candidates) releasedOn.set(c.url, c.r.date);

  // Cask-pinned files exist by definition (and carry their hash in the cache); the rest are checked.
  for (const [u, i] of caskInstaller) if (i.sha256) cache[u] = i.sha256.toLowerCase();
  const exists = await existing(candidates.map((c) => c.url).filter((u) => !caskInstaller.has(u)), cache, log, today, releasedOn);
  for (const u of caskInstaller.keys()) exists.set(u, true);

  const newest = releases[0].version;
  const uploaded = uploadDates(releases, candidates, cache);
  const versions = [];
  const totals = { windows: 0, macos: 0 };
  for (const platform of ['windows', 'macos']) {
    for (const r of releases) {
      const installers = candidates
        .filter((c) => c.r === r && c.platform === platform && exists.get(c.url) === true)
        .map((c) => {
          const ci = caskInstaller.get(c.url);
          const sha = cache[c.url];
          return {
            platform, architecture: c.arch, type: c.type, variant: `Live ${c.ed}`, url: c.url, host: new URL(c.url).hostname, filename: c.url.split('/').pop(),
            ...(sha ? { sha256: sha, ...(ci ? { checksum_source: 'Homebrew cask' } : {}) } : { no_checksum: true }),
            ...(ci?.min_os_version ? { min_os_version: ci.min_os_version } : {}),
          };
        })
        .sort((a, b) => cfg.editions.indexOf(a.variant.slice(5)) - cfg.editions.indexOf(b.variant.slice(5)) || ARCH_ORDER.indexOf(a.architecture) - ARCH_ORDER.indexOf(b.architecture));
      if (!installers.length) continue;
      totals[platform]++;
      versions.push({
        platform,
        version: r.version,
        ...(r.date || uploaded.get(r) ? { release_date: r.date || uploaded.get(r) } : {}),
        ...(r.text ? { release_notes: r.text } : {}),
        release_notes_url: `${r.page}#${r.anchor}`,
        series: r.version.split('.')[0],
        installers,
      });
    }
  }
  if (!versions.some((v) => v.version === newest)) log(`  note: the newest release (${newest}) has no downloads yet`);
  // Put the kept entries back, newest first within each platform.
  if (frozen.length) {
    versions.push(...frozen);
    for (const p of ['windows', 'macos']) totals[p] = versions.filter((v) => v.platform === p).length;
    versions.sort((a, b) => ['windows', 'macos'].indexOf(a.platform) - ['windows', 'macos'].indexOf(b.platform) || compareVersions(b.version, a.version));
  }
  return { versions, versions_total: Object.fromEntries(Object.entries(totals).filter(([, n]) => n)), stats: { eligible: releases.length, fetched: candidates.length, failed: [...exists.values()].filter((v) => v === null).length } };
}

// ------------------------------------------------------------------------------------------------ Push
async function fetchPush(cfg, ctx) {
  const { getText, cache, log, today } = ctx;
  const releases = parsePushNotes(await getText(cfg.feeds.releases));
  if (!releases.length) throw new Error('no Push release notes found');
  const newest = releases[0];

  const wanted = cfg.downloads.map((d) => ({ ...d }));
  const exists = await existing(wanted.map((d) => d.url), cache, log, today, new Map(wanted.map((d) => [d.url, newest.date])));
  const live = wanted.filter((d) => exists.get(d.url) === true);
  for (const d of wanted) if (exists.get(d.url) !== true) log(`  Push download left out (${exists.get(d.url) === false ? 'not found' : 'could not be checked'}): ${d.url}`);

  // The changelog text of the newest release, plus the next few releases, so the page shows what changed recently.
  const earlier = releases.slice(1, 1 + (cfg.earlier_releases ?? 6));
  const notes = cap([`${newest.text}`, ...earlier.map((r) => `Push ${r.version} with Live ${r.live} (${r.date})\n${r.text}`)].join('\n\n'), 6000);

  const versions = [];
  const totals = {};
  for (const platform of ['windows', 'macos']) {
    const installers = live
      .filter((d) => d.platforms.includes(platform))
      .map((d) => ({
        platform, architecture: 'neutral', type: d.type, variant: d.variant, url: d.url, host: new URL(d.url).hostname, filename: d.url.split('/').pop(),
        ...(cache[d.url] ? { sha256: cache[d.url] } : { no_checksum: true }),
      }));
    if (!installers.length) continue;
    totals[platform] = 1;
    versions.push({ platform, version: newest.version, release_date: newest.date, release_notes: notes, release_notes_url: cfg.feeds.releases, series: newest.version.split('.').slice(0, 2).join('.'), installers });
  }
  return { versions, versions_total: totals, stats: { eligible: releases.length, fetched: wanted.length, failed: wanted.length - live.length } };
}

export async function fetchSource(cfg, ctx) {
  return cfg.product === 'push' ? fetchPush(cfg, ctx) : fetchLive(cfg, ctx);
}
