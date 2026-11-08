// The public /statistics/ page: a static shell; assets/stats.js fills it from /stats-data.php.
export function statsPage({ statsV }) {
  const section = (id, title, note = '') => `<section class="st-card"><h2 id="h-${id}">${title}</h2>${note ? `<p class="muted">${note}</p>` : ''}<div id="${id}"></div></section>`;
  const body = `
<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> › Stats</nav>
<article class="stats" id="stats">
<h1>Stats</h1>
<p class="lead">How Everyversion is used: pageviews, visitors, and clicks on the Download and Install buttons. These numbers are public.</p>
<p class="muted">We count with our own small script and keep the data on our own server. No cookies, no third-party tools, and no IP addresses are stored. Visitors are counted per day from a one-way hash that cannot be followed from one day to the next, so a person who returns tomorrow counts as a new visitor. See the <a href="/legal/privacy/">privacy policy</a>.</p>

<div class="st-range" role="group" aria-label="Time range">
<button type="button" class="chip" data-range="7" aria-pressed="false">7 days</button>
<button type="button" class="chip" data-range="30" aria-pressed="true">30 days</button>
<button type="button" class="chip" data-range="90" aria-pressed="false">90 days</button>
<button type="button" class="chip" data-range="365" aria-pressed="false">1 year</button>
</div>
<p class="st-msg" id="error" role="status" hidden>The statistics could not be loaded. Try again in a moment.</p>
<p class="st-msg" id="empty" role="status" hidden>No visits have been recorded in this period yet.</p>
<noscript><p class="st-msg">The charts need JavaScript. The numbers are also available at <a href="/stats-data.php?days=30">/stats-data.php?days=30</a>.</p></noscript>

<div class="tiles" id="tiles" aria-live="polite"></div>

<section class="st-card"><h2 id="h-pv">Pageviews per day</h2><div class="chart" id="c-pv"></div></section>
<section class="st-card"><h2 id="h-uv">Visitors per day</h2><p class="muted">Each day counted on its own: someone who visits on two days counts once on each.</p><div class="chart" id="c-uv"></div></section>
<section class="st-card"><h2 id="h-dl">Downloads and installs per day</h2><p class="muted">Clicks on a Download button or on the Linux Install button. A click shows intent: the file itself comes from the publisher.</p><div class="chart" id="c-dl"></div></section>

<details class="st-table"><summary>View the daily numbers as a table</summary>
<div class="scroll"><table><thead><tr><th scope="col">Day (UTC)</th><th scope="col">Pageviews</th><th scope="col">Visitors</th><th scope="col">Downloads and installs</th></tr></thead><tbody id="t-body"></tbody></table></div>
</details>

<div class="st-grid">
${section('l-apps', 'Most downloaded and installed', 'Clicks on Download and Install, by app.')}
${section('l-views', 'Most viewed', 'Pageviews, by app.')}
${section('l-slots', 'Which button', 'Every kind of click we measure, and where it was.')}
${section('l-platforms', 'Downloads by platform')}
${section('l-hosts', 'Where downloads go', 'The publisher or package host of the Download buttons that were clicked.')}
${section('l-countries', 'Countries', 'Pageviews, with downloads and installs beneath each name. Country comes from the network the request passes through, not from an IP address we keep.')}
${section('l-browsers', 'Browsers')}
${section('l-os', 'Operating systems')}
${section('l-devices', 'Devices')}
${section('l-referrers', 'Where visitors come from', 'Websites that link to us. Visits with no referrer are not listed.')}
${section('l-pages', 'Page types')}
${section('l-langs', 'Browser languages')}
</div>
<p class="muted" id="updated"></p>
<p class="muted">Bots and crawlers are left out, and so is anyone who has Do Not Track or Global Privacy Control switched on.</p>
</article>
<script src="/stats.js?v=${statsV}" defer></script>
`;
  return {
    path: '/statistics/',
    title: 'Stats: pageviews, downloads and installs on Everyversion',
    description: 'Public usage statistics for Everyversion: pageviews, daily visitors, and clicks on Download and Install buttons. No cookies, no third parties.',
    body,
  };
}
