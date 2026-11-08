// Flathub source: flathub.org/api/v2 -> normalised Linux (Flatpak) version object.
// Pure extraction of what Flathub publishes about an app. Flathub lists only the current release as installable
// (`flatpak install` always takes the newest build), so, like a Homebrew cask, a Linux "version history" is one entry.
// Flathub publishes no file hash for a Flatpak: the repository is OSTree, signed by Flathub. We therefore mark the
// installer `no_checksum` instead of inventing a SHA-256.
//
// Attribution: app metadata (name, summary, license, release data, verification status) comes from Flathub
// (https://flathub.org), which collects it from each app's own AppStream file. Every Linux record links its Flathub page.

import { createHash } from 'node:crypto';
import { compareVersions } from './version.mjs';
import { domainKey } from './cask.mjs';

export const FLATHUB = 'https://flathub.org';
export const FLATHUB_API = `${FLATHUB}/api/v2`;
export const FLATHUB_ORG = 'https://github.com/flathub';
const UA = { 'user-agent': 'everyversion.net-ingest' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const pageUrl = (id) => `${FLATHUB}/apps/${encodeURIComponent(id)}`;
export const apiUrl = (id) => `${FLATHUB_API}/appstream/${encodeURIComponent(id)}`;
export const repoUrl = (id) => `${FLATHUB_ORG}/${id}`;
const ID_RE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/;
export const isAppId = (s) => ID_RE.test(String(s || ''));

// ---------------------------------------------------------------- API

/** JSON from the Flathub API. Returns null on 404 (unknown app); throws after three failed tries on anything else. */
async function api(path, init = {}) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${FLATHUB_API}${path}`, { ...init, headers: { ...UA, ...(init.headers || {}) }, signal: AbortSignal.timeout(60000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await sleep(120); // be polite: the API is free and shared
      return await res.json();
    } catch (e) {
      last = e;
      await sleep(600 * (attempt + 1));
    }
  }
  throw new Error(`${path}: ${last.message}`);
}

export const getAppstream = (id) => api(`/appstream/${encodeURIComponent(id)}`);
export const getSummary = (id) => api(`/summary/${encodeURIComponent(id)}`);
export async function searchApps(query) {
  const r = await api('/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  return Array.isArray(r?.hits) ? r.hits : [];
}

// ---------------------------------------------------------------- normalising

const str = (v) => (typeof v === 'string' && v.trim() && v.trim() !== 'null' ? v.trim() : undefined);
const prune = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)));
const day = (secondsOrIso) => {
  if (secondsOrIso == null || secondsOrIso === '') return undefined;
  const n = Number(secondsOrIso);
  const d = Number.isFinite(n) && String(secondsOrIso).trim() !== '' && n > 1e8 ? new Date(n * 1000) : new Date(String(secondsOrIso));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
};
const ARCH = { x86_64: 'x64', aarch64: 'arm64' };
const SKIP_TYPES = new Set(['runtime', 'extension', 'addon', 'localization', 'generic']);

/** Newest stable release: highest timestamp, ties broken by version number. */
function newestRelease(releases) {
  const stable = (Array.isArray(releases) ? releases : []).filter((r) => str(r?.version) && (!r.type || r.type === 'stable'));
  return stable.sort((a, b) => (Number(b.timestamp) || 0) - (Number(a.timestamp) || 0) || compareVersions(String(b.version), String(a.version)))[0];
}

export const sha = (x) => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');

/** Returns { version, flathub, name, summary, homepage, provenance } or { skip: reason }. */
export function normaliseFlathub(app, summary, retrievedAt) {
  if (!app || !str(app.id)) return { skip: 'not found on Flathub' };
  if (SKIP_TYPES.has(app.type)) return { skip: `Flathub lists it as a ${app.type}, not an application` };
  if (app.is_eol) return { skip: 'end-of-life on Flathub' };
  const id = app.id;
  const rel = newestRelease(app.releases);
  if (!rel) return { skip: 'Flathub lists no stable release' };
  const version = String(rel.version).trim();

  const arches = (Array.isArray(summary?.arches) && summary.arches.length ? summary.arches : ['x86_64']).map((a) => ARCH[a]).filter(Boolean);
  const archList = [...new Set(arches.length ? arches : ['x64'])].sort();
  const flatpakref = `https://dl.flathub.org/repo/appstream/${id}.flatpakref`;
  const installers = archList.map((architecture) => ({
    platform: 'linux',
    architecture,
    type: 'flatpak',
    url: flatpakref,
    host: 'dl.flathub.org',
    filename: `${id}.flatpakref`,
    no_checksum: true,
  }));

  const m = app.metadata || {};
  const verified = m['flathub::verification::verified'] === true || m['flathub::verification::verified'] === 'true';
  const verification = verified
    ? prune({
        method: str(m['flathub::verification::method']),
        login_provider: str(m['flathub::verification::login_provider']),
        login_name: str(m['flathub::verification::login_name']),
        login_is_organization: m['flathub::verification::login_is_organization'] === true ? true : undefined,
        website: str(m['flathub::verification::website']),
        verified_on: day(m['flathub::verification::timestamp']),
      })
    : undefined;

  const flathub = prune({
    app_id: id,
    page_url: pageUrl(id),
    repo_url: repoUrl(id),
    install_command: `flatpak install flathub ${id}`,
    run_command: `flatpak run ${id}`,
    verified,
    verification,
    license: str(app.project_license),
    free_license: typeof app.is_free_license === 'boolean' ? app.is_free_license : undefined,
    developer_name: str(app.developer_name),
    categories: Array.isArray(app.categories) ? app.categories.filter((c) => typeof c === 'string') : undefined,
    download_size: Number.isInteger(summary?.download_size) ? summary.download_size : undefined,
    installed_size: Number.isInteger(summary?.installed_size) ? summary.installed_size : undefined,
    arches: archList,
  });

  const version_ = prune({
    platform: 'linux',
    version,
    release_date: day(rel.timestamp) || day(rel.date),
    release_notes_url: /^https:\/\//.test(str(rel.url) || '') ? str(rel.url) : undefined,
    installers,
  });

  return {
    version: version_,
    flathub,
    name: str(app.name),
    summary: str(app.summary),
    homepage: str(app.urls?.homepage),
    provenance: {
      source: 'flathub',
      platform: 'linux',
      repo: repoUrl(id),
      retrieved_at: retrievedAt,
      path: `api/v2/appstream/${id}`,
      api_url: apiUrl(id),
      content_sha256: sha({ version: version_, flathub }),
    },
  };
}

