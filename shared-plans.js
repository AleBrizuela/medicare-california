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
  R.push({g: L('Costs', 'Costos')});
  R.push({lab: L('Monthly premium', 'Prima mensual'), big: true, cells: PLANS.map(function(p){ return v(premUsd(p.prem)); })});
  if(MINE && MINE.prem != null){
    R.push({lab: L('Difference a year (premium)', 'Diferencia al año (prima)'), big: true, diff: true,
      cells: PLANS.map(function(p){
        if(p === MINE) return {t: '—', off: true};
        if(p.prem == null) return {t: noInfo(), na: true};
        var d = Math.round((p.prem - MINE.prem) * 12);
        if(d === 0) return {t: L('Same', 'Igual')};
        return {t: (d > 0 ? '+' : '−') + usd(Math.abs(d)), cls: d > 0 ? 'up' : 'dn'};
      })});
  }
  R.push({lab: L('Max out-of-pocket', 'Máximo de bolsillo'), big: true, cells: PLANS.map(function(p){ return v(p.moop == null ? null : usd(p.moop)); })});
  R.push({lab: L('Drug deductible', 'Deducible de medicamentos'), cells: PLANS.map(function(p){
    return p.drug ? v(p.dded == null ? null : usd(p.dded)) : {t: L('No drug coverage', 'Sin medicamentos'), off: true}; })});
  R.push({g: L('Visits', 'Consultas')});
  [['pcp', L('Primary doctor', 'Médico primario')], ['spec', L('Specialist', 'Especialista')],
   ['er', L('Emergency room', 'Emergencias')], ['urg', L('Urgent care', 'Urgencias')]]
    .forEach(function(x){ R.push({lab: x[1], cells: PLANS.map(function(p){ return v(money(p[x[0]])); })}); });
  R.push({lab: L('Your doctors and hospital', 'Sus médicos y hospital'),
    cells: PLANS.map(function(){ return {t: L('We check them for you', 'Lo revisamos por usted')}; })});
  R.push({g: L('Extra benefits', 'Beneficios extra')});
  R.push({lab: 'Dental', cells: PLANS.map(function(p){ return v(dentalT(p)); })});
  R.push({lab: L('Eyewear', 'Anteojos'), cells: PLANS.map(function(p){ return v(visionT(p)); })});
  R.push({lab: L('Hearing aids', 'Audífonos'), cells: PLANS.map(function(p){ return v(hearT(p)); })});
  R.push({lab: 'OTC', cells: PLANS.map(function(p){ return v(otcT(p)); })});
  R.push({g: L('CMS rating', 'Calificación CMS')});
  R.push({lab: L('Overall star rating', 'Estrellas (general)'), cells: PLANS.map(function(p){ return v(starsT(p)); })});
  return R;
}

function isZero(s){ return s === '$0' || s === '$0.00' || s === '0%'; }
function tableHTML(){
  var R = rows(), sameLabels = [], keep = [];
  R.forEach(function(r){
    if(r.g){ keep.push(r); return; }
    var same = r.cells.length > 1 && r.cells.every(function(c){ return c.t === r.cells[0].t; });
    if(same && !r.diff && !r.big){ sameLabels.push(r.lab); return; }
    keep.push(r);
  });
  var body = keep.filter(function(r, i){ return !(r.g && (i === keep.length - 1 || keep[i + 1].g)); }).map(function(r){
    if(r.g) return '<tr class="grp"><td colspan="' + (PLANS.length + 1) + '">' + esc(r.g) + '</td></tr>';
    return '<tr><td class="lab">' + esc(r.lab) + '</td>' + r.cells.map(function(c, j){
      var cls = 'v' + (r.big ? ' big' : '') + (c.off ? ' off' : '') + (c.na ? ' na off' : '') +
        (c.cls ? ' ' + c.cls : '') + (PLANS[j] === MINE ? ' mine' : '') + (!c.off && !c.na && isZero(String(c.t)) ? ' zero' : '');
      return '<td class="' + cls + '">' + esc(c.t) + '</td>';
    }).join('') + '</tr>';
  }).join('');
  var head = '<tr><th class="l0">' + L('Plans 2027', 'Planes 2027') + '</th>' + PLANS.map(function(p){
    return '<th class="' + (p === MINE ? 'mine' : '') + '" style="--cc:' + (p === MINE ? '#1E3A5F' : cc(p)) + '">' +
      '<span class="eb">' + (p === MINE ? L('YOUR PLAN', 'SU PLAN') : esc(p.org)) + '</span>' + esc(p.name) +
      '<span class="pid">' + esc(p.org) + '<br>' + esc(baseType(p)) + ' · <span class="nw">' + esc(dashId(p.id)) + '</span></span></th>';
  }).join('') + '</tr>';
  window._sameLabels = sameLabels;
  return '<div class="cmp"><table><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
}

