// "What's new" summaries: one short description, in our own words, of what changed in an app's latest release. Hand-written
// per app in config/whatsnew/<slug>.json from the publisher's release notes, and shown in the "What's new" section of the app
// page and in the .md twin in place of the publisher's quoted notes.
//
// A summary belongs to one version on one platform. When the app's latest version on that platform changes, the summary is
// stale: the page falls back to the publisher's notes until the file is rewritten (/refresh-apps does that).
//
// File shape (see README, "What's new summaries"):
//   { "slug", "platform": "windows" | "macos" | "linux", "version", "reviewed": "YYYY-MM-DD",
//     "summary": "1 to 3 sentences, at most SUMMARY_MAX characters",
//     "source": "https://…" }          the release notes page it was written from (optional when the notes came with the manifest)

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WHATSNEW_DIR = join(ROOT, 'config', 'whatsnew');
export const SUMMARY_MAX = 380;

export function loadWhatsNew() {
  const out = new Map();
  if (!existsSync(WHATSNEW_DIR)) return out;
  for (const f of readdirSync(WHATSNEW_DIR).filter((x) => x.endsWith('.json')).sort()) {
    out.set(f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(WHATSNEW_DIR, f), 'utf8')));
  }
  return out;
}

// The summary when it still matches the app's latest version on its platform; null when there is none or it is stale.
export function currentWhatsNew(wn, rec) {
  if (!wn || !rec) return null;
  const latest = rec.versions.find((v) => v.platform === wn.platform);
  return latest && latest.version === wn.version ? wn : null;
}

// Problems with one file ([] when fine). `rec` is the app record it belongs to (or undefined when the slug is unknown).
export function whatsNewProblems(slug, wn, rec) {
  const bad = [];
  if (!rec) bad.push('no app with this slug');
  if (wn.slug !== slug) bad.push(`"slug" must equal the file name (${slug})`);
  if (!['windows', 'macos', 'linux'].includes(wn.platform)) bad.push('"platform" must be windows, macos or linux');
  if (typeof wn.version !== 'string' || !wn.version) bad.push('"version" is missing');
  else if (rec && !rec.versions.some((v) => v.platform === wn.platform && v.version === wn.version)) bad.push(`version ${wn.version} is not listed for ${wn.platform}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wn.reviewed || '')) bad.push('"reviewed" must be YYYY-MM-DD');
  const s = typeof wn.summary === 'string' ? wn.summary.trim() : '';
  if (!s) bad.push('"summary" is missing');
  else {
    if (s.length > SUMMARY_MAX) bad.push(`"summary" is long (${s.length} chars; at most ${SUMMARY_MAX})`);
    if (/\b(UNCONFIRMED|TODO|lorem)\b/i.test(s)) bad.push('contains a placeholder or UNCONFIRMED marker');
    if (/\n/.test(s)) bad.push('"summary" is one paragraph, no line breaks');
  }
  if (wn.source != null && !/^https:\/\/[^\s]+$/.test(wn.source)) bad.push('"source" must be an https URL');
  return bad;
}
