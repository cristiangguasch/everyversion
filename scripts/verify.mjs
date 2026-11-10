#!/usr/bin/env node
// Independent verification (level 1). For the first N apps (alphabetical, same order as the home page):
// downloads the latest installers from their publisher hosts, re-computes SHA-256, compares with the
// upstream manifest value, and checks the code signature (macOS: codesign; Windows: osslsigncode).
// Files are deleted right after each check. Output: data/verification.json (merged into the site by build.mjs).
//   node scripts/verify.mjs [count=10]      first N apps
//   node scripts/verify.mjs slug1 slug2     only those apps (results for other apps are kept)
//   node scripts/verify.mjs --resign-from=DIR  re-check signatures only, using already-downloaded files named <slug>__<filename> in DIR
//   options: --skip=N (skip first N apps) --max-mb=M (leave apps with any installer larger than M MB unchecked) --jobs=K (apps in parallel)
// An app is recorded as verified only if EVERY latest installer was downloaded and checked. Otherwise it stays at level 0
// and data/verification.json records why (skipped: true).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'verification.json');
const OPT = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const SKIP = Number(OPT.skip || 0);
const MAX_BYTES = OPT['max-mb'] ? Number(OPT['max-mb']) * 1e6 : Infinity;
const JOBS = Number(OPT.jobs || 1);
const SLUGS = ARGS.length && Number.isNaN(Number(ARGS[0])) ? ARGS : null;
const COUNT = SLUGS ? Infinity : Number(ARGS[0] || 10);
const WORK = process.env.VERIFY_TMP || join(tmpdir(), 'everyversion-verify');
mkdirSync(WORK, { recursive: true });

const recs = readdirSync(join(ROOT, 'data', 'apps'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(ROOT, 'data', 'apps', f), 'utf8')))
  .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  .filter((r) => !SLUGS || SLUGS.includes(r.slug))
  .slice(SKIP, SKIP + COUNT);

// Windows roots for osslsigncode come from the macOS system trust store.
const ROOTS = join(WORK, 'roots.pem');
// System roots plus vetted extras in data/roots (fingerprints documented in data/roots/README.md).
let rootsPem = execFileSync('security', ['find-certificate', '-a', '-p', '/System/Library/Keychains/SystemRootCertificates.keychain'], { maxBuffer: 1 << 26 }).toString();
const EXTRA = join(ROOT, 'data', 'roots');
if (existsSync(EXTRA)) {
  for (const f of readdirSync(EXTRA).filter((n) => n.endsWith('.crt'))) {
    rootsPem += '\n' + execFileSync('openssl', ['x509', '-inform', 'DER', '-in', join(EXTRA, f)]).toString();
  }
}
writeFileSync(ROOTS, rootsPem);

const sha256 = (f) =>
  new Promise((res, rej) => {
    const h = createHash('sha256');
    createReadStream(f).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej);
  });

// Installers are not always named with an extension (e.g. "getInstaller"), so detect the type from the content.
function kindOf(file, name) {
  const ext = name.toLowerCase().split('.').pop();
  if (['dmg', 'pkg', 'exe', 'msi'].includes(ext)) return ext;
  const t = spawnSync('file', ['-b', file], { encoding: 'utf8' }).stdout;
  if (/PE32|MS-DOS executable/i.test(t)) return 'exe';
  if (/Composite Document File|MSI/i.test(t)) return 'msi';
  if (/zlib compressed|disk image|Apple Driver Map|bzip2|Macintosh HFS/i.test(t)) return 'dmg';
  if (/xar archive/i.test(t)) return 'pkg';
  if (/Mach-O|Zip archive/i.test(t)) return /Mach-O/.test(t) ? 'macho' : 'zip';
  return ext;
}

function signature(file, name) {
  const ext = kindOf(file, name);
  if (ext === 'macho') {
    const r = spawnSync('codesign', ['--verify', '--strict', '-vv', file], { encoding: 'utf8' });
    const out = (r.stderr + r.stdout).trim().split('\n').slice(0, 2).join(' | ');
    return { tool: 'codesign', status: r.status === 0 ? 'valid' : /not signed/i.test(out) ? 'unsigned' : 'invalid', detail: out };
  }
  if (ext === 'dmg' || ext === 'pkg') {
    const r = spawnSync('codesign', ['--verify', '--strict', '-vv', file], { encoding: 'utf8' });
    const out = (r.stderr + r.stdout).trim().split('\n').slice(0, 2).join(' | ');
    return { tool: 'codesign', status: r.status === 0 ? 'valid' : /not signed/i.test(out) ? 'unsigned' : 'invalid', detail: out };
  }
  if (ext === 'exe' || ext === 'msi') {
    const r = spawnSync('osslsigncode', ['verify', '-in', file, '-CAfile', ROOTS, '-TSA-CAfile', ROOTS], { encoding: 'utf8' });
    const out = r.stdout + r.stderr;
    const ok = /Signature verification: ok/i.test(out);
    const none = /No signature found|no signature/i.test(out);
    const signer = /Subject: .*?CN=([^,\n]+)/.exec(out)?.[1];
    return { tool: 'osslsigncode', status: ok ? 'valid' : none ? 'unsigned' : 'invalid', detail: ok ? `signed by ${signer || 'unknown signer'}` : out.trim().split('\n').slice(-2).join(' | ') };
  }
  return { tool: null, status: 'not-applicable', detail: `${ext} files carry no embedded signature` };
}

