#!/usr/bin/env node
// Ingest winget-pkgs manifests -> data/apps/<slug>.json
//
// - Uses a blobless/treeless, depth-1, sparse clone of microsoft/winget-pkgs in
//   .cache/ (no API rate limits, only the folders we need are checked out).
// - Pure extraction: every field is copied or mechanically normalised from the
//   manifests. No LLM, no network calls to vendors, no invented values.
// - Idempotent: a record's provenance only changes when its content changes, so
//   re-running produces no diff unless upstream changed.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { feedPartsOf, mergeFeed } from './lib/supplement.mjs';
import { compareVersions } from './lib/version.mjs';
import { loadCasks, normaliseCask, suggestCask } from './lib/cask.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, '.cache', 'winget-pkgs');
const DATA = join(ROOT, 'data', 'apps');
const REPO = 'https://github.com/microsoft/winget-pkgs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean); // re-read just these winget IDs
const NEW_ONLY = args.includes('--new') || ONLY.length > 0; // only ingest config entries that have no record yet; leave everything else untouched
const LIMIT = opt('limit', 100000);
const MAX_VERSIONS = opt('max-versions', 100);

const RESERVED = new Set(['index', 'api', 'assets', 'about', 'sitemap', 'robots', 'llms', 'search', 'changes', 'status', 'schema', '404', 'security', 'contact', 'legal', 'windows', 'mac', 'macos', 'linux', 'stats', 'statistics']);

const git = (...a) => execFileSync('git', ['-C', CACHE, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// ---------------------------------------------------------------- config

function readConfig() {
  const out = [];
  for (const raw of readFileSync(join(ROOT, 'config', 'apps.txt'), 'utf8').split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [id, ...rest] = line.split(/\s+/);
    const slugTok = rest.find((t) => t.startsWith('slug='));
    const nameTok = rest.find((t) => t.startsWith('name='));
    const formerlyTok = rest.find((t) => t.startsWith('formerly='));
    const previousTok = rest.find((t) => t.startsWith('previous='));
    out.push({
      id,
      curatedPricing: rest.find((t) => !t.startsWith('slug=') && !t.startsWith('name=') && !t.startsWith('formerly=') && !t.startsWith('previous=') && !t.startsWith('cask=') && !t.startsWith('flathub=')) || null,
      slugOverride: slugTok ? slugTok.slice(5) : null,
      nameOverride: nameTok ? nameTok.slice(5).replace(/_/g, ' ') : null, // name=Threema_Web -> "Threema Web"
      formerly: formerlyTok ? formerlyTok.slice(9).replace(/_/g, ' ') : null, // formerly=SQLiteStudio -> "Letos (formerly SQLiteStudio)" in H1 and title
      previous: previousTok ? previousTok.slice(9).split(',').filter(Boolean) : [], // previous=PawelSalawa.SQLiteStudio: the winget ID(s) the app had before a rename; their versions join this page
      cask: (rest.find((t) => t.startsWith('cask=')) || '').slice(5) || null,
    });
  }
  return out;
}

const manifestDir = (id) => `manifests/${id[0].toLowerCase()}/${id.split('.').join('/')}`;

// ---------------------------------------------------------------- git cache

function syncCache(paths) {
  if (!existsSync(join(CACHE, '.git'))) {
    mkdirSync(dirname(CACHE), { recursive: true });
    execFileSync('git', ['clone', '--filter=tree:0', '--depth=1', '--no-checkout', '--sparse', `${REPO}.git`, CACHE], { stdio: 'inherit' });
  } else {
    git('fetch', '--depth=1', '--filter=tree:0', 'origin', 'master');
  }
  git('checkout', '-q', '-f', 'FETCH_HEAD');
  git('sparse-checkout', 'set', '--cone', ...paths);
  return git('rev-parse', 'HEAD');
}

// ---------------------------------------------------------------- helpers

const slugify = (s) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\+/g, ' plus ')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const asDate = (v) => {
  if (v == null) return undefined;
  const s = v instanceof Date ? v.toISOString() : String(v);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : undefined;
};

const str = (v) => (v == null ? undefined : String(v).trim() || undefined);
const list = (v) => (Array.isArray(v) && v.length ? v.map(String) : undefined);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length)));

