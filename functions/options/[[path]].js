/* T-078 · the link preview for a shared comparison.
 *
 * WhatsApp, iMessage and Gmail do not run JavaScript: whatever they show comes from the HTML the
 * server hands them. The shared page is one static file for every link, so without this every
 * preview would read the same. This Function serves that same file and rewrites the title and
 * description from the path, so the card says how many options and for which ZIP.
 *
 * T-136 (2026-10-24): the image now varies by agent + language too, same state map (T-159) as
 * beneficiosmedicare's opciones-compartidas.js. MC's own repo carries no zip->state data (it embeds
 * beneficiosmedicare's widget rather than its own), so the state lookup is a plain cross-origin fetch
 * of BM's public `/data/zip_index.js` -- a static asset, not a bound service, so a normal fetch() is
 * the right tool (env.ASSETS only binds this Pages project's own files). Any failure (network, parse,
 * unknown ZIP) falls through to the static file's own default (Alejandra, English): a shared link
 * never breaks over an image choice.
 *
 * Deliberately plain JavaScript with no dependencies: Cloudflare's build for these repos runs
 * generate_sitemap.py and nothing else, and adding a bundler is a change to the thing every release
 * depends on (BLUEPRINT's second always-ask trigger).
 *
 * A Function takes precedence over the _redirects rewrite for this path, so it serves the page
 * itself. Anything unexpected falls through to the plain asset: a visitor always gets the page.
 */
const ALEJANDRA = { CA: 1, AZ: 1 };  // T-159: her only licensed states; Susana everywhere else

// '"<key>":"<value>"' found by plain search -- same approach as BM's opciones-compartidas.js
function pick(text, key) {
  const k = '"' + key + '":"', i = text.indexOf(k);
  if (i < 0) return '';
  const j = text.indexOf('"', i + k.length);
  return j < 0 ? '' : text.slice(i + k.length, j);
}

export async function onRequest(context) {
  const { request, env, params, next } = context;
  const url = new URL(request.url);
  const page = new URL('/options-shared.html', url.origin);

  let res;
  try {
    res = await env.ASSETS.fetch(new Request(page.toString(), request));
  } catch (e) {
    return next();
  }

  try {
    const type = res.headers.get('content-type') || '';
    if (!/text\/html/i.test(type)) return res;

    const parts = (Array.isArray(params.path) ? params.path : []).filter(Boolean);
    const zip = /^\d{5}$/.test(parts[0] || '') ? parts[0] : '';
    const ids = parts.slice(1).filter(p => /^[A-Z0-9-]{4,}$/i.test(p));
    if (!zip || !ids.length) return res;

    const en = url.searchParams.get('lang') !== 'es';
    const n = Math.min(ids.length, 3);
    const esc = s => String(s).replace(/[&<>"]/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // T-136: agent by state, same map as BM. T-138: the place is the city (never the county),
    // same cross-origin data file as BM's own functions. Both default to the plain ZIP / Alejandra
    // if a lookup fails; this path is unreached today (SHARE_READABLE_PATH is off in the widget),
    // kept consistent in case it's ever re-enabled.
    let ak = 'alejandra', place = '';
    try {
      const zi = await fetch('https://beneficiosmedicare.com/data/zip_index.js');
      if (zi.ok) {
        const st = pick(await zi.text(), zip);
        ak = ALEJANDRA[st] ? 'alejandra' : 'susana';
      }
      const zc = await fetch('https://beneficiosmedicare.com/data/zip_city.js');
      if (zc.ok) place = pick(await zc.text(), zip);
    } catch (e) { /* keep defaults */ }
    const where = place || `ZIP ${zip}`;
    const title = en ? `${n} plan${n === 1 ? '' : 's'} for 2027 in ${where}`
                     : `${n} plan${n === 1 ? '' : 'es'} 2027 en ${where}`;

    const img = `${url.origin}/og-plans-mc-${ak}-${en ? 'en' : 'es'}-20261024.jpg`;
    const alt = ak === 'susana'
      ? (en ? 'Susana Marcos, Medicare agent, Medicare-California.com' : 'Susana Marcos, agente de Medicare, Medicare-California.com')
      : (en ? 'Alejandra Brizuela, Medicare agent, Medicare-California.com' : 'Alejandra Brizuela, agente de Medicare, Medicare-California.com');

    const html = (await res.text())
      .replace(/<meta property="og:title" content="[^"]*">/,
               `<meta property="og:title" content="${esc(title)}">`)
      .replace(/<title>[^<]*<\/title>/,
               `<title>${esc(title)} | Medicare California</title>`)
      .replace(/<meta property="og:image" content="[^"]*">/,
               `<meta property="og:image" content="${esc(img)}">`)
      .replace(/<meta property="og:image:secure_url" content="[^"]*">/,
               `<meta property="og:image:secure_url" content="${esc(img)}">`)
      .replace(/<meta property="og:image:alt" content="[^"]*">/,
               `<meta property="og:image:alt" content="${esc(alt)}">`)
      .replace(/<meta name="twitter:image" content="[^"]*">/,
               `<meta name="twitter:image" content="${esc(img)}">`);

    const headers = new Headers(res.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('x-robots-tag', 'noindex, follow');
    return new Response(html, { status: res.status, headers });
  } catch (e) {
    return res;
  }
}
