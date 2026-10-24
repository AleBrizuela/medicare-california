/* T-133: the "compare 2027 plans" zip box, shared by every non-home page that carries one
 * (blog posts, guides, city/state/neighborhood pages, /beneficios + /benefits). Submitting
 * never leaves the page itself with server state -- it just navigates to this site's own
 * home, same language, with the ZIP and where it came from (zip_top or zip_end) in the URL,
 * which the home's own auto-submit (?zip=) picks up on load. Never cross-domain (CLAUDE.md).
 */
(function () {
  function digits(v) { return v.replace(/\D/g, '').slice(0, 5); }

  document.addEventListener('input', function (e) {
    if (!e.target.classList || !e.target.classList.contains('zbx-input')) return;
    e.target.value = digits(e.target.value);
  }, true);

  document.addEventListener('submit', function (e) {
    var f = e.target.closest ? e.target.closest('.zbx-form') : null;
    if (!f) return;
    e.preventDefault();
    var box = f.closest('.zbx');
    var input = f.querySelector('.zbx-input');
    var err = box.querySelector('.zbx-error');
    var zip = digits(input.value.trim());
    input.value = zip;
    if (!/^\d{5}$/.test(zip)) {
      err.style.display = 'block';
      input.focus();
      return;
    }
    err.style.display = 'none';
    var cta = f.querySelector('.zbx-btn').getAttribute('data-cta');
    if (typeof gtag === 'function') {
      gtag('event', 'cta_click', {
        site: box.getAttribute('data-site'),
        lang: box.getAttribute('data-lang'),
        page: location.pathname,
        placement: cta,
        target: 'plan_finder'
      });
    }
    location.href = box.getAttribute('data-target') + encodeURIComponent(zip) + '&from=' + cta + '#comparar';
  }, true);
})();
