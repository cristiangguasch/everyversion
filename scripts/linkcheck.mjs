#!/usr/bin/env node
// Link check for the Download buttons: finds download URLs that no longer exist so the build can disable their buttons.
//
//   node scripts/linkcheck.mjs                 check URLs that are new, were dead or unknown last time, and have no result yet
//   node scripts/linkcheck.mjs --refresh       check every download URL again (about 8,000 requests; takes a while)
//   node scripts/linkcheck.mjs --only=slug,..  just those apps
//   --jobs=N (default 10)
//
// Results go to data/links.json as { "<url>": "<status>:<YYYY-MM-DD>" }. Only HTTP 404 and 410 count as dead; a timeout, a
// 403/429 (a host that dislikes automated requests) or a server error is "unknown" and leaves the button enabled.
// The build (scripts/build.mjs) disables the button for every URL recorded as 404/410 here, and for any URL that
// scripts/verify.mjs could not download because of a 404. A URL that comes back to life is enabled again on the next check.
//
// URL set: the same buttons the pages show (the newest installers per platform, and the versions listed in the old-versions table).

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'data', 'links.json');
const PAGE_VERSIONS = 20; // keep in step with PAGE_VERSIONS in build.mjs
const argv = process.argv.slice(2);
const flags = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')).map(([k, v]) => [k, v ?? true]));
const ONLY = new Set(String(flags.only || '').split(',').filter(Boolean));
const JOBS = Number(flags.jobs) || 10;
const PER_HOST = 3;
const TODAY = new Date().toISOString().slice(0, 10);
const UA = 'Mozilla/5.0 (compatible; everyversion.net-linkcheck; +https://everyversion.net/)';

const cache = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
const status = (u) => Number(String(cache[u] || '').split(':')[0]) || 0;

// ---- which URLs
const urls = new Map(); // url -> slug (first app that uses it)
for (const f of readdirSync(join(ROOT, 'data', 'apps')).filter((x) => x.endsWith('.json'))) {
  const rec = JSON.parse(readFileSync(join(ROOT, 'data', 'apps', f), 'utf8'));
  if (ONLY.size && !ONLY.has(rec.slug)) continue;
  for (const p of rec.platforms) {
    for (const v of rec.versions.filter((x) => x.platform === p).slice(0, PAGE_VERSIONS)) {
      for (const i of v.installers) if (i.type !== 'flatpak' && /^https:\/\//.test(i.url) && !urls.has(i.url)) urls.set(i.url, rec.slug);
    }
  }
}
const todo = [...urls.keys()].filter((u) => flags.refresh || !(u in cache) || [404, 410].includes(status(u)) || !(status(u) >= 200 && status(u) < 400));

// ---- requests
async function probe(url, method, headers = {}) {
  const res = await fetch(url, { method, headers: { 'user-agent': UA, ...headers }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  res.body?.cancel?.().catch(() => {});
  return res.status;
}
async function check(url) {
  try {
    let s = await probe(url, 'HEAD');
    // Many hosts answer HEAD with 404/403/405 but serve the file; ask for one byte with GET before calling it dead.
    if ([400, 403, 404, 405, 501].includes(s)) s = await probe(url, 'GET', { range: 'bytes=0-0' });
    return s;
  } catch {
    return 0; // timeout or network error: unknown
  }
}

const busy = new Map(); // host -> running requests
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let done = 0;
let dead = 0;
let flip = 0;
const queue = [...todo].sort(() => Math.random() - 0.5); // spread hosts out
async function worker() {
  while (queue.length) {
    const i = queue.findIndex((u) => (busy.get(new URL(u).host) || 0) < PER_HOST);
    if (i === -1) { await wait(100); continue; }
    const [url] = queue.splice(i, 1);
    const host = new URL(url).host;
    busy.set(host, (busy.get(host) || 0) + 1);
    const before = status(url);
    const s = await check(url);
    busy.set(host, busy.get(host) - 1);
    cache[url] = `${s}:${TODAY}`;
    if ([404, 410].includes(s)) { dead++; console.log(`  ${s} ${urls.get(url)}: ${url}`); }
    else if ([404, 410].includes(before)) { flip++; console.log(`  back to ${s} ${urls.get(url)}: ${url}`); }
    if (++done % 250 === 0) { console.log(`  ${done}/${todo.length} checked, ${dead} dead so far`); writeFileSync(FILE, JSON.stringify(cache) + '\n'); }
  }
}

console.log(`link check: ${urls.size} download URLs, ${todo.length} to check${flags.refresh ? ' (full refresh)' : ''}`);
if (todo.length) await Promise.all(Array.from({ length: JOBS }, worker));
// Forget URLs that no app lists any more, so the file does not grow forever (only on a full run).
if (!ONLY.size) for (const u of Object.keys(cache)) if (!urls.has(u)) delete cache[u];
const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(FILE, JSON.stringify(sorted) + '\n');
const deadNow = Object.entries(sorted).filter(([u, v]) => urls.has(u) && [404, 410].includes(Number(v.split(':')[0]))).length;
const unknown = Object.entries(sorted).filter(([u, v]) => urls.has(u) && !(Number(v.split(':')[0]) >= 200 && Number(v.split(':')[0]) < 400) && ![404, 410].includes(Number(v.split(':')[0]))).length;
console.log(`✓ checked ${todo.length}: ${deadNow} dead (404/410, buttons disabled), ${unknown} unknown (left enabled)${flip ? `, ${flip} came back` : ''}`);
