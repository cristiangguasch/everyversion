// Deterministic, rule-based "what the installer does" summary.
// It only restates what the winget manifest declares. It is NOT a behavioural
// analysis of the binary, and the page says so. Backtick spans become <code>.
//
// Each summary is a list of [label, value] rows. The page merges the rows of every
// platform into one table, so a label must mean the same thing on each platform.
// Facts the source does not state are left out rather than shown as "not stated".

const TYPE_LABEL = {
  exe: 'Setup program (.exe)',
  nullsoft: 'NSIS setup (.exe)',
  inno: 'Inno Setup (.exe)',
  wix: 'WiX installer (.msi)',
  msi: 'Windows Installer (.msi)',
  burn: 'WiX Burn bootstrapper (.exe)',
  msix: 'MSIX package',
  appx: 'APPX package',
  zip: 'ZIP archive',
  portable: 'Portable program (no install needed)',
  pwa: 'Progressive web app',
  msstore: 'Microsoft Store listing',
  flatpak: 'Flatpak',
};

// Switches winget itself applies when the manifest declares none.
const WINGET_DEFAULT_SILENT = {
  nullsoft: '/S',
  inno: '/SP- /VERYSILENT /SUPPRESSMSGBOXES /NORESTART',
  wix: '/quiet /norestart',
  msi: '/quiet /norestart',
  burn: '/quiet /norestart',
};

const ARCH_LABEL = { x64: 'x64', x86: 'x86', arm64: 'ARM64', arm: 'ARM', neutral: 'any architecture' };

