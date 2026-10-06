/* T-032 · Seasonal date strip (signed AB 2026-10-05). Replaces the AEP banner, which said
   "¡La inscripción está ABIERTA!" forever, including after AEP closed: a false enrollment claim from Dec 8.
   One file per site; every page with <div id="aep-banner" data-lang="es|en"> gets the strip.
   The message is picked by today's date, so it is always true without anyone changing it:
     Sep 1-Oct 14 before AEP + countdown · Oct 15-Dec 7 AEP open + days left · Dec 8-31 new plan Jan 1
     Jan 1-Mar 31 OEP (Medicare Advantage, change once) · Apr 1-Aug 31 turning 65
   Change wording here, never on the pages. Same file on both sites except SITE below. */
(function () {
  var SITE = {
    bg: '#00578F',   // MC: one shade deeper than MC blue so the yellow link passes contrast (5.4:1, white 7.6:1)
    links: {
      en: { aep: '/blog/medicare-aep-2027-california-changes', aepYear: 2027, contact: '/contact',
            oep: '/blog/aep-vs-medicare-advantage-oep-california', t65: '/blog/turning-65-california-medicare-iep-guide' },
      es: { aep: 'https://beneficiosmedicare.com/blog/inscripcion-anual-aep-2027-california', aepYear: 2027, contact: '/contacto',
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

  var text, more, href;
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
    more = lang === 'en' ? 'Review your plan' : 'Revise su plan'; href = aepLink;
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
  el.innerHTML = '<span>' + text + '</span><a class="ds-more" href="' + href + '">' + more + ' &rarr;</a>';
})();
