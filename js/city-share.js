/* T-141 amendment (9): guide share, reusable across all 10 city pages (and any future guide page
   that includes this file). Standalone — this page is not inside the plan-finder widget, so it
   cannot call widget-v4.html's openShareSheet(); this is a small self-contained equivalent:
   WhatsApp, Text, Email, Copy — no PDF, no agent block. Message = page title + its own canonical
   URL (T-113 style). Icon matches the device (same pair T-143 adds to the plan-finder's own share
   buttons, so it reads the same site-wide): iPhone/iPad/Mac = box with an up arrow, everything
   else = three connected dots. */
(function(){
  var IOS = /iPhone|iPad|iPod|Macintosh|Mac OS/.test(navigator.userAgent);
  var ICON_IOS = '<svg class="shrico" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M12 4l-4 4M12 4l4 4"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg>';
  var ICON_DOTS = '<svg class="shrico" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><circle cx="18" cy="5" r="2.8"/><circle cx="6" cy="12" r="2.8"/><circle cx="18" cy="19" r="2.8"/><path d="M8.3 10.7l7.4-4.1M8.3 13.3l7.4 4.1" stroke="currentColor" stroke-width="1.8" fill="none"/></svg>';
  var ICON = IOS ? ICON_IOS : ICON_DOTS;

  function L(en, es){ return (document.documentElement.lang || '').slice(0,2) === 'es' ? es : en; }

  function paintIcons(){
    var hosts = document.querySelectorAll('[data-shr-icon]');
    for (var i = 0; i < hosts.length; i++) hosts[i].innerHTML = ICON;
  }

  function guideURL(){
    var canon = document.querySelector('link[rel="canonical"]');
    var base = canon ? canon.href : location.href.split('?')[0].split('#')[0];
    var sep = base.indexOf('?') > -1 ? '&' : '?';
    return base + sep + 'utm_source=guide_share&utm_medium=referral&share_id=' + shareId();
  }
  function shareId(){
    if (!window._cityShareId) window._cityShareId = Math.random().toString(36).slice(2, 10);
    return window._cityShareId;
  }
  function guideMsg(){
    var title = (document.querySelector('h1') || {}).textContent || document.title;
    return title.trim() + '\n' + guideURL();
  }
  function fireOpen(){
    if (typeof gtag === 'function') gtag('event', 'share_open', { mode: 'guide', page: location.pathname });
  }
  function fireSend(channel){
    if (typeof gtag === 'function') gtag('event', 'share_send', { mode: 'guide', channel: channel, page: location.pathname });
  }

  var sheetEl = null;
  function buildSheet(){
    if (sheetEl) return sheetEl;
    var wrap = document.createElement('div');
    wrap.className = 'gshsh-wrap';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML =
      '<div class="gshsh-backdrop" data-gsh-close></div>' +
      '<div class="gshsh" role="dialog" aria-modal="true" aria-label="' + L('Share this guide', 'Compartir esta guía') + '">' +
        '<p class="gshsh-h">' + L('Share this guide', 'Compartir esta guía') + '</p>' +
        '<button type="button" class="gshsh-ch" data-gsh="whatsapp"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6.1-.1.3-.3.4-.5.2-.2.2-.3.3-.5.1-.2.1-.4 0-.5-.1-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3z"/><path d="M12 2a10 10 0 0 0-8.6 15l-1 3.7 3.8-1A10 10 0 1 0 12 2z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg><span>WhatsApp</span></button>' +
        '<button type="button" class="gshsh-ch" data-gsh="sms">' + ICON.replace('shrico','shrico2') + '<span>' + L('Text', 'Texto') + '</span></button>' +
        '<button type="button" class="gshsh-ch" data-gsh="email"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg><span>Email</span></button>' +
        '<button type="button" class="gshsh-ch" data-gsh="copy"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg><span>' + L('Copy link', 'Copiar enlace') + '</span></button>' +
        '<button type="button" class="gshsh-cancel" data-gsh-close>' + L('Cancel', 'Cancelar') + '</button>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function(e){
      var close = e.target.closest('[data-gsh-close]');
      if (close) { closeSheet(); return; }
      var btn = e.target.closest('[data-gsh]');
      if (!btn) return;
      var k = btn.getAttribute('data-gsh');
      var msg = guideMsg(), url = guideURL();
      if (k === 'whatsapp') window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener');
      else if (k === 'sms') location.href = 'sms:?&body=' + encodeURIComponent(msg);
      else if (k === 'email') location.href = 'mailto:?subject=' + encodeURIComponent((document.querySelector('h1')||{}).textContent||document.title) + '&body=' + encodeURIComponent(msg);
      else if (k === 'copy') {
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).catch(function(){
          var ta = document.createElement('textarea'); ta.value = url; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); } catch(e){} document.body.removeChild(ta);
        }).then(function(){ btn.querySelector('span').textContent = L('Copied!', '¡Copiado!'); });
      }
      fireSend(k);
    });
    sheetEl = wrap;
    return wrap;
  }
  function openSheet(){
    fireOpen();
    var el = buildSheet();
    el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('gshsh-open');
  }
  function closeSheet(){
    if (!sheetEl) return;
    sheetEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('gshsh-open');
  }

  document.addEventListener('DOMContentLoaded', function(){
    paintIcons();
    var triggers = document.querySelectorAll('[data-gsh-open]');
    for (var i = 0; i < triggers.length; i++) triggers[i].addEventListener('click', openSheet);
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeSheet(); });
  });
})();