function readYaml(file) {
  try {
    return YAML.parse(readFileSync(file, 'utf8'), { uniqueKeys: false });
  } catch (e) {
    console.warn(`  ! cannot parse ${file.replace(CACHE + '/', '')}: ${e.message.split('\n')[0]}`);
    return null;
  }
}

const SPDX = new Set([
  'MIT', 'Apache-2.0', 'GPL-2.0', 'GPL-2.0-only', 'GPL-2.0-or-later', 'GPL-3.0', 'GPL-3.0-only', 'GPL-3.0-or-later',
  'LGPL-2.1', 'LGPL-2.1-only', 'LGPL-2.1-or-later', 'LGPL-3.0', 'LGPL-3.0-only', 'LGPL-3.0-or-later', 'AGPL-3.0',
  'AGPL-3.0-only', 'AGPL-3.0-or-later', 'BSD-2-Clause', 'BSD-3-Clause', 'MPL-2.0', 'ISC', 'Zlib', 'Unlicense', 'CC0-1.0',
  'EPL-1.0', 'EPL-2.0', 'BSL-1.0', '0BSD', 'Python-2.0', 'PostgreSQL', 'Artistic-2.0', 'MS-PL', 'MS-RL', 'OFL-1.1', 'WTFPL',
]);
const OSS_RE = /(?<![A-Za-z])(MIT|Apache|GPL|LGPL|AGPL|BSD|MPL|Mozilla Public|ISC|Zlib|PSF|Unlicense|CC0|EPL|Eclipse Public|BSL-1\.0|Boost|PostgreSQL|Artistic|MS-PL|MS-RL|Open Source)/i;
const NOT_OSS_RE = /non-?commercial|proprietary|source[- ]available|BUSL|business source|SSPL|elastic|commons clause|trial|shareware/i;

function derivePricing(licenseName, curated) {
  if (licenseName && OSS_RE.test(licenseName) && !NOT_OSS_RE.test(licenseName)) return { status: 'open-source', source: 'derived-from-license' };
  if (licenseName && /freeware/i.test(licenseName)) return { status: 'freeware', source: 'derived-from-license' };
  if (curated === 'free-to-download') return { status: 'free-to-download', source: 'curated' };
  return { status: 'unknown', source: 'none' };
}

const ISSUES_RE = /^https?:\/\/(www\.)?(github\.com|gitlab\.com|bitbucket\.org|codeberg\.org)\/[^/]+\/[^/]+\/(-\/)?issues\/?(\?.*)?$/i;

function normaliseInstaller(top, inst) {
  const m = { ...top, ...inst };
  const url = str(m.InstallerUrl);
  const sha = str(m.InstallerSha256)?.toLowerCase();
  if (!url || !sha || !/^[0-9a-f]{64}$/.test(sha)) return null;

  let host;
  let filename;
  try {
    const u = new URL(url);
    host = u.hostname;
    filename = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '') || host;
  } catch {
    return null;
  }

  const sw = { ...(top.InstallerSwitches || {}), ...(inst.InstallerSwitches || {}) };
  const deps = m.Dependencies || {};
  const arch = String(m.Architecture || '').toLowerCase();
  const scope = str(m.Scope)?.toLowerCase();
  const sig = str(m.SignatureSha256)?.toLowerCase();

  return clean({
    platform: 'windows',
    architecture: ['x86', 'x64', 'arm', 'arm64', 'neutral'].includes(arch) ? arch : 'neutral',
    type: str(m.InstallerType)?.toLowerCase() || 'unknown',
    nested_type: str(m.NestedInstallerType)?.toLowerCase(),
    scope: scope === 'user' || scope === 'machine' ? scope : undefined,
    locale: str(m.InstallerLocale),
    url,
    host,
    filename,
    sha256: sha,
    signature_sha256: sig && /^[0-9a-f]{64}$/.test(sig) ? sig : undefined,
    product_code: str(m.ProductCode),
    min_os_version: str(m.MinimumOSVersion),
    elevation_requirement: str(m.ElevationRequirement),
    install_modes: list(m.InstallModes),
    switches: (() => {
      const s = clean({
        silent: str(sw.Silent),
        silent_with_progress: str(sw.SilentWithProgress),
        interactive: str(sw.Interactive),
        install_location: str(sw.InstallLocation),
        log: str(sw.Log),
        upgrade: str(sw.Upgrade),
        custom: str(sw.Custom),
      });
      return Object.keys(s).length ? s : undefined;
    })(),
    upgrade_behavior: str(m.UpgradeBehavior),
    protocols: list(m.Protocols),
    file_extensions: list(m.FileExtensions),
    commands: list(m.Commands),
    dependencies: (() => {
      const d = clean({
        windows_features: list(deps.WindowsFeatures),
        windows_libraries: list(deps.WindowsLibraries),
        packages: list((deps.PackageDependencies || []).map((p) => p.PackageIdentifier)),
      });
      return Object.keys(d).length ? d : undefined;
    })(),
    apps_and_features: Array.isArray(m.AppsAndFeaturesEntries) && m.AppsAndFeaturesEntries.length
      ? m.AppsAndFeaturesEntries.map((e) =>
          clean({
            display_name: str(e.DisplayName),
            publisher: str(e.Publisher),
            display_version: str(e.DisplayVersion),
            product_code: str(e.ProductCode),
            upgrade_code: str(e.UpgradeCode),
            installer_type: str(e.InstallerType)?.toLowerCase(),
          }),
        )
      : undefined,
  });
}

