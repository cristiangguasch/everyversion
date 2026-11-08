// Homebrew cask source: formulae.brew.sh/api/cask.json -> normalised macOS version object.
// Pure extraction of what the cask declares. Casks track only the current release, so a
// macOS "version history" is always a single entry (older ones live in the cask's git history).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareVersions } from './version.mjs';

export const CASK_REPO = 'https://github.com/Homebrew/homebrew-cask';
export const CASK_API = 'https://formulae.brew.sh/api/cask.json';

export async function loadCasks(cacheDir) {
  const res = await fetch(CASK_API, { headers: { 'user-agent': 'everyversion.net-ingest' } });
  if (!res.ok) throw new Error(`cask.json: HTTP ${res.status}`);
  const text = await res.text();
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(join(cacheDir, 'cask.json'), text);
  const list = JSON.parse(text);
  return new Map(list.map((c) => [c.token, c]));
}

// ---------------------------------------------------------------- helpers

const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const nn = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v != null));
const strings = (v) => [v].flat(Infinity).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
const uniq = (a) => [...new Set(a)];
const prune = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length) && !(v && typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)));
const basename = (p) => String(p).split('/').filter(Boolean).pop();

const EXT_RE = /\.(dmg|pkg|zip|tar\.gz|tgz|tar\.bz2|tbz|tar\.xz|txz|tar)$/i;

/** Best file name for a download URL: last path segment, or a query value that looks like a file (e.g. ?file=App.dmg). */
function fileNameFrom(u) {
  const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
  if (EXT_RE.test(last)) return last;
  for (const v of u.searchParams.values()) if (EXT_RE.test(v)) return v;
  return last || u.hostname;
}

function typeFromName(name, artifacts) {
  const n = name.toLowerCase();
  if (/\.dmg$/.test(n)) return 'dmg';
  if (/\.pkg$/.test(n)) return 'pkg';
  if (/\.zip$/.test(n)) return 'zip';
  if (/\.(tar\.gz|tgz|tar\.bz2|tbz|tar\.xz|txz|tar)$/.test(n)) return 'tar';
  if (artifacts.some((a) => a.pkg)) return 'pkg';
  return 'unknown';
}

