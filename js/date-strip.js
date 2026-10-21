/* T-032 · Seasonal deadline box (signed AB 2026-10-05; redesigned T-119, AB 2026-10-21).
   Renders into the top of #zip-card (was #aep-banner, removed in T-119 — "less is more"). No
   link in the box; the ZIP form right below it is the call to action.
   The message is picked by today's date, so it is always true without anyone changing it:
     Sep 1-Oct 14 before AEP + countdown · Oct 15-Dec 7 AEP open + days left · Dec 8-31 new plan Jan 1
     Jan 1-Mar 31 OEP (Medicare Advantage, change once) · Apr 1-Aug 31 turning 65
   PROTECT reads the four non-active messages before Dec 8 (see NOW.md T-119).
   Change wording here, never on the pages. Same file on both sites except the one color below. */
(function () {
  var card = document.getElementById('zip-card');
  if (!card) return;
  var lang = (document.documentElement.getAttribute('lang') || '').indexOf('en') === 0 ? 'en' : 'es';
  var now = new Date(), y = now.getFullYear();
  var today = new Date(y, now.getMonth(), now.getDate());
  var at = function (m, d) { return new Date(y, m - 1, d); };
  var daysTo = function (t) { return Math.round((t - today) / 864e5); };
  var unit = function (n) { return lang === 'en' ? (n === 1 ? 'day' : 'days') : (n === 1 ? 'día' : 'días'); };
  var num = function (n) { return '<span class="dl-num">' + n + '</span>'; };

  var eyebrow, main, month, day;
  if (today < at(9, 1) && today > at(3, 31)) {                                   // Apr 1 - Aug 31
    eyebrow = lang === 'en' ? 'TURNING 65 THIS YEAR?' : '¿CUMPLE 65 ESTE AÑO?';
    main = lang === 'en' ? 'We help, at no cost' : 'Le ayudamos sin costo';
    day = '65';
  } else if (today <= at(3, 31)) {                                               // Jan 1 - Mar 31
    eyebrow = 'MEDICARE ADVANTAGE';
    main = lang === 'en' ? 'Switch once until then' : 'Puede cambiar una vez';
    month = 'MAR'; day = '31';
  } else if (today < at(10, 15)) {                                               // Sep 1 - Oct 14
    var n = daysTo(at(10, 15));
    eyebrow = lang === 'en' ? 'ANNUAL ENROLLMENT' : 'INSCRIPCIÓN ANUAL';
    main = (lang === 'en' ? 'Starts in ' + num(n) + ' ' + unit(n)
                          : 'Empieza en ' + num(n) + ' ' + unit(n));
    month = 'OCT'; day = '15';
  } else if (today <= at(12, 7)) {                                               // Oct 15 - Dec 7
    var left = daysTo(at(12, 7)) + 1;   // Dec 7 itself counts as a day left
    eyebrow = lang === 'en' ? 'ANNUAL ENROLLMENT' : 'INSCRIPCIÓN ANUAL';
    main = (lang === 'en' ? num(left) + ' ' + unit(left) + ' left'
                          : (left === 1 ? 'Queda ' : 'Quedan ') + num(left) + ' ' + unit(left));
    month = lang === 'en' ? 'DEC' : 'DIC'; day = '7';
  } else {                                                                       // Dec 8 - Dec 31
    eyebrow = lang === 'en' ? 'YOUR NEW PLAN' : 'SU PLAN NUEVO';
    main = lang === 'en' ? 'Starts January ' + num('1') : 'Empieza el ' + num('1') + ' de enero';
    month = lang === 'en' ? 'JAN' : 'ENE'; day = '1';
  }

  var tile = '<div class="dl-tile">' + (month ? '<span class="dl-month">' + month + '</span>' : '') + '<span class="dl-day">' + day + '</span></div>';
  var box = document.createElement('div');
  box.className = 'dl-box';
  box.innerHTML = '<div class="dl-text"><p class="dl-eyebrow">' + eyebrow + '</p><p class="dl-main">' + main + '</p></div>' + tile;
  card.insertBefore(box, card.firstChild);

  // T-087: a visitor arriving from elsewhere on the site with /#zip-card in the URL (blog CTAs,
  // the widget, etc. still link here) — centre the card clear of the sticky header and focus the
  // field, the same behavior this file has always given that link, now independent of the box.
  if (location.hash !== '#zip-card') return;
  var openFinder = function () {
    var input = document.getElementById('zip-input');
    var showing = !!(card && card.getClientRects().length);
    var t = showing ? card : document.getElementById('widget-anchor');
    if (!t) return;
    if (showing && input) { try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); } }
    var r = t.getBoundingClientRect(), top = window.pageYOffset || document.documentElement.scrollTop || 0;
    window.scrollTo(0, Math.max(0, r.top + top - Math.max(16, (window.innerHeight - r.height) / 2)));
  };
  if (document.readyState === 'complete') setTimeout(openFinder, 0);
  else window.addEventListener('load', function () { setTimeout(openFinder, 0); }, { once: true });
})();
