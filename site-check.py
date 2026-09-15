#!/usr/bin/env python3
"""
site-check.py — pre-deploy gate for the Susana Marcos LLC Medicare sites.

Fails the build on defects that are invisible in a browser but break indexing,
mislead clients, or silently lose content. Every check here exists because the
thing it catches actually happened.

Usage:
    python3 site-check.py --dir . --domain https://beneficiosmedicare.com
    python3 site-check.py --dir . --domain https://... --report   # never exits 1
    python3 site-check.py --dir . --domain https://... --base origin/production

Exit codes: 0 = clean (or --report), 1 = at least one ERROR.

Owner: 14. CTO. See reference/deploy-flow.md and reference/review-policy.md.
"""

import argparse
import html
import json
import os
import re
import subprocess
import sys
from collections import defaultdict

# ---------------------------------------------------------------- constants

BRAND = {
    "beneficiosmedicare.com": {
        "correct": {"#002147", "#007B7B", "#005C5C", "#007B40", "#A8D8B9"},
        "wrong": {"#00897B": "#007B7B", "#00796B": "#007B40"},
    },
    "medicare-california.com": {
        "correct": {"#0080D4", "#0071BC"},
        # the Material defaults, plus BM's own palette leaking onto MC pages
        "wrong": {"#00897B": "#0080D4", "#00796B": "#0080D4",
                  "#A8D8B9": "#BBDDF5", "#007B40": "#0071BC",
                  "#007B7B": "#0080D4", "#005C5C": "#0071BC"},
    },
}

NON_PUBLIC = ("index-v", "index-dev", "index-localtest", "index-current", "404", "bot-evals")

SKIP_DIRS = {".git", "node_modules", ".github", "__pycache__", ".cloudflare", "images"}

URL_ATTRS = [
    ("canonical", re.compile(r'rel="canonical"[^>]*?href="([^"]+)"')),
    ("hreflang", re.compile(r'hreflang="[^"]*"[^>]*?href="([^"]+)"')),
    ("og:url", re.compile(r'(?:property|name)="og:url"[^>]*?content="([^"]+)"')),
    ("json-ld", re.compile(r'"(?:@id|url)"\s*:\s*"(https://[^"]+)"')),
]

OUR_DOMAINS = ("beneficiosmedicare.com", "medicare-california.com")

JSONLD_BLOCK = re.compile(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>',
                          re.S | re.I)


# ---------------------------------------------------------------- helpers

class Findings:
    def __init__(self):
        self.items = defaultdict(list)   # (severity, check) -> [(file, detail)]

    def add(self, severity, check, path, detail):
        self.items[(severity, check)].append((path, detail))

    def error(self, check, path, detail):
        self.add("ERROR", check, path, detail)

    def warn(self, check, path, detail):
        self.add("WARN", check, path, detail)

    def count(self, severity):
        return sum(len(v) for (s, _), v in self.items.items() if s == severity)


def iter_html(root):
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for fn in files:
            if fn.endswith(".html"):
                fp = os.path.join(dirpath, fn)
                yield fp, os.path.relpath(fp, root)


def is_non_public(rel):
    stem = os.path.basename(rel)
    stem = stem[:-5] if stem.endswith(".html") else stem
    return stem.startswith(NON_PUBLIC)


def load_redirect_sources(root):
    srcs = set()
    p = os.path.join(root, "_redirects")
    if not os.path.exists(p):
        return srcs
    for line in open(p, encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        # A trailing 200 is a REWRITE, not a redirect: Cloudflare serves content at that
        # URL. Treating it as a redirect would exempt a live, indexable page from every
        # page-level check. Only 3xx lines make a page unreachable.
        if len(parts) >= 3 and parts[2].isdigit() and not parts[2].startswith("3"):
            continue
        srcs.add(parts[0].rstrip("/") or "/")
    return srcs


def visible_text(src):
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", src, flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", html.unescape(t))


# ---------------------------------------------------------------- checks

