// Screenshot row on app pages: arrow buttons scroll the row, a click opens the full image in a lightbox.
// Without this script the row still scrolls by swipe/trackpad and each screenshot links to its image file.
(function () {
  var shots = document.querySelectorAll('[data-shots]');
  if (!shots.length) return;

  shots.forEach(function (box) {
    var track = box.querySelector('.shots-track');
    var prev = box.querySelector('.shots-prev');
    var next = box.querySelector('.shots-next');
    function update() {
      var max = track.scrollWidth - track.clientWidth;
      prev.hidden = track.scrollLeft <= 2;
      next.hidden = track.scrollLeft >= max - 2;
      if (max <= 2) prev.hidden = next.hidden = true;
    }
    function go(dir) { track.scrollBy({ left: dir * track.clientWidth * 0.9, behavior: 'smooth' }); }
    prev.addEventListener('click', function () { go(-1); });
    next.addEventListener('click', function () { go(1); });
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  });

  // Lightbox: one <dialog> for the page.
  var links = Array.prototype.slice.call(document.querySelectorAll('[data-shots] .shot'));
  if (!links.length || typeof HTMLDialogElement !== 'function') return;
  var dlg = document.createElement('dialog');
  dlg.className = 'lb';
  dlg.setAttribute('aria-label', 'Screenshot');
  dlg.innerHTML =
    '<button type="button" class="lb-close" aria-label="Close">×</button>' +
    '<button type="button" class="lb-nav lb-prev" aria-label="Previous screenshot"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>' +
    '<figure><img alt=""><figcaption></figcaption></figure>' +
    '<button type="button" class="lb-nav lb-next" aria-label="Next screenshot"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>';
  document.body.appendChild(dlg);
  var img = dlg.querySelector('img');
  var cap = dlg.querySelector('figcaption');
  var at = 0;
  function show(i) {
    at = (i + links.length) % links.length;
    var a = links[at], thumb = a.querySelector('img');
    img.src = a.getAttribute('href');
    img.alt = thumb.alt;
    cap.textContent = (a.dataset.caption ? a.dataset.caption + ' · ' : '') + (at + 1) + ' of ' + links.length;
    dlg.querySelector('.lb-prev').hidden = dlg.querySelector('.lb-next').hidden = links.length < 2;
  }
  links.forEach(function (a, i) {
    a.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; // keep "open in new tab"
      e.preventDefault();
      show(i);
      dlg.showModal();
    });
  });
  dlg.querySelector('.lb-close').addEventListener('click', function () { dlg.close(); });
  dlg.querySelector('.lb-prev').addEventListener('click', function () { show(at - 1); });
  dlg.querySelector('.lb-next').addEventListener('click', function () { show(at + 1); });
  dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); }); // click outside the image
  dlg.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') show(at - 1);
    else if (e.key === 'ArrowRight') show(at + 1);
  });
})();
