// Deterministic, rule-based "what the installer does" summary.
// It only restates what the winget manifest declares. It is NOT a behavioural
// analysis of the binary, and the page says so. Backtick spans become <code>.

const TYPE_LABEL = {
  exe: 'a standalone setup program (.exe)',
  nullsoft: 'an NSIS (Nullsoft) setup program (.exe)',
  inno: 'an Inno Setup program (.exe)',
  wix: 'a Windows Installer package built with WiX (.msi)',
  msi: 'a Windows Installer package (.msi)',
  burn: 'a WiX Burn bootstrapper (.exe)',
  msix: 'an MSIX app package',
  appx: 'an APPX app package',
  zip: 'a ZIP archive that is unpacked',
  portable: 'a portable program that runs without being installed',
  pwa: 'a progressive web app',
  msstore: 'a Microsoft Store listing',
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

export function summariseInstaller(installers) {
  const out = [];
  if (!installers?.length) return out;

  // 1. Format, by type with the architectures that use it.
  const byType = new Map();
  for (const i of installers) {
    const key = i.type === 'zip' && i.nested_type ? `zip:${i.nested_type}` : i.type;
    if (!byType.has(key)) byType.set(key, new Set());
    byType.get(key).add(i.architecture);
  }
  const fmt = [...byType].map(([key, arches]) => {
    const [type, nested] = key.split(':');
    let label = TYPE_LABEL[type] || `a "${type}" installer`;
    if (nested) label += ` containing ${TYPE_LABEL[nested] || nested}`;
    const a = ARCH_ORDER.filter((x) => arches.has(x)).map((x) => ARCH_LABEL[x]);
    return `${label} for ${joinList(a)}`;
  });
  out.push(`Delivered as ${joinList(fmt)}.`);

  // 2. Scope and elevation.
  const scopes = uniq(installers.map((i) => i.scope).filter(Boolean));
  const allScoped = installers.every((i) => i.scope);
  if (scopes.length === 1 && allScoped) {
    out.push(
      scopes[0] === 'user'
        ? 'Installs for the current user only, so administrator rights are normally not needed.'
        : 'Installs for all users on the PC, which normally requires administrator rights.',
    );
  } else if (scopes.length > 1) {
    out.push('Offers both a per-user and an all-users installer.');
  } else {
    out.push('The manifest does not state an install scope.');
  }
  const elev = uniq(installers.map((i) => i.elevation_requirement).filter(Boolean));
  if (elev.includes('elevatesSelf')) out.push('The installer asks Windows for administrator rights itself.');
  else if (elev.includes('elevationRequired')) out.push('Must be run with administrator rights.');
  else if (elev.includes('elevationProhibited')) out.push('Must not be run with administrator rights.');

  // 3. Unattended install.
  const silent = uniq(installers.map((i) => i.switches?.silent).filter(Boolean));
  if (silent.length) {
    out.push(`Supports unattended install with ${joinList(silent.map((s) => `\`${s}\``))}.`);
  } else {
    const defs = uniq(installers.map((i) => WINGET_DEFAULT_SILENT[i.type]).filter(Boolean));
    if (defs.length && installers.every((i) => WINGET_DEFAULT_SILENT[i.type])) {
      out.push(`No custom silent switch is declared; winget falls back to its default for this installer type (${joinList(defs.map((s) => `\`${s}\``))}).`);
    } else if (!installers.some((i) => ['msix', 'appx', 'zip', 'portable'].includes(i.type))) {
      out.push('No silent-install switch is declared in the manifest.');
    }
  }
  const modes = uniq(installers.flatMap((i) => i.install_modes || []));
  if (modes.length) out.push(`Declared install modes: ${joinList(modes)}.`);

  // 4. System integration.
  const protocols = uniq(installers.flatMap((i) => i.protocols || []));
  if (protocols.length) out.push(`Registers the ${joinList(protocols.map((p) => `\`${p}://\``))} link protocol.`);
  const exts = uniq(installers.flatMap((i) => i.file_extensions || []));
  if (exts.length) out.push(`Associates with the file ${exts.length === 1 ? 'type' : 'types'} ${joinList(exts.slice(0, 12).map((e) => `\`.${e}\``))}${exts.length > 12 ? ' and others' : ''}.`);
  const cmds = uniq(installers.flatMap((i) => i.commands || []));
  if (cmds.length) out.push(`Adds the command-line ${cmds.length === 1 ? 'command' : 'commands'} ${joinList(cmds.slice(0, 10).map((c) => `\`${c}\``))}.`);
  const entries = uniq(installers.flatMap((i) => (i.apps_and_features || []).map((e) => e.display_name).filter(Boolean)));
  if (entries.length) out.push(`Shows up in Windows “Installed apps” as ${joinList(entries.slice(0, 4).map((e) => `“${e}”`))}.`);
  if (installers.some((i) => ['msix', 'appx'].includes(i.type))) out.push('Packaged apps run with a declared set of capabilities and are installed per user by Windows.');

  // 5. Dependencies and requirements.
  const feats = uniq(installers.flatMap((i) => i.dependencies?.windows_features || []));
  const libs = uniq(installers.flatMap((i) => i.dependencies?.windows_libraries || []));
  const pkgs = uniq(installers.flatMap((i) => i.dependencies?.packages || []));
  if (pkgs.length) out.push(`Needs ${pkgs.length === 1 ? 'this winget package' : 'these winget packages'} first: ${joinList(pkgs.map((p) => `\`${p}\``))}.`);
  if (feats.length) out.push(`Requires the Windows ${feats.length === 1 ? 'feature' : 'features'} ${joinList(feats.map((p) => `\`${p}\``))}.`);
  if (libs.length) out.push(`Requires the Windows ${libs.length === 1 ? 'library' : 'libraries'} ${joinList(libs.map((p) => `\`${p}\``))}.`);
  const minOs = uniq(installers.map((i) => i.min_os_version).filter(Boolean));
  if (minOs.length === 1) out.push(`Minimum Windows version: \`${minOs[0]}\`.`);

  // 6. Upgrades.
  const up = uniq(installers.map((i) => i.upgrade_behavior).filter(Boolean));
  if (up.length === 1) {
    if (up[0] === 'install') out.push('Upgrades install over the existing version.');
    else if (up[0] === 'uninstallPrevious') out.push('Upgrades remove the previous version first.');
    else if (up[0] === 'deny') out.push('The manifest blocks in-place upgrades through winget.');
  }
  return out;
}