def check_exemptions(root, f):
    """Nothing may be exempt from every other check on the strength of its filename.

    is_non_public() is a prefix match on the basename, so `404-old-plan-list.html` or
    `index-current-costs.html` would be skipped by every page check while being served
    at HTTP 200. The exemption is only honest if the page really is non-indexable, so
    make the gate verify that rather than assume it.
    """
    for fp, rel in iter_html(root):
        if not is_non_public(rel):
            continue
        src = open(fp, encoding="utf-8", errors="ignore").read()
        if not re.search(r'name="robots"[^>]*content="[^"]*noindex', src, re.I):
            f.error("exempt-but-indexable", rel,
                    "matches NON_PUBLIC so every check skips it, but it has no "
                    "noindex — it is served and indexable")


def check_urls(root, domain, f):
    """Canonical/hreflang/og:url/JSON-LD must not use .html, and hreflang must
    not point at something _redirects sends elsewhere."""
    redirects = load_redirect_sources(root)
    for fp, rel in iter_html(root):
        if is_non_public(rel):
            continue
        # Cloudflare serves the extensionless url, so only THAT form deciding to
        # redirect makes a page unreachable. Keying on the .html form instead let
        # index-es.html -- live at 200, self-canonical -- skip three real errors.
        if ("/" + rel[:-5]) in redirects:
            continue
        src = open(fp, encoding="utf-8", errors="ignore").read()

        if len(re.findall(r'rel="canonical"', src)) > 1:
            f.error("duplicate-canonical", rel, "more than one <link rel=canonical>")
        if 'rel="canonical"' not in src:
            f.warn("missing-canonical", rel, "no canonical tag")

        # URL_ATTRS requires rel= before href= and hreflang= before href=. A <link> with
        # the attributes the other way round is invisible to every check below AND does
        # not trip missing-canonical, so it passes twice over. Catch the ordering itself.
        for tag in re.findall(r"<link\b[^>]*>", src):
            if ("canonical" in tag or "hreflang=" in tag) and "href=" in tag:
                if not (URL_ATTRS[0][1].search(tag) or URL_ATTRS[1][1].search(tag)):
                    f.error("unparseable-link-tag", rel,
                            "href before rel/hreflang — the URL checks cannot read this: "
                            + tag[:100])

        for kind, rx in URL_ATTRS:
            for u in rx.findall(src):
                # A canonical or og:url on a domain that is neither of ours hands the page
                # to someone else. Six MC files canonicalised to the abandoned
                # californiaseniorsbenefits.com until 2026-09-13; this `continue` is why
                # the gate could not have found them.
                if not any(d in u for d in OUR_DOMAINS):
                    if kind in ("canonical", "og:url") and u.startswith("http"):
                        f.error("foreign-canonical", rel, f"{kind} -> {u} (not our domain)")
                    continue
                if re.search(r"\.html($|[#?])", u):
                    f.error("html-url", rel, f"{kind} -> {u}")
                for d in OUR_DOMAINS:
                    marker = "https://" + d
                    if u.startswith(marker):
                        path = u[len(marker):].split("#")[0].split("?")[0].rstrip("/") or "/"
                        if path in redirects or (path + ".html") in redirects:
                            f.error("url-points-at-redirect", rel, f"{kind} -> {u}")


def check_internal_links(root, domain, f):
    """Internal <a href> must not carry .html. Cloudflare 308s every .html url to
    its extensionless form, so an internal .html link spends a redirect hop on
    every crawl and every click, and passes its signal through a 301 instead of
    directly. Same defect class as the canonical .html problem, one layer up."""
    redirects = load_redirect_sources(root)
    for fp, rel in iter_html(root):
        if is_non_public(rel):
            continue
        if ("/" + rel[:-5]) in redirects:
            continue
        src = open(fp, encoding="utf-8", errors="ignore").read()
        host = domain.replace("https://", "").replace("http://", "").rstrip("/")
        same, sister = {}, {}
        for href in re.findall(r'href="([^"]*\.html(?:[#?][^"]*)?)"', src):
            target = href.split("#")[0].split("?")[0]
            if re.match(r"https?://", target):
                if host in target:
                    same[href] = same.get(href, 0) + 1
                elif any(d in target for d in OUR_DOMAINS):
                    # the sister property: also 308s, but its URL scheme is the other
                    # repo's business, so report it without failing this repo's build.
                    sister[href] = sister.get(href, 0) + 1
                continue
            # "/x.html" and bare "contact.html" / "../about.html" alike. 73 relative ones
            # survived the 2026-09-15 rewrite because the old regex required a leading "/".
            same[href] = same.get(href, 0) + 1
        for href, n in sorted(same.items()):
            f.error("internal-html-link", rel, f"{href} x{n} — drop .html, it 308s")
        for href, n in sorted(sister.items()):
            f.warn("sister-site-html-link", rel, f"{href} x{n} — 308s on the other domain")


