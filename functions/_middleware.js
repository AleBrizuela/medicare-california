/* T-148 (D-118) · _redirects never actually blocks a repo-root file that still exists on disk --
 * Cloudflare Pages' static-asset serving answers the request before _redirects runs, confirmed
 * live on production 2026-10-25 (every file below still returned 200, cache bypassed). A Pages
 * Function DOES take precedence over static serving (already proven by
 * functions/options/[[path]].js), so this middleware is the real version of the same _redirects
 * block below it: same files, same 301 destination, now actually enforced. Keep this list in
 * sync with that (still present, now redundant-but-harmless) _redirects block.
 *
 * Deliberately excluded, fetched at runtime, must stay public:
 *   /sitemap-style.xsl   - referenced by sitemap.xml
 *   /data/plan-year.json - fetched by the plan-finder widget
 */

const EXACT = new Set([
  '/site-check.py',
  '/smoke-check.py',
  '/generate_sitemap.py',
  '/generate_blog_index.py',
  '/package.json',
  '/package-lock.json',
  '/medicare-figures.json',
  '/README.md',
  '/README-AB-TESTING.md',
  '/QA-CHECKLIST.md',
  '/Widget-QA-Report.docx',
  '/.gitignore',
  '/CNAME',
  '/tools/check-shared.mjs',
  '/tools/stamp-shared.mjs',
]);

const PREFIXES = ['/.github/', '/SHIP/'];

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (EXACT.has(path) || PREFIXES.some(p => path.startsWith(p))) {
    return Response.redirect(new URL('/', url.origin).toString(), 301);
  }

  return next();
}