/** Read one version folder. Returns { version, locale, installers } or null. */
function readVersion(id, appDir, dirName) {
  const dir = join(appDir, dirName);
  const docs = readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => ({ f, d: readYaml(join(dir, f)) }))
    .filter((x) => x.d && x.d.PackageIdentifier === id);

  const byType = (t) => docs.filter((x) => x.d.ManifestType === t).map((x) => x.d);
  const single = byType('singleton')[0];
  const installerDoc = byType('installer')[0] || single;
  if (!installerDoc) return null;
  const versionDoc = byType('version')[0];
  const defaultLocale = versionDoc?.DefaultLocale;
  const localeDoc =
    byType('defaultLocale')[0] ||
    single ||
    docs.map((x) => x.d).find((d) => d.ManifestType === 'locale' && d.PackageLocale === defaultLocale);

  const { Installers = [], ...top } = installerDoc;
  const installers = Installers.map((i) => normaliseInstaller(top, i)).filter(Boolean);
  if (!installers.length) return null;

  const dates = [top.ReleaseDate, ...Installers.map((i) => i.ReleaseDate)].map(asDate).filter(Boolean).sort();

  return {
    version: String(installerDoc.PackageVersion ?? dirName),
    locale: localeDoc || {},
    manifestVersion: str(installerDoc.ManifestVersion),
    releaseDate: dates.at(-1),
    installers,
    dir: `${manifestDir(id)}/${dirName}`,
  };
}