def check_figures(root, figures_path, f):
    """No page may state a retired CMS dollar figure in a cost context."""
    if not os.path.exists(figures_path):
        f.warn("figures-data-missing", os.path.basename(figures_path),
               "medicare-figures.json not found; figure check skipped")
        return
    data = json.load(open(figures_path, encoding="utf-8"))
    ctx = re.compile("|".join(re.escape(w) for w in data["context_words"]), re.I)
    for fp, rel in iter_html(root):
        if is_non_public(rel):
            continue
        src = open(fp, encoding="utf-8", errors="ignore").read()
        # visible_text() strips <script>, so JSON-LD FAQ answers — which feed Google
        # snippets and AI retrieval — were never scanned. Scan them as a second pass.
        for where, text in (("", visible_text(src)),
                            (" (in JSON-LD)", " ".join(JSONLD_BLOCK.findall(src)))):
            if not text:
                continue
            for key, spec in data["figures"].items():
                for retired in spec["retired"]:
                    # (?![\d,.]) also rejected "$257." and "$185," — a figure at the end of
                    # a sentence or clause, the commonest position in prose. It hid 10 of
                    # the 14 stale figures on this repo. Only a DIGIT continuation means
                    # this is really a longer number.
                    for m in re.finditer(r"\$" + re.escape(retired) + r"(?!\d|[,.]\d)", text):
                        window = text[max(0, m.start() - 90):m.end() + 90]
                        if ctx.search(window):
                            f.error("stale-figure", rel,
                                    f'${retired} as {spec["label"]}{where} '
                                    f'— current is ${spec["current"]}')
                            break


def check_brand(root, domain, f):
    host = domain.replace("https://", "").replace("http://", "").rstrip("/")
    spec = BRAND.get(host)
    if not spec:
        return
    for fp, rel in iter_html(root):
        if is_non_public(rel):
            continue
        src = open(fp, encoding="utf-8", errors="ignore").read()
        for bad, good in spec["wrong"].items():
            n = len(re.findall(re.escape(bad), src, re.I))
            if n:
                f.warn("wrong-brand-colour", rel, f"{bad} x{n} — should be {good}")
        if len(re.findall(r":root\s*\{", src)) > 1:
            f.error("duplicate-root-block", rel,
                    "more than one :root{} — the wrong site's theme may be overriding")