function installerFrom(src, arch, minOs, artifacts) {
  const url = str(src.url);
  if (!url || !/^https?:\/\//.test(url)) return null;
  let host;
  let filename;
  try {
    const u = new URL(url);
    host = u.hostname;
    filename = fileNameFrom(u);
  } catch {
    return null;
  }
  const sha = typeof src.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(src.sha256) ? src.sha256.toLowerCase() : undefined;
  return prune({
    platform: 'macos',
    architecture: arch,
    type: typeFromName(filename, artifacts),
    url,
    host,
    filename,
    sha256: sha,
    no_checksum: sha ? undefined : true,
    min_os_version: minOs,
    version: str(src.version),
  });
}

function cleanupFrom(artifacts) {
  const quit = [];
  const launchctl = [];
  const pkgutil = [];
  const remove = [];
  const loginItems = [];
  const zap = [];
  for (const a of artifacts) {
    for (const u of [a.uninstall].flat().filter(Boolean)) {
      quit.push(...strings(u.quit));
      launchctl.push(...strings(u.launchctl));
      pkgutil.push(...strings(u.pkgutil));
      remove.push(...strings(u.delete), ...strings(u.trash));
      loginItems.push(...strings(u.login_item));
    }
    for (const z of [a.zap].flat().filter(Boolean)) zap.push(...strings(z.trash), ...strings(z.delete), ...strings(z.rmdir));
  }
  return prune({
    quit: uniq(quit),
    launchctl: uniq(launchctl),
    pkgutil: uniq(pkgutil),
    remove: uniq(remove),
    login_items: uniq(loginItems),
    zap_paths: uniq(zap).slice(0, 40),
  });
}

const IGNORED_KEYS = new Set(['app', 'pkg', 'binary', 'target', 'zap', 'uninstall', 'installer', 'preflight_steps', 'postflight_steps', 'uninstall_preflight_steps', 'uninstall_postflight_steps', 'manpage', 'bash_completion', 'zsh_completion', 'fish_completion', 'generate_completions_from_executable', 'command_wrapper', 'artifact']);

/** Returns { version, installers[], summary, homepage, provenance } or { skip: reason }. */
export function normaliseCask(cask, retrievedAt) {
  if (cask.disabled) return { skip: 'disabled' };
  if (cask.deprecated) return { skip: 'deprecated' };

  const artifacts = Array.isArray(cask.artifacts) ? cask.artifacts : [];
  const macos = cask.depends_on?.macos;
  const minOs = macos?.['>='] ? String(macos['>='][0]) : undefined;

  // Which CPU architectures does the newest supported macOS cover, and with what URL/hash?
  // A variation that sets a url replaces url AND sha256 together (a null hash then means "unknown",
  // never "inherit the other architecture's hash").
  const supported = (cask.supported_platforms || []).filter((p) => !p.includes('linux'));
  const osName = (supported[0] || '').replace(/^arm64_/, '');
  const applyVar = (name) => {
    const v = cask.variations?.[name];
    if (v && v.url) return { url: v.url, sha256: v.sha256, version: v.version ?? cask.version };
    if (v && v.sha256) return { url: cask.url, sha256: v.sha256, version: v.version ?? cask.version };
    return { url: cask.url, sha256: cask.sha256, version: cask.version };
  };
  const hasIntel = supported.includes(osName);
  const hasArm = supported.includes(`arm64_${osName}`);
  const intel = applyVar(osName);
  const arm = applyVar(`arm64_${osName}`);
  const archDeps = (cask.depends_on?.arch || []).map((a) => a.type);

  let installers;
  if (hasIntel && hasArm) {
    installers =
      arm.url !== intel.url || arm.sha256 !== intel.sha256
        ? [installerFrom(intel, 'x64', minOs, artifacts), installerFrom(arm, 'arm64', minOs, artifacts)]
        : [installerFrom(intel, 'universal', minOs, artifacts)];
  } else if (hasArm) {
    installers = [installerFrom(arm, 'arm64', minOs, artifacts)];
  } else if (hasIntel) {
    installers = [installerFrom(intel, 'x64', minOs, artifacts)];
  } else {
    const arch = archDeps.length === 1 ? (archDeps[0] === 'arm64' ? 'arm64' : 'x64') : 'universal';
    installers = [installerFrom({ url: cask.url, sha256: cask.sha256, version: cask.version }, arch, minOs, artifacts)];
  }
  installers = installers.filter(Boolean);
  if (!installers.length) return { skip: 'no download URL' };

  // Headline version = newest across architectures; an installer on an older build keeps its own version.
  const rawOf = (i) => i.version ?? str(cask.version) ?? 'latest';
  const head = installers.reduce((a, b) => (compareVersions(rawOf(b).split(',')[0], rawOf(a).split(',')[0]) > 0 ? b : a));
  const rawVersion = rawOf(head);
  const version = rawVersion.split(',')[0];
  installers = installers.map(({ version: iv, ...rest }) => {
    const v = iv ? iv.split(',')[0] : version;
    return v !== version ? { ...rest, version: v } : rest;
  });

  const apps = uniq(artifacts.flatMap((a) => strings(a.app)));
  const pkgs = uniq(artifacts.flatMap((a) => strings(a.pkg)));
  const binaries = uniq(
    artifacts.flatMap((a) =>
      [a.binary].flat().filter(Boolean).map((b) => {
        if (typeof b === 'string') return basename(b);
        const t = nn(b).target;
        return t ? basename(t) : null;
      }),
    ),
  ).filter(Boolean);
  // `binary` is an array like ["path", {target: "name"}]: handle that shape too.
  for (const a of artifacts) {
    if (Array.isArray(a.binary)) {
      const t = a.binary.find((x) => x && typeof x === 'object' && x.target);
      const s = a.binary.find((x) => typeof x === 'string');
      const name = t ? basename(t.target) : s ? basename(s) : null;
      if (name && !binaries.includes(name)) binaries.push(name);
    }
  }
  const other = uniq(artifacts.flatMap((a) => Object.keys(a)).filter((k) => !IGNORED_KEYS.has(k)));

  const dep = cask.depends_on || {};
  const cleanup = cleanupFrom(artifacts);

  const version_ = prune({
    platform: 'macos',
    version,
    source_version: rawVersion !== version ? rawVersion : undefined,
    installers,
    cask: prune({
      apps,
      pkgs,
      binaries,
      other_artifacts: other,
      manual_installer: artifacts.some((a) => a.installer) || undefined,
      auto_updates: cask.auto_updates === true || undefined,
      caveats: str(cask.caveats)?.slice(0, 600),
      depends_on: prune({ casks: strings(dep.cask), formulae: strings(dep.formula) }),
      cleanup,
    }),
  });

  return {
    version: version_,
    name: str(cask.name?.[0]),
    summary: str(cask.desc),
    homepage: str(cask.homepage),
    provenance: prune({
      source: 'homebrew-cask',
      platform: 'macos',
      repo: CASK_REPO,
      commit: cask.tap_git_head,
      retrieved_at: retrievedAt,
      path: cask.ruby_source_path,
      api_url: `https://formulae.brew.sh/api/cask/${encodeURIComponent(cask.token)}.json`,
    }),
  };
}

// ---------------------------------------------------------------- matching a winget app to a cask

const norm = (x) => String(x || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '');
const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'ac']);
/** "github.com/owner" for code hosts, otherwise the registrable domain ("videolan.org"). */
export function domainKey(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (/^(github|gitlab|codeberg|sourceforge)\.(com|org|net)$/.test(host) || host === 'sourceforge.net') return `${host}/${(u.pathname.split('/')[1] || '').toLowerCase()}`;
    const parts = host.split('.');
    const keep = parts.length > 2 && SECOND_LEVEL.has(parts.at(-2)) ? 3 : 2;
    return parts.slice(-keep).join('.');
  } catch {
    return '';
  }
}

