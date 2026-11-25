// First-party analytics beacon. No cookies, no storage, no third parties: it sends small events to /collect.php on this site.
// Sends nothing when the visitor has Do Not Track or Global Privacy Control switched on.
//
//   pageview   once per page load
//   download   a click on a Download button          (data-t="download")
//   install    a click on the Linux Install button   (data-t="install")
//   copy       a click on a copy-command button      (data-t="copy")
//
// Buttons describe themselves with data attributes: data-t (event), data-slot (which button), data-pl (platform),
// data-ar (architecture), data-ty (installer type), data-h (download host), data-v (version, when not the latest).
// An app page marks itself with <article data-slug data-ver>.
(() => {
  const nav = navigator;
  if (nav.doNotTrack === '1' || window.doNotTrack === '1' || nav.msDoNotTrack === '1' || nav.globalPrivacyControl) return;
  const ENDPOINT = '/collect.php';
  const loc = location;
  const art = document.querySelector('article[data-slug]');
  const slug = art ? art.dataset.slug : '';
  const ver = art ? art.dataset.ver : '';
  const path = loc.pathname;
  const pageType = path === '/' ? 'home' : art ? 'app' : /^\/(windows|mac|linux)\/$/.test(path) ? 'platform' : /^\/categories\//.test(path) ? 'category' : 'other';
  const qs = new URLSearchParams(loc.search);
  const CLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'msclkid', 'yclid', 'ttclid', 'twclid', 'li_fat_id', 'ScCid', 'epik', 'rdt_cid'];

  const send = (o) => {
    const body = JSON.stringify(o);
    try {
      // text/plain keeps this a "simple" request: no CORS preflight, and sendBeacon survives the page being left (a download click).
      if (nav.sendBeacon && nav.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain;charset=UTF-8' }))) return;
    } catch (e) {}
    try {
      fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain;charset=UTF-8' } }).catch(() => {});
    } catch (e) {}
  };

  const pageview = () => {
    let ref = '';
    try {
      if (document.referrer) ref = new URL(document.referrer).hostname;
    } catch (e) {}
    send({
      e: 'pageview',
      p: path.slice(0, 100),
      pt: pageType,
      s: slug || undefined,
      r: ref && ref !== loc.hostname ? ref : undefined,
      l: nav.language || undefined,
      w: innerWidth < 600 ? 's' : innerWidth < 1024 ? 'm' : 'l',
      us: qs.get('utm_source') || undefined,
      um: qs.get('utm_medium') || undefined,
      uc: qs.get('utm_campaign') || undefined,
      // Which ad click marker is in the address, if any (its name only, never its value): it tells paid traffic apart.
      ck: CLICK_IDS.find((k) => qs.has(k)),
    });
  };
  // Not for prerendered or background-opened tabs: count the view when the page is actually shown.
  const start = () => {
    if (document.visibilityState === 'hidden') {
      const on = () => {
        if (document.visibilityState === 'visible') {
          document.removeEventListener('visibilitychange', on);
          pageview();
        }
      };
      document.addEventListener('visibilitychange', on);
    } else pageview();
  };
  if (document.prerendering) document.addEventListener('prerenderingchange', start, { once: true });
  else start();

  const click = (e) => {
    const el = e.target.closest && e.target.closest('[data-t]');
    if (!el) return;
    if (el.getAttribute('aria-expanded') === 'true') return; // a dropdown button that is already open: this click closes it
    const d = el.dataset;
    send({
      e: d.t,
      p: path.slice(0, 100),
      pt: pageType,
      s: slug || undefined,
      sl: d.slot,
      pl: d.pl,
      ar: d.ar,
      ty: d.ty,
      h: d.h,
      v: d.v || ver || undefined,
      l: nav.language || undefined,
    });
  };
  document.addEventListener('click', click, true);
  document.addEventListener('auxclick', (e) => { if (e.button === 1) click(e); }, true); // middle-click opens the download in a new tab
})();
