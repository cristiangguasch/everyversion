// Pull an app's own icon out of its macOS download (disk image, ZIP, installer package or tar).
// Nothing from the download is ever run: images are mounted read-only and only a few files are read.
//   extractMacIcon(file, { appHint, workDir }) -> { png: Buffer, app: 'Foo.app', how: 'icns' | 'quicklook' } | { error }
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26, timeout: 120000, killSignal: 'SIGKILL', ...opts });

/** What kind of download is this, judged from its content (names are not always honest). */
export function kindOf(file) {
  const t = run('file', ['-b', file]).stdout || '';
  if (/Zip archive/i.test(t)) return 'zip';
  if (/xar archive/i.test(t)) return 'pkg';
  if (/(zlib compressed|disk image|Apple Driver Map|bzip2 compressed|Macintosh HFS|Apple partition|DOS\/MBR|GPT)/i.test(t) || /\.dmg$/i.test(file)) return 'dmg';
  if (/(gzip|XZ compressed|tar archive|POSIX tar)/i.test(t)) return 'tar';
  return null;
}

function findApps(root, depth = 3) {
  const out = [];
  const walk = (dir, d) => {
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(dir, n);
      if (n.endsWith('.app')) {
        out.push(p);
        continue; // do not look inside an app for more apps
      }
      let isDir = false;
      try {
        isDir = statSync(p).isDirectory();
      } catch {}
      if (isDir && d < depth) walk(p, d + 1);
    }
  };
  walk(root, 0);
  return out;
}

function findFiles(root, re, depth = 3) {
  const out = [];
  const walk = (dir, d) => {
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const p = join(dir, n);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (re.test(n)) out.push([p, st.size]);
      else if (st.isDirectory() && d < depth && !n.endsWith('.app')) walk(p, d + 1);
    }
  };
  walk(root, 0);
  return out.sort((a, b) => b[1] - a[1]).map(([p]) => p);
}
const topNames = (root) => {
  try {
    return readdirSync(root).filter((n) => !n.startsWith('.')).slice(0, 10).join(', ') || '(empty)';
  } catch {
    return '(unreadable)';
  }
};

const norm = (s) => String(s || '').toLowerCase().replace(/\.app$/, '').replace(/[^a-z0-9]/g, '');
function chooseApp(apps, appHint) {
  if (!apps.length) return null;
  const want = (Array.isArray(appHint) ? appHint : [appHint]).filter(Boolean).map(norm);
  const base = (p) => p.split('/').pop();
  return apps.find((a) => want.includes(norm(base(a)))) || apps.find((a) => want.some((w) => w && norm(base(a)).includes(w))) || apps[0];
}

function iconFromApp(appDir, tmp, { fullApp = true } = {}) {
  const info = join(appDir, 'Contents', 'Info.plist');
  let plist = {};
  if (existsSync(info)) {
    const j = run('plutil', ['-convert', 'json', '-o', '-', info]);
    try {
      plist = JSON.parse(j.stdout);
    } catch {}
  }
  const res = join(appDir, 'Contents', 'Resources');
  const names = existsSync(res) ? readdirSync(res).filter((n) => n.toLowerCase().endsWith('.icns')) : [];
  let icns = null;
  const declared = plist.CFBundleIconFile;
  if (declared) {
    const want = declared.toLowerCase().endsWith('.icns') ? declared : `${declared}.icns`;
    icns = names.find((n) => n.toLowerCase() === want.toLowerCase()) || null;
  }
  if (!icns && names.length) {
    // fall back to the biggest .icns in the bundle (almost always the app icon)
    icns = names.map((n) => [n, statSync(join(res, n)).size]).sort((a, b) => b[1] - a[1])[0][0];
  }
  if (icns) {
    const out = join(tmp, 'icon.png');
    const r = run('sips', ['-s', 'format', 'png', '--resampleHeightWidthMax', '192', join(res, icns), '--out', out]);
    if (r.status === 0 && existsSync(out)) return { png: readFileSync(out), how: 'icns' };
  }
  // Apps that keep their icon in an asset catalogue: ask macOS to draw it (works only when the full app is on disk).
  if (!fullApp) return null;
  const q = run('qlmanage', ['-t', '-s', '192', '-o', tmp, appDir], { timeout: 20000 });
  const thumb = join(tmp, `${appDir.split('/').pop()}.png`);
  if (q.status === 0 && existsSync(thumb)) return { png: readFileSync(thumb), how: 'quicklook' };
  return null;
}

export function extractMacIcon(file, { appHint, workDir }) {
  mkdirSync(workDir, { recursive: true });
  const tmp = mkdtempSync(join(workDir, 'x-'));
  const kind = kindOf(file);
  let mount = null;
  try {
    let root;
    if (kind === 'dmg') {
      const r = run('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-noverify', '-plist', '-mountrandom', tmp, file], { input: 'Y\n' });
      const m = /<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/.exec(r.stdout || '');
      if (!m) return { error: `could not mount the disk image (${(r.stderr || '').trim().split('\n').pop() || 'no mount point'})` };
      mount = m[1];
      root = mount;
    } else if (kind === 'zip') {
      root = join(tmp, 'z');
      mkdirSync(root);
      // only the files we need, not the whole app
      run('unzip', ['-q', '-o', file, '*.app/Contents/Info.plist', '*.app/Contents/Resources/*.icns', '-d', root]);
    } else if (kind === 'pkg') {
      root = join(tmp, 'p');
      const r = run('pkgutil', ['--expand-full', file, root]);
      if (r.status !== 0) return { error: `could not open the package (${(r.stderr || '').trim().split('\n').pop()})` };
    } else if (kind === 'tar') {
      root = join(tmp, 't');
      mkdirSync(root);
      run('tar', ['-xf', file, '-C', root, '--include', '*.app/Contents/Info.plist', '--include', '*.app/Contents/Resources/*.icns']);
    } else {
      return { error: 'not a disk image, ZIP, package or tar archive' };
    }
    let apps = findApps(root, kind === 'pkg' ? 8 : 3);
    if (!apps.length && kind !== 'pkg') {
      // the disk image or ZIP holds an installer package instead of the app: open it and look inside
      for (const [i, pkg] of findFiles(root, /\.pkg$/i, 3).slice(0, 2).entries()) {
        const dest = join(tmp, `inner-${i}`);
        const r = run('pkgutil', ['--expand-full', pkg, dest]);
        if (r.status === 0) apps = findApps(dest, 8);
        if (apps.length) break;
      }
    }
    let app = chooseApp(apps, appHint);
    if (!app) return { error: `no .app found inside (contents: ${topNames(root)})` };
    let got = iconFromApp(app, tmp, { fullApp: kind === 'dmg' || kind === 'pkg' });
    if (!got && (kind === 'zip' || kind === 'tar')) {
      // the icon is not a plain .icns: unpack the whole app so macOS can draw it
      const full = join(tmp, 'full');
      mkdirSync(full);
      if (kind === 'zip') run('ditto', ['-xk', file, full]);
      else run('tar', ['-xf', file, '-C', full]);
      app = chooseApp(findApps(full, 3), appHint) || app;
      got = iconFromApp(app, tmp, { fullApp: true });
    }
    if (!got) return { error: `no icon found in ${app.split('/').pop()}` };
    return { ...got, app: app.split('/').pop() };
  } catch (e) {
    return { error: e.message };
  } finally {
    if (mount) run('hdiutil', ['detach', mount, '-force']);
    rmSync(tmp, { recursive: true, force: true });
  }
}
