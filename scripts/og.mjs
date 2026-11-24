// Share images (og:image) for app pages: 1200x630 PNG with the app icon, the app name, the Everyversion logo and the platform icons.
//
// Each image is made once and kept in data/og/<slug>.png. data/og.json records what it was made from (a hash of the app name and the
// icon file). An image is only made again when the name or the icon changes, or with --force.
//
//   node scripts/og.mjs                        make missing or outdated images for every app
//   node scripts/og.mjs --only=vlc,zed         only these slugs
//   node scripts/og.mjs --out=<dir> --only=…   write samples to <dir> and leave data/og untouched
//   node scripts/og.mjs --force                remake even when nothing changed

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { PLATFORM_PATHS } from './lib/platform-icons.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OG_DIR = join(ROOT, 'data', 'og');
const OG_INDEX = join(ROOT, 'data', 'og.json');
const W = 1200, H = 630;

// Brand (brand/BRAND.md): light palette, since share previews do not follow dark mode.
const C = { blue: '#1d4fe0', ink: '#15181d', muted: '#5b6472', surface: '#f6f7f9', line: '#dfe3e8', bg: '#ffffff' };

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const only = args.only ? new Set(String(args.only).split(',').map((s) => s.trim())) : null;
const outDir = args.out ? resolve(String(args.out)) : OG_DIR;
const sample = Boolean(args.out);

const fonts = [
  { name: 'Geist', data: readFileSync(join(ROOT, 'brand', 'fonts', 'Geist-Bold.ttf')), weight: 700, style: 'normal' },
  { name: 'Geist', data: readFileSync(join(ROOT, 'brand', 'fonts', 'Geist-Regular.ttf')), weight: 400, style: 'normal' },
];
const icons = JSON.parse(readFileSync(join(ROOT, 'data', 'icons.json'), 'utf8'));
const logoSvg = readFileSync(join(ROOT, 'brand', 'logo.svg'), 'utf8');
const dataUri = (mime, buf) => `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;

// Element helper in the shape satori reads (no JSX build step needed).
const h = (type, style, children) => ({ type, props: { style: { display: 'flex', ...style }, children } });
const img = (src, width, height, style = {}) => ({ type: 'img', props: { src, width, height, style } });

function platformIcon(p, size) {
  const d = PLATFORM_PATHS[p];
  const paint = d.stroke ? `fill="none" stroke="${C.ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"` : `fill="${C.ink}"`;
  return img(dataUri('image/svg+xml', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ${paint}>${d.body}</svg>`), size, size);
}

// Name size steps down with length so long names still fit on two lines.
const nameSize = (name) => (name.length <= 12 ? 88 : name.length <= 20 ? 76 : name.length <= 30 ? 64 : 54);

// The app's own icon, or null. The generic GitHub mark (source "github-project") is a stand-in, not the app's image,
// so those apps get the letter tile like apps with no icon.
function ownIcon(slug) {
  const icon = icons[slug];
  if (!icon || icon.source === 'github-project') return null;
  const file = join(ROOT, 'data', 'icons', icon.file);
  return existsSync(file) ? { ...icon, path: file } : null;
}

function card(rec) {
  const icon = ownIcon(rec.slug);
  const iconFile = icon?.path;
  let iconEl;
  if (icon) {
    const src = dataUri(icon.ext === 'svg' ? 'image/svg+xml' : 'image/png', readFileSync(iconFile));
    // macOS app icons already carry their own shape; others sit on a light tile.
    iconEl = icon.source === 'macos-app-bundle'
      ? img(src, 200, 200)
      : h('div', { width: 200, height: 200, borderRadius: 44, background: C.surface, border: `2px solid ${C.line}`, alignItems: 'center', justifyContent: 'center' }, [img(src, 140, 140)]);
  } else {
    // No icon: the first letter on a Version Blue tile.
    iconEl = h('div', { width: 200, height: 200, borderRadius: 44, background: C.blue, color: '#fff', fontSize: 110, fontWeight: 700, alignItems: 'center', justifyContent: 'center' }, rec.name.trim()[0].toUpperCase());
  }

  const plats = ['windows', 'macos', 'linux'].filter((p) => rec.platforms.includes(p));
  // The page's lead line (the app summary); long ones are cut at three lines with an ellipsis.
  const sub = (rec.summary || '').trim();

  return h('div', { width: W, height: H, background: C.bg, fontFamily: 'Geist', color: C.ink, flexDirection: 'column' }, [
    h('div', { height: 14, width: W, background: C.blue }, []),
    h('div', { flex: 1, flexDirection: 'column', padding: '0 88px', justifyContent: 'space-between' }, [
      h('div', { flex: 1, alignItems: 'center', gap: 56 }, [
        iconEl,
        h('div', { flexDirection: 'column', flex: 1, gap: 18 }, [
          h('div', { fontSize: nameSize(rec.name), fontWeight: 700, letterSpacing: '-0.035em', lineHeight: 1.05, lineClamp: 2, display: 'block' }, rec.name),
          ...(sub ? [h('div', { fontSize: 30, fontWeight: 400, color: C.muted, lineHeight: 1.35, lineClamp: 3, display: 'block' }, sub)] : []),
        ]),
      ]),
      h('div', { height: 120, alignItems: 'center', justifyContent: 'space-between', borderTop: `2px solid ${C.line}` }, [
        img(dataUri('image/svg+xml', logoSvg), 336, 48),
        h('div', { gap: 30, alignItems: 'center' }, plats.map((p) => platformIcon(p, 46))),
      ]),
    ]),
  ]);
}

// What the image depends on: the name and the icon bytes. Platforms are drawn too but, by choice, do not trigger a remake.
function inputHash(rec) {
  const icon = ownIcon(rec.slug);
  const iconSha = icon ? createHash('sha256').update(readFileSync(icon.path)).digest('hex') : 'none';
  return createHash('sha256').update(`${rec.name}\n${iconSha}`).digest('hex').slice(0, 16);
}

const index = !sample && existsSync(OG_INDEX) ? JSON.parse(readFileSync(OG_INDEX, 'utf8')) : {};
const saveIndex = () => writeFileSync(OG_INDEX, JSON.stringify(Object.fromEntries(Object.entries(index).sort()), null, 2) + '\n');
mkdirSync(outDir, { recursive: true });
let made = 0, kept = 0;
for (const f of readdirSync(join(ROOT, 'data', 'apps')).filter((x) => x.endsWith('.json')).sort()) {
  const rec = JSON.parse(readFileSync(join(ROOT, 'data', 'apps', f), 'utf8'));
  if (only && !only.has(rec.slug)) continue;
  const hash = inputHash(rec);
  const out = join(outDir, `${rec.slug}.png`);
  if (!sample && !args.force && index[rec.slug]?.hash === hash && existsSync(out)) { kept++; continue; }
  const svg = await satori(card(rec), { width: W, height: H, fonts });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng();
  writeFileSync(out, png);
  if (!sample) {
    index[rec.slug] = { hash, made: new Date().toISOString().slice(0, 10) };
    saveIndex(); // after every image, so an interrupted run keeps what it made
  }
  made++;
  console.log(`${rec.slug}.png ${(png.length / 1024).toFixed(0)} KB`);
}
console.log(`og images: ${made} made, ${kept} unchanged${sample ? ` (samples in ${outDir})` : ''}`);
