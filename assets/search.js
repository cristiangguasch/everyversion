// Header search with live suggestions (every page except the home page, which has its own larger search box).
// The app list is loaded the first time the box is focused: /search-index.json (about 11 KB gzipped).
// Same ranking as the home page: name first, then publisher and tags. Arrow keys, Enter and Escape work.
(() => {
  const form = document.querySelector('form.header-search');
  if (!form) return;
  const q = form.querySelector('input');
  const box = form.querySelector('.suggest');
  if (!q || !box) return;
  const MAX = 8;
  let apps = null;
  // The page loads this script as /search.js?v=<hash>; the same hash goes on the index URL so a new index is never served from cache.
  const V = (document.currentScript && new URL(document.currentScript.src).searchParams.get('v')) || '';
  let pending = null;
  let shown = [];
  let act = -1;

  const load = () => {
    if (apps) return Promise.resolve(apps);
    pending ||= fetch('/search-index.json' + (V ? '?v=' + V : ''))
      .then((r) => {
        if (!r.ok) throw new Error('index not found');
        return r.json();
      })
      .then((j) => (apps = j))
      .catch(() => {
        pending = null;
        return [];
      });
    return pending;
  };

  const score = (a, t) => {
    const n = a.n.toLowerCase();
    if (n === t) return 100;
    if (n.startsWith(t)) return 90;
    if (n.split(/[^a-z0-9]+/).some((w) => w.startsWith(t))) return 80;
    if (n.includes(t)) return 70;
    if (t.length > 1) {
      if (a.p.toLowerCase().includes(t)) return 40;
      if (a.k.includes(t)) return 30;
    }
    return 0;
  };
  const find = (t) =>
    (apps || [])
      .map((a) => ({ a, s: score(a, t) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s || x.a.n.localeCompare(y.a.n));
  const mk = (tag, cls, txt) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  };
  const hl = (el, text, t) => {
    const i = text.toLowerCase().indexOf(t);
    if (i < 0 || !t) {
      el.textContent = text;
      return;
    }
    el.append(text.slice(0, i), mk('mark', null, text.slice(i, i + t.length)), text.slice(i + t.length));
  };
  const open = (v) => {
    box.hidden = !v;
    q.setAttribute('aria-expanded', v ? 'true' : 'false');
    if (!v) {
      act = -1;
      q.removeAttribute('aria-activedescendant');
    }
  };
  const mark = (i) => {
    [...box.children].forEach((li, j) => {
      const on = j === i;
      li.classList.toggle('on', on);
      li.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on) {
        q.setAttribute('aria-activedescendant', li.id);
        li.scrollIntoView({ block: 'nearest' });
      }
    });
    act = i;
  };

  const render = async () => {
    const t = q.value.trim().toLowerCase();
    if (!t) {
      box.textContent = '';
      shown = [];
      open(false);
      return;
    }
    await load();
    if (q.value.trim().toLowerCase() !== t) return; // the text changed while the list was loading
    box.textContent = '';
    const all = find(t);
    shown = all.slice(0, MAX).map((x) => x.a);
    shown.forEach((a, i) => {
      const li = mk('li', 'opt');
      li.id = 'hsg' + i;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      const link = mk('a');
      link.href = '/' + a.s + '/';
      link.tabIndex = -1;
      if (a.i) {
        const im = mk('img', 'ico');
        im.src = '/' + a.s + '/icon.' + a.i + (a.h ? '?v=' + a.h : '');
        im.width = 28;
        im.height = 28;
        im.alt = a.n + ' icon';
        im.loading = 'lazy';
        link.append(im);
      } else link.append(mk('span', 'ico ph'));
      const tx = mk('span', 'tx');
      const nm = mk('span', 'nm');
      hl(nm, a.n, t);
      tx.append(nm, mk('span', 'sub', a.p + ' · ' + a.v));
      link.append(tx);
      li.append(link);
      li.addEventListener('mousemove', () => {
        if (act !== i) mark(i);
      });
      box.append(li);
    });
    if (all.length > MAX) {
      const li = mk('li', 'more', 'Showing ' + MAX + ' of ' + all.length + ' matches. Keep typing to narrow it down.');
      li.setAttribute('role', 'presentation');
      box.append(li);
    }
    if (!shown.length) {
      const li = mk('li', 'none');
      li.setAttribute('role', 'presentation');
      li.append('No app matches “' + q.value.trim() + '”. ');
      const a = mk('a', null, 'Request it');
      a.href = '/contact/';
      li.append(a, '.');
      box.append(li);
    }
    open(true);
    act = -1;
  };

  q.addEventListener('focus', () => {
    load();
    if (q.value.trim()) render();
  });
  q.addEventListener('input', render);
  q.addEventListener('keydown', (e) => {
    if (box.hidden && e.key === 'ArrowDown' && q.value.trim()) {
      e.preventDefault();
      render();
      return;
    }
    if (box.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (shown.length) mark((act + 1) % shown.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length) mark((act - 1 + shown.length) % shown.length);
    } else if (e.key === 'Escape') open(false);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = q.value.trim().toLowerCase();
    if (!t) return;
    await load();
    const pick = act >= 0 ? shown[act] : shown[0] || (find(t)[0] || {}).a;
    if (pick) location.href = '/' + pick.s + '/';
    else render();
  });
  document.addEventListener('click', (e) => {
    if (!form.contains(e.target)) open(false);
  });
})();