function readApp(id, curatedPricing, slugFor, slugOverride, nameOverride, formerly, previous = []) {
  const appDir = join(CACHE, manifestDir(id));
  if (!existsSync(appDir)) return { missing: true };

  const dirs = readdirSync(appDir)
    .filter((n) => statSync(join(appDir, n)).isDirectory() && existsSync(join(appDir, n, `${id}.yaml`)))
    .sort((a, b) => compareVersions(b, a));
  if (!dirs.length) return { missing: true };

  const versions = [];
  for (const d of dirs) {
    if (versions.length >= MAX_VERSIONS) break;
    const v = readVersion(id, appDir, d);
    if (v) versions.push(v);
  }
  if (!versions.length) return { missing: true };
  // After a rename with a new winget ID, the old ID's versions join the page. Each keeps its own ID (for `winget install --id`),
  // and a version number the new ID already has is not repeated.
  let totalDirs = dirs.length;
  for (const pid of previous) {
    const pDir = join(CACHE, manifestDir(pid));
    if (!existsSync(pDir)) continue;
    const pDirs = readdirSync(pDir)
      .filter((n) => statSync(join(pDir, n)).isDirectory() && existsSync(join(pDir, n, `${pid}.yaml`)))
      .filter((n) => !dirs.includes(n))
      .sort((a, b) => compareVersions(b, a));
    totalDirs += pDirs.length;
    for (const d of pDirs) {
      if (versions.length >= MAX_VERSIONS) break;
      const v = readVersion(pid, pDir, d);
      if (v && !versions.some((x) => x.version === v.version)) versions.push({ ...v, wingetId: pid });
    }
  }
  versions.sort((a, b) => compareVersions(b.version, a.version));

  // Descriptive fields: newest version wins, older versions fill gaps.
  const L = {};
  for (const v of versions) for (const [k, val] of Object.entries(v.locale)) if (L[k] === undefined && val != null) L[k] = val;

  const name = str(L.PackageName);
  const publisher = str(L.Publisher);
  if (!name || !publisher) return { missing: true, reason: 'no name/publisher' };

  const licenseName = str(L.License);
  const support = str(L.PublisherSupportUrl);
  const docsList = Array.isArray(L.Documentations)
    ? L.Documentations.map((d) => clean({ label: str(d.DocumentLabel), url: str(d.DocumentUrl) })).filter((d) => d.label && d.url)
    : [];

  const latest = versions[0];
  const rec = {
    schema_version: 2,
    slug: slugOverride || slugFor(id, name, publisher),
    name: nameOverride || name,
    formerly: formerly || undefined,
    publisher,
    author: str(L.Author),
    ids: clean({ winget: id, winget_previous: previous.length ? previous : undefined, moniker: str(L.Moniker) }),
    platforms: ['windows'],
    summary: str(L.ShortDescription),
    description: str(L.Description),
    // Drop opaque store-ID style tags (long, digits+letters, no hyphen).
    tags: list((L.Tags || []).filter((t) => !/^(?=.*\d)(?=.*[a-z])[a-z0-9]{12,}$/i.test(String(t)))),
    locale: str(L.PackageLocale),
    urls: clean({
      homepage: str(L.PackageUrl) || str(L.PublisherUrl),
      publisher: str(L.PublisherUrl),
      support,
      bug_tracker: support && ISSUES_RE.test(support) ? support : undefined,
      privacy: str(L.PrivacyUrl),
      purchase: str(L.PurchaseUrl),
      release_notes: str(latest.locale.ReleaseNotesUrl),
      documentation: docsList.length ? docsList : undefined,
    }),
    license: clean({
      name: licenseName || 'Not stated',
      url: str(L.LicenseUrl),
      spdx: licenseName && SPDX.has(licenseName) ? licenseName : undefined,
      copyright: str(L.Copyright),
      copyright_url: str(L.CopyrightUrl),
    }),
    pricing: derivePricing(licenseName, curatedPricing),
    latest_versions: { windows: latest.version },
    last_updated: latest.releaseDate,
    versions_total: { windows: totalDirs },
    versions: versions.map((v) =>
      clean({
        platform: 'windows',
        version: v.version,
        release_date: v.releaseDate,
        release_notes: str(v.locale.ReleaseNotes),
        release_notes_url: str(v.locale.ReleaseNotesUrl),
        manifest_version: v.manifestVersion,
        manifest_dir: v.dir,
        winget_id: v.wingetId,
        installers: v.installers,
      }),
    ),
    verification: {
      level: 0,
      label: 'Hashes copied from upstream package manifests (winget-pkgs, Homebrew cask). Not independently re-computed; signatures not checked.',
      checks: { hash_in_manifest: true, hash_recomputed: false, signature_checked: false },
    },
  };
  rec._manifestDir = manifestDir(id);
  return { rec: clean(rec) };
}

// ---------------------------------------------------------------- main