/**
 * Find the Homebrew cask for a winget record. A match needs BOTH the same name AND the same website domain.
 * Returns { token, confidence: 'confident' | 'review' | null, others: [...] }.
 *   confident = exactly one cask matches on name and domain (applied automatically)
 *   review    = a name-only match (reported, never applied)
 */
export function suggestCask(rec, casks) {
  const names = new Set([norm(rec.name), norm(rec.slug)].filter(Boolean));
  // The same project shows up on the same website OR downloads from the same place (e.g. the same GitHub owner).
  const winInstaller = rec.versions?.find((v) => (v.platform ?? 'windows') === 'windows')?.installers?.[0]?.url;
  const sites = new Set([rec.urls?.homepage, rec.urls?.publisher, winInstaller].map(domainKey).filter(Boolean));
  const stable = [...casks.values()].filter((c) => !c.token.includes('@')); // ignore @beta / @insiders variants
  const byName = stable.filter((c) => [c.token, ...(Array.isArray(c.name) ? c.name : [c.name])].map(norm).some((x) => names.has(x)));
  const both = byName.filter((c) => [c.homepage, c.url].map(domainKey).some((d) => d && sites.has(d)));
  if (both.length === 1) return { token: both[0].token, confidence: 'confident', others: [] };
  if (both.length > 1) return { token: null, confidence: 'review', others: both.map((c) => c.token) };
  if (byName.length) return { token: null, confidence: 'review', others: byName.map((c) => c.token) };
  return { token: null, confidence: null, others: [] };
}
