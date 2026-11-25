// Publisher feeds that fill gaps in a winget or Homebrew record (config/custom-sources.json, "supplement": true).
//
// winget-pkgs and Homebrew miss releases: they can trail the publisher by a day or more, they rarely carry updates to an
// older release line (JetBrains ships 2026.2.7 after 2026.3), and a cask lists only the current release. A supplement
// source reads the publisher's own feed and adds the versions the record lacks, on the platforms the record already has.
//
// Rules:
//   - winget and Homebrew always win: a feed version is added only when the record has no version with the same number
//     (compared the way winget compares, so 3.9.2 equals 3.9.2.0).
//   - Every added version carries `from_feed: <source id>`, so the build can say where it came from (no winget pin, no manifest).
//   - Each platform the feed touched gets its own provenance entry (source "custom", after the winget or cask entry), with
//     `added`: how many versions the feed adds to versions_total, listed or not.
//   - Feed versions are listed when they fall within the newest `max` of winget, cask and feed together; the rest only count
//     in versions_total. winget and cask versions are always kept.
//
// stripFeed() undoes mergeFeed(), so scripts/custom.mjs always starts from the plain winget/Homebrew record, and
// scripts/ingest.mjs can carry the feed versions across a re-read of winget without the record looking changed.

import { compareVersions } from './version.mjs';

const PLATFORM_ORDER = ['windows', 'macos', 'linux'];
const byNewest = (a, b) => compareVersions(b.version, a.version) || String(b.release_date || '').localeCompare(String(a.release_date || ''));
const isFeedEntry = (e) => e.source === 'custom' && e.supplement === true;

function recompute(rec) {
  const latest = {};
  for (const p of rec.platforms) {
    const v = rec.versions.find((x) => x.platform === p);
    if (v) latest[p] = v.version;
  }
  const dates = rec.versions.map((v) => v.release_date).filter(Boolean).sort();
  return { ...rec, latest_versions: latest, ...(dates.length ? { last_updated: dates.at(-1) } : {}) };
}

/** The record without anything a supplement feed added. */
export function stripFeed(rec) {
  const entries = (rec.provenance || []).filter(isFeedEntry);
  if (!entries.length && !rec.versions.some((v) => v.from_feed)) return rec;
  const total = { ...rec.versions_total };
  for (const e of entries) if (total[e.platform] != null) total[e.platform] = Math.max(0, total[e.platform] - (e.added || 0));
  return recompute({
    ...rec,
    versions: rec.versions.filter((v) => !v.from_feed),
    versions_total: total,
    provenance: rec.provenance.filter((e) => !isFeedEntry(e)),
  });
}

/** Feed-added versions and their provenance entries, as kept in a merged record (for carrying them across a winget re-read). */
export function feedPartsOf(rec) {
  const entries = (rec?.provenance || []).filter(isFeedEntry);
  if (!entries.length) return null;
  const byPlatform = {};
  for (const e of entries) byPlatform[e.platform] = { versions: rec.versions.filter((v) => v.platform === e.platform && v.from_feed), entry: e, unlisted: Math.max(0, (e.added || 0) - rec.versions.filter((v) => v.platform === e.platform && v.from_feed).length) };
  return byPlatform;
}

/**
 * Add feed versions to a plain record (no feed parts in it).
 *   feed:  { <platform>: { versions: [...], unlisted?: n, entry: provenance entry without `added` } }
 * Returns { rec, added: { <platform>: n } }.
 */
export function mergeFeed(base, feed) {
  let versions = [...base.versions];
  const total = { ...base.versions_total };
  const provenance = [...base.provenance];
  const added = {};
  for (const p of PLATFORM_ORDER) {
    const f = feed?.[p];
    if (!f || !base.platforms.includes(p)) continue;
    const mine = versions.filter((v) => v.platform === p);
    const same = (m, v) => compareVersions(m.version, v.version) === 0 || (v.source_version && compareVersions(m.version, v.source_version) === 0);
    const extra = f.versions.filter((v) => !mine.some((m) => same(m, v)));
    if (!extra.length && !f.unlisted) continue;
    // winget and cask versions are never dropped (a later run could not get them back); the adapter already left out the
    // feed versions that fall outside the newest `max`, and counts them in `unlisted`.
    const listed = [...mine, ...extra].sort(byNewest);
    versions = versions.filter((v) => v.platform !== p).concat(listed);
    added[p] = extra.length + (f.unlisted || 0);
    total[p] = (total[p] || mine.length) + added[p];
    provenance.push({ ...f.entry, platform: p, added: added[p] });
  }
  versions = PLATFORM_ORDER.flatMap((p) => versions.filter((v) => v.platform === p));
  return { rec: recompute({ ...base, versions, versions_total: total, provenance }), added };
}
