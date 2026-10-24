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

Owner: SHIP. See reference/deploy-flow.md and reference/review-policy.md.
"""

import argparse
import struct
import html
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from html.parser import HTMLParser
import difflib
from datetime import datetime, timedelta

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

# "widget" covers widget.html / widget-v*.html: embedded JS apps, every one noindex
# and absent from the sitemap. A page whose job is to be an iframe has few words BY
# DESIGN, and reporting it as "blank or gutted" buried the two pages that really are.
# T-078: the shared-comparison sheet draws itself from the plan IDs in its own URL, so its static
# HTML holds no prose for check_bodies to measure, and it is noindex by design. check_exemptions
# below is what keeps that honest: anything on this list that is NOT noindex is a hard error.
NON_PUBLIC = ("index-v", "index-dev", "index-localtest", "index-current", "404",
              "bot-evals", "widget", "opciones", "options")

SKIP_DIRS = {".git", "node_modules", ".github", "__pycache__", ".cloudflare", "images",
             "tools",  # tools/ holds internal scrapers, noindex and unlinked
             "partials"}  # T-108: shared-component fragments, not standalone pages

URL_ATTRS = [
    ("canonical", re.compile(r'rel="canonical"[^>]*?href="([^"]+)"')),
    ("hreflang", re.compile(r'hreflang="[^"]*"[^>]*?href="([^"]+)"')),
    ("og:url", re.compile(r'(?:property|name)="og:url"[^>]*?content="([^"]+)"')),
    # "item" (BreadcrumbList) and mainEntityOfPage were not scanned until 2026-09-26;
    # 89 breadcrumb URLs ending in .html slipped past this check as a result.
    ("json-ld", re.compile(r'"(?:@id|url|item|mainEntityOfPage)"\s*:\s*"(https://[^"]+)"')),
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


# Each site's own team page, keyed by domain — never the sister site's.
FIRST_AGENT = {
    "beneficiosmedicare.com": "Susana Marcos",
    "medicare-california.com": "Alejandra Brizuela",
}

def check_team_pages(root, domain, f):
    """T-125 (AB 2026-10-22, "we fixed this many times and apparently messed it
    up again"): team/equipo links must stay same-site, and each site's own
    team.html/equipo.html must list its own lead agent first — Susana on BM,
    Alejandra on MC. Catches the bios link crossing domains again before it
    reaches production a third time."""
    host = domain.replace("https://", "").replace("http://", "").rstrip("/")
    other = "medicare-california.com" if "beneficiosmedicare" in host else "beneficiosmedicare.com"
    first_agent = FIRST_AGENT[host]
    for fp, rel in iter_html(root):
        if is_non_public(rel):
            continue
        src = open(fp, encoding="utf-8", errors="ignore").read()
        for m in re.finditer(r'href="(https?://' + re.escape(other) + r'/(?:team|equipo|authors)/?[^"]*)"', src):
            f.error("cross-domain-team-link", rel, f"href -> {m.group(1)} (belongs on {host})")
        if os.path.basename(rel) in ("team.html", "equipo.html"):
            names = re.findall(r"<h3>(Susana Marcos|Alejandra Brizuela)</h3>", src)
            if not names:
                f.warn("team-page-no-agent-names", rel, "no agent <h3> found — check manually")
            elif names[0] != first_agent:
                f.error("team-page-wrong-order", rel,
                        f"first agent card is {names[0]}, expected {first_agent} first")


# Which Medicare Part each figure belongs to, so a figure can be rejected when the
# surrounding text plainly names a different Part. None = not Part-specific.
PART_OF = {
    "part_b_premium": "B", "part_b_deductible": "B",
    "part_a_deductible": "A", "part_a_coins_61_90": "A",
    "part_a_coins_lifetime": "A", "part_a_premium_full": "A",
    "part_a_premium_reduced": "A", "snf_coins": "A",
    "part_d_deductible": "D", "part_d_base_premium": "D", "part_d_penalty_month": "D",
    "part_d_irmaa": "D", "extra_help_income_single": "D", "extra_help_income_couple": "D",
    "extra_help_resources_single": "D",
}

def check_figures(root, figures_path, f):
    """No page may state a retired CMS dollar figure in a cost context."""
    if not os.path.exists(figures_path):
        f.warn("figures-data-missing", os.path.basename(figures_path),
               "medicare-figures.json not found; figure check skipped")
        return
    data = json.load(open(figures_path, encoding="utf-8"))
    ctx = re.compile("|".join(re.escape(w) for w in data["context_words"]), re.I)
    # check_urls and check_sitemap already skip pages whose SERVED url redirects away.
    # This check did not, so it reported stale figures on -en stubs nobody can reach,
    # padding the count with findings that cannot be acted on.
    redirects = load_redirect_sources(root)
    for fp, rel in iter_html(root):
        if is_non_public(rel):
            continue
        if ("/" + rel[:-5]) in redirects:
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
                    # Also the written-out form ("257 dollars", "257 dólares"): a retired $257
                    # Part B deductible sat in an MC FAQ, visible and in JSON-LD, as
                    # "257 dollar deductible" and passed this check (found 2026-09-26).
                    for m in re.finditer(r"(?:\$" + re.escape(retired) + r"|(?<![\d$.,])" + re.escape(retired)
                                         + r"\s*(?:dollars?|d[oó]lares))(?!\d|[,.]\d)", text, re.I):
                        window = text[max(0, m.start() - 90):m.end() + 90]
                        if not ctx.search(window):
                            continue
                        # `ctx` is a generic list of cost words, so ANY of "premium",
                        # "deductible", "part a/b" within 90 chars fired. Two guards, each
                        # for a mis-attribution seen in the wild:
                        #
                        # 1. A range. "premium difference ... often $240 to $600 a year" is
                        #    not a claim that $240 IS the Part B deductible.
                        near = text[max(0, m.start() - 12):m.end() + 12]
                        if re.search(re.escape(retired) + r"\s*(?:to|-|\u2013|\u2014|a)\s*\$", near, re.I) \
                           or re.search(r"\$[\d,.]+\s*(?:to|-|\u2013|\u2014|a)\s*\$" + re.escape(retired), near, re.I):
                            continue
                        # 2. The wrong Part. "Part D ... deductible up to $505" was reported
                        #    as a stale Part A premium. If the window names a different Part
                        #    and never this figure's own, it is not this figure.
                        mine = PART_OF.get(key)
                        if mine:
                            named = {p.upper() for p in re.findall(r"[Pp]art[e]?\s+([ABCD])\b", window)}
                            if named and mine not in named:
                                continue
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


# ---------------------------------------------------------------- CTA labels (T-043)

# The fixed placement list. PROVE owns the names and their meaning, in
# PROVE/reference/cta-placements.md (outside this repo, since the repo root is public).
# A new name goes there first, then here, then onto a page.
CTA_PLACEMENTS = {"header", "home_hero", "home_alt", "sticky_bar", "float_call", "float_text", "contact_card",
                  "guide_cta", "inline_body", "sidebar", "blog_cta", "city_cta",
                  "state_cta", "final_cta", "footer", "widget", "float", "thank_you",
                  "zip_top", "zip_end"}  # T-133: the zip box's two placements on non-home pages
CTA_TARGETS = {"plan_finder"}

_VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
         "param", "source", "track", "wbr"}
_HOME = (r"(?:/|/en|/es|https://(?:www\.)?(?:beneficiosmedicare|medicare-california)"
         r"\.com/?(?:en|es)?)")
_PLAN_TEXT = re.compile(r"(?i)compar\w* (?:los )?(?:planes|plans)|ver (?:los )?planes"
                        r"|see (?:the )?plans|find (?:your|my) plan")


def cta_kind(tag, attrs, text=""):
    """What kind of CTA an <a> or <button> is, or "" if it is not one.

    The click listener stamped into every page's footer (T-020/T-040/T-043) sorts taps
    with the same href patterns. Change one, change the other.
    """
    if tag == "a":
        h = (attrs.get("href") or "").strip()
        if re.match(r"(?i)tel:", h):
            return "phone"
        if re.match(r"(?i)sms:", h):
            return "sms"
        if re.search(r"(?i)wa\.me|whatsapp\.com", h):
            return "whatsapp"
        if re.search(r"(?i)calendar\.app\.google|calendly\.com|//(?:www\.)?cal\.com", h):
            return "book"
        if re.match(r"(?i)mailto:", h):
            return "email"
        p = re.sub(r"(?i)^https?://(?:www\.)?(?:beneficiosmedicare|medicare-california)"
                   r"\.com", "", h)
        if re.match(r"^/?(?:contacto|contact)(?:\.html)?/?(?:[?#].*)?$", p):
            return "contact"
        if re.search(r"#(?:widget-anchor|zip-card)$", h):
            return "plan_finder"
        if re.match(_HOME + r"(?:#[\w-]+)?$", h) and _PLAN_TEXT.search(text):
            return "plan_finder"
    elif tag == "button":
        # T-133: the zip box's submit button has no onclick (zbx.js listens for the
        # form's submit event instead), so it needs its own class-based signal to be
        # seen as a CTA at all -- otherwise a copy missing data-cta would pass silently.
        if "zbx-btn" in (attrs.get("class") or "").split():
            return "zip_box"
        oc = attrs.get("onclick") or ""
        if re.search(r"handleZipSubmit\s*\(", oc):
            return "home_zip"   # the home ZIP card: widget_start already counts it
        if re.search(r"smoothScrollToWidget\s*\(|handleZip\s*\(", oc):
            return "plan_finder"
        if re.search(r"location\.href\s*=\s*['\"]" + _HOME + r"(?:#[\w-]+)?['\"]", oc):
            return "plan_finder"
    return ""


class _CtaParser(HTMLParser):
    def __init__(self, src):
        super().__init__(convert_charrefs=True)
        self.line0 = [0]
        for m in re.finditer("\n", src):
            self.line0.append(m.end())
        self.stack, self.open, self.found = [], [], []

    def handle_starttag(self, tag, attrs):
        a = {k: (v or "") for k, v in attrs}
        if tag in ("a", "button"):
            ln, col = self.getpos()
            self.open.append({"tag": tag, "attrs": a, "text": "", "line": ln,
                              "offset": self.line0[ln - 1] + col,
                              "anc": list(self.stack)})
        if tag not in _VOID:
            self.stack.append((tag, a.get("id", ""), a.get("class", "").split(),
                               a.get("data-cta")))

    def handle_endtag(self, tag):
        if tag in ("a", "button"):
            for i in range(len(self.open) - 1, -1, -1):
                if self.open[i]["tag"] == tag:
                    el = self.open.pop(i)
                    el["text"] = " ".join(el["text"].split())
                    el["kind"] = cta_kind(tag, el["attrs"], el["text"])
                    if el["kind"]:
                        self.found.append(el)
                    break
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        for el in self.open:
            el["text"] += data


def find_ctas(src):
    """Every CTA <a>/<button> in a page, in document order, with its ancestors.

    Each item: tag, attrs, kind, text, line, offset (of the "<"), anc (outermost first:
    (tag, id, [classes], data-cta)), label (its own data-cta) and inherited (nearest
    data-cta on itself or an ancestor, which is what the listener's closest() reads).
    Links written by scripts at run time are not seen: the listener still reports them,
    with the container fallback.
    """
    p = _CtaParser(src)
    p.feed(src)
    p.close()
    out = sorted(p.found, key=lambda e: e["offset"])
    for el in out:
        el["label"] = el["attrs"].get("data-cta")
        el["inherited"] = el["label"] or next(
            (d for _, _, _, d in reversed(el["anc"]) if d), None)
    return out


# T-057: the phrases that claim OUR service is free, or that sell "licensed" as the
# reason to pick us. Banned by AB (T-049, 2026-10-13: never "agentes licenciadas" as a
# selling point; "Nuestra ayuda no le cuesta nada", not "gratuita"). A statement about
# what MEDICARE covers at no cost is a fact, not a claim about us, and is not on this
# list -- it warns instead, so a human can look.
OG_OUR_CLAIM = [
    "asesoria gratuita", "asesoría gratuita", "ayuda gratuita", "servicio 100% gratis",
    "free local help", "free plan comparison", "free guidance", "free help",
    "free bilingual", "free service", "always free", "licensed bilingual",
    "agentes licenciad", "licensed in 8 states", "licensed in 9 states",
    "from a licensed local agent", "by two licensed",
]
OG_BAN_WORD = re.compile(r"gratis|gratuit|\bfree\b|licenciad|licensed", re.I)


def og_meta(prop, src):
    e = re.escape(prop)
    m = (re.search(r'<meta[^>]*?(?:property|name)="%s"[^>]*?content="([^"]*)"' % e, src, re.I)
         or re.search(r'<meta[^>]*?content="([^"]*)"[^>]*?(?:property|name)="%s"' % e, src, re.I))
    return m.group(1) if m else None


def image_size(path):
    """(w, h) for a PNG or JPEG, or None. Stdlib only -- site-check has no deps."""
    try:
        d = open(path, "rb").read()
    except OSError:
        return None
    if d[:8] == b"\x89PNG\r\n\x1a\n" and len(d) >= 24:
        return struct.unpack(">II", d[16:24])
    if d[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(d):
            if d[i] != 0xFF:
                i += 1
                continue
            mk = d[i + 1]
            if mk in (0xD8, 0xD9) or 0xD0 <= mk <= 0xD7:
                i += 2
                continue
            if mk in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB):
                h, w = struct.unpack(">HH", d[i + 5:i + 9])
                return (w, h)
            i += 2 + struct.unpack(">H", d[i + 2:i + 4])[0]
    return None


def check_og(root, domain, f):
    """T-057: does a texted, WhatsApp'd or emailed link show a card, and is it clean?

    Measured 2026-10-14, before this check existed: 125 of 197 public pages had no
    og:image at all, 16 MC pages pointed at medicare-california.com/og-image.jpg (404),
    5 MC city pages at images/<city>-medicare.jpg (404), one BM page at MC's image, and
    108 pages had no twitter:card, so a texted link was a bare URL with a compass icon.
    None of it renders on the page, so nothing on either site could ever have shown it.
    """
    host = domain.split("//", 1)[1].rstrip("/")
    redirects = load_redirect_sources(root)
    for fp, rel in iter_html(root):
        if is_non_public(rel) or rel.replace(os.sep, "/").startswith("social/"):
            continue
        if ("/" + rel[:-5]) in redirects:
            continue
        src = open(fp, encoding="utf-8", errors="ignore").read()

        img = og_meta("og:image", src)
        if not img:
            f.error("og-image-missing", rel, "no og:image — a texted link shows no picture")
        elif not img.startswith("https://"):
            f.error("og-image-not-absolute", rel, f"{img} — WhatsApp and iMessage need a full URL")
        elif not img.startswith(f"https://{host}/"):
            f.error("og-image-offsite", rel, f"{img} — not on {host}")
        else:
            local = os.path.join(root, img[len(f"https://{host}/"):])
            if not os.path.exists(local):
                f.error("og-image-404", rel, f"{img} — that file is not in the repo")
            else:
                kb = os.path.getsize(local) // 1024
                if kb > 300:
                    f.warn("og-image-heavy", rel, f"{kb} KB — WhatsApp may skip it over 300 KB")
                wh = image_size(local)
                if wh and wh != (1200, 630):
                    f.warn("og-image-not-1200x630", rel, f"{wh[0]}x{wh[1]}")

        if (og_meta("twitter:card", src) or "") != "summary_large_image":
            f.warn("og-twitter-card", rel, "no twitter:card=summary_large_image — "
                                           "the card shows a thumbnail, not the picture")
        for tag in ("og:title", "og:description"):
            if not (og_meta(tag, src) or "").strip():
                f.warn("og-card-incomplete", rel, f"no {tag}")

        # T-113 (AB 2026-10-19 audit, ZIP 64078): "less is more." A WhatsApp/iMessage card
        # title that is a verbatim copy of the long SEO <title> is exactly how the widget's
        # own share-card bug happened -- the same text twice, cut off by the platform's own
        # length limit. Neither check was here before T-113 (og-card-incomplete above only
        # ever checked for BLANK tags); both are warns, same severity as og-twitter-card,
        # since a long/duplicate title still renders, just badly. Mirrored from BM's
        # site-check.py per the cross-site-fixes rule.
        tm = re.search(r"<title[^>]*>(.*?)</title>", src, re.S | re.I)
        seo_title = re.sub(r"\s+", " ", tm.group(1)).strip() if tm else ""
        og_title = (og_meta("og:title", src) or "").strip()
        if og_title:
            if seo_title and og_title == seo_title and len(og_title) > 55:
                f.warn("og-title-duplicate", rel,
                       f'og:title repeats <title> verbatim ({len(og_title)} chars) — '
                       "likely to cut off on a share card")
            elif len(og_title) > 70:
                f.warn("og-title-too-long", rel, f"og:title is {len(og_title)} chars — likely to cut off")

        for tag in ("og:title", "og:description", "twitter:title", "twitter:description"):
            v = og_meta(tag, src) or ""
            low = v.lower()
            hit = next((p for p in OG_OUR_CLAIM if p in low), None)
            if hit:
                f.error("og-claims-free-or-licensed", rel, f'{tag}: "{hit}" — AB banned this wording')
            elif OG_BAN_WORD.search(v):
                f.warn("og-word-free-or-licensed", rel,
                       f'{tag}: "{OG_BAN_WORD.search(v).group(0)}" — check it is about what '
                       "Medicare covers, not about us")

def check_ctas(root, f):
    """Every CTA carries a placement from PROVE's list (T-043).

    Without a label the T-040 listener guesses the placement from the container, and
    on 2026-10-06 that meant 0 of ~1,200 links on BM and 19 on MC reported a name from
    the list. Plan-finder buttons also need data-cta-target, or cta_click never fires.
    """
    redirects = load_redirect_sources(root)
    for fp, rel in iter_html(root):
        if is_non_public(rel) or ("/" + rel[:-5]) in redirects:
            continue
        src = open(fp, encoding="utf-8", errors="ignore").read()
        for m in re.finditer(r'\bdata-cta="([^"]*)"', src):
            if m.group(1) not in CTA_PLACEMENTS:
                f.error("cta-unknown-placement", rel,
                        f'line {src.count(chr(10), 0, m.start()) + 1}: "{m.group(1)}" '
                        "is not on PROVE's list")
        for m in re.finditer(r'\bdata-cta-target="([^"]*)"', src):
            if m.group(1) not in CTA_TARGETS:
                f.error("cta-unknown-target", rel,
                        f'line {src.count(chr(10), 0, m.start()) + 1}: "{m.group(1)}"')
        for el in find_ctas(src):
            what = f'line {el["line"]}: {el["kind"]} <{el["tag"]}> "{el["text"][:40]}"'
            if not el["inherited"]:
                f.error("cta-unlabeled", rel, what)
            if el["kind"] == "plan_finder" and \
                    el["attrs"].get("data-cta-target") != "plan_finder":
                f.error("cta-plan-target-missing", rel, what)


# ---------------------------------------------------------------- T-134 Google safety gate

CITY_NAME_RE = re.compile(r"[a-z0-9]+")


def _city_name_from_rel(rel):
    """california/cities/los-angeles.html -> 'los angeles'; None if not a city page."""
    parts = rel.split("/")
    if len(parts) >= 2 and parts[-2] == "cities" and not rel.endswith("index.html"):
        stem = parts[-1][:-5]
        return stem.replace("-", " ")
    return None


def _page_type(rel):
    """Bucket pages so look-alike only compares pages of the same kind."""
    parts = rel.split("/")
    if len(parts) == 1:
        return "root"
    return "/".join(parts[:-1])


def _core_words(src):
    """Visible text with header/nav/footer AND any stamped shared block (zip box, lang-cta,
    etc. -- anything between <!-- shared:X --> markers) stripped, so two pages sharing
    chrome or a shared component don't look like duplicates of each other on that account.
    Falls back to the whole page if there is no <main>/<article> landmark to anchor on."""
    m = re.search(r"<(main|article)\b.*?</\1>", src, re.S | re.I)
    body = m.group(0) if m else src
    body = re.sub(r"<(header|footer|nav)\b.*?</\1>", " ", body, flags=re.S | re.I)
    body = re.sub(r"<!--\s*shared:[^>]*?-->.*?<!--\s*/shared:[^>]*?-->", " ", body, flags=re.S)
    text = visible_text(body).lower()
    return re.findall(r"[a-z0-9]+", text)


def _changed_files(root, base):
    try:
        out = subprocess.run(["git", "diff", "--name-only", base, "--"],
                              cwd=root, capture_output=True, text=True, timeout=60)
    except Exception:
        return None
    if out.returncode != 0:
        return None
    return {line.strip() for line in out.stdout.splitlines() if line.strip()}


def check_google_safety(root, domain, f, base=None):
    """T-134 (AB 2026-10-24): "i need something anticipating and avoiding this type of
    problem" — MC dropped out of Google on Aug 18, the first day of Google's Aug 2026
    spam update, and nothing in this gate would have caught the kind of page that
    triggers it. Five checks, each proven able to fail on a planted bad page before
    being trusted (BLUEPRINT rule) — see SHIP/now/2026-10-24_T-134-gate-proof.md.
    """
    redirects = load_redirect_sources(root)
    pages = []  # (rel, src, words, type)
    for fp, rel in iter_html(root):
        if is_non_public(rel) or ("/" + rel[:-5]) in redirects:
            continue
        src = open(fp, encoding="utf-8", errors="ignore").read()
        pages.append((rel, src))

    changed = _changed_files(root, base) if base else None

    # (a) look-alike --------------------------------------------------------------
    # ERROR only for a pairing that CROSSED the 40% line because of this push -- not every
    # pairing that happens to include a page this push touched. A page that was already a
    # near-duplicate before this push (T-135's own backlog) stays WARN even when something
    # unrelated on it changed; only a pairing that is newly over the line, or a brand-new
    # page that lands over the line, is this push's own doing.
    by_type = defaultdict(list)
    for rel, src in pages:
        by_type[_page_type(rel)].append((rel, _core_words(src)))

    _old_cache = {}

    def _old_words(rel):
        if not base:
            return None
        if rel not in _old_cache:
            try:
                out = subprocess.run(["git", "show", f"{base}:{rel}"], cwd=root,
                                      capture_output=True, text=True, timeout=20)
                _old_cache[rel] = _core_words(out.stdout) if out.returncode == 0 else []
            except Exception:
                _old_cache[rel] = None
        return _old_cache[rel]

    seen_pairs = 0
    for ptype, items in by_type.items():
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                rel_a, words_a = items[i]
                rel_b, words_b = items[j]
                if not words_a or not words_b:
                    continue
                ratio = difflib.SequenceMatcher(None, words_a, words_b).quick_ratio()
                if ratio <= 0.40:
                    continue
                seen_pairs += 1
                detail = f"{ratio:.0%} identical to {rel_b}"
                touched = changed is not None and (rel_a in changed or rel_b in changed)
                is_new_pairing = False
                if touched:
                    old_a = _old_words(rel_a) if rel_a in changed else words_a
                    old_b = _old_words(rel_b) if rel_b in changed else words_b
                    if old_a is None or old_b is None:
                        is_new_pairing = True  # couldn't establish a before -- be conservative
                    elif not old_a or not old_b:
                        is_new_pairing = True  # one side is a brand-new page
                    else:
                        old_ratio = difflib.SequenceMatcher(None, old_a, old_b).quick_ratio()
                        is_new_pairing = old_ratio <= 0.40
                if is_new_pairing:
                    f.error("google-safety-lookalike", rel_a, detail)
                else:
                    f.warn("google-safety-lookalike-existing", rel_a, detail)
    if seen_pairs:
        f.warn("google-safety-lookalike-count", "-",
               f"{seen_pairs} page pair(s) over the 40% look-alike threshold site-wide "
               "(T-135 cleanup target)")

    # (b) bulk ----------------------------------------------------------------------
    try:
        head_msg = subprocess.run(["git", "log", "-1", "--format=%B"], cwd=root,
                                   capture_output=True, text=True, timeout=30).stdout
    except Exception:
        head_msg = ""
    if "AB-OK-BULK" not in head_msg:
        sitemap_path = os.path.join(root, "sitemap.xml")
        if os.path.exists(sitemap_path):
            try:
                cutoff = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")
                old_hash = subprocess.run(
                    ["git", "log", f"--until={cutoff}", "-1", "--format=%H", "--", "sitemap.xml"],
                    cwd=root, capture_output=True, text=True, timeout=30).stdout.strip()
                new_src = open(sitemap_path, encoding="utf-8", errors="ignore").read()
                new_urls = set(re.findall(r"<loc>([^<]*)</loc>", new_src))
                if old_hash:
                    old_src = subprocess.run(["git", "show", f"{old_hash}:sitemap.xml"],
                                              cwd=root, capture_output=True, text=True,
                                              timeout=30).stdout
                    old_urls = set(re.findall(r"<loc>([^<]*)</loc>", old_src))
                else:
                    old_urls = set()  # no 7-day-old sitemap: repo is younger than the window
                added = new_urls - old_urls
                if len(added) > 5:
                    f.error("google-safety-bulk", "sitemap.xml",
                            f"{len(added)} new indexable URLs added to the sitemap in the "
                            "last 7 days (limit 5) — add 'AB-OK-BULK <date>' to the commit "
                            "message if this batch is intentional")
            except Exception as e:
                f.warn("google-safety-bulk-skipped", "sitemap.xml", str(e)[:120])

    # (c) dates -----------------------------------------------------------------------
    date_re = re.compile(r'"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})')
    for rel, src in pages:
        m = date_re.search(src)
        if not m:
            continue
        published = m.group(1)
        try:
            fp_rel = rel
            out = subprocess.run(
                ["git", "log", "--follow", "--format=%ad", "--date=format:%Y-%m-%d",
                 "--diff-filter=A", "--", fp_rel],
                cwd=root, capture_output=True, text=True, timeout=30)
            first_commit = out.stdout.strip().splitlines()[-1] if out.stdout.strip() else None
        except Exception:
            first_commit = None
        if not first_commit:
            continue
        try:
            pub_d = datetime.strptime(published, "%Y-%m-%d")
            first_d = datetime.strptime(first_commit, "%Y-%m-%d")
        except ValueError:
            continue
        if pub_d < first_d - timedelta(days=1):
            f.error("google-safety-fake-date", rel,
                    f"datePublished {published} predates this file's first commit "
                    f"({first_commit})")

    # (d) stuffing ----------------------------------------------------------------------
    near_me_re = re.compile(r"near me|cerca de m[ií]", re.I)
    for rel, src in pages:
        text = visible_text(src)
        hits = near_me_re.findall(text)
        if len(hits) > 1:
            f.error("google-safety-stuffing-nearme", rel,
                    f'"near me" / "cerca de mí" appears {len(hits)} times')
        city = _city_name_from_rel(rel)
        if not city:
            continue
        words = text.lower().split()
        if not words:
            continue
        count = len(re.findall(re.escape(city), text.lower()))
        per_1000 = count / (len(words) / 1000)
        if per_1000 > 8:
            f.error("google-safety-stuffing-city", rel,
                    f'"{city}" appears {count} times ({per_1000:.1f} per 1,000 words, limit 8)')

    # (e) indexing ------------------------------------------------------------------------
    robots_path = os.path.join(root, "robots.txt")
    if os.path.exists(robots_path):
        robots_src = open(robots_path, encoding="utf-8", errors="ignore").read()
        if re.search(r"(?im)^\s*disallow:\s*/\s*$", robots_src):
            f.error("google-safety-robots-disallow-all", "robots.txt",
                    "Disallow: / blocks the whole site")

    sitemap_path = os.path.join(root, "sitemap.xml")
    sitemap_urls = set()
    if os.path.exists(sitemap_path):
        sitemap_src = open(sitemap_path, encoding="utf-8", errors="ignore").read()
        sitemap_urls = {u[len(domain):].rstrip("/") or "/"
                         for u in re.findall(r"<loc>([^<]*)</loc>", sitemap_src)
                         if u.startswith(domain)}

    def path_of(rel):
        path = "/" + rel[:-5]
        path = "/" if path == "/index" else (path[:-6] if path.endswith("/index") else path)
        return path.rstrip("/") or "/"

    for rel, src in pages:
        if path_of(rel) not in sitemap_urls and rel != "index.html":
            continue
        if re.search(r'name="robots"[^>]*content="[^"]*noindex', src, re.I):
            f.error("google-safety-sitemap-noindex", rel,
                    "listed in the sitemap but has a noindex meta tag")

    for home_rel in ("index.html", "en.html", "es.html"):
        fp = os.path.join(root, home_rel)
        if not os.path.exists(fp):
            continue
        src = open(fp, encoding="utf-8", errors="ignore").read()
        m = re.search(r'rel="canonical"[^>]*href="([^"]+)"', src)
        if not m:
            f.error("google-safety-home-no-canonical", home_rel, "home page has no canonical tag")
        elif not m.group(1).startswith(domain):
            f.error("google-safety-home-cross-domain-canonical", home_rel,
                    f"canonical points at {m.group(1)}, not this domain")


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
        "team-pages": lambda: check_team_pages(root, domain, f),
        "figures": lambda: check_figures(root, figures_path, f),
        "brand": lambda: check_brand(root, domain, f),
        "sitemap": lambda: check_sitemap(root, domain, f),
        "bodies": lambda: check_bodies(root, f),
        "ctas": lambda: check_ctas(root, f),
        "og": lambda: check_og(root, domain, f),
        "google-safety": lambda: check_google_safety(root, domain, f, a.base),
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
        print("  content-loss: NOT RUN — pass --base <ref> (e.g. --base origin/production)")
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