// ---------------------------------------------------------------- macOS (Homebrew cask)

const MAC_TYPE = {
  dmg: 'a disk image (.dmg)',
  pkg: 'a macOS installer package (.pkg)',
  zip: 'a ZIP archive',
  tar: 'a compressed tar archive',
  unknown: 'a download whose format the URL does not state',
};
const MAC_ARCH = { universal: 'Apple silicon and Intel', arm64: 'Apple silicon (ARM64)', x64: 'Intel (x64)' };

export function summariseCask(version) {
  const out = [];
  const ins = version.installers || [];
  const c = version.cask || {};
  if (!ins.length) return out;

  // 1. Format and architectures
  const byType = new Map();
  for (const i of ins) {
    if (!byType.has(i.type)) byType.set(i.type, []);
    byType.get(i.type).push(MAC_ARCH[i.architecture] || i.architecture);
  }
  out.push(`Delivered as ${joinList([...byType].map(([t, a]) => `${MAC_TYPE[t] || t} for ${joinList(uniq(a))}`))}.`);

  // 2. What gets installed
  if (c.apps?.length) out.push(`Installs the app ${joinList(c.apps.map((a) => `\`${a}\``))} into the Applications folder.`);
  if (c.pkgs?.length) out.push(`Runs the installer ${c.pkgs.length === 1 ? 'package' : 'packages'} ${joinList(c.pkgs.map((a) => `\`${a}\``))}; package installers usually ask for an administrator password and can place files anywhere on the system.`);
  if (c.manual_installer) out.push('Includes an installer step that the cask hands over to the vendor’s own setup program.');
  if (c.binaries?.length) out.push(`Adds the command-line ${c.binaries.length === 1 ? 'tool' : 'tools'} ${joinList(c.binaries.slice(0, 8).map((b) => `\`${b}\``))}${c.binaries.length > 8 ? ` and ${c.binaries.length - 8} more` : ''} when installed with Homebrew.`);
  if (c.other_artifacts?.length) out.push(`Also installs: ${joinList(c.other_artifacts.map((a) => a.replace(/_/g, ' ')))}.`);

  // 3. Requirements and updates
  const minOs = uniq(ins.map((i) => i.min_os_version).filter(Boolean));
  if (minOs.length === 1) out.push(`Requires macOS ${minOs[0]} or later.`);
  const deps = [...(c.depends_on?.casks || []), ...(c.depends_on?.formulae || [])];
  if (deps.length) out.push(`Needs ${deps.length === 1 ? 'this Homebrew package' : 'these Homebrew packages'} first: ${joinList(deps.map((d) => `\`${d}\``))}.`);
  if (c.auto_updates) out.push('The app updates itself, so it may be newer than the version Homebrew lists.');

  // 4. Removal
  const cl = c.cleanup || {};
  const steps = [];
  if (cl.quit?.length) steps.push('asks the app to quit');
  if (cl.launchctl?.length) steps.push('stops background services');
  if (cl.pkgutil?.length) steps.push('forgets installer package receipts');
  if (cl.login_items?.length) steps.push('removes login items');
  if (cl.remove?.length) steps.push(`deletes ${cl.remove.length} extra ${cl.remove.length === 1 ? 'file' : 'files'}`);
  if (steps.length) out.push(`On uninstall, Homebrew ${joinList(steps)}.`);
  if (cl.zap_paths?.length) out.push(`A full “zap” removal also deletes up to ${cl.zap_paths.length} support, cache and preference ${cl.zap_paths.length === 1 ? 'location' : 'locations'} in your home folder.`);

  // 5. Integrity
  if (ins.some((i) => i.no_checksum)) out.push('The cask does not pin a checksum for this download (an unversioned URL), so the file can change without notice.');
  return out;
}

// ---------------------------------------------------------------- archives from a publisher's own feed (custom sources)

const ARCHIVE_TYPE = { tar: 'a compressed tar archive (.tgz)', zip: 'a ZIP archive', dmg: 'a disk image (.dmg)', exe: 'a setup program (.exe)', swu: 'a firmware update package (.swu)' };
const ARCHIVE_ARCH = { ...ARCH_LABEL, universal: 'both Apple silicon and Intel Macs' };

export function summariseArchive(version) {
  const ins = version.installers || [];
  const out = [];
  if (!ins.length) return out;
  const byType = new Map();
  for (const i of ins) {
    if (!byType.has(i.type)) byType.set(i.type, new Set());
    byType.get(i.type).add(i.architecture);
  }
  const archOrder = ['universal', ...ARCH_ORDER];
  out.push(`Delivered as ${joinList([...byType].map(([t, a]) => `${ARCHIVE_TYPE[t] || `a "${t}" file`} for ${joinList(archOrder.filter((x) => a.has(x)).map((x) => ARCHIVE_ARCH[x]))}`))}.`);
  const has = (...t) => ins.some((i) => t.includes(i.type));
  if (has('zip', 'tar')) out.push('Archives are unpacked by you, not run as an installer program, so the download itself changes nothing on your computer until you extract and run what is inside.');
  if (has('dmg')) out.push('A disk image opens in Finder; the download itself changes nothing on your Mac until you open it and run what is inside.');
  if (has('exe')) out.push('A setup program changes your computer when you run it, not when you download it.');
  if (has('swu')) out.push('A firmware update package is installed on the device itself, not on your computer.');
  // Where the checksum on this page comes from.
  const withSha = ins.filter((i) => i.sha256);
  const fromCask = withSha.filter((i) => i.checksum_source === 'Homebrew cask');
  if (withSha.length === ins.length && !fromCask.length) out.push('The publisher posts a SHA-256 file next to each download, and the checksum shown on this page is taken from it.');
  else if (withSha.length === ins.length) out.push('The publisher posts no checksum for these downloads; the SHA-256 shown on this page is the one a Homebrew cask pins for the file.');
  else if (withSha.length) out.push('The publisher posts no checksum for these downloads. Where a SHA-256 is shown, it is the one a Homebrew cask pins; for the others we compute it from the file when we check it.');
  else out.push('The publisher posts no checksum for these downloads. Where this page shows a SHA-256, we computed it from the file ourselves.');
  return out;
}

export function summarise(version, { custom = false } = {}) {
  if (custom) return summariseArchive(version);
  return version.platform === 'macos' ? summariseCask(version) : summariseInstaller(version.installers);
}