def check_sitemap(root, domain, f):
    p = os.path.join(root, "sitemap.xml")
    if not os.path.exists(p):
        f.error("sitemap-missing", "sitemap.xml", "not found")
        return
    src = open(p, encoding="utf-8", errors="ignore").read()
    locs = [re.sub(r"<[^>]*>", "", m) for m in re.findall(r"<loc>[^<]*</loc>", src)]
    # <loc> was validated; the xhtml:link alternates beside it never were. 9 of them
    # point at -es URLs that _redirects 301s away, which is the same defect as
    # url-points-at-redirect on a page — Google drops the language pairing either way.
    alts = re.findall(r'<xhtml:link[^>]*hreflang="([^"]*)"[^>]*href="([^"]*)"', src)
    redirects = load_redirect_sources(root)
    on_disk = {rel for _, rel in iter_html(root)}

    def path_of(u):
        return u[len(domain):].rstrip("/") if u.startswith(domain) else u

    for u in locs:
        if u.endswith(".html"):
            f.error("sitemap-html-url", "sitemap.xml", u)
        path = path_of(u)
        if path in redirects or (path + ".html") in redirects:
            f.error("sitemap-redirecting-url", "sitemap.xml", u)
        if is_non_public(path.lstrip("/")):
            f.error("sitemap-non-public-url", "sitemap.xml", u)
        # reverse drift: a <loc> with no file behind it is a 404 handed to Google.
        # Nothing checked this direction — only served-but-unlisted.
        if u.startswith(domain):
            stem = path.lstrip("/")
            cands = {"index.html"} if stem == "" else {stem + ".html", stem + "/index.html"}
            if not (cands & on_disk):
                f.error("sitemap-url-has-no-page", "sitemap.xml",
                        f"{u} — no file on disk ({' or '.join(sorted(cands))})")

    for lang, u in alts:
        if u.endswith(".html"):
            f.error("sitemap-alternate-html-url", "sitemap.xml", f'hreflang="{lang}" -> {u}')
        path = path_of(u)
        if path in redirects or (path + ".html") in redirects:
            f.error("sitemap-alternate-redirects", "sitemap.xml",
                    f'hreflang="{lang}" -> {u}')

    # every served public page should be listed
    listed = {u[len(domain):].rstrip("/") or "/" for u in locs if u.startswith(domain)}
    for fp, rel in iter_html(root):
        if is_non_public(rel) or rel.startswith("blog/index"):
            continue
        # pages that _redirects sends elsewhere are correctly absent
        if ("/" + rel[:-5]) in redirects:
            continue
        path = "/" + rel[:-5]
        path = "/" if path == "/index" else (path[:-5] if path.endswith("/index") else path)
        if path.rstrip("/") not in listed and path not in listed:
            f.warn("page-not-in-sitemap", rel, "served but not listed in sitemap.xml")


def check_content_loss(root, base, f):
    """No file may lose lines unless it's a regenerated artefact."""
    ALLOWED = {"sitemap.xml"}
    try:
        out = subprocess.run(["git", "diff", "--numstat", base, "--"],
                             cwd=root, capture_output=True, text=True, timeout=60)
    except Exception as e:
        f.warn("content-loss-check-skipped", "-", f"git diff failed: {e}")
        return
    if out.returncode != 0:
        f.warn("content-loss-check-skipped", "-", out.stderr.strip()[:120])
        return
    for line in out.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) != 3 or not parts[0].isdigit() or not parts[1].isdigit():
            continue
        added, removed, path = int(parts[0]), int(parts[1]), parts[2]
        if os.path.basename(path) in ALLOWED:
            continue
        if removed - added > 3:
            f.error("content-loss", path,
                    f"net -{removed - added} lines (+{added} -{removed}) vs {base}")


def check_bodies(root, f):
    """Served pages must still contain real prose.

    Two holes this closes, both of which hid `index-widget.html` and
    `resources.html` — blank, HTTP 200 and sitemapped — for six months:
      * scope: only blog/ was inspected, so no root or city page was ever looked at;
      * `if not m: continue`: a page with no <main>/<article> AT ALL passed silently,
        which is precisely what a deleted body looks like.
    """
    redirects = load_redirect_sources(root)
    for fp, rel in iter_html(root):
        if is_non_public(rel):
            continue
        if ("/" + rel[:-5]) in redirects:
            continue
        src = open(fp, encoding="utf-8", errors="ignore").read()
        page_words = len(visible_text(src).split())
        if page_words < 120:
            f.error("empty-page", rel,
                    f"{page_words} visible words on the whole page — blank or gutted")
        m = re.search(r"<(main|article)\b.*?</\1>", src, re.S | re.I)
        if not m:
            # no landmark: nothing for the article check to measure, and a WCAG 2.4.1
            # defect in its own right. Never report this as a pass.
            f.warn("no-main-landmark", rel,
                   f"no <main> or <article> — body check cannot run ({page_words} words)")
            continue
        body = visible_text(m.group(0))
        words = len(body.split())
        h2 = len(re.findall(r"<h2\b", m.group(0), re.I))
        if rel.startswith("blog/") and not rel.endswith("index.html"):
            if words < 150 or h2 == 0:
                f.error("empty-article", rel, f"{words} words, {h2} <h2> — looks like a stub")


