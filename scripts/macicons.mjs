#!/usr/bin/env node
// Download ONE macOS file per app (the one Homebrew's cask lists), take the app's own icon out of it, and keep it
// as data/icons/<slug>.png. The download is deleted straight away. Nothing from it is run.
//
//   node scripts/macicons.mjs --all            every app that has a Mac build
//   node scripts/macicons.mjs slug1 slug2      only those apps
//   node scripts/macicons.mjs --missing        only apps that still have no icon or just the generic GitHub mark (add slugs to limit it)
//   options: --jobs=2   (parallel downloads)
//
// File choice: universal build, else Apple silicon, else Intel; disk image, then ZIP, then installer package.
// Result and provenance go to data/icons.json (source "macos-app-bundle"). Apps that fail keep their current icon.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMacIcon } from './lib/macicon.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = join(ROOT, 'data', 'icons');
const INDEX = join(ROOT, 'data', 'icons.json');
const WORK = process.env.ICON_TMP || join(tmpdir(), 'everyversion-icons');
const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const only = args.filter((a) => !a.startsWith('--'));
const JOBS = Number(opt.jobs || 2);

const ARCH = { universal: 0, arm64: 1, x64: 2 };
const TYPE = { dmg: 0, zip: 1, pkg: 2, tar: 3 };
export function macFileFor(rec) {
  const v = rec.versions.find((x) => x.platform === 'macos');
  if (!v) return null;
  return [...v.installers].sort((a, b) => (ARCH[a.architecture] ?? 9) - (ARCH[b.architecture] ?? 9) || (TYPE[a.type] ?? 9) - (TYPE[b.type] ?? 9))[0];
}

const casks = (() => {
  try {
    return new Map(JSON.parse(readFileSync(join(ROOT, '.cache', 'homebrew-cask', 'cask.json'), 'utf8')).map((c) => [c.token, c]));
  } catch {
    return new Map();
  }
})();
// The cask says which .app it installs; that is the app whose icon we want.
const appNames = (token) => (casks.get(token)?.artifacts || []).flatMap((a) => (a.app ? a.app.filter((x) => typeof x === 'string') : []));

const current = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : {};
const needsIcon = (slug) => !current[slug] || current[slug].source === 'github-project'; // never replace a real icon
const recs = readdirSync(join(ROOT, 'data', 'apps'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(ROOT, 'data', 'apps', f), 'utf8')))
  .filter((r) => ('all' in opt || ('missing' in opt && !only.length) || only.includes(r.slug)) && (!('missing' in opt) || needsIcon(r.slug)) && r.platforms.includes('macos'));

mkdirSync(ICONS, { recursive: true });
mkdirSync(WORK, { recursive: true });
const index = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : {};
const save = () => writeFileSync(INDEX, JSON.stringify(index, null, 2) + '\n');

async function one(rec) {
  const inst = macFileFor(rec);
  const label = rec.name.padEnd(32);
  const file = join(WORK, `${rec.slug}.download`);
  try {
    execFileSync('curl', ['-fsSL', '--retry', '3', '--max-time', '1800', '-o', file, inst.url], { stdio: 'pipe' });
    const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
    const got = extractMacIcon(file, { appHint: [...appNames(rec.ids.homebrew_cask), rec.name], workDir: WORK });
    if (got.error) {
      console.log(`${label} no icon: ${got.error}`);
      return;
    }
    const out = `${rec.slug}.png`;
    writeFileSync(join(ICONS, out), got.png);
    index[rec.slug] = { file: out, source: 'macos-app-bundle', cask: rec.ids.homebrew_cask, app: got.app, how: got.how, url: inst.url, sha256: sha, ext: 'png', bytes: got.png.length, fetched_at: new Date().toISOString().slice(0, 10) };
    save();
    console.log(`${label} ${got.app} via ${got.how} (${got.png.length} bytes)  [${inst.architecture} ${inst.type}]`);
  } catch (e) {
    console.log(`${label} error: ${String(e.stderr || e.message).split('\n')[0]}`);
  } finally {
    rmSync(file, { force: true });
  }
}

const queue = [...recs];
console.log(`${recs.length} app(s)`);
await Promise.all(Array.from({ length: JOBS }, async () => { while (queue.length) await one(queue.shift()); }));
console.log('done');
