// App screenshots from Flathub (the only source we use that publishes them: winget and Homebrew casks have no screenshot field).
//
// For every app matched to Flathub, reads https://flathub.org/api/v2/appstream/<id>, takes up to MAX screenshots in Flathub's order
// (its default one first), downloads the largest size up to 1400px wide and saves it as WebP, at most 1200px wide, in
// data/screenshots/<slug>/screenshot-01.webp, -02, … The build copies them to /<slug>/screenshot-01.webp.
//
// Made once: data/screenshots.json keeps a hash of the Flathub image URLs per app, and an app is only fetched again when that list
// changes (or with --force). These are pictures of the Linux version, and the page credits Flathub.
//
//   node scripts/screenshots.mjs                 every Flathub app that is new or changed
//   node scripts/screenshots.mjs --only=vlc,gimp only these slugs
//   node scripts/screenshots.mjs --force         fetch again even when nothing changed
//
// Needs ImageMagick (`magick`) for the WebP conversion.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'data', 'screenshots');
const INDEX = join(ROOT, 'data', 'screenshots.json');
const MAX = 8; // a few show what the app looks like; more is noise
const MAX_WIDTH = 1200;

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const only = args.only ? new Set(String(args.only).split(',').map((s) => s.trim())) : null;

const index = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : {};
const saveIndex = () => writeFileSync(INDEX, JSON.stringify(Object.fromEntries(Object.entries(index).sort()), null, 2) + '\n');
const num = (i) => String(i + 1).padStart(2, '0');

// The biggest size that is not huge: the original is often 2-4k wide, which we would only shrink anyway.
function pickSize(sizes) {
  const list = (sizes || []).map((s) => ({ ...s, w: Number(s.width) || 0 })).filter((s) => /^https:\/\//.test(s.src || ''));
  const fit = list.filter((s) => s.w && s.w <= 1400).sort((a, b) => b.w - a.w)[0];
  return fit || list.sort((a, b) => a.w - b.w)[0] || null;
}

async function get(url, as = 'json') {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'everyversion-screenshots/1.0' }, signal: AbortSignal.timeout(30000) });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return as === 'json' ? r.json() : Buffer.from(await r.arrayBuffer());
    } catch (e) {
      if (attempt >= 3) throw e;
      await new Promise((ok) => setTimeout(ok, 1500 * attempt));
    }
  }
}

const apps = readdirSync(join(ROOT, 'data', 'apps')).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(join(ROOT, 'data', 'apps', f), 'utf8')))
  .filter((r) => r.ids?.flathub && (!only || only.has(r.slug)));

const work = mkdtempSync(join(tmpdir(), 'ev-shots-')); // downloads land here, apart from the scripts
let fetched = 0, kept = 0, none = 0, failed = 0;
try {
  for (const rec of apps) {
    let meta;
    try { meta = await get(`https://flathub.org/api/v2/appstream/${encodeURIComponent(rec.ids.flathub)}`); } catch (e) { console.warn(`  ${rec.slug}: Flathub data failed (${e.message})`); failed++; continue; }
    const picks = (meta?.screenshots || []).map((s) => ({ size: pickSize(s.sizes), caption: typeof s.caption === 'string' ? s.caption.trim() : '' })).filter((s) => s.size).slice(0, MAX);
    if (!picks.length) { if (index[rec.slug]) delete index[rec.slug]; none++; continue; }
    const hash = createHash('sha256').update(picks.map((p) => p.size.src).join('\n')).digest('hex').slice(0, 16);
    const dir = join(DIR, rec.slug);
    const have = index[rec.slug];
    if (!args.force && have?.hash === hash && have.items.every((it) => existsSync(join(dir, it.file)))) { kept++; continue; }

    const items = [];
    try {
      for (const [i, p] of picks.entries()) {
        const raw = join(work, `${rec.slug}-${num(i)}.img`);
        writeFileSync(raw, await get(p.size.src, 'buffer'));
        const out = join(work, `screenshot-${num(i)}.webp`);
        // First frame only, sRGB, no metadata, shrink (never enlarge) to MAX_WIDTH.
        execFileSync('magick', [`${raw}[0]`, '-auto-orient', '-colorspace', 'sRGB', '-strip', '-resize', `${MAX_WIDTH}x>`, '-quality', '82', `webp:${out}`]);
        const [w, h] = execFileSync('magick', ['identify', '-format', '%w %h', out]).toString().trim().split(' ').map(Number);
        items.push({ file: `screenshot-${num(i)}.webp`, width: w, height: h, ...(p.caption ? { caption: p.caption } : {}), source: p.size.src, tmp: out });
      }
    } catch (e) { console.warn(`  ${rec.slug}: download failed (${e.message})`); failed++; continue; }

    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    for (const it of items) { writeFileSync(join(dir, it.file), readFileSync(it.tmp)); rmSync(it.tmp); delete it.tmp; }
    index[rec.slug] = { hash, flathub: rec.ids.flathub, page: `https://flathub.org/apps/${rec.ids.flathub}`, fetched: new Date().toISOString().slice(0, 10), items };
    saveIndex(); // after every app, so an interrupted run keeps what it fetched
    fetched++;
    console.log(`${rec.slug}: ${items.length} screenshot(s)`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
  saveIndex();
}
console.log(`screenshots: ${fetched} app(s) fetched, ${kept} unchanged, ${none} with none on Flathub, ${failed} failed`);
if (failed) process.exitCode = 1;
