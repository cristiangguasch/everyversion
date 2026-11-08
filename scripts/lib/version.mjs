// Version comparison modelled on winget's own: dot-separated parts, each a
// numeric prefix plus an optional suffix. A suffix (e.g. "-beta1") sorts below
// the bare number. Missing parts count as 0, so 1.0 == 1.0.0.

function parts(v) {
  return String(v)
    .trim()
    .replace(/^[vV](?=\d)/, '')
    .split('.')
    .map((p) => {
      const m = /^(\d*)(.*)$/s.exec(p);
      return { n: m[1] === '' ? 0 : parseInt(m[1], 10), s: m[2] };
    });
}

export function compareVersions(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? { n: 0, s: '' };
    const y = pb[i] ?? { n: 0, s: '' };
    if (x.n !== y.n) return x.n < y.n ? -1 : 1;
    if (x.s !== y.s) {
      if (x.s === '') return 1;
      if (y.s === '') return -1;
      return x.s < y.s ? -1 : 1;
    }
  }
  return 0;
}

/** Sort newest first. */
export function sortVersionsDesc(list, key = (x) => x) {
  return [...list].sort((a, b) => compareVersions(key(b), key(a)));
}
