/* T-136 (2026-10-24) · the link preview for a shared comparison, the path the widget actually uses.
 *
 * shareURL() in widget-v4.html builds `/options-shared?zip=...&p=id1,id2&lang=...` (the query-string
 * form; SHARE_READABLE_PATH, the path-based `/options/<zip>/<ids>` form that `functions/options/
 * [[path]].js` handles, is off). That older Function was never reached by a real share link, so this
 * one rewrites the title and the link-preview image for the path visitors actually get.
 *
 * WhatsApp, iMessage, Facebook and Gmail do not run JavaScript: the preview is whatever HTML the
 * server hands their crawler. For a link-preview crawler only (or ?og=1, for checking), this serves
 * the static file with its og/twitter tags rewritten: the agent for the ZIP's state (same SUSANA map
 * as beneficiosmedicare's opciones-compartidas.js: Susana for KS, MO, TX, FL, Alejandra everywhere
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
const SUSANA = { KS: 1, MO: 1, TX: 1, FL: 1 };
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
    if (!/^\d{5}$/.test(zip) || !ids.length) return res;

    const en = url.searchParams.get('lang') !== 'es';
    const n = ids.length;

    // AB 2026-10-24: the title should name the place, same as BM's opciones-compartidas ("en Cass,
    // MO"), not just the bare ZIP -- the state (for the agent) and the county (for the place name)
    // both come from BM's public data files, same cross-origin fetch as the agent lookup below.
    let ak = 'alejandra', st = '', county = '';
    try {
      const zi = await fetch('https://beneficiosmedicare.com/data/zip_index.js');
      if (zi.ok) {
        st = pick(await zi.text(), zip);
        if (SUSANA[st]) ak = 'susana';
      }
      if (/^[A-Z]{2}$/.test(st)) {
        const pf = await fetch(`https://beneficiosmedicare.com/data/plans_${st}_2027.json`);
        if (pf.ok) county = pick(await pf.text(), zip);
      }
    } catch (e) { /* keep defaults */ }

    const where = /^[A-Z]{2}$/.test(st) ? (county ? `${county}, ${st}` : st) : `ZIP ${zip}`;
    const title = en ? `${n} Medicare plan${n === 1 ? '' : 's'} for 2027 in ${where}`
                     : `${n} plan${n === 1 ? '' : 'es'} de Medicare 2027 en ${where}`;

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
