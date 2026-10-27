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

/* T-135/T-150 (2026-10-26) · same gap, different shape: a page retired in the SAME deploy that
 * adds its own _redirects rule does not actually redirect -- confirmed live (cache-busted, and
 * on a brand-new branch preview with no prior cache at all) still 404s instead of 301ing, for
 * both brand-new rules AND a long-standing, previously-working blog redirect tested the same
 * way. Not yet root-caused; a Pages Function is the one mechanism already proven to take
 * precedence (see the comment above), so retired city pages (T-135) and consolidated blog posts
 * (T-150) both route through it too. Keep these maps in sync with the matching _redirects block
 * (still present, belt-and-suspenders). The hard split here (not reused from EXACT's
 * redirect-to-home) is deliberate: these need a per-page target, not just "/".
 */
const CITY_REDIRECTS = new Map([
  ['/california/cities/beverly-hills', '/california/cities/los-angeles'],
  ['/california/cities/culver-city', '/california/cities/los-angeles'],
  ['/california/cities/del-rey', '/california/cities/los-angeles'],
  ['/california/cities/el-segundo', '/california/cities/los-angeles'],
  ['/california/cities/mar-vista', '/california/cities/los-angeles'],
  ['/california/cities/marina-del-rey', '/california/cities/los-angeles'],
  ['/california/cities/mid-city', '/california/cities/los-angeles'],
  ['/california/cities/playa-del-rey', '/california/cities/los-angeles'],
  ['/california/cities/playa-vista', '/california/cities/los-angeles'],
  ['/california/cities/santa-monica', '/california/cities/los-angeles'],
  ['/california/cities/westchester', '/california/cities/los-angeles'],
  ['/california/cities/san-jose', '/best-medicare-advantage-california'],
  ['/california/cities/san-francisco', '/best-medicare-advantage-california'],
  ['/california/cities/sacramento', '/best-medicare-advantage-california'],
  ['/california/cities/fresno', '/best-medicare-advantage-california'],
  ['/california/cities/bakersfield', '/best-medicare-advantage-california'],
  // T-135 phase 2 (2026-10-26, AB: "only LA and SD are ready, remove the other 3") --
  // long-beach/riverside/orange-county were kept live pending a rewrite; not waiting.
  ['/california/cities/long-beach', '/california/cities/los-angeles'],
  ['/california/cities/riverside', '/california/cities/los-angeles'],
  ['/california/cities/orange-county', '/california/cities/los-angeles'],
]);

const BLOG_REDIRECTS = new Map([
  ['/blog/medicare-part-d-drug-coverage-california', '/blog/medicare-parte-d-medicamentos-california'],
  ['/blog/medicare-preventive-care-california', '/blog/free-medicare-preventive-services-california'],
  ['/blog/medicare-dental-coverage-california', '/blog/medicare-dental-vision-hearing-california'],
  ['/blog/medicare-diabetes-cobertura-california', '/blog/medicare-diabetes-coverage-california'],
]);

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  if (EXACT.has(path) || PREFIXES.some(p => path.startsWith(p))) {
    return Response.redirect(new URL('/', url.origin).toString(), 301);
  }

  const normalized = path.replace(/\.html$/, '');

  const cityTarget = CITY_REDIRECTS.get(normalized);
  if (cityTarget) {
    return Response.redirect(new URL(cityTarget, url.origin).toString(), 301);
  }

  const blogTarget = BLOG_REDIRECTS.get(normalized);
  if (blogTarget) {
    return Response.redirect(new URL(blogTarget, url.origin).toString(), 301);
  }

  return next();
}