// ---------------------------------------------------------------- matching a catalog app to a Flathub app

const norm = (x) => String(x || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '');

const flathubSites = (app) => new Set([app.urls?.homepage, app.urls?.bugtracker, app.urls?.vcs_browser, app.urls?.help, app.urls?.contact, app.metadata?.['flathub::verification::website']].map((u) => domainKey(str(u) || '')).filter(Boolean));

/**
 * Find the Flathub app for a catalog record. A match needs BOTH the same name AND the same website (or code host owner),
 * the same rule as the Homebrew cask match.
 * Returns { id, confidence: 'confident' | 'review' | null, others: [...] }.
 *   confident = exactly one Flathub app matches on name and website (applied automatically)
 *   review    = a name-only match, or several (reported, never applied)
 */
export async function suggestFlathub(rec) {
  const names = new Set([norm(rec.name), norm(rec.slug)].filter(Boolean));
  const winInstaller = rec.versions?.find((v) => (v.platform ?? 'windows') === 'windows')?.installers?.[0]?.url;
  const sites = new Set([rec.urls?.homepage, rec.urls?.publisher, rec.urls?.support, winInstaller].map((u) => domainKey(u || '')).filter(Boolean));

  const seen = new Map();
  for (const q of [...new Set([rec.name, rec.slug.replace(/-/g, ' ')])]) {
    for (const h of await searchApps(q)) if (h.app_id && !seen.has(h.app_id)) seen.set(h.app_id, h);
  }
  const byName = [...seen.values()].filter((h) => !SKIP_TYPES.has(h.type) && names.has(norm(h.name)));
  const both = [];
  for (const h of byName) {
    const app = await getAppstream(h.app_id);
    if (app && [...flathubSites(app)].some((d) => sites.has(d))) both.push(h.app_id);
  }
  if (both.length === 1) return { id: both[0], confidence: 'confident', others: [] };
  if (both.length > 1) return { id: null, confidence: 'review', others: both };
  if (byName.length) return { id: null, confidence: 'review', others: byName.map((h) => h.app_id) };
  return { id: null, confidence: null, others: [] };
}
