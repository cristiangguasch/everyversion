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
  let view = 'totals'; // the daily chart: 'totals' (pageviews, visitors, downloads) or 'channels' (visitors per channel)
  let last = null; // the data last drawn, so the Totals / Channels switch redraws without fetching again
  // Channels view: only three hues stay apart for every reader when every line can cross every other, so the three
  // main channels get a fixed color each and the rest are added up into one gray dashed line. The table lists them all.
  const CHANNELS = ['Direct', 'Organic Search', 'AI Organic Search', 'Social', 'Referral', 'Email', 'Paid Search', 'Paid Social', 'Other campaigns'];
  const MAIN_CHANNELS = [['Direct', 'sv-s1', 'direct'], ['Organic Search', 'sv-s2', 'search'], ['AI Organic Search', 'sv-s3', 'AI search']];
  const TOTALS = [
    { key: 'pv', label: 'Pageviews', short: 'pageviews', cls: 'sv-s1' },
    { key: 'uv', label: 'Visitors', short: 'visitors', cls: 'sv-s2' },
    { key: 'dl', label: 'Downloads and installs', short: 'downloads', cls: 'sv-s3' },
  ];

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

  /**
   * One chart, one shared axis, one 2px line per measure in fixed categorical order (blue, orange, teal). A legend above,
   * each line's latest value labelled at its end (labels pushed apart so they never overlap), and a crosshair with a
   * tooltip listing every measure on hover or with the arrow keys.
   */
  function multiLineChart(host, series, defs) {
    host.textContent = '';
    const many = defs.length > 4; // more than 4 lines: legend and tooltip only, no end labels (they would collide)
    const W = 720;
    const H = 240;
    const m = { l: 44, r: many ? 16 : 118, t: 14, b: 28 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const n = series.length;
    // Four steps of 1, 2 or 5 times a power of ten, so counts get whole-number ticks (0, 10, 20, 30, 40).
    const step = (() => {
      const r = Math.max(Math.max(...defs.flatMap((d) => series.map((p) => p[d.key])), 0) / 4, 1);
      const p = 10 ** Math.floor(Math.log10(r));
      const f = r / p;
      return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
    })();
    const max = step * 4;
    const x = (i) => m.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
    const y = (v) => m.t + ih - (v / max) * ih;
    const latest = defs.map((d) => `${d.label} ${nf.format(series[n - 1][d.key])}`).join(', ');

    const legend = document.createElement('ul');
    legend.className = 'sv-legend';
    legend.innerHTML = defs.map((d) => `<li${d.title ? ` title="${esc(d.title)}"` : ''}><span class="sv-sw ${d.cls}" aria-hidden="true"></span>${esc(d.label)}${d.title ? ` <span class="sv-lg-sub">(${esc(d.title)})</span>` : ''}</li>`).join('');

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sv', role: 'img', tabindex: '0', 'aria-label': `${defs.map((d) => d.label).join(', ')} per day, ${fmtDay(series[0].d, true)} to ${fmtDay(series[n - 1].d, true)}. Latest day: ${latest}. Use the arrow keys to read each day; a table with every value follows.` }, null);
    for (let t = 0; t <= 4; t++) {
      const v = (max / 4) * t;
      el('line', { x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v), class: 'sv-grid' }, svg);
      const tx = el('text', { x: m.l - 8, y: y(v) + 4, class: 'sv-tick', 'text-anchor': 'end' }, svg);
      tx.textContent = compact(Math.round(v * 10) / 10);
    }
    const labelEvery = Math.max(1, Math.round(n / 5));
    for (let i = 0; i < n; i += labelEvery) {
      const tx = el('text', { x: x(i), y: H - 8, class: 'sv-tick', 'text-anchor': i === 0 ? 'start' : 'middle' }, svg);
      tx.textContent = fmtDay(series[i].d);
    }
    // Lines, drawn last measure first so the first (pageviews) sits on top where they cross.
    for (const d of [...defs].reverse()) {
      const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(p[d.key]).toFixed(1)}`);
      if (n > 1) el('path', { d: `M${pts.join('L')}`, class: `sv-line ${d.cls}` }, svg);
    }
    // End dots, and end labels in text ink, nudged apart vertically (at least 15px between them).
    const ends = defs.map((d) => ({ d, v: series[n - 1][d.key], y: y(series[n - 1][d.key]) })).sort((a, b) => a.y - b.y);
    for (let k = 1; k < ends.length; k++) ends[k].ly = Math.max(ends[k].y, (ends[k - 1].ly ?? ends[k - 1].y) + 15);
    ends[0].ly = ends[0].y;
    const over = ends[ends.length - 1].ly - (m.t + ih + 4);
    if (over > 0) for (const e of ends) e.ly -= over;
    for (const e of ends) {
      el('circle', { cx: x(n - 1), cy: e.y, r: 4, class: `sv-dot ${e.d.cls}` }, svg);
      if (many) continue;
      const t = el('text', { x: x(n - 1) + 10, y: e.ly + 4, class: 'sv-end' }, svg);
      t.textContent = `${nf.format(e.v)} ${e.d.short}`;
    }

    // Hover layer: one crosshair, a dot on every line, one tooltip with all measures.
    const cross = el('line', { y1: m.t, y2: m.t + ih, class: 'sv-cross', visibility: 'hidden' }, svg);
    const hdots = defs.map((d) => el('circle', { r: 4, class: `sv-dot ${d.cls}`, visibility: 'hidden' }, svg));
    const tip = document.createElement('div');
    tip.className = 'sv-tip';
    tip.hidden = true;
    const show = (i) => {
      i = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      defs.forEach((d, k) => {
        hdots[k].setAttribute('cx', x(i));
        hdots[k].setAttribute('cy', y(series[i][d.key]));
        hdots[k].setAttribute('visibility', 'visible');
      });
      tip.innerHTML = `<span class="d">${esc(fmtDay(series[i].d, true))}</span>` + (many ? [...defs].sort((a, b) => series[i][b.key] - series[i][a.key]) : defs).map((d) => `<span class="r"><span class="sv-sw ${d.cls}" aria-hidden="true"></span>${esc(d.label)} <strong>${nf.format(series[i][d.key])}</strong></span>`).join('');
      tip.hidden = false;
      const pct = (x(i) / W) * 100;
      tip.style.left = pct + '%';
      tip.style.transform = pct > 60 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)';
      tip.style.top = '8px';
      return i;
    };
    const hide = () => {
      cross.setAttribute('visibility', 'hidden');
      hdots.forEach((h) => h.setAttribute('visibility', 'hidden'));
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
    const plot = document.createElement('div');
    plot.className = 'chart';
    plot.append(svg, tip);
    host.append(legend, plot);
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
      if (r.cls) li.className = r.cls;
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

  /** The daily chart and its table, in the current view. Channels with no visitors in the period are left out. */
  function drawDaily() {
    const s = last;
    if (!s) return;
    let defs;
    let rows;
    let cols; // table columns (every channel); defs are the chart's lines
    if (view === 'channels') {
      const has = (c) => s.some((d) => (d.ch || {})[c]);
      const rest = CHANNELS.filter((c) => !MAIN_CHANNELS.some(([m]) => m === c) && has(c));
      defs = MAIN_CHANNELS.filter(([c]) => has(c)).map(([c, cls, short]) => ({ key: c, label: c, short, cls }));
      if (rest.length) defs.push({ key: '_other', label: 'Other channels', short: 'other', cls: 'sv-s0', title: rest.join(', ') });
      cols = [...defs.filter((x) => x.key !== '_other'), ...rest.map((c) => ({ key: c, label: c }))];
      rows = s.map((d) => {
        const ch = d.ch || {};
        return { d: d.d, ...Object.fromEntries(CHANNELS.map((c) => [c, ch[c] || 0])), _other: rest.reduce((n, c) => n + (ch[c] || 0), 0) };
      });
      $('h-daily').textContent = 'Visitors per day by channel';
      $('n-daily').textContent = 'Each visitor counts once a day, under the first outside source they came from (see Channels below).';
    } else {
      defs = TOTALS;
      cols = TOTALS;
      rows = s;
      $('h-daily').textContent = 'Pageviews, visitors and downloads per day';
      $('n-daily').textContent = 'Visitors are counted each day on their own: someone who visits on two days counts once on each. Downloads and installs are clicks on a Download button or the Linux Install button; the file itself comes from the publisher.';
    }
    if (!defs.length) {
      $('c-main').innerHTML = '<p class="muted">No visits yet.</p>';
    } else {
      multiLineChart($('c-main'), rows, defs);
    }
    $('t-head').innerHTML = `<tr><th scope="col">Day (UTC)</th>${cols.map((x) => `<th scope="col">${esc(x.label)}</th>`).join('')}</tr>`;
    $('t-body').innerHTML = [...rows].reverse().map((d) => `<tr><th scope="row">${esc(fmtDay(d.d, true))}</th>${cols.map((x) => `<td>${nf.format(d[x.key])}</td>`).join('')}</tr>`).join('');
  }

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

    last = s;
    drawDaily();

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
    const chRow = (label, v, cls) => ({ label, v: v[0], cls, sub: `${nf.format(v[1])} pageview${v[1] === 1 ? '' : 's'} · ${nf.format(v[2])} download${v[2] === 1 ? '' : 's'}`, title: `${label}: ${nf.format(v[0])} visitors, ${nf.format(v[1])} pageviews, ${nf.format(v[2])} downloads and installs${v[1] ? ` (${(v[2] / v[1] * 100).toFixed(1)} per 100 pageviews)` : ''}` });
    const chRows = Object.entries(cur.channels || {}).map(([ch, v]) => chRow(ch, v)).sort((a, b) => b.v - a.v);
    // Under Direct: the part that landed straight on an app page, most likely a link shared where no referrer is passed.
    const deep = cur.direct_deep || [0, 0, 0];
    const at = chRows.findIndex((r) => r.label === 'Direct');
    if (at > -1 && deep[0]) chRows.splice(at + 1, 0, chRow('of which likely shared links', deep, 'sub-row'));
    bars($('l-channels'), chRows, 'No visits yet.');
    bars($('l-referrers'), rowsOf(cur.referrers).sort((a, b) => b.v - a.v), 'No outside referrers yet.');
    bars($('l-pages'), rowsOf(cur.pages, (k) => PAGE[k] || k).sort((a, b) => b.v - a.v));
    bars($('l-langs'), rowsOf(cur.langs, LANG).sort((a, b) => b.v - a.v));

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

  document.querySelectorAll('[data-view]').forEach((b) =>
    b.addEventListener('click', () => {
      view = b.dataset.view;
      document.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      drawDaily();
    }),
  );
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
