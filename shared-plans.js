/* T-056 · the page a shared plan link opens.
 *
 * Everything on screen comes from the link and from the CMS plan file this site already serves.
 * We store nothing: the plans, the ZIP, the language and the date are in the query, and the note
 * is after the "#", which a browser never sends to a server. A reply is added to the link the
 * reader sends back, for the same reason.
 *
 * Lead rules on this page are the same as the widget's, plus from_share=yes and the share id, so
 * PROVE can follow shared -> opened -> asked -> client without any personal data in the events.
 */
(function(){
'use strict';

// ── link ──
var Q = new URLSearchParams(location.search);
var lang = Q.get('l') === 'es' ? 'es' : 'en';
var zip  = (Q.get('z') || '').replace(/\D/g, '').slice(0, 5);
var ids  = (Q.get('p') || '').split(';').map(function(s){return s.trim();}).filter(Boolean).slice(0, 4);
var myId = (Q.get('m') || '').trim();
var sDate= (Q.get('d') || '').slice(0, 10);
var sid  = (Q.get('s') || '').slice(0, 12);
var chan = (Q.get('utm_medium') || '').slice(0, 20);
function hashNotes(){
  var h = location.hash.replace(/^#/, '');
  if(!h) return [];
  var p = new URLSearchParams(h), out = [];
  ['n','n2','n3','n4'].forEach(function(k){ var v = p.get(k); if(v) out.push(v.slice(0, 280)); });
  return out;
}
var notes = hashNotes();

function L(en, es){ return lang === 'en' ? en : es; }
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
function $(id){ return document.getElementById(id); }

// ── money and labels, the same wording the widget uses ──
function usd(v, cents){ if(v == null) return null;
  return '$' + Number(v).toLocaleString('en-US', {minimumFractionDigits: cents && v % 1 ? 2 : 0, maximumFractionDigits: cents ? 2 : 0}); }
function premUsd(v){ return v == null ? null : (v === 0 ? '$0' : usd(v, true)); }
function money(s){ if(s == null || s === '') return null; return String(s); }
function noInfo(){ return L('No information', 'Sin información'); }
function dashId(id){ var m = String(id || '').split('_');
  return m[0] + (m[1] ? '-' + m[1] : '') + (m[2] && m[2] !== '0' ? '-' + m[2] : ''); }
function baseType(p){ return String(p.type || '').replace(/\s*[CDI]-SNP\s*/g, '').trim(); }

var CARRIER_COLORS = {
  'SCAN Health Plan':'#0057A6','Alignment Health Plan':'#F37021','Alignment Health':'#F37021',
  'UnitedHealthcare':'#002677','Humana':'#49A942','Blue Shield of California':'#0073CF',
  'Aetna Medicare':'#7D3F98','Aetna':'#7D3F98','Anthem Blue Cross':'#0055A5','Anthem':'#0055A5',
  'Kaiser Permanente':'#B11226','Wellcare':'#00529B','Centene':'#E31837',
  'L.A. Care Health Plan':'#009CDE','Molina Healthcare of California':'#E31837',
  'Clever Care Health Plan':'#FF6B35','Central Health Medicare Plan':'#2E86AB',
  'UCLA Health Medicare Advantage Plan':'#2774AE','Astiva Health':'#00A5CF',
  'AHF':'#E3000B','Elite Health Plan, Inc.':'#1B4F72',
  'Imperial Health Plan of California, Inc.':'#2E8B57','Champion Heath Plan':'#FF8C00',
  'VillageHealth':'#4B8B3B','Align Senior Care':'#5B8A72'
};
function cc(p){ return CARRIER_COLORS[p.org] || '#C9D1D8'; }

// ── GA, same shape as the widget's events ──
function gaInternal(){ try { return !!window.bmInternal || /\.pages\.dev$/i.test(location.hostname); } catch(e){ return false; } }
function ev(name, params){
  try {
    var base = {site: 'mc', lang: lang, page: 'shared', zip3: zip.slice(0, 3), share_id: sid, channel: chan};
    if(gaInternal()) base.traffic_type = 'internal';
    if(typeof gtag === 'function') gtag('event', name, Object.assign(base, params || {}));
  } catch(e){}
}

// ── advisor ──
var ADV = {name: 'Alejandra Brizuela', lic: '4507923', tel: '+13105979142', telShown: '(310) 597-9142',
  mail: 'Alejandra@Medicare-California.com', photo: '/images/alejandra-headshot.webp'};
var WA = 'https://wa.me/13105979142';

// ── data ──
var DATA = null, PLANS = [], MINE = null, county = '';
function loadScript(src){ return new Promise(function(res, rej){
  var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }

// The CMS plan files are served from beneficiosmedicare.com, which is where the plan finder
// keeps them; this page reads them there rather than carrying a 44 MB copy of the same files.
// A *.pages.dev preview reads its own twin preview, so a branch is never checked against
// production data by accident.
// This works because Cloudflare Pages serves every asset with Access-Control-Allow-Origin: *
// (measured on beneficiosmedicare.com 2026-10-15, on /data/*, / and /widget-v4.html). It is a
// Pages default, not a rule in that repo's _headers. If a cross-origin fetch here ever starts
// failing, that default is the first thing to check, and the fix is four lines in BM's
// _headers under /data/*.
function dataHost(){
  var h = location.hostname;
  if(/\.pages\.dev$/i.test(h)) return 'https://' + h.replace('medicare-california', 'beneficiosmedicare');
  return 'https://beneficiosmedicare.com';
}
function boot(){
  if(!zip || !ids.length){ fail(L('This link is incomplete.', 'Este enlace está incompleto.')); return; }
  loadScript(dataHost() + '/data/zip_index.js')
    .then(function(){
      var st = (typeof ZIP_INDEX !== 'undefined') ? ZIP_INDEX[zip] : null;
      if(!st) throw new Error('zip');
      return fetch(dataHost() + '/data/plans_' + st + '_2027.json').then(function(r){ if(!r.ok) throw new Error('data'); return r.json(); });
    })
    .then(function(j){
      DATA = j; county = (j.zips && j.zips[zip]) || '';
      var byId = {}; j.plans.forEach(function(p){ byId[p.id] = p; });
      PLANS = ids.map(function(i){ return byId[i]; }).filter(Boolean);
      MINE = myId ? (byId[myId] || null) : null;
      if(MINE) PLANS = [MINE].concat(PLANS.filter(function(p){ return p.id !== MINE.id; }));
      if(!PLANS.length) throw new Error('plans');
      render();
      ev('shared_view', {plans: PLANS.length, has_note: notes.length ? 'yes' : 'no',
        days_since_share: daysSince(), data_changed: dataChanged() ? 'yes' : 'no', my_plan: MINE ? 'yes' : 'no'});
    })
    .catch(function(){ fail(L('We could not open this comparison.', 'No pudimos abrir esta comparación.')); });
}
function fail(msg){
  $('main').innerHTML = '<div class="err">' + esc(msg) + ' ' +
    L('Ask the person who sent it for a new link, or write to us.', 'Pídale un enlace nuevo a quien se lo mandó, o escríbanos.') + '</div>' + contactCard();
  paintPin();
}
function daysSince(){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(sDate)) return '';
  var d = Math.round((Date.now() - Date.parse(sDate + 'T12:00:00')) / 86400000);
  return d >= 0 ? d : '';
}
// "Changed" means the CMS file behind the page is not the one the link was made from. The share
// carries the plan file's own source line; nothing is inferred from a clock.
function dataChanged(){
  var v = Q.get('v');
  if(!v || !DATA) return false;
  return v !== hash8(DATA.source || '');
}
function hash8(s){ var h = 5381; for(var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36).slice(0, 8); }
// The CMS source line is written in English by the build. On a Spanish page we show the date out of
// it, not the sentence; the whole line is still printed in the fine print at the bottom.
function cmsStamp(){
  if(!DATA || !DATA.source) return '';
  var m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(DATA.source);
  if(!m) return '';
  return ' · ' + L('CMS data of ', 'Datos de CMS del ') + fmtDate(m[3] + '-' + m[1] + '-' + m[2]);
}
function fmtDate(iso){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  var d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString(lang === 'en' ? 'en-US' : 'es-US', {year: 'numeric', month: 'long', day: 'numeric'});
}

// ── benefit text, short forms only ──
function dentalT(p){ var v = String(p.dental || '').toLowerCase();
  if(v === 'comprehensive') return {t: L('Preventive + major', 'Preventivo + mayor')};
  if(v === 'preventive') return {t: L('Preventive', 'Preventivo')};
  if(v === 'none') return {t: L('Not included', 'No incluido'), off: true};
  return null; }
function visionT(p){ var v = String(p.vision || '').toLowerCase();
  if(v === 'exams+eyewear') return {t: L('Exams + eyewear', 'Examen + anteojos')};
  if(v === 'exams') return {t: L('Exams only', 'Solo examen')};
  if(v === 'none') return {t: L('Not included', 'No incluido'), off: true};
  return null; }
function hearT(p){ var v = String(p.hearing || '').toLowerCase();
  if(v === 'exams+aids') return {t: L('Exams + aids', 'Examen + audífonos')};
  if(v === 'aids') return {t: L('Aids only', 'Solo audífonos')};
  if(v === 'exams') return {t: L('Exams only', 'Solo examen')};
  if(v === 'none') return {t: L('Not included', 'No incluido'), off: true};
  return null; }
var PER = {mo:['a month','al mes'],'3mo':['every 3 months','cada 3 meses'],'6mo':['every 6 months','cada 6 meses'],yr:['a year','al año']};
function otcT(p){ var o = p.otc;
  if(!o) return null;
  if(!o.has) return {t: L('Not included', 'No incluido'), off: true};
  if(o.amt == null) return {t: L('Included', 'Incluido')};
  var w = PER[o.per]; return {t: usd(o.amt) + (w ? ' ' + L(w[0], w[1]) : '')}; }
function starsT(p){
  if(typeof p.stars === 'number' && p.stars > 0) return {t: p.stars.toFixed(1).replace(/\.0$/, '') + ' ★'};
  if(p.starsna === 'new') return {t: L('Too new to rate', 'Plan nuevo, sin calificación'), off: true};
  if(p.starsna === 'few') return {t: L('Not enough data', 'Sin datos suficientes'), off: true};
  return null; }

function rows(){
  var R = [], v = function(x){ return x == null ? {t: noInfo(), na: true} : (typeof x === 'string' ? {t: x} : x); };
  // Same rows, same order, same groups as the PDF. One sheet, two outputs, so they cannot drift.
  if(PLANS.some(function(p){ return typeof p.stars === 'number' || p.starsna; }))
    R.push({lab: L('Star rating 2027', 'Estrellas Medicare 2027'), keep: true, stars: true,
      cells: PLANS.map(function(p){
        return (typeof p.stars === 'number' && p.stars > 0)
          ? {t: '\u2605 ' + p.stars.toFixed(1).replace(/\.0$/, '') + L(' of 5', ' de 5')}
          : {t: L('Not rated yet', 'Aún sin calificación'), off: true}; })});
  R.push({g: L('COSTS', 'COSTOS')});
  R.push({lab: L('Monthly premium', 'Prima mensual'), big: true, keep: true,
    cells: PLANS.map(function(p){ return v(premUsd(p.prem)); })});
  if(MINE && MINE.prem != null){
    R.push({lab: L('Difference a year (premium)', 'Diferencia al año (prima)'), big: true, diff: true, keep: true,
      cells: PLANS.map(function(p){
        if(p === MINE) return {t: '—', off: true};
        if(p.prem == null) return {t: noInfo(), na: true};
        var d = Math.round((p.prem - MINE.prem) * 12);
        if(d === 0) return {t: L('Same', 'Igual')};
        return {t: (d > 0 ? '+' : '−') + usd(Math.abs(d)), cls: d > 0 ? 'up' : 'dn'};
      })});
  }
  R.push({lab: L('Part B giveback (if any)', 'Devolución Parte B (si hay)'),
    cells: PLANS.map(function(p){ return p.gb ? {t: usd(p.gb) + L(' a month', ' al mes')} : {t: L('Not included', 'No incluido'), off: true}; })});
  R.push({lab: L('Yearly max out-of-pocket', 'Máximo de gastos al año'), big: true, keep: true,
    cells: PLANS.map(function(p){ return v(p.moop == null ? null : usd(p.moop)); })});
  R.push({lab: L('Doctor / specialist', 'Médico / especialista'),
    cells: PLANS.map(function(p){ return {t: (money(p.pcp) || noInfo()) + ' / ' + (money(p.spec) || noInfo())}; })});
  R.push({lab: L('Emergency room', 'Sala de emergencias'), cells: PLANS.map(function(p){ return v(money(p.er)); })});
  R.push({g: L('YOUR DOCTOR AND HOSPITAL', 'SU MÉDICO Y HOSPITAL')});
  // said once, across the columns - never a row that could land in "the same in all"
  R.push({full: L('We check your doctors and your hospital against each plan, one by one.',
                  'Revisamos sus médicos y su hospital en cada plan, uno por uno.')});
  R.push({g: L('DRUGS (PART D)', 'MEDICINAS (PARTE D)')});
  R.push({lab: L('Covers drugs?', '¿Cubre medicinas?'),
    cells: PLANS.map(function(p){ return {t: p.drug ? L('Yes', 'Sí') : L('No', 'No'), off: !p.drug}; })});
  R.push({lab: L('Drug deductible', 'Deducible de medicinas'), cells: PLANS.map(function(p){
    return p.drug ? v(p.dded == null ? null : usd(p.dded)) : {t: L('No drug coverage', 'Sin medicamentos'), off: true}; })});
  R.push({g: 'EXTRAS'});
  R.push({lab: 'Dental', cells: PLANS.map(function(p){ return v(dentalT(p)); })});
  R.push({lab: L('Hearing aids', 'Audífonos'), cells: PLANS.map(function(p){ return v(hearT(p)); })});
  R.push({lab: L('Eyewear', 'Anteojos'), cells: PLANS.map(function(p){ return v(visionT(p)); })});
  R.push({lab: 'OTC', cells: PLANS.map(function(p){ return v(otcT(p)); })});
  return R;
}
// The two numbers that differ most across these plans, in dollars. A fact, never a
// recommendation: nothing here may read as "best" or "suggested".
function insight(){
  var out = [];
  [[L('Premium a year', 'Prima al año'), function(p){ return p.prem == null ? null : Math.round(p.prem * 12); }],
   [L('Yearly max out-of-pocket', 'Máximo de gastos al año'), function(p){ return p.moop; }],
   [L('Drug deductible', 'Deducible de medicinas'), function(p){ return p.drug ? p.dded : null; }]].forEach(function(x){
    var vs = PLANS.map(x[1]).filter(function(v){ return typeof v === 'number'; });
    if(vs.length < 2) return;
    var lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
    if(hi > lo) out.push({d: hi - lo, t: x[0] + ' ' + usd(lo) + L(' to ', ' a ') + usd(hi)});
  });
  out.sort(function(a, b){ return b.d - a.d; });
  return out.slice(0, 2).map(function(o){ return o.t; }).join('   ·   ');
}
function isZero(s){ return s === '$0' || s === '$0.00' || s === '0%'; }
function tableHTML(){
  var R = rows(), sameLabels = [], keep = [];
  R.forEach(function(r){
    if(r.g || r.full){ keep.push(r); return; }
    var same = r.cells.length > 1 && r.cells.every(function(c){ return c.t === r.cells[0].t; });
    if(same && !r.keep){ sameLabels.push(r.lab); return; }
    keep.push(r);
  });
  var body = keep.filter(function(r, i){ return !(r.g && (i === keep.length - 1 || keep[i + 1].g)); }).map(function(r){
    if(r.g) return '<tr class="grp"><td colspan="' + (PLANS.length + 1) + '">' + esc(r.g) + '</td></tr>';
    if(r.full) return '<tr class="full"><td colspan="' + (PLANS.length + 1) + '">' + esc(r.full) + '</td></tr>';
    return '<tr><td class="lab">' + esc(r.lab) + '</td>' + r.cells.map(function(c, j){
      var cls = 'v' + (r.big ? ' big' : '') + (c.off ? ' off' : '') + (c.na ? ' na off' : '') +
        (c.cls ? ' ' + c.cls : '') + (PLANS[j] === MINE ? ' mine' : '') + (!c.off && !c.na && isZero(String(c.t)) ? ' zero' : '');
      return '<td class="' + cls + '">' + esc(c.t) + '</td>';
    }).join('') + '</tr>';
  }).join('');
  // The carrier is named ONCE per column, big and in its own colour, as on the printed sheet.
  var head = '<tr><th class="l0">' + L('Plans 2027', 'Planes 2027') + '</th>' + PLANS.map(function(p){
    return '<th class="' + (p === MINE ? 'mine' : '') + '" style="--cc:' + (p === MINE ? '#002147' : cc(p)) + '">' +
      '<span class="car">' + (p === MINE ? L('YOUR PLAN', 'SU PLAN') : esc(p.org)) + '</span>' +
      '<span class="nm">' + esc(p.name) + '</span>' +
      '<span class="pid">' + esc(baseType(p)) + ' · <span class="nw">' + esc(dashId(p.id)) + '</span></span></th>';
  }).join('') + '</tr>';
  window._sameLabels = sameLabels;
  return '<div class="cmp"><table><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
}
// ONE contact block on the page, after the table, and no photo in it: the photo is in the
// header band, once (T-056 round 7 point 2 - AB: "don't think i want my picture TWICE").
function contactPath(){ return L('/contact', '/contacto'); }
function advBrand(){ return 'Medicare California'; }
function askBox(){
  return '<div class="askb">' +
    '<h3>' + L('Which one is right for you?', '¿Cuál le conviene?') + '</h3>' +
    '<p>' + L('I tell you, based on your doctors.', 'Se lo digo según sus médicos.') + '</p>' +
    '<a class="b1" href="' + contactPath() + '" data-cta="final_cta" onclick="shEv(\'form_open\',\'final_cta\')">' +
      L('Ask for your personal comparison', 'Pida su comparación personal') + '</a>' +
    '<div class="row" style="display:flex;gap:9px;justify-content:center;flex-wrap:wrap;margin-top:10px">' +
      '<a class="b2" href="tel:' + ADV.tel + '" data-cta="contact_card" onclick="shEv(\'phone_click\')">' + L('Call', 'Llamar') + ' ' + ADV.telShown + '</a>' +
      '<a class="b2" href="' + WA + '" target="_blank" rel="noopener" data-cta="contact_card" onclick="shEv(\'whatsapp_click\')">WhatsApp</a>' +
      '<a class="b2" href="sms:' + ADV.tel + '" data-cta="contact_card" onclick="shEv(\'sms_click\')">' + L('Text', 'Texto') + '</a>' +
    '</div></div>';
}
function contactCard(){ return askBox(); }   // the fallback path shows the same one block
function stepsHTML(){
  return '<div class="steps">' +
    [[L('We review your doctors and drugs together.', 'Revisamos juntos sus médicos y sus medicinas.')],
     [L('Changes from Oct 15 to Dec 7, 2026.', 'Cambios del 15 de oct. al 7 de dic. de 2026.')],
     [L('Your new plan starts Jan 1, 2027.', 'Su plan nuevo empieza el 1 de enero de 2027.')]]
    .map(function(x, i){ return '<div class="s"><b>' + (i + 1) + '.</b>' + esc(x[0]) + '</div>'; }).join('') + '</div>';
}
function render(){
  document.documentElement.lang = lang;
  $('langLink').textContent = L('Español', 'English');
  $('eyebrow').textContent = L('Shared with you', 'Le compartieron');
  $('h1').textContent = PLANS.length + ' ' + L(PLANS.length === 1 ? 'Medicare plan 2027' : 'Medicare plans 2027',
                                               PLANS.length === 1 ? 'plan de Medicare 2027' : 'planes de Medicare 2027');
  $('sub').textContent = (zip ? 'ZIP ' + zip : '') + (county ? ' · ' + county : '');
  // One date story: shared on, CMS data of, opened on - the same three the PDF prints.
  $('stamp').textContent = (sDate ? L('Shared on ', 'Compartido el ') + fmtDate(sDate) : '') + cmsStamp() +
    ' · ' + L('opened ', 'abierto el ') + fmtDate(new Date().toISOString().slice(0, 10));
  $('advLabel').textContent = L('Your advisor · Lic. #', 'Su asesora · Lic. #') + ADV.lic;
  $('advMail').textContent = ADV.mail;
  $('brand').textContent = advBrand();

  var noteCard = notes.length
    ? '<div class="card note"><p class="h">' + L('Their note', 'Su nota') + '</p><p>' + esc(notes[0]) + '</p></div>'
    : '';
  var replies = notes.slice(1).map(function(n, i){
    return '<div class="r"><b>' + L('Reply ', 'Respuesta ') + (i + 1) + '</b>' + esc(n) + '</div>'; }).join('');

  // the sheet's top strip: what changes most, and the one gold thing on the page
  var ins = insight();
  var strip = '<div class="ins"><div class="t">' +
    (ins ? '<b>' + L('What changes most: ', 'Lo que más cambia: ') + '</b>' + esc(ins)
         : esc(L('The official CMS figures for these plans, side by side.', 'Las cifras oficiales de CMS de estos planes, lado a lado.'))) +
    '</div><span class="gold">' + L('Choose by Dec 7 · starts Jan 1', 'Elija antes del 7 de dic. · inicia el 1 de enero') + '</span></div>';

  var table = tableHTML();
  var same = (window._sameLabels || []).length
    ? '<div class="same"><h5>' + L('The same in all ' + PLANS.length, 'Igual en los ' + PLANS.length) + '</h5><p>' +
      esc(window._sameLabels.join(' · ')) + '</p></div>' : '';

  $('main').innerHTML =
    (dataChanged() ? '<div class="chg">' + L('Some CMS figures changed after this was shared. What you see below is today\u2019s data.',
                                             'Algunas cifras de CMS cambiaron después de que le compartieron esto. Abajo ve los datos de hoy.') + '</div>' : '') +
    noteCard +
    (replies ? '<div class="replies">' + replies + '</div>' : '') +
    strip +
    table + same +
    (MINE && MINE.prem != null ? '<p class="fine" style="margin-top:8px">' +
      L('The yearly difference compares the monthly premium only. Copays and drug costs depend on the care you use.',
        'La diferencia al año compara solo la prima mensual. Los copagos y los medicamentos dependen de la atención que use.') + '</p>' : '') +
    askBox() +
    '<div class="card rep"><p style="font-weight:700;margin-bottom:7px">' + L('Add a reply', 'Agregar una respuesta') + '</p>' +
      (notes.length >= 4
        ? '<p style="font-size:14px;color:#5F6B75">' + L('This link already has the most replies it can carry.', 'Este enlace ya tiene todas las respuestas que puede llevar.') + '</p>'
        : '<textarea id="rep" maxlength="280" placeholder="' + esc(L('e.g. I like the second one. Can we talk Sunday?', 'Ej: Me gusta el segundo. ¿Hablamos el domingo?')) + '" oninput="repCount()"></textarea>' +
          '<p class="cnt"><span id="repc">0</span>/280</p>' +
          '<div class="btns"><button class="b2" onclick="sendReply()">' + L('Send reply', 'Enviar respuesta') + '</button>' +
          '<button class="b2" onclick="makePDF()">' + L('Save as PDF', 'Guardar en PDF') + '</button></div>' +
          '<p class="cnt" id="repok" style="text-align:left;color:#007B40"></p>') + '</div>' +
    stepsHTML() +
    fineprint();
  paintPin();
  $('langLink').href = switchLangURL();
}
function fineprint(){
  return '<div class="fine">' +
    '<p>' + L('We do not offer every plan available in your area. Currently we represent 7 organizations which offer 255 products in your area. Please contact Medicare.gov or 1-800-MEDICARE to get information on all of your options.',
              'No ofrecemos todos los planes disponibles en su área. Actualmente representamos 7 organizaciones que ofrecen 255 productos en su área. Comuníquese con Medicare.gov o llame al 1-800-MEDICARE para obtener información sobre todas sus opciones.') + '</p>' +
    '<p>' + L('Not connected with or endorsed by the federal government or the Medicare program.',
              'No está relacionado ni respaldado por el gobierno federal ni por el programa Medicare.') + '</p>' +
    '<p>' + L('Every year, Medicare evaluates plans based on a 5-star rating system.',
              'Cada año, Medicare evalúa los planes según un sistema de calificación de 5 estrellas.') + '</p>' +
    '<p>' + esc(L('A fixed picture of the CMS data', 'Es una foto fija de los datos de CMS') + cmsStamp().replace(/^ · /, ': ') +
      L('. Plan details can change. © 2026 Susana Marcos LLC, doing business as ', '. Los detalles del plan pueden cambiar. © 2026 Susana Marcos LLC, que opera como ') + advBrand() + '.') + '</p>' +
    '</div>';
}
function paintPin(){
  $('pinBar').innerHTML = '<a href="sms:' + ADV.tel + '" data-cta="sticky_bar" onclick="shEv(\'sms_click\',\'sticky_bar\')">' +
    '<img src="' + ADV.photo + '" alt="" width="30" height="30">' + L('Ask Alejandra', 'Pregúntele a Alejandra') + '</a>';
}
function switchLangURL(){
  var q = new URLSearchParams(location.search); q.set('l', lang === 'en' ? 'es' : 'en');
  return location.pathname + '?' + q.toString() + location.hash;
}
window.switchLang = function(e){ e.preventDefault(); location.href = switchLangURL(); };
window.shEv = function(name, placement){ ev(name, {placement: placement || 'contact_card'}); };
window.repCount = function(){ var t = $('rep'), c = $('repc'); if(t && c) c.textContent = String(t.value.length); };

// A reply travels in the link the reader sends back. Nothing is stored here.
window.sendReply = function(){
  var t = $('rep'); if(!t || !t.value.trim()) return;
  var h = new URLSearchParams(location.hash.replace(/^#/, ''));
  var k = ['n','n2','n3','n4'].find(function(x){ return !h.get(x); }) || 'n4';
  h.set(k, t.value.trim().slice(0, 280));
  var url = location.origin + location.pathname + location.search + '#' + h.toString();
  ev('shared_reply_send', {notes: notes.length + 1});
  var txt = encodeURIComponent(url);
  if(navigator.share) navigator.share({title: document.title, url: url}).catch(function(){ copy(url); });
  else if(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) location.href = (/Android/i.test(navigator.userAgent) ? 'sms:?body=' : 'sms:&body=') + txt;
  else copy(url);
};
function copy(url){
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url);
  var o = $('repok'); if(o) o.textContent = L('Link with your reply copied. Send it back to them.', 'Enlace con su respuesta copiado. Envíeselo de vuelta.');
}
window.makePDF = function(){ ev('pdf_open', {from: 'shared'}); window.print(); };

// ── staging badge: nobody should mistake a preview for the live site ──
// It lives in the sticky top bar, not floating over the page: floating, it covered a figure in
// the comparison table at 375px, and a badge that hides a number is worse than no badge.
if(/\.pages\.dev$/i.test(location.hostname)){
  var b = document.createElement('span'); b.className = 'stg-badge';
  b.textContent = 'STAGING';
  var bar = document.querySelector('.tb .wrap'), ln = document.getElementById('langLink');
  if(bar && ln) bar.insertBefore(b, ln); else document.body.appendChild(b);
}
boot();
})();