const results = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const save = () => writeFileSync(OUT, JSON.stringify(results, null, 2) + '\n');
const today = new Date().toISOString().slice(0, 10);

async function sizeOf(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(30000) });
    return Number(r.headers.get('content-length')) || null;
  } catch {
    return null;
  }
}

async function verifyApp(rec) {
  const targets = [];
  const seen = new Set();
  for (const p of rec.platforms) {
    const v = rec.versions.find((x) => x.platform === p);
    for (const i of v.installers) if (i.type !== 'flatpak' && !seen.has(i.url)) (seen.add(i.url), targets.push({ p, v, i }));
  }
  // Decide before downloading anything: one oversized installer leaves the whole app unchecked.
  for (const { i } of targets) {
    const size = await sizeOf(i.url);
    if (size && size > MAX_BYTES) {
      console.log(`${rec.name}: SKIPPED (${i.filename} is ${(size / 1e6).toFixed(0)} MB)`);
      results[rec.slug] = { checked_at: today, skipped: true, reason: `installer larger than ${MAX_BYTES / 1e6} MB: ${i.filename} (${(size / 1e6).toFixed(0)} MB)` };
      return save();
    }
  }
  const items = [];
  // A download we already checked (same URL, same expected hash, checked in the last 90 days, hash computed) is not downloaded again,
  // so adding one new file to an app does not mean re-downloading the others. `--recheck` forces a full re-download.
  const earlier = results[rec.slug];
  const fresh = earlier?.installers && !('recheck' in OPT) && (Date.parse(today) - Date.parse(earlier.checked_at)) / 86400000 <= 90;
  for (const { p, v, i } of targets) {
    const old = fresh && earlier.installers.find((x) => x.url === i.url && x.platform === p && x.computed_sha256 && x.hash !== 'MISMATCH' && (x.expected_sha256 || null) === (i.sha256 || null));
    if (old) {
      console.log(`${rec.name} ${p} ${i.filename} ... reused earlier check (${old.hash} / ${old.signature.status})`);
      items.push(old);
      continue;
    }
    const file = join(WORK, `${rec.slug}-${p}-${i.filename.replace(/[^\w.-]/g, '_')}`);
    const item = { platform: p, version: v.version, filename: i.filename, url: i.url, expected_sha256: i.sha256 || null };
    try {
      const args = ['-fsSL', '--retry', '3', '--max-time', '1800', '-o', file];
      if (Number.isFinite(MAX_BYTES)) args.push('--max-filesize', String(MAX_BYTES));
      execFileSync('curl', [...args, i.url], { stdio: 'pipe' });
      item.computed_sha256 = await sha256(file);
      item.hash = !item.expected_sha256 ? 'no-upstream-hash' : item.computed_sha256 === item.expected_sha256.toLowerCase() ? 'match' : 'MISMATCH';
      item.signature = signature(file, i.filename);
    } catch (e) {
      item.hash = 'download-failed';
      item.error = String(e.stderr || e.message).split('\n')[0];
      item.signature = { tool: null, status: 'not-checked', detail: 'download failed' };
    } finally {
      rmSync(file, { force: true });
    }
    console.log(`${rec.name} ${p} ${i.filename} ... ${item.hash} / ${item.signature.status}`);
    items.push(item);
  }
  const failed = items.filter((x) => x.hash === 'download-failed');
  if (failed.length) {
    console.log(`${rec.name}: LEFT UNCHECKED (${failed.length} of ${items.length} downloads failed: ${failed[0].error})`);
    results[rec.slug] = { checked_at: today, skipped: true, reason: `${failed.length} of ${items.length} downloads failed: ${failed[0].error}`, installers_attempted: items };
  } else {
    results[rec.slug] = { checked_at: today, installers: items };
  }
  save();
}

if (OPT['resign-from']) {
  const dir = OPT['resign-from'];
  let changed = 0;
  for (const [slug, entry] of Object.entries(results)) {
    for (const it of entry.installers || []) {
      const f = join(dir, `${slug}__${it.filename.replace(/[^\w.-]/g, '_')}`);
      if (it.signature.status !== 'invalid' || !existsSync(f)) continue;
      const before = it.signature.status;
      it.signature = signature(f, it.filename);
      it.hash_rechecked = await sha256(f) === it.computed_sha256;
      console.log(`${slug} ${it.filename}: ${before} -> ${it.signature.status}${it.hash_rechecked ? '' : ' (FILE HASH CHANGED)'}`);
      changed++;
    }
  }
  save();
  console.log(`re-checked ${changed} signatures ->`, OUT);
  process.exit(0);
}

const queue = [...recs];
await Promise.all(Array.from({ length: JOBS }, async () => { while (queue.length) await verifyApp(queue.shift()); }));
console.log('done ->', OUT);
