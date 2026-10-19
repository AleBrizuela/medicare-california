/* T-078 · the link preview for a shared comparison.
 *
 * WhatsApp, iMessage and Gmail do not run JavaScript: whatever they show comes from the HTML the
 * server hands them. The shared page is one static file for every link, so without this every
 * preview would read the same. This Function serves that same file and rewrites the title and
 * description from the path, so the card says how many options and for which ZIP.
 *
 * Deliberately plain JavaScript with no dependencies: Cloudflare's build for these repos runs
 * generate_sitemap.py and nothing else, and adding a bundler is a change to the thing every release
 * depends on (BLUEPRINT's second always-ask trigger). The bespoke per-link IMAGE — card B+, a tile
 * per carrier — needs a rasteriser and therefore that build change; it is written on the ticket and
 * waits for AB. Until then the site's own card is the image: branded, correct, never broken.
 *
 * A Function takes precedence over the _redirects rewrite for this path, so it serves the page
 * itself. Anything unexpected falls through to the plain asset: a visitor always gets the page.
 */
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
    // T-113: no description -- the image carries the tagline, agent name and phone; this path is
    // unreached today (SHARE_READABLE_PATH is off in the widget), kept consistent in case it's ever
    // re-enabled.
    const title = en ? `${n} Medicare plan${n === 1 ? '' : 's'} for 2027 · ZIP ${zip}`
                     : `${n} plan${n === 1 ? '' : 'es'} de Medicare 2027 · ZIP ${zip}`;
    const esc = s => String(s).replace(/[&<>"]/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const html = (await res.text())
      .replace(/<meta property="og:title" content="[^"]*">/,
               `<meta property="og:title" content="${esc(title)}">`)
      .replace(/<title>[^<]*<\/title>/,
               `<title>${esc(title)} | Medicare California</title>`);

    const headers = new Headers(res.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('x-robots-tag', 'noindex, follow');
    return new Response(html, { status: res.status, headers });
  } catch (e) {
    return res;
  }
}
