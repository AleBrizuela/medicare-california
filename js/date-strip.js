/* T-032 · Seasonal date strip (signed AB 2026-10-05). Replaces the AEP banner, which said
   "¡La inscripción está ABIERTA!" forever, including after AEP closed: a false enrollment claim from Dec 8.
   One file per site; every page with <div id="aep-banner" data-lang="es|en"> gets the strip.
   The message is picked by today's date, so it is always true without anyone changing it:
     Sep 1-Oct 14 before AEP + countdown · Oct 15-Dec 7 AEP open + days left · Dec 8-31 new plan Jan 1
     Jan 1-Mar 31 OEP (Medicare Advantage, change once) · Apr 1-Aug 31 turning 65
   Change wording here, never on the pages. Same file on both sites except SITE below. */
(function () {
  var SITE = {
    bg: 'linear-gradient(135deg,#002147 0%,#0080D4 100%)',   // MC: the standard banner gradient (AB 2026-10-05, chosen knowing the yellow link is 3.0-3.6:1 on the light end)
    links: {
      en: { aep: '/blog/medicare-aep-2027-california-changes', aepYear: 2027, contact: '/contact', finder: '/#zip-card',
            oep: '/blog/aep-vs-medicare-advantage-oep-california', t65: '/blog/turning-65-california-medicare-iep-guide' },
      es: { aep: 'https://beneficiosmedicare.com/blog/inscripcion-anual-aep-2027-california', aepYear: 2027, contact: '/contacto', finder: '/es#zip-card',
            oep: 'https://beneficiosmedicare.com/blog/aep-vs-periodo-inscripcion-abierta-medicare-advantage-california', t65: 'https://beneficiosmedicare.com/blog/inscripcion-inicial-cumplir-65' }
    }
  };

  var el = document.getElementById('aep-banner');
  if (!el) return;
  var lang = el.getAttribute('data-lang') === 'en' ? 'en' : 'es', L = SITE.links[lang];
  var now = new Date(), y = now.getFullYear();
  var today = new Date(y, now.getMonth(), now.getDate());
  var at = function (m, d) { return new Date(y, m - 1, d); };
  var daysTo = function (t) { return Math.round((t - today) / 864e5); };
  var dias = function (n) { return lang === 'en' ? n + (n === 1 ? ' day' : ' days') : n + (n === 1 ? ' día' : ' días'); };
  // The AEP guide is written for one plan year; in a later year the link falls back to the contact page.
  var aepLink = L.aepYear === y + 1 ? L.aep : L.contact;

  var text, more, href, target;
  if (today < at(9, 1) && today > at(3, 31)) {                                   // Apr 1 - Aug 31
    text = lang === 'en' ? 'Turning 65 this year? We help you enroll, at no cost to you'
                         : '¿Cumple 65 este año? Le ayudamos a inscribirse, sin costo para usted';
    more = lang === 'en' ? 'Start here' : 'Empiece aquí'; href = L.t65;
  } else if (today <= at(3, 31)) {                                               // Jan 1 - Mar 31
    text = lang === 'en' ? 'Have Medicare Advantage? You can switch once until March 31'
                         : '¿Tiene Medicare Advantage? Puede cambiar una vez hasta el 31 de marzo';
    more = lang === 'en' ? 'How it works' : 'Cómo funciona'; href = L.oep;
  } else if (today < at(10, 15)) {                                               // Sep 1 - Oct 14
    var n = daysTo(at(10, 15));
    text = (lang === 'en' ? 'Annual Enrollment: Oct. 15 to Dec. 7' : 'Inscripción anual: 15 oct. al 7 dic.')
         + '<span class="ds-count"> · ' + (lang === 'en' ? dias(n) + ' to go' : (n === 1 ? 'falta ' : 'faltan ') + dias(n)) + '</span>';
    more = lang === 'en' ? "What's changing in " + (y + 1) : 'Qué cambia en ' + (y + 1); href = aepLink;
  } else if (today <= at(12, 7)) {                                               // Oct 15 - Dec 7
    var left = daysTo(at(12, 7)) + 1;   // Dec 7 itself counts as a day left
    text = (lang === 'en' ? 'Annual Enrollment open until Dec. 7' : 'Inscripción anual abierta hasta el 7 dic.')
         + '<span class="ds-count"> · ' + (lang === 'en' ? dias(left) + ' left' : (left === 1 ? 'queda ' : 'quedan ') + dias(left)) + '</span>';
    // T-087 (AB 2026-10-15): "the banner saying review your benefits should place someone in the main
    // widget, not in an article. We want people taking action." So while AEP is open, and only then, the
    // link opens the plan finder: the ZIP box on THIS site's home page, in the language of the page the
    // strip sits on. Never the other domain. Every other season keeps the link it had.
    more = lang === 'en' ? 'Review your plan' : 'Revise su plan'; href = L.finder; target = 'plan_finder';
  } else {                                                                       // Dec 8 - Dec 31
    text = lang === 'en' ? 'Your new plan starts January 1. Questions?' : 'Su plan nuevo empieza el 1 de enero. ¿Preguntas?';
    more = lang === 'en' ? 'Write to us' : 'Escríbanos'; href = L.contact;
  }

  if (!document.getElementById('ds-style')) {
    var st = document.createElement('style');
    st.id = 'ds-style';
    st.textContent = '#aep-banner{background:' + SITE.bg + ';color:#fff;text-align:center;padding:10px 16px;font-size:15px;line-height:1.45;font-weight:600;position:relative;z-index:50;min-height:44px}'
      + '#aep-banner .ds-more{color:#FFD54F;font-weight:700;text-decoration:underline;text-underline-offset:3px;margin-left:10px;white-space:nowrap;display:inline-block;padding:4px 2px;margin-top:-4px;margin-bottom:-4px}'
      + '#aep-banner .ds-more:focus-visible{outline:2px solid #FFD54F;outline-offset:2px}'
      + '@media(max-width:480px){#aep-banner{font-size:14px;padding:8px 12px}}';
    document.head.appendChild(st);
  }
  el.innerHTML = '<span>' + text + '</span><a class="ds-more"'
    + (target ? ' data-cta="date_strip" data-cta-target="' + target + '"' : '')
    + ' href="' + href + '">' + more + ' &rarr;</a>';

  // T-087: taking someone to the ZIP box, wherever they tapped from. Only while the link points at it.
  if (!target) return;
  var finderPath = (href.split('#')[0] || '/').replace(/\/+$/, '');
  var tidy = function (p) { return p.replace(/\/index\.html$/, '/').replace(/\.html$/, '').replace(/\/+$/, ''); };
  var onFinderPage = function () { return tidy(location.pathname) === finderPath; };
  // Already on that page: scroll the card clear of the sticky header and put the cursor in the field.
  // Once a ZIP has been entered the card is hidden and the finder itself is open, so go to that instead.
  var openFinder = function () {
    var card = document.getElementById('zip-card'), input = document.getElementById('zip-input');
    var showing = !!(card && card.getClientRects().length);
    var t = showing ? card : document.getElementById('widget-anchor');
    if (!t) return false;
    // Focus first, and inside the tap itself, or the phone keyboard does not come up. preventScroll,
    // because a field taking focus cancels a smooth scroll already running, so the order matters.
    if (showing && input) { try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); } }
    // Scroll by a measured offset rather than scrollIntoView: centring the card leaves it clear of the
    // sticky header whatever that header's height, and this is the one way that is testable headlessly.
    // The glide comes from the page's own scroll-behavior, as it does for every other link to this card.
    var r = t.getBoundingClientRect(), top = window.pageYOffset || document.documentElement.scrollTop || 0;
    window.scrollTo(0, Math.max(0, r.top + top - Math.max(16, (window.innerHeight - r.height) / 2)));
    return true;
  };
  var a = el.querySelector('.ds-more');
  if (a) a.addEventListener('click', function (ev) {
    if (!onFinderPage()) return;            // another page: follow the link, the hash lands on the card
    if (openFinder()) ev.preventDefault();  // the home page itself: no reload, just the card and the cursor
  });
  // Arriving from another page: the browser has already jumped to the card. Centre it and focus the field
  // once the page has settled, so a late-loading image above it cannot leave the card off screen.
  if (location.hash === '#zip-card' && onFinderPage()) {
    if (document.readyState === 'complete') setTimeout(openFinder, 0);
    else window.addEventListener('load', function () { setTimeout(openFinder, 0); }, { once: true });
  }
})();
