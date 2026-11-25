// Supplement adapter: JetBrains' own release feed, for the JetBrains apps that come from winget-pkgs and Homebrew.
//
// Feed (published by JetBrains, one request for every product):
//   https://data.services.jetbrains.com/products/releases?code=DG,IIU,...&type=release&latest=false
//   Per product, every stable release, newest first: version, date, notesLink and `downloads` keyed by package:
//     windows (x64 .exe)  windowsARM64 (Arm64 .exe)  mac (Intel .dmg)  macM1 (Apple silicon .dmg)  ... each with link and
//     checksumLink, a "<sha256> *<file>" text file next to the download.
//
// What it adds: the Windows and macOS releases the record lacks (winget trails JetBrains, skips most updates to older release
// lines, and a cask lists only the current release). Not added: .zip and JBR-variant packages, Linux tarballs (Linux comes
// from Flathub), EAP and RC builds (type=release only), and any release whose checksum file cannot be read.

const PACKAGES = [
  { key: 'windows', platform: 'windows', arch: 'x64', type: 'exe' },
  { key: 'windowsARM64', platform: 'windows', arch: 'arm64', type: 'exe' },
  { key: 'mac', platform: 'macos', arch: 'x64', type: 'dmg' },
  { key: 'macM1', platform: 'macos', arch: 'arm64', type: 'dmg' },
];

/** "<sha256> *file" or "<sha256>  file". */
export function parseChecksum(text) {
  const m = /^\s*([0-9a-fA-F]{64})\b/.exec(String(text));
  return m ? m[1].toLowerCase() : null;
}

let feedCache = null; // one feed request per run, shared by every product

async function loadFeed(cfg, ctx) {
  if (!feedCache) {
    const codes = [...new Set(Object.values(cfg.products))].join(',');
    feedCache = await ctx.getJson(`${cfg.feeds.releases}?code=${codes}&type=release&latest=false`);
  }
  return feedCache;
}

/** Feed URL for one product, as shown on the page. */
export const productFeedUrl = (cfg, code) => `${cfg.feeds.releases}?code=${code}&type=release`;

/**
 * Versions JetBrains lists for this app that `rec` (plain winget/Homebrew record) does not have, on Windows and macOS.
 * Returns { windows?: [versions], macos?: [versions] } plus stats.
 */
export async function fetchSupplement(cfg, ctx, rec) {
  const code = cfg.products[rec.ids.winget];
  const feed = await loadFeed(cfg, ctx);
  const releases = feed[code];
  if (!Array.isArray(releases) || !releases.length) throw new Error(`no releases for product code ${code}`);
  const { compareVersions } = await import('../lib/version.mjs');
  const max = cfg.max_versions || 100;
  const out = {};
  const stats = { fetched: 0, failed: 0 };

  for (const plat of ['windows', 'macos']) {
    if (!rec.platforms.includes(plat)) continue;
    const have = rec.versions.filter((v) => v.platform === plat).map((v) => v.version);
    const pk = PACKAGES.filter((x) => x.platform === plat);
    const missing = releases
      .filter((r) => r.version && pk.some((x) => r.downloads?.[x.key]?.link))
      // Same release: the same version number, or winget's number is JetBrains' full build (Toolbox: 3.1.2.64642 = 3.1.2)
      .filter((r) => !have.some((h) => compareVersions(h, r.version) === 0 || (r.build && compareVersions(h, r.build) === 0)))
      .sort((a, b) => compareVersions(b.version, a.version));
    // Only the ones that can still make the listed `max` need a checksum; the rest only count.
    const merged = [...have.map((v) => ({ version: v, mine: true })), ...missing.map((r) => ({ version: r.version, r }))].sort((a, b) => compareVersions(b.version, a.version));
    const listable = merged.slice(0, max).filter((x) => x.r).map((x) => x.r);
    const unlisted = missing.length - listable.length;

    const jobs = listable.flatMap((r) => pk.filter((x) => r.downloads?.[x.key]?.link).map((x) => ({ r, x, d: r.downloads[x.key] })));
    let i = 0;
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (i < jobs.length) {
        const j = jobs[i++];
        const sumUrl = j.d.checksumLink || `${j.d.link}.sha256`;
        if (ctx.cache[sumUrl]) { j.sha = ctx.cache[sumUrl]; continue; }
        try {
          j.sha = parseChecksum(await ctx.getText(sumUrl));
          if (j.sha) { ctx.cache[sumUrl] = j.sha; stats.fetched++; } else stats.failed++;
        } catch {
          stats.failed++;
        }
      }
    }));

    const versions = [];
    for (const r of listable) {
      const installers = jobs
        .filter((j) => j.r === r && j.sha)
        .map((j) => {
          const u = new URL(j.d.link);
          return { platform: plat, architecture: j.x.arch, type: j.x.type, url: j.d.link, host: u.hostname, filename: u.pathname.split('/').pop(), sha256: j.sha };
        });
      if (!installers.length) continue; // no readable checksum: not listed
      versions.push({
        platform: plat,
        version: r.version,
        ...(r.build && r.build !== r.version ? { source_version: r.build } : {}),
        ...(r.date ? { release_date: r.date } : {}),
        ...(r.notesLink ? { release_notes_url: r.notesLink } : {}),
        from_feed: cfg.id,
        installers,
      });
    }
    out[plat] = { versions, unlisted };
  }
  return { byPlatform: out, stats, feedUrl: productFeedUrl(cfg, code) };
}
