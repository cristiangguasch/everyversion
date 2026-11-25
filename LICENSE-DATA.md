# Data license

Copyright (c) 2026 Cristian Gonzalez Guasch

The Everyversion data is licensed under the Creative Commons Attribution 4.0 International License (CC BY 4.0). You may copy, share and adapt it for any purpose, including commercially, as long as you give credit.

- Summary: https://creativecommons.org/licenses/by/4.0/
- Legal code: https://creativecommons.org/licenses/by/4.0/legalcode

The code (scripts, server and site assets) is under the MIT License in [LICENSE](LICENSE).

## What this covers

- `data/`, except the items listed under "Not covered" below: the app records, verification results, link checks, categories, tags and the other files we compile and maintain.
- `config/`: the app list, categories, custom sources and the hand-written feature notes.
- The same data as published on everyversion.net: the per-app `.json` and `.md` files and `/api/v1/`.

## How to give credit

Name Everyversion, link to it, name the license, and say whether you changed the data. For example:

> Data from [Everyversion](https://everyversion.net), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Modified.

## Not covered

Some of the data comes from other people and keeps their terms:

- **Fields copied from the package catalogs** keep the catalog's license: winget-pkgs manifests (MIT, Microsoft), Homebrew casks (BSD 2-Clause) and Flathub/AppStream metadata (the license each app's metadata states). This includes publisher names, descriptions, release notes, download URLs and published checksums.
- **App icons and screenshots** (`data/icons/`, `data/screenshots/`, and the app icons inside `data/og/`) belong to their publishers. They are shown only to identify each app.
- **VirusTotal results** (`data/virustotal.json`) come from VirusTotal and fall under VirusTotal's terms of service.
- **Certificates** in `data/roots/` belong to their issuers.
- **The Everyversion name and logo** (`brand/`) are not licensed for reuse, except to refer to Everyversion. See the brand guidelines on https://everyversion.net/about/#brand.
- **The Geist fonts** (`assets/fonts/`, `brand/fonts/`) are under the SIL Open Font License; see `GEIST-OFL.txt`.
