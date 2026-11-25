// /statistics/: public usage statistics, drawn from /stats-data.php (which reads the NDJSON event files).
// Plain SVG and HTML, no libraries. Visitors are counted per day only: the Visitors tile adds up the daily counts, so a person who returns on another day is counted again.
(() => {
  const root = document.getElementById('stats');
  if (!root) return;
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const nf = new Intl.NumberFormat('en');
  const compact = (n) => (n >= 1e6 ? +(n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? +(n / 1e3).toFixed(1) + 'K' : nf.format(n));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fmtDay = (d, withYear) => new Date(d + 'T00:00:00Z').toLocaleDateString('en', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  const regionName = (() => {
    try {
      const r = new Intl.DisplayNames(['en'], { type: 'region' });
      return (cc) => (cc === 'XX' ? 'Unknown' : r.of(cc) || cc);
    } catch (e) {
      return (cc) => (cc === 'XX' ? 'Unknown' : cc);
    }
  })();
  const SLOT = {
    'windows|row': 'Windows: Download button',
    'macos|row': 'Mac: Download button',
    'linux|row': 'Linux: Download button',
    'windows|version': 'Windows: older version Download',
    'macos|version': 'Mac: older version Download',
    'linux|version': 'Linux: older version Download',
    'linux|install': 'Linux: Install button',
    'linux|copy-install': 'Linux: copy install command',
    'linux|copy-run': 'Linux: copy run command',
    'windows|copy-winget': 'Windows: copy winget command',
    'macos|copy-brew': 'Mac: copy Homebrew command',
    'linux|copy-flatpak': 'Linux: copy Flatpak command (footer)',
  };
  const PLAT = { windows: 'Windows', macos: 'Mac', linux: 'Linux' };
  const PAGE = { home: 'Home', app: 'App pages', platform: 'Platform lists', category: 'Category pages', other: 'Other pages' };
  const DEVICE = { desktop: 'Desktop', mobile: 'Mobile', tablet: 'Tablet' };
  const LANG = (() => {
    try {
      const r = new Intl.DisplayNames(['en'], { type: 'language' });
      return (l) => r.of(l) || l;
    } catch (e) {
      return (l) => l;
    }
  })();

  let names = {};
  let days = 30;

  // ---------------------------------------------------------------- charts
  const nice = (m) => {
    if (m <= 4) return 4;
    const p = 10 ** Math.floor(Math.log10(m));
    const f = m / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  };
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  };

  /** One line chart: 2px line, a 10% wash under it, hairline grid, end dot, crosshair + tooltip on hover or arrow keys. */
  function lineChart(host, series, key, unit) {
    host.textContent = '';
    const W = 720;
    const H = 210;
    const m = { l: 44, r: 16, t: 14, b: 28 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const n = series.length;
    const vals = series.map((d) => d[key]);
    const max = nice(Math.max(...vals, 0));
    const x = (i) => m.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
    const y = (v) => m.t + ih - (v / max) * ih;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sv', role: 'img', tabindex: '0', 'aria-label': `${unit} per day, ${fmtDay(series[0].d, true)} to ${fmtDay(series[n - 1].d, true)}. Latest day: ${nf.format(vals[n - 1])}. A table with every value follows the charts.` });
    for (let t = 0; t <= 4; t++) {
      const v = (max / 4) * t;
      el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'sv-grid' }, svg);
      const tx = el('text', { x: m.l - 8, y: y(v) + 4, class: 'sv-tick', 'text-anchor': 'end' }, svg);
      tx.textContent = compact(Math.round(v * 10) / 10);
    }
    const labelEvery = Math.max(1, Math.round(n / 5));
    for (let i = 0; i < n; i += labelEvery) {
      const tx = el('text', { x: x(i), y: H - 8, class: 'sv-tick', 'text-anchor': i === 0 ? 'start' : 'middle' }, svg);
      tx.textContent = fmtDay(series[i].d);
    }
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    if (n > 1) {
      el('path', { d: `M${pts.join('L')}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`, class: 'sv-area' }, svg);
      el('path', { d: `M${pts.join('L')}`, class: 'sv-line' }, svg);
    }
    // End dot with a surface ring, and its value (the one direct label).
    el('circle', { cx: x(n - 1), cy: y(vals[n - 1]), r: 4, class: 'sv-dot' }, svg);
    const last = el('text', { x: x(n - 1), y: Math.max(y(vals[n - 1]) - 10, 10), class: 'sv-last', 'text-anchor': 'end' }, svg);
    last.textContent = nf.format(vals[n - 1]);

    // Hover layer.
    const cross = el('line', { y1: m.t, y2: m.t + ih, class: 'sv-cross', visibility: 'hidden' }, svg);
    const hdot = el('circle', { r: 4, class: 'sv-dot', visibility: 'hidden' }, svg);
    const tip = document.createElement('div');
    tip.className = 'sv-tip';
    tip.hidden = true;
    const show = (i) => {
      i = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      hdot.setAttribute('cx', x(i));
      hdot.setAttribute('cy', y(vals[i]));
      cross.setAttribute('visibility', 'visible');
      hdot.setAttribute('visibility', 'visible');
      tip.innerHTML = `<span class="d">${esc(fmtDay(series[i].d, true))}</span><strong>${nf.format(vals[i])}</strong> ${esc(unit.toLowerCase())}`;
      tip.hidden = false;
      const pct = (x(i) / W) * 100;
      tip.style.left = pct + '%';
      tip.style.transform = pct > 70 ? 'translateX(-100%)' : pct < 30 ? 'translateX(0)' : 'translateX(-50%)';
      tip.style.top = Math.max((y(vals[i]) / H) * 100 - 22, 0) + '%';
      return i;
    };
    const hide = () => {
      cross.setAttribute('visibility', 'hidden');
      hdot.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    };
    let cur = n - 1;
    svg.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      cur = show(Math.round(((((ev.clientX - r.left) / r.width) * W - m.l) / iw) * (n - 1)));
    });
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowLeft') cur = show(cur - 1);
      else if (ev.key === 'ArrowRight') cur = show(cur + 1);
      else if (ev.key === 'Escape') hide();
      else return;
      ev.preventDefault();
    });
    host.append(svg, tip);
  }

  /** Horizontal bars: <= 10px thick, rounded at the data end, value at the tip in text ink. */
  function bars(host, rows, empty) {
    host.textContent = '';
    if (!rows.length) {
      host.innerHTML = `<p class="muted">${esc(empty || 'Nothing yet.')}</p>`;
      return;
    }
    const max = Math.max(...rows.map((r) => r.v), 1);
    const ul = document.createElement('ul');
    ul.className = 'bars';
    for (const r of rows) {
      const li = document.createElement('li');
      li.title = r.title || `${r.label}: ${nf.format(r.v)}`;
      li.innerHTML = `<span class="bl">${r.href ? `<a href="${esc(r.href)}">${esc(r.label)}</a>` : esc(r.label)}${r.sub ? `<span class="bs">${esc(r.sub)}</span>` : ''}</span><span class="bt"><span class="bf" style="width:${Math.max((r.v / max) * 100, r.v ? 1.5 : 0).toFixed(1)}%"></span></span><span class="bv">${nf.format(r.v)}</span>`;
      ul.appendChild(li);
    }
    host.appendChild(ul);
  }
  const rowsOf = (obj, label = (k) => k, extra = {}) => Object.entries(obj).map(([k, v]) => ({ label: label(k), v, ...extra }));

  // ---------------------------------------------------------------- page
  const sum = (a, k) => a.reduce((n, d) => n + d[k], 0);
  const delta = (cur, prev, label) => {
    if (!prev) return `<span class="dl-none">No earlier data to compare</span>`;
    const p = ((cur - prev) / prev) * 100;
    const arrow = p > 0 ? '▲' : p < 0 ? '▼' : '■';
    return `<span class="dl-d">${arrow} ${Math.abs(p) < 10 ? Math.abs(p).toFixed(1) : Math.round(Math.abs(p))}%</span> <span class="dl-none">vs ${esc(label)}</span>`;
  };

  function render(cur, prevSeries) {
    const s = cur.series;
    const pv = sum(s, 'pv');
    const dl = sum(s, 'dl');
    const uv = sum(s, 'uv'); // each day's visitors added up: someone who comes on two days counts on both
    const prevLabel = days === 7 ? 'the previous 7 days' : `the previous ${days} days`;
    const pPv = prevSeries ? sum(prevSeries, 'pv') : 0;
    const pDl = prevSeries ? sum(prevSeries, 'dl') : 0;
    const pUv = prevSeries ? sum(prevSeries, 'uv') : 0;
    $('tiles').innerHTML = [
      ['Pageviews', compact(pv), delta(pv, pPv, prevLabel)],
      ['Visitors', compact(uv), delta(uv, pUv, prevLabel) + '<span class="dl-none"> (each day counted on its own)</span>'],
      ['Downloads and installs', compact(dl), delta(dl, pDl, prevLabel)],
      ['Download rate', pv ? (dl / pv * 100).toFixed(1) + '%' : '–', '<span class="dl-none">clicks per 100 pageviews</span>'],
    ].map(([l, v, d]) => `<div class="tile"><div class="tl">${l}</div><div class="tv">${v}</div><div class="td">${d}</div></div>`).join('');

    lineChart($('c-pv'), s, 'pv', 'Pageviews');
    lineChart($('c-uv'), s, 'uv', 'Visitors');
    lineChart($('c-dl'), s, 'dl', 'Downloads and installs');

    const app = (slug) => names[slug] || slug;
    bars($('l-apps'), Object.entries(cur.apps).filter(([, v]) => v[1] > 0).slice(0, 12).map(([slug, v]) => ({ label: app(slug), href: `/${slug}/`, v: v[1], sub: `${nf.format(v[0])} views`, title: `${app(slug)}: ${nf.format(v[1])} downloads and installs, ${nf.format(v[0])} pageviews` })), 'No downloads yet.');
    bars($('l-views'), Object.entries(cur.apps).sort((a, b) => b[1][0] - a[1][0]).slice(0, 12).map(([slug, v]) => ({ label: app(slug), href: `/${slug}/`, v: v[0], title: `${app(slug)}: ${nf.format(v[0])} pageviews` })), 'No pageviews yet.');
    bars($('l-slots'), rowsOf(cur.slots, (k) => SLOT[k] || k).sort((a, b) => b.v - a.v), 'No clicks yet.');
    bars($('l-platforms'), rowsOf(cur.platforms, (k) => PLAT[k] || k).sort((a, b) => b.v - a.v), 'No downloads yet.');
    bars($('l-hosts'), rowsOf(cur.hosts).sort((a, b) => b.v - a.v), 'No downloads yet.');
    bars($('l-countries'), Object.entries(cur.countries).slice(0, 12).map(([cc, v]) => ({ label: regionName(cc), v: v[0], sub: v[1] ? `${nf.format(v[1])} downloads` : '', title: `${regionName(cc)}: ${nf.format(v[0])} pageviews, ${nf.format(v[1])} downloads and installs` })), 'No data yet.');
    bars($('l-browsers'), rowsOf(cur.browsers).sort((a, b) => b.v - a.v));
    bars($('l-os'), rowsOf(cur.os).sort((a, b) => b.v - a.v));
    bars($('l-devices'), rowsOf(cur.devices, (k) => DEVICE[k] || k).sort((a, b) => b.v - a.v));
    bars($('l-channels'), Object.entries(cur.channels || {}).map(([ch, v]) => ({ label: ch, v: v[0], sub: `${nf.format(v[1])} pageview${v[1] === 1 ? '' : 's'} · ${nf.format(v[2])} download${v[2] === 1 ? '' : 's'}`, title: `${ch}: ${nf.format(v[0])} visitors, ${nf.format(v[1])} pageviews, ${nf.format(v[2])} downloads and installs${v[1] ? ` (${(v[2] / v[1] * 100).toFixed(1)} per 100 pageviews)` : ''}` })).sort((a, b) => b.v - a.v), 'No visits yet.');
    bars($('l-referrers'), rowsOf(cur.referrers).sort((a, b) => b.v - a.v), 'No outside referrers yet.');
    bars($('l-pages'), rowsOf(cur.pages, (k) => PAGE[k] || k).sort((a, b) => b.v - a.v));
    bars($('l-langs'), rowsOf(cur.langs, LANG).sort((a, b) => b.v - a.v));

    $('t-body').innerHTML = [...s].reverse().map((d) => `<tr><th scope="row">${esc(fmtDay(d.d, true))}</th><td>${nf.format(d.pv)}</td><td>${nf.format(d.uv)}</td><td>${nf.format(d.dl)}</td></tr>`).join('');
    $('updated').textContent = `Updated ${new Date(cur.generated).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' })}. Days are UTC, and today is still in progress.`;
    $('empty').hidden = pv > 0 || dl > 0;
  }

  async function load() {
    root.setAttribute('aria-busy', 'true');
    try {
      const [cur, prev] = await Promise.all([
        fetch(`/stats-data.php?days=${days}`).then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
        days <= 365 ? fetch(`/stats-data.php?days=${days * 2}`).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null),
      ]);
      render(cur, prev ? prev.series.slice(0, prev.series.length - days) : null);
      $('error').hidden = true;
    } catch (e) {
      $('error').hidden = false;
    }
    root.removeAttribute('aria-busy');
  }

  document.querySelectorAll('[data-range]').forEach((b) =>
    b.addEventListener('click', () => {
      days = +b.dataset.range;
      document.querySelectorAll('[data-range]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      load();
    }),
  );
  // App names for the lists: the same index the header search uses.
  fetch('/search-index.json')
    .then((r) => r.json())
    .then((list) => {
      names = Object.fromEntries(list.map((a) => [a.s, a.n]));
    })
    .catch(() => {})
    .then(load);
})();
