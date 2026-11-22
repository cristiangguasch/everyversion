// Editorial notes shown inside the Description section of an app page: hand-written per app in config/features/<slug>.json,
// rendered by the build on the page and in the .md twin.
//
// The text is written by us, in our own words, from the publisher's pages listed in `sources`. It never carries a claim we could not
// confirm on a page. `sources` and `reviewed` are not printed; they are the audit trail for whoever updates the file.
//
// File shape (see README, "Features notes"):
//   { "slug", "reviewed": "YYYY-MM-DD",
//     "best_for": "…",
//     "points": [{ "title": "…", "text": "…" }]          5 to 8 points; titles are free, so the structure differs per app
//     "sources": [{ "label": "…", "url": "https://…" }] }

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FEATURES_DIR = join(ROOT, 'config', 'features');

export function loadFeatures() {
  const out = new Map();
  if (!existsSync(FEATURES_DIR)) return out;
  for (const f of readdirSync(FEATURES_DIR).filter((x) => x.endsWith('.json')).sort()) {
    out.set(f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(FEATURES_DIR, f), 'utf8')));
  }
  return out;
}

// Problems with one features file ([] when fine). `rec` is the app record it belongs to (or undefined when the slug is unknown).
export function featureProblems(slug, feat, rec) {
  const bad = [];
  const str = (x) => typeof x === 'string' && x.trim().length > 0;
  if (!rec) bad.push('no app with this slug');
  if (feat.slug !== slug) bad.push(`"slug" must equal the file name (${slug})`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(feat.reviewed || '')) bad.push('"reviewed" must be YYYY-MM-DD');
  if (!Array.isArray(feat.points) || feat.points.length < 5 || feat.points.length > 8) bad.push('"points" needs 5 to 8 entries');
  for (const [i, p] of (feat.points || []).entries()) {
    if (!str(p.title) || !str(p.text)) bad.push(`point ${i + 1} needs a title and a text`);
    else if (p.title.length > 70) bad.push(`point ${i + 1}: title is long (${p.title.length} chars)`);
    else if (p.text.length > 520) bad.push(`point ${i + 1}: text is long (${p.text.length} chars; keep it short)`);
  }
  if (new Set((feat.points || []).map((p) => p.title)).size !== (feat.points || []).length) bad.push('point titles must be unique');
  if (!str(feat.best_for)) bad.push('"best_for" is missing');
  if (!Array.isArray(feat.sources) || !feat.sources.length) bad.push('"sources" needs at least one official page');
  for (const s of feat.sources || []) if (!str(s.label) || !/^https:\/\/[^\s]+$/.test(s.url || '')) bad.push(`bad source ${JSON.stringify(s)}`);
  const text = [feat.best_for, ...(feat.points || []).flatMap((p) => [p.title, p.text])].join(' ');
  if (/\b(UNCONFIRMED|TODO|lorem)\b/i.test(text)) bad.push('contains a placeholder or UNCONFIRMED marker');
  return bad;
}

// HTML that goes inside the Description section, right after the description paragraphs. `code` lets `backticks` become <code>.
export function featuresHtml(feat, { esc, code }) {
  return `<p class="feat-fit"><strong>Best for:</strong> ${code(feat.best_for)}</p>
<h3>Features</h3>
<ul class="feat">
${feat.points.map((p) => `<li><strong>${esc(p.title)}:</strong> ${code(p.text)}</li>`).join('\n')}
</ul>`;
}

// Markdown for the twin, placed right after the description text.
export function featuresMd(feat) {
  return [`**Best for:** ${feat.best_for}`, '', '### Features', '', ...feat.points.map((p) => `- **${p.title}:** ${p.text}`), ''].join('\n');
}