async function main() {
  const allConfig = readConfig();
  const haveIds = new Set();
  if (existsSync(DATA)) for (const f of readdirSync(DATA).filter((f) => f.endsWith('.json'))) {
    const id = JSON.parse(readFileSync(join(DATA, f), 'utf8')).ids.winget;
    if (id) haveIds.add(id); // custom-source records (scripts/custom.mjs) have no winget id and are not ours to manage
  }
  const config = ONLY.length ? allConfig.filter((c) => ONLY.includes(c.id)) : NEW_ONLY ? allConfig.filter((c) => !haveIds.has(c.id)) : allConfig;
  console.log(`config: ${allConfig.length} packages${NEW_ONLY ? `, ${config.length} new` : ''}`);
  if (!config.length) {
    console.log('nothing new to ingest');
    return;
  }

  console.log('syncing winget-pkgs (sparse, depth 1)…');
  const commit = syncCache(config.flatMap((c) => [c.id, ...c.previous].map(manifestDir)));
  console.log(`winget-pkgs @ ${commit}`);

  console.log('fetching Homebrew cask index…');
  const casks = await loadCasks(join(ROOT, '.cache', 'homebrew-cask'));
  console.log(`cask index: ${casks.size} casks`);

  mkdirSync(DATA, { recursive: true });
  const existing = new Map(); // id -> record
  for (const f of readdirSync(DATA).filter((f) => f.endsWith('.json'))) {
    const r = JSON.parse(readFileSync(join(DATA, f), 'utf8'));
    if (r.ids.winget) existing.set(r.ids.winget, r);
  }

  const taken = new Map(); // slug -> id
  for (const [id, r] of existing) taken.set(r.slug, id);
  const assigned = new Map();
  const slugFor = (id, name, publisher) => {
    if (assigned.has(id)) return assigned.get(id);
    if (existing.has(id)) return existing.get(id).slug;
    const candidates = [slugify(name), slugify(`${name} ${publisher}`), slugify(id)];
    let s = candidates.find((c) => c && !RESERVED.has(c) && (!taken.has(c) || taken.get(c) === id));
    s ??= `${candidates[0]}-app`;
    taken.set(s, id);
    assigned.set(id, s);
    return s;
  };

  const now = new Date().toISOString();
  const kept = new Set();
  const missing = [];
  const caskNotes = [];
  const autoCask = [];
  let changed = 0;
  let unchanged = 0;

  for (const { id, slugOverride } of allConfig) if (slugOverride) taken.set(slugOverride, id);
  for (const { id, curatedPricing, slugOverride, nameOverride, formerly, previous, cask: caskConfigured } of config) {
    if (kept.size >= LIMIT) break;
    const res = readApp(id, curatedPricing, slugFor, slugOverride, nameOverride, formerly, previous);
    if (res.missing) {
      missing.push(id);
      continue;
    }
    let { rec } = res;
    const manifest_dir = rec._manifestDir;
    delete rec._manifestDir;

    // New apps only: look for the Homebrew cask ourselves. Needs the same name AND the same website domain.
    let caskToken = caskConfigured;
    let autoMatched = null;
    if (!caskToken && NEW_ONLY) {
      const sg = suggestCask(rec, casks);
      if (sg.token) {
        caskToken = sg.token;
        autoMatched = sg.token;
        caskNotes.push(`${sg.token} (${rec.slug}): auto-matched on name and website, review it`);
      } else if (sg.confidence === 'review') {
        caskNotes.push(`${rec.slug}: possible casks need a manual decision: ${sg.others.slice(0, 4).join(', ')}`);
      } else {
        caskNotes.push(`${rec.slug}: no Homebrew cask found (Windows only)`);
      }
    }

    // ---- Homebrew cask (macOS), matched explicitly in config/apps.txt
    const provenance = [{ source: 'winget-pkgs', platform: 'windows', repo: REPO, commit, retrieved_at: now, path: manifest_dir }];
    if (caskToken) {
      const raw = casks.get(caskToken);
      const norm = raw ? normaliseCask(raw, now) : { skip: 'token not found' };
      if (norm.skip) {
        caskNotes.push(`${caskToken} (${rec.slug}): skipped, ${norm.skip}`);
      } else {
        rec.platforms = ['windows', 'macos'];
        rec.ids = { ...rec.ids, homebrew_cask: caskToken };
        if (norm.disabled) {
          rec.homebrew_cask_disabled = norm.disabled;
          caskNotes.push(`${caskToken} (${rec.slug}): cask is disabled in Homebrew (${norm.disabled.reason}); kept, with a warning on the page`);
        }
        if (autoMatched) autoCask.push({ id, token: autoMatched });
        rec.latest_versions.macos = norm.version.version;
        rec.versions_total.macos = 1;
        rec.versions = [...rec.versions, norm.version];
        // winget sometimes ships an all-lowercase PackageName; take the cask's capitalisation when it is the same name.
        if (norm.name && rec.name === rec.name.toLowerCase() && norm.name.toLowerCase() === rec.name) rec.name = norm.name;
        rec.summary ??= norm.summary;
        rec.urls = { ...(rec.urls || {}) };
        rec.urls.homepage ??= norm.homepage;
        provenance.push(norm.provenance);
      }
    }

    // ---- provenance: an entry only moves when that platform's content changed
    const prev = existing.get(id) ?? previous.map((p) => existing.get(p)).find(Boolean); // a renamed app's record still carries its old ID
    // Linux (Flathub) data is owned by scripts/flathub.mjs, which runs after this step. Carry it over so a re-read of the
    // winget data does not drop it (and keeps its retrieved_at); flathub.mjs then refreshes it.
    if (prev?.ids?.flathub && prev.flathub) {
      rec.platforms = ['windows', ...(rec.platforms.includes('macos') ? ['macos'] : []), 'linux'];
      rec.ids = { ...rec.ids, flathub: prev.ids.flathub };
      rec.latest_versions.linux = prev.latest_versions.linux;
      rec.versions_total.linux = prev.versions_total.linux;
      rec.versions = [...rec.versions, ...prev.versions.filter((v) => v.platform === 'linux')];
      rec.verification = { ...rec.verification, label: prev.verification.label.includes('Flathub') ? rec.verification.label + prev.verification.label.slice(prev.verification.label.indexOf(' Linux (Flatpak)')) : rec.verification.label };
      provenance.push(...prev.provenance.filter((e) => e.platform === 'linux'));
      rec.flathub = prev.flathub;
    }
    const platOf = (v) => v.platform ?? 'windows';
    const parts = (r, plat) => {
      const { provenance: _p, versions, latest_versions, versions_total, platforms, verification, last_updated, flathub: _f, ...shared } = r;
      const ids = { ...shared.ids };
      delete ids.homebrew_cask;
      delete ids.flathub;
      return JSON.stringify({ versions: versions.filter((v) => platOf(v) === plat && !v.from_feed), ...(plat === 'windows' ? { ...shared, ids } : {}) });
    };
    rec.provenance = provenance.map((entry) => {
      const old = prev && Array.isArray(prev.provenance) ? prev.provenance.find((e) => e.platform === entry.platform) : null;
      return old && parts(prev, entry.platform) === parts(rec, entry.platform) ? old : entry;
    });
    // Versions a publisher feed added (supplement sources, scripts/lib/supplement.mjs) stay until scripts/custom.mjs re-reads
    // that feed, which runs right after this step; winget versions with the same number replace them.
    const feedPrev = feedPartsOf(prev);
    if (feedPrev) {
      const feed = Object.fromEntries(Object.entries(feedPrev).map(([p, f]) => [p, { versions: f.versions, unlisted: f.unlisted, entry: (({ added: _a, ...e }) => e)(f.entry) }]));
      rec = mergeFeed(rec, feed).rec;
    }
    const same = prev && JSON.stringify(prev) === JSON.stringify(clean(rec));

    writeFileSync(join(DATA, `${rec.slug}.json`), JSON.stringify(rec, null, 2) + '\n');
    kept.add(rec.slug);
    same ? unchanged++ : changed++;
  }

  // Drop records that are no longer in scope (full runs only; --new never deletes anything).
  if (!NEW_ONLY) {
    for (const f of readdirSync(DATA).filter((f) => f.endsWith('.json'))) {
      // Only winget-managed records can go out of scope; custom-source records are owned by scripts/custom.mjs.
      if (!kept.has(f.replace(/\.json$/, '')) && JSON.parse(readFileSync(join(DATA, f), 'utf8')).ids.winget) rmSync(join(DATA, f));
    }
  }

  // Remember auto-matched casks in the config so later full runs keep them.
  if (autoCask.length) {
    const file = join(ROOT, 'config', 'apps.txt');
    // Edit one line at a time: match on the first token of each line only.
    const lines = readFileSync(file, 'utf8').split('\n');
    for (const { id, token } of autoCask) {
      const i = lines.findIndex((l) => l.replace(/#.*/, '').trim().split(/\s+/)[0] === id);
      if (i >= 0 && !/\bcask=/.test(lines[i])) lines[i] = `${lines[i].trimEnd()} cask=${token}`;
    }
    const text = lines.join('\n');
    writeFileSync(file, text);
  }

  writeFileSync(
    join(ROOT, 'data', 'meta.json'),
    JSON.stringify({ source: 'winget-pkgs', repo: REPO, commit, run_at: now, apps: readdirSync(DATA).filter((f) => f.endsWith('.json')).length, max_versions_per_app: MAX_VERSIONS }, null, 2) + '\n',
  );

  console.log(`\nwrote ${kept.size} apps (${changed} new/changed, ${unchanged} unchanged)`);
  const withMac = [...kept].filter((slug) => JSON.parse(readFileSync(join(DATA, `${slug}.json`), 'utf8')).platforms.includes('macos')).length;
  console.log(`macOS (Homebrew cask) matched: ${withMac}`);
  for (const n of caskNotes) console.log(`  cask: ${n}`);
  if (missing.length) console.log(`not found / skipped (${missing.length}): ${missing.join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