# ---------------------------------------------------------------- output

def report(f, strict):
    order = ["ERROR", "WARN"]
    icons = {"ERROR": "FAIL", "WARN": "warn"}
    for sev in order:
        groups = {k: v for k, v in f.items.items() if k[0] == sev}
        if not groups:
            continue
        print(f"\n{'=' * 72}\n{sev}\n{'=' * 72}")
        for (_, check), rows in sorted(groups.items(), key=lambda x: -len(x[1])):
            print(f"\n  [{icons[sev]}] {check} — {len(rows)} occurrence(s) in "
                  f"{len({r[0] for r in rows})} file(s)")
            shown = defaultdict(list)
            for path, detail in rows:
                shown[path].append(detail)
            for path in sorted(shown)[:12]:
                print(f"      {path}")
                for d in shown[path][:3]:
                    print(f"          {d}")
                if len(shown[path]) > 3:
                    print(f"          ... +{len(shown[path]) - 3} more in this file")
            if len(shown) > 12:
                print(f"      ... +{len(shown) - 12} more file(s)")

    e, w = f.count("ERROR"), f.count("WARN")
    print(f"\n{'-' * 72}")
    print(f"  {e} error(s), {w} warning(s)")
    if e == 0 and w == 0:
        print("  clean")
    print(f"{'-' * 72}\n")
    return e > 0 or (strict and w > 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=".")
    ap.add_argument("--domain", required=True)
    ap.add_argument("--base", help="git ref to compare against for content loss")
    ap.add_argument("--figures", default="medicare-figures.json")
    ap.add_argument("--report", action="store_true", help="never exit non-zero")
    ap.add_argument("--strict", action="store_true", help="warnings fail too")
    ap.add_argument("--only", help="comma-separated check names to run")
    a = ap.parse_args()

    root = os.path.abspath(a.dir)
    # --domain without a scheme silently disabled check_sitemap: every <loc> starts
    # "https://", so nothing matched, `listed` came out empty, and all 87 pages warned
    # page-not-in-sitemap while sitemap-redirecting-url quietly checked nothing. Refuse it.
    if not a.domain.startswith(("https://", "http://")):
        print(f"--domain must include the scheme, e.g. https://{a.domain.lstrip('/')}",
              file=sys.stderr)
        return 2
    domain = a.domain.rstrip("/")
    figures_path = a.figures if os.path.isabs(a.figures) else os.path.join(root, a.figures)
    f = Findings()

    all_checks = {
        "exemptions": lambda: check_exemptions(root, f),
        "urls": lambda: check_urls(root, domain, f),
        "links": lambda: check_internal_links(root, domain, f),
        "figures": lambda: check_figures(root, figures_path, f),
        "brand": lambda: check_brand(root, domain, f),
        "sitemap": lambda: check_sitemap(root, domain, f),
        "bodies": lambda: check_bodies(root, f),
    }
    if a.base:
        all_checks["content-loss"] = lambda: check_content_loss(root, a.base, f)

    selected = a.only.split(",") if a.only else list(all_checks)
    print(f"site-check — {domain}")
    print(f"  dir: {root}")
    print(f"  checks: {', '.join(selected)}")
    if not a.base:
        # The check that exists because of the March 2026 content-loss incident only runs
        # when --base is given, and no npm script passes it. A clean report used to look
        # identical to one where content loss had been checked. Say so out loud.
        print("  content-loss: NOT RUN — pass --base <ref> (e.g. --base origin/main)")
    for name in selected:
        if name not in all_checks:
            print(f"  unknown check: {name}", file=sys.stderr)
            return 2
        all_checks[name]()

    failed = report(f, a.strict)
    if a.report:
        return 0
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