function contactCard(){
  return '<div class="ctc"><img src="' + ADV.photo + '" alt="' + esc(ADV.name) + '" width="76" height="76" loading="lazy">' +
    '<h3>' + L('Questions about these plans?', '¿Preguntas sobre estos planes?') + '</h3>' +
    '<p>' + L('I answer in Spanish or English.', 'Le contesto en español o inglés.') + '</p>' +
    '<div class="row">' +
      '<a class="main" href="tel:' + ADV.tel + '" data-cta="contact_card" onclick="shEv(\'phone_click\')">' + L('Call', 'Llamar') + ' ' + ADV.telShown + '</a>' +
      '<a href="' + WA + '" target="_blank" rel="noopener" data-cta="contact_card" onclick="shEv(\'whatsapp_click\')">WhatsApp</a>' +
      '<a href="sms:' + ADV.tel + '" data-cta="contact_card" onclick="shEv(\'sms_click\')">' + L('Text', 'Texto') + '</a>' +
    '</div><p class="lic">' + esc(ADV.name) + ' · ' + advBrand() + '</p></div>';
}
function advBrand(){ return 'Medicare California'; }

// The ask goes to the site's own contact form, the one that is already wired to the leads sheet
// and already tested. T-078 does not open a second lead endpoint on this page.
function contactPath(){ return L('/contact', '/contacto'); }  // MC: English default, same two paths
function askBox(){
  return '<div class="askb"><img src="' + ADV.photo + '" alt="' + esc(ADV.name) + '" width="72" height="72" loading="lazy">' +
    '<h3>' + L('Which one is right for you?', '¿Cuál le conviene?') + '</h3>' +
    '<p>' + L('I tell you, based on your doctors.', 'Se lo digo según sus médicos.') + '</p>' +
    '<a class="b1" href="' + contactPath() + '" data-cta="final_cta" onclick="shEv(\'form_open\',\'final_cta\')">' + L('Ask for your personal comparison', 'Pida su comparación personal') + '</a>' +
    '<span class="alt">' + L('or text', 'o texto al') + ' <a href="sms:' + ADV.tel + '" data-cta="contact_card" onclick="shEv(\'sms_click\')">' + ADV.telShown + '</a></span></div>';
}

function render(){
  document.documentElement.lang = lang;
  $('langLink').textContent = L('Español', 'English');
  $('eyebrow').textContent = L('Shared with you', 'Le compartieron');
  $('h1').textContent = PLANS.length + ' ' + L(PLANS.length === 1 ? 'Medicare plan 2027' : 'Medicare plans 2027',
                                               PLANS.length === 1 ? 'plan de Medicare 2027' : 'planes de Medicare 2027');
  $('sub').textContent = (zip ? 'ZIP ' + zip : '') + (county ? ' · ' + county : '');
  $('stamp').textContent = (sDate ? L('Shared on ', 'Compartido el ') + fmtDate(sDate) : '') + cmsStamp();
  $('advLabel').textContent = L('Your advisor · Lic. #', 'Su asesora · Lic. #') + ADV.lic;
  $('advMail').textContent = ADV.mail;
  $('brand').textContent = advBrand();

  var noteCard = notes.length
    ? '<div class="card note"><p class="h">' + L('Their note', 'Su nota') + '</p><p>' + esc(notes[0]) + '</p></div>'
    : '<div class="card"><p style="font-size:15px;line-height:1.5">' +
        L('Questions about these plans? Text Alejandra: ', '¿Preguntas sobre estos planes? Escríbale a Alejandra: ') +
        '<a href="sms:' + ADV.tel + '" data-cta="inline_body" onclick="shEv(\'sms_click\',\'inline_body\')"><b>' + ADV.telShown + '</b></a></p></div>';

  var replies = notes.slice(1).map(function(n, i){
    return '<div class="r"><b>' + L('Reply ', 'Respuesta ') + (i + 1) + '</b>' + esc(n) + '</div>'; }).join('');

  var table = tableHTML();
  var same = (window._sameLabels || []).length
    ? '<div class="same"><h5>' + L('The same in all ' + PLANS.length, 'Igual en los ' + PLANS.length) + '</h5><p>' +
      esc(window._sameLabels.join(' · ')) + '</p></div>' : '';

  $('main').innerHTML =
    (dataChanged() ? '<div class="chg">' + L('Some CMS figures changed after this was shared. What you see below is today’s data.',
                                             'Algunas cifras de CMS cambiaron después de que le compartieron esto. Abajo ve los datos de hoy.') + '</div>' : '') +
    noteCard +
    (replies ? '<div class="replies">' + replies + '</div>' : '') +
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
          '<button class="b2" onclick="sendReply()">' + L('Send reply', 'Enviar respuesta') + '</button>' +
          ' <button class="b2" onclick="makePDF()">' + L('Save as PDF', 'Guardar en PDF') + '</button>' +
          '<p class="cnt" id="repok" style="text-align:left;color:#00796B"></p>') + '</div>' +
    contactCard() +
    '<div class="steps">' +
      '<div class="s"><b>' + L('Step 1', 'Paso 1') + '</b><span>' + L('You tell me your doctors.', 'Usted me dice sus médicos.') + '</span></div>' +
      '<div class="s"><b>' + L('Step 2', 'Paso 2') + '</b><span>' + L('I check them against each plan.', 'Yo los reviso en cada plan.') + '</span></div>' +
      '<div class="s"><b>' + L('Step 3', 'Paso 3') + '</b><span>' + L('We decide together.', 'Decidimos juntas.') + '</span></div>' +
    '</div>' +
    '<p style="margin-top:14px"><span class="gold">' + L('Open enrollment ends December 7', 'La inscripción termina el 7 de diciembre') + '</span></p>' +
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
    (DATA && DATA.source ? '<p>' + esc(L('Source: ', 'Fuente: ') + DATA.source) + '</p>' : '') +
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