const uniq = (a) => [...new Set(a)];
const joinList = (a) => (a.length <= 2 ? a.join(' and ') : `${a.slice(0, -1).join(', ')}, and ${a.at(-1)}`);
const ARCH_ORDER = ['x64', 'x86', 'arm64', 'arm', 'neutral'];
// "Setup program" reads as "setup program" mid-list; names and acronyms (Inno, Windows, WiX, NSIS, ZIP) keep their case.
const lowerFirst = (s) => (/^[A-Z][a-z]*\b/.test(s) && !/^(Inno|Windows|Microsoft|Flatpak|StuffIt|BinHex)\b/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const code = (a) => a.map((x) => `\`${x}\``);
// Several sentences in one cell end with a full stop; a single phrase does not.
const sentences = (a) => (a.length > 1 ? `${a.join('. ')}.` : a[0]);
const more = (a, n) => `${a.slice(0, n).join(', ')}${a.length > n ? ` and ${a.length - n} more` : ''}`;

// Formats, comma-separated. Architectures are a row of their own, so they are added per format
// only when the formats do not all cover the same ones.
function packageRow(groups, label, archLabel, archOrder) {
  const sets = groups.map(([, a]) => archOrder.filter((x) => a.has(x)).join(','));
  const same = uniq(sets).length === 1;
  return groups
    .map(([key, a], k) => {
      const name = k ? lowerFirst(label(key)) : label(key);
      return same ? name : `${name} (${archOrder.filter((x) => a.has(x)).map((x) => archLabel[x] || x).join(', ')})`;
    })
    .join(same ? ', ' : '; ');
}

const groupBy = (ins, keyOf) => {
  const m = new Map();
  for (const i of ins) {
    const k = keyOf(i);
    if (!m.has(k)) m.set(k, new Set());
    m.get(k).add(i.architecture);
  }
  return [...m];
};

export function summariseInstaller(installers) {
  const out = [];
  if (!installers?.length) return out;

  // 1. Format.
  const typeName = (key) => {
    const [type, nested] = key.split(':');
    const name = TYPE_LABEL[type] || `“${type}” installer`;
    if (!nested) return name;
    const inner = nested === 'portable' ? 'portable program' : lowerFirst(TYPE_LABEL[nested] || nested);
    return `${name} with ${/^([aeiouAEIOU]|NSIS|MSI)/.test(inner) ? 'an' : 'a'} ${inner}`;
  };
  out.push(['Package', packageRow(groupBy(installers, (i) => (i.type === 'zip' && i.nested_type ? `zip:${i.nested_type}` : i.type)), typeName, ARCH_LABEL, ARCH_ORDER)]);

  // 2. Scope and elevation.
  const scopes = uniq(installers.map((i) => i.scope).filter(Boolean));
  if (scopes.length === 1 && installers.every((i) => i.scope)) {
    out.push(['Install scope', scopes[0] === 'user' ? 'Current user only, so administrator rights are normally not needed' : 'All users on the PC, which normally needs administrator rights']);
  } else if (scopes.length > 1) {
    out.push(['Install scope', 'A per-user and an all-users installer']);
  }
  const elev = uniq(installers.map((i) => i.elevation_requirement).filter(Boolean));
  if (elev.includes('elevatesSelf')) out.push(['Admin rights', 'The installer asks Windows for them itself']);
  else if (elev.includes('elevationRequired')) out.push(['Admin rights', 'Must be run as administrator']);
  else if (elev.includes('elevationProhibited')) out.push(['Admin rights', 'Must not be run as administrator']);

  // 3. Unattended install.
  const silent = uniq(installers.map((i) => i.switches?.silent).filter(Boolean));
  if (silent.length) {
    out.push(['Silent install', joinList(code(silent))]);
  } else {
    const defs = uniq(installers.map((i) => WINGET_DEFAULT_SILENT[i.type]).filter(Boolean));
    if (defs.length && installers.every((i) => WINGET_DEFAULT_SILENT[i.type])) out.push(['Silent install', `None declared; winget uses its default, ${joinList(code(defs))}`]);
  }
  const modes = uniq(installers.flatMap((i) => i.install_modes || []));
  if (modes.length) out.push(['Install modes', joinList(modes)]);

  // 4. System integration.
  const protocols = uniq(installers.flatMap((i) => i.protocols || []));
  if (protocols.length) out.push(['Link protocols', joinList(protocols.map((p) => `\`${p}://\``))]);
  const exts = uniq(installers.flatMap((i) => i.file_extensions || []));
  if (exts.length) out.push(['File types', more(exts.map((e) => `\`.${e}\``), 12)]);
  const cmds = uniq(installers.flatMap((i) => i.commands || []));
  if (cmds.length) out.push(['Commands', more(code(cmds), 10)]);
  const entries = uniq(installers.flatMap((i) => (i.apps_and_features || []).map((e) => e.display_name).filter(Boolean)));
  if (entries.length) out.push(['Listed in Installed apps as', joinList(entries.slice(0, 4).map((e) => `“${e}”`))]);
  if (installers.some((i) => ['msix', 'appx'].includes(i.type))) out.push(['Packaged app', 'Runs with a declared set of capabilities; Windows installs it per user']);
  // Dependencies and the minimum Windows version come from the requirements rows on the page.

  // 5. Upgrades.
  const up = uniq(installers.map((i) => i.upgrade_behavior).filter(Boolean));
  if (up.length === 1) {
    const v = { install: 'Installs over the existing version', uninstallPrevious: 'Removes the previous version first', deny: 'The manifest blocks in-place upgrades through winget' }[up[0]];
    if (v) out.push(['Upgrades', v]);
  }
  return out;
}

// ---------------------------------------------------------------- macOS (Homebrew cask)

const MAC_TYPE = {
  dmg: 'Disk image (.dmg)',
  pkg: 'macOS installer package (.pkg)',
  zip: 'ZIP archive',
  tar: 'Compressed tar archive',
  unknown: 'Download whose format the URL does not state',
};
const MAC_ARCH = { universal: 'Apple silicon and Intel', arm64: 'Apple silicon', x64: 'Intel' };
const MAC_ARCH_ORDER = ['universal', 'x64', 'arm64'];

export function summariseCask(version) {
  const out = [];
  const ins = version.installers || [];
  const c = version.cask || {};
  if (!ins.length) return out;

  // 1. Format
  out.push(['Package', packageRow(groupBy(ins, (i) => i.type), (t) => MAC_TYPE[t] || t, MAC_ARCH, MAC_ARCH_ORDER)]);

  // 2. What gets installed
  const what = [];
  if (c.apps?.length) what.push(`${joinList(code(c.apps))} in the Applications folder`);
  if (c.pkgs?.length) what.push(`Runs ${joinList(code(c.pkgs))}; package installers usually ask for an administrator password and can place files anywhere on the system`);
  if (c.manual_installer) what.push('Hands over to the vendor’s own setup program');
  if (what.length) out.push(['Installs', sentences(what)]);
  if (c.binaries?.length) out.push(['Commands', `${more(code(c.binaries), 8)} (when installed with Homebrew)`]);
  if (c.other_artifacts?.length) out.push(['Also installs', joinList(c.other_artifacts.map((a) => a.replace(/_/g, ' ')))]);

  // 3. Updates. The minimum macOS version and cask dependencies come from the requirements rows on the page.
  if (c.auto_updates) out.push(['Updates itself', 'Yes, so it may be newer than the version Homebrew lists']);

  // 4. Removal
  const cl = c.cleanup || {};
  const steps = [];
  if (cl.quit?.length) steps.push('asks the app to quit');
  if (cl.launchctl?.length) steps.push('stops background services');
  if (cl.pkgutil?.length) steps.push('forgets installer package receipts');
  if (cl.login_items?.length) steps.push('removes login items');
  if (cl.remove?.length) steps.push(`deletes ${cl.remove.length} extra ${cl.remove.length === 1 ? 'file' : 'files'}`);
  const removal = [];
  if (steps.length) removal.push(`Homebrew ${joinList(steps)}`);
  if (cl.zap_paths?.length) removal.push(`A full “zap” removal also deletes up to ${cl.zap_paths.length} support, cache and preference ${cl.zap_paths.length === 1 ? 'location' : 'locations'} in your home folder`);
  if (removal.length) out.push(['Uninstall', sentences(removal)]);

  // 5. Integrity
  if (ins.some((i) => i.no_checksum)) out.push(['Checksum', 'The cask pins none for this download (an unversioned URL), so the file can change without notice']);
  return out;
}

// ---------------------------------------------------------------- archives from a publisher's own feed (custom sources)

const ARCHIVE_TYPE = { tar: 'Compressed tar archive (.tgz)', zip: 'ZIP archive', dmg: 'Disk image (.dmg)', exe: 'Setup program (.exe)', swu: 'Firmware update package (.swu)', sit: 'StuffIt archive (.sit)', hqx: 'BinHex archive (.hqx)' };
const ARCHIVE_ARCH = { ...ARCH_LABEL, universal: 'Apple silicon and Intel' };

export function summariseArchive(version) {
  const ins = version.installers || [];
  const out = [];
  if (!ins.length) return out;
  out.push(['Package', packageRow(groupBy(ins, (i) => i.type), (t) => ARCHIVE_TYPE[t] || `“${t}” file`, ARCHIVE_ARCH, ['universal', ...ARCH_ORDER])]);
  const has = (...t) => ins.some((i) => t.includes(i.type));
  const effect = [];
  if (has('zip', 'tar')) effect.push('Archives are unpacked by you, not run as an installer program, so the download changes nothing on your computer until you extract and run what is inside');
  if (has('dmg')) effect.push('A disk image opens in Finder; the download changes nothing on your Mac until you open it and run what is inside');
  if (has('exe')) effect.push('A setup program changes your computer when you run it, not when you download it');
  if (has('sit', 'hqx')) effect.push('StuffIt and BinHex files are classic Mac OS archives: they need an old Mac or a tool that can open them');
  if (has('swu')) effect.push('A firmware update package is installed on the device itself, not on your computer');
  if (effect.length) out.push(['What it changes', sentences(effect)]);
  // Where the checksum on this page comes from.
  const withSha = ins.filter((i) => i.sha256);
  const fromCask = withSha.filter((i) => i.checksum_source === 'Homebrew cask');
  out.push([
    'Checksum',
    withSha.length === ins.length && !fromCask.length
      ? 'The publisher posts a SHA-256 file next to each download, and the checksum shown on this page is taken from it'
      : withSha.length === ins.length
        ? 'The publisher posts none; the SHA-256 shown on this page is the one a Homebrew cask pins for the file'
        : withSha.length
          ? 'The publisher posts none. Where a SHA-256 is shown, it is the one a Homebrew cask pins; for the others we compute it from the file when we check it.'
          : 'The publisher posts none. Where this page shows a SHA-256, we computed it from the file ourselves.',
  ]);
  return out;
}

export function summarise(version, { custom = false } = {}) {
  if (custom) return summariseArchive(version);
  return version.platform === 'macos' ? summariseCask(version) : summariseInstaller(version.installers);
}
