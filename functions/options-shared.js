/* T-136 (2026-10-24) · the link preview for a shared comparison, the path the widget actually uses.
 *
 * shareURL() in widget-v4.html builds `/options-shared?zip=...&p=id1,id2&lang=...` (the query-string
 * form; SHARE_READABLE_PATH, the path-based `/options/<zip>/<ids>` form that `functions/options/
 * [[path]].js` handles, is off). That older Function was never reached by a real share link, so this
 * one rewrites the title and the link-preview image for the path visitors actually get.
 *
 * WhatsApp, iMessage, Facebook and Gmail do not run JavaScript: the preview is whatever HTML the
 * server hands their crawler. For a link-preview crawler only (or ?og=1, for checking), this serves
 * the static file with its og/twitter tags rewritten: the agent for the ZIP's state (same state map
 * as beneficiosmedicare's opciones-compartidas.js, T-159: Alejandra for CA and AZ, Susana everywhere
 * else) and her card image (1200x630, og-plans-mc-<agent>-<lang>-20261024.jpg). MC's own repo carries
 * no zip->state data (it embeds beneficiosmedicare's widget rather than its own), so the lookup is a
 * plain cross-origin fetch of BM's public `/data/zip_index.js` -- a static asset, not a bound
 * service. Any failure (network, parse, unknown ZIP) falls through to the static file's own default
 * (Alejandra, English): a shared link never breaks over an image choice.
 *
 * People get the plain file, untouched: the page draws itself in the browser. Only a crawler pays
 * for the lookup, a plain text search, well inside a Function's CPU budget. Anything unexpected
 * returns the plain file, so a shared link always opens.
 */
const BOT = /facebookexternalhit|facebot|whatsapp|twitterbot|slackbot|linkedinbot|telegrambot|discordbot|skypeuripreview|googlebot|google-inspectiontool|googleimageproxy|google-pagerenderer|bingbot|applebot|pinterest|embedly|redditbot|iframely|vkshare|outbrain|quora link preview|nuzzel|bitlybot|xing-contenttabreceiver|mastodon|bluesky/i;
const ALEJANDRA = { CA: 1, AZ: 1 };  // T-159: her only licensed states; Susana everywhere else
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function pick(text, key) {
  const k = '"' + key + '":"', i = text.indexOf(k);
  if (i < 0) return '';
  const j = text.indexOf('"', i + k.length);
  return j < 0 ? '' : text.slice(i + k.length, j);
}

export async function onRequestGet(context) {
  const { request, next } = context;
  const res = await next();
  try {
    const url = new URL(request.url);
    const force = url.searchParams.get('og') === '1';
    if (!force && !BOT.test(request.headers.get('user-agent') || '')) return res;
    if (!/text\/html/i.test(res.headers.get('content-type') || '')) return res;

    const zip = url.searchParams.get('zip') || '';
    const ids = (url.searchParams.get('p') || '').split(',').filter(x => /^[A-Z0-9-]{4,}$/i.test(x)).slice(0, 3);
    // T-139: a shared LIST link carries no plan ids at all (it replays filters, not a plan set), so
    // its own count (n) and filter words (t) -- written by shareListURL() in widget-v4.html -- stand
    // in for what `ids` gives the compare case below.
    const listN = parseInt(url.searchParams.get('n') || '0', 10) || 0;
    const isList = !ids.length && listN > 0;
    if (!/^\d{5}$/.test(zip) || (!ids.length && !isList)) return res;

    const en = url.searchParams.get('lang') !== 'es';
    const n = isList ? listN : ids.length;
    const t = isList ? (url.searchParams.get('t') || '') : '';

    // T-138: the title names the CITY (USPS default city + state), never the county -- the state
    // (for the agent) and the place (city, ZIP's own fallback) both come from BM's public data
    // files, same cross-origin fetch as the agent lookup always used (MC's own repo carries no
    // zip->place data; it embeds BM's widget rather than its own).
    let ak = 'alejandra', st = '', place = '';
    try {
      const zi = await fetch('https://beneficiosmedicare.com/data/zip_index.js');
      if (zi.ok) {
        st = pick(await zi.text(), zip);
        ak = ALEJANDRA[st] ? 'alejandra' : 'susana';
      }
      const zc = await fetch('https://beneficiosmedicare.com/data/zip_city.js');
      if (zc.ok) place = pick(await zc.text(), zip);
    } catch (e) { /* keep defaults */ }

    const where = place || (/^[A-Z]{2}$/.test(st) ? st : `ZIP ${zip}`);
    // T-138 (7): no "Medicare" -- the logo and the link already say it.
    const title = isList
      ? (en ? `${n}${t ? ' ' + t : ''} plan${n === 1 ? '' : 's'} in ${where}`
            : `${n} plan${n === 1 ? '' : 'es'}${t ? ' ' + t : ''} en ${where}`)
      : en ? `${n} plan${n === 1 ? '' : 's'} for 2027 in ${where}`
           : `${n} plan${n === 1 ? '' : 'es'} 2027 en ${where}`;

    const img = `${url.origin}/og-plans-mc-${ak}-${en ? 'en' : 'es'}-20261024.jpg`;
    const alt = ak === 'susana'
      ? (en ? 'Susana Marcos, Medicare agent, Medicare-California.com' : 'Susana Marcos, agente de Medicare, Medicare-California.com')
      : (en ? 'Alejandra Brizuela, Medicare agent, Medicare-California.com' : 'Alejandra Brizuela, agente de Medicare, Medicare-California.com');

    const html = (await res.text())
      .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)} | Medicare California</title>`)
      .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`)
      .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${esc(img)}">`)
      .replace(/<meta property="og:image:secure_url" content="[^"]*">/, `<meta property="og:image:secure_url" content="${esc(img)}">`)
      .replace(/<meta property="og:image:alt" content="[^"]*">/, `<meta property="og:image:alt" content="${esc(alt)}">`)
      .replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${esc(img)}">`)
      .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${esc(url.toString())}">`);

    const headers = new Headers(res.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('x-robots-tag', 'noindex, follow');
    headers.set('x-og-agent', ak);
    headers.delete('content-length');
    return new Response(html, { status: res.status, headers });
  } catch (e) {
    return res;
  }
}
