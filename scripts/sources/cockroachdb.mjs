// Custom source adapter: CockroachDB (Cockroach Labs).
//
// Feeds (both published by the vendor):
//   releases.json  every release: version, series, date, kind (production | testing), withdrawn, and the platforms it was built for
//   series.json    every release series: kind (regular | innovation), dates, support windows and when its binaries are removed
//
// Download links are built, not listed:  <base>/<prefix>-<version>.<platform>[-<min os>]-<arch>.<ext>
// For example  https://binaries.cockroachdb.com/cockroach-v26.3.5.linux-amd64.tgz  with its SHA-256 at  <that URL>.sha256sum
// (The prefix is "cockroach": the same files under "cockroachdb-" return 404.)
//
// What is listed: production releases that are not withdrawn and whose series has not reached its binary-removal date.
// Not listed: testing releases (alpha/beta/rc), FIPS and s390x builds (separate special builds, not the standard downloads).

import { compareVersions } from '../lib/version.mjs';

// feed platform name -> how the file is named and what it is
const TARGETS = [
  { feed: 'linux-amd64', platform: 'linux', arch: 'x64', os: 'linux', suffix: 'amd64', ext: 'tgz', type: 'tar' },
  { feed: 'linux-arm64', platform: 'linux', arch: 'arm64', os: 'linux', suffix: 'arm64', ext: 'tgz', type: 'tar' },
  { feed: 'darwin-amd64', platform: 'macos', arch: 'x64', os: 'darwin-10.9', suffix: 'amd64', ext: 'tgz', type: 'tar' },
  { feed: 'darwin-arm64', platform: 'macos', arch: 'arm64', os: 'darwin-11.0', suffix: 'arm64', ext: 'tgz', type: 'tar' },
  { feed: 'win-amd64', platform: 'windows', arch: 'x64', os: 'windows-6.2', suffix: 'amd64', ext: 'zip', type: 'zip' },
];
const PLATFORM_ORDER = ['windows', 'macos', 'linux'];
const ARCH_ORDER = ['x64', 'arm64'];

export function fileName(cfg, version, t) {
  return `${cfg.file_prefix}-${version}.${t.os}-${t.suffix}.${t.ext}`;
}

/** Parses "<sha256>  <filename>" (sha256sum format). */
export function parseChecksum(text) {
  const m = /^\s*([0-9a-fA-F]{64})\b/.exec(String(text));
  return m ? m[1].toLowerCase() : null;
}

export async function fetchSource(cfg, ctx) {
  const { getJson, getText, cache, log, today } = ctx;
  const releases = (await getJson(cfg.feeds.releases)).releases;
  const seriesList = (await getJson(cfg.feeds.series)).series;
  if (!Array.isArray(releases) || !Array.isArray(seriesList)) throw new Error('feeds do not have the expected shape');
  const seriesBy = new Map(seriesList.map((s) => [s.series, s]));

  const stillAvailable = (s) => s && (!s.binary_removal_date || s.binary_removal_date > today);
  const eligible = releases
    .filter((r) => r.kind === 'production' && !r.withdrawn && stillAvailable(seriesBy.get(r.series)))
    .sort((a, b) => compareVersions(b.version, a.version));

  // Which releases we list per platform: the newest `max_versions`; the rest are counted in versions_total.
  const byPlatform = {};
  for (const plat of PLATFORM_ORDER) {
    const targets = TARGETS.filter((t) => t.platform === plat);
    const rels = eligible.filter((r) => targets.some((t) => (r.platforms || []).includes(t.feed)));
    byPlatform[plat] = { targets, total: rels.length, shown: rels.slice(0, cfg.max_versions) };
  }

  // Checksums: one .sha256sum file per download. A published release file never changes, so results are cached by URL.
  const wanted = [];
  for (const { targets, shown } of Object.values(byPlatform)) {
    for (const r of shown) for (const t of targets) if ((r.platforms || []).includes(t.feed)) wanted.push({ r, t, url: `${cfg.download_base}/${fileName(cfg, r.version, t)}` });
  }
  const missing = wanted.filter((w) => !cache[w.url]);
  let fetched = 0;
  const failed = new Set();
  const queue = [...missing];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (queue.length) {
        const w = queue.shift();
        try {
          const sha = parseChecksum(await getText(`${w.url}.sha256sum`));
          if (!sha) throw new Error('no SHA-256 in the .sha256sum file');
          cache[w.url] = sha;
          fetched++;
        } catch (e) {
          failed.add(w.url);
          log(`  skipped ${w.url}: ${e.message}`);
        }
      }
    }),
  );

  const versions = [];
  for (const plat of PLATFORM_ORDER) {
    const { targets, shown } = byPlatform[plat];
    for (const r of shown) {
      const s = seriesBy.get(r.series);
      const installers = targets
        .filter((t) => (r.platforms || []).includes(t.feed))
        .map((t) => ({ t, url: `${cfg.download_base}/${fileName(cfg, r.version, t)}` }))
        .filter(({ url }) => cache[url] && !failed.has(url))
        .map(({ t, url }) => ({ platform: plat, architecture: t.arch, type: t.type, url, host: new URL(url).hostname, filename: url.split('/').pop(), sha256: cache[url] }))
        .sort((a, b) => ARCH_ORDER.indexOf(a.architecture) - ARCH_ORDER.indexOf(b.architecture));
      if (!installers.length) continue;
      versions.push({
        platform: plat,
        version: r.version.replace(/^v/, ''),
        release_date: r.date,
        release_notes_url: cfg.release_notes_url.replace('{series}', r.series),
        series: r.series,
        ...(s?.lts?.initial_patch && compareVersions(r.version, s.lts.initial_patch) >= 0 ? { lts: true } : {}),
        installers,
      });
    }
  }

  const release_series = seriesList
    .filter(stillAvailable)
    .map((s) => {
      const latest = eligible.find((r) => r.series === s.series);
      return latest
        ? {
            series: s.series,
            kind: s.kind,
            release_date: s.release_date || undefined,
            maintenance_ends: s.maintenance_ends ?? null,
            assistance_ends: s.assistance_ends ?? null,
            binary_removal_date: s.binary_removal_date ?? null,
            lts: s.lts ?? null,
            latest_version: latest.version.replace(/^v/, ''),
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => compareVersions(b.series, a.series));

  return {
    versions,
    versions_total: Object.fromEntries(PLATFORM_ORDER.map((p) => [p, byPlatform[p].total]).filter(([p, n]) => n && versions.some((v) => v.platform === p))),
    release_series,
    stats: { eligible: eligible.length, fetched, failed: failed.size },
  };
}
