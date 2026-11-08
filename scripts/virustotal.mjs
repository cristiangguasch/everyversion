#!/usr/bin/env node
// Look up every latest installer on VirusTotal by SHA-256 and store the real scan statistics.
// Nothing is uploaded: this only asks VirusTotal whether it already has a report for the hash.
//
//   node scripts/virustotal.mjs            (reads VT_API_KEY from the environment or from .env)
//   VT_API_KEY=<your key> node scripts/virustotal.mjs [--limit=N] [--per-minute=4] [--refresh-flagged]
//   --refresh-flagged re-fetches files that were flagged but have no stored engine labels yet.
//
// Output: data/virustotal.json  { "<sha256>": { fetched_at, found, scanned_at, stats, detections? } }
// detections (only when an engine flagged the file): [{ engine, category, result }] exactly as VirusTotal reports them.
// Resumable: hashes already stored are skipped (delete an entry to refresh it).
// The free VirusTotal API allows about 4 requests per minute, so a full run of ~300 files takes over an hour.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'virustotal.json');
// The key comes from the environment or from a private .env file in the project root (git-ignored).
if (!process.env.VT_API_KEY && existsSync(join(ROOT, '.env'))) {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = /^\s*VT_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
    if (m) process.env.VT_API_KEY = m[1].replace(/^["']|["']$/g, '');
  }
}
const KEY = process.env.VT_API_KEY;
if (!KEY) {
  console.error('Set VT_API_KEY (a free key from https://www.virustotal.com/gui/my-apikey).');
  process.exit(1);
}
const OPT = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const LIMIT = Number(OPT.limit || Infinity);
const GAP_MS = Math.ceil(60000 / Number(OPT['per-minute'] || 4)) + 500;

// Prefer the hash we re-computed ourselves; fall back to the upstream manifest value.
const verification = existsSync(join(ROOT, 'data', 'verification.json')) ? JSON.parse(readFileSync(join(ROOT, 'data', 'verification.json'), 'utf8')) : {};
const computed = new Map();
for (const e of Object.values(verification)) for (const i of e.installers || []) if (i.computed_sha256) computed.set(i.url, i.computed_sha256);

const hashes = new Set();
for (const f of readdirSync(join(ROOT, 'data', 'apps')).filter((n) => n.endsWith('.json'))) {
  const rec = JSON.parse(readFileSync(join(ROOT, 'data', 'apps', f), 'utf8'));
  for (const p of rec.platforms) {
    const v = rec.versions.find((x) => x.platform === p);
    for (const i of v.installers) {
      const h = (computed.get(i.url) || i.sha256 || '').toLowerCase();
      if (/^[0-9a-f]{64}$/.test(h)) hashes.add(h);
    }
  }
}

const results = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const needsLabels = (r) => r?.found && (r.stats.malicious || 0) + (r.stats.suspicious || 0) > 0 && !r.detections;
if ('refresh-flagged' in OPT) for (const h of hashes) if (needsLabels(results[h])) delete results[h];
const pending = [...hashes].filter((h) => !results[h]);
const todo = pending.slice(0, LIMIT);
console.log(`${hashes.size} unique hashes, ${hashes.size - pending.length} already stored, ${todo.length} to look up now`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;
for (const h of todo) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://www.virustotal.com/api/v3/files/${h}`, { headers: { 'x-apikey': KEY, accept: 'application/json' } });
    if (res.status === 429) {
      console.log('rate limited, waiting 60s');
      await sleep(60000);
      continue;
    }
    if (res.status === 404) {
      results[h] = { fetched_at: new Date().toISOString().slice(0, 10), found: false };
    } else if (res.ok) {
      const a = (await res.json()).data.attributes;
      results[h] = {
        fetched_at: new Date().toISOString().slice(0, 10),
        found: true,
        scanned_at: a.last_analysis_date ? new Date(a.last_analysis_date * 1000).toISOString().slice(0, 10) : null,
        stats: a.last_analysis_stats,
        ...((a.last_analysis_stats.malicious || 0) + (a.last_analysis_stats.suspicious || 0) > 0
          ? { detections: Object.entries(a.last_analysis_results || {}).filter(([, v]) => v.category === 'malicious' || v.category === 'suspicious').map(([engine, v]) => ({ engine, category: v.category, result: v.result })) }
          : {}),
      };
    } else {
      console.error(`${h}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
      if (res.status === 401 || res.status === 403) process.exit(1);
    }
    break;
  }
  const r = results[h];
  console.log(`${++n}/${todo.length} ${h.slice(0, 12)} ${r ? (r.found ? `malicious ${r.stats.malicious}, suspicious ${r.stats.suspicious}, harmless ${r.stats.harmless}, undetected ${r.stats.undetected}` : 'not on VirusTotal') : 'no result'}`);
  writeFileSync(OUT, JSON.stringify(results, null, 1) + '\n');
  await sleep(GAP_MS);
}
console.log('done ->', OUT);
