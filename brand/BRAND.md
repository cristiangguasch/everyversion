# Everyversion brand guide

## Name

| Where | Write it as |
|---|---|
| Prose, page titles, `og:site_name`, structured data (`name`) | **Everyversion** (one word, capital E only) |
| Logo wordmark | **everyversion** in lowercase, with an optional lighter **.net** |
| URLs, canonical links, `llms.txt`, API | `everyversion.net` |

Never: "Every Version", "EveryVersion", "Everyversion.net" in running text.
The name is set in one place for the site: `SITE.name` in `scripts/build.mjs`
(static pages are in `scripts/lib/pages.mjs`).

## Positioning

Everyversion is a plain, trustworthy archive of software versions. Every version is
linked straight to the publisher and has a checksum you can verify before you run it.
We host no installers and bundle nothing. It is closer to FossHub and Flathub (calm,
specific, trust stated in the copy) than to a download portal.

## Voice

Friendly but not slang. Bold and honest.

- Warm and clear. Short sentences. No slang, no hype, no exclamation marks.
- Say what is true and what we checked. Say what we could not check.
- No scare tactics. A risk is stated as a fact with its numbers ("3 of 70 engines flagged").
- Prefer the concrete claim to the adjective: "official links, SHA-256 checksums,
  no installers hosted" rather than "safe and fast".

## Mark

Three stacked down-chevrons on a rounded square. The front one is solid, the ones behind
it fade: versions piled up over time, and the one you pick is the one you download.

- Source: `mark.svg` (square, 32x32 grid). Raster: `mark-512.png`.
- Favicons in `assets/`: `favicon.ico` (16/32/48), `favicon-48x48.png`
  (Google asks for multiples of 48px), `apple-touch-icon.png` (180px).
- Keep the tile blue; do not recolour, rotate, add shadows or outline the chevrons.
- Clear space around the tile: at least a quarter of its width.
- Minimum size: 16px (the chevrons are drawn heavy so they survive favicon size).

## Logo files

- `logo.svg` (for light backgrounds), `logo-dark.svg` (for dark backgrounds), `logo.png` (1200px, white background).
  Text is converted to outlines, so no font is needed.
- `mark.svg` and `mark-512.png` are the mark alone, for square spaces.

## Wordmark

`everyversion` in Geist Bold, lowercase, tracking -0.035em, next to the mark.
`.net` follows in Geist Regular in the muted grey, and may be dropped where the
space is tight (app icon, social avatar, footer).

## Colour

| Role | Light | Dark | Use |
|---|---|---|---|
| Version Blue | `#1d4fe0` | `#7aa2ff` | Brand, links, primary buttons, the mark tile |
| Verified Green | `#0a7d52` | `#3fcf8e` (text), `#0a7d52` (button fill) | Download buttons, "safe", "verified", checksums that match |
| Ink | `#15181d` | `#e8ebef` | Text |
| Muted | `#5b6472` | `#9aa4b2` | Secondary text, `.net` suffix |
| Surface / line | `#f6f7f9` / `#dfe3e8` | `#171b21` / `#2a313a` | Cards, borders |

Blue says "this is Everyversion"; green only ever says "this was checked or is safe to act on".
Do not use green decoratively. Warnings keep the existing amber.
The blue is a deep ultramarine and the green a deep emerald, on purpose: both are darker
and more saturated than the light-cyan blue and mint green used by the big download portals.

## Type

- **Geist** (variable, SIL OFL; `assets/fonts/geist.woff2`) for the wordmark and h1 to h3.
- **System fonts** (`system-ui`) for body text, tables and UI. Fast, no layout shift.
- Mono (`ui-monospace`) for hashes, versions and file names.
