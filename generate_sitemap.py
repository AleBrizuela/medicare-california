#!/usr/bin/env python3
"""
Lightweight sitemap generator for static sites on Cloudflare Pages.
Scans local HTML files and generates sitemap.xml during build.

Usage (build command for Cloudflare Pages):
    python generate_sitemap.py --domain https://beneficiosmedicare.com --dir .
    python generate_sitemap.py --domain https://medicare-california.com --dir .
"""

import argparse
import os
import re
import xml.etree.ElementTree as ET
from datetime import date
from html.parser import HTMLParser


class HreflangExtractor(HTMLParser):
    """Extracts hreflang alternates from HTML files."""

    def __init__(self):
        super().__init__()
        self.hreflang = {}

    def handle_starttag(self, tag, attrs):
        if tag == "link":
            attrs_dict = dict(attrs)
            rel = attrs_dict.get("rel", "")
            if "alternate" in rel and "hreflang" in attrs_dict and "href" in attrs_dict:
                self.hreflang[attrs_dict["hreflang"]] = attrs_dict["href"]



_NON_PUBLIC_PREFIXES = ("index-v", "index-dev", "index-localtest", "index-current", "404", "bot-evals")


def _is_non_public(url_path):
    """True for archived experiments and local-only dev/test pages."""
    name = url_path.rsplit("/", 1)[-1]
    stem = name[:-len(".html")] if name.endswith(".html") else name
    return stem.startswith(_NON_PUBLIC_PREFIXES)


_REDIRECT_SOURCES = None


def _is_redirected(url_path, directory):
    """True if _redirects has a rule whose source matches this file.

    Pages that 301 away must stay out of the sitemap: Google reports them
    as "Page with redirect" and they consume crawl budget for nothing.
    """
    global _REDIRECT_SOURCES
    if _REDIRECT_SOURCES is None:
        _REDIRECT_SOURCES = set()
        rpath = os.path.join(directory, "_redirects")
        if os.path.exists(rpath):
            with open(rpath, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    parts = line.split()
                    if len(parts) >= 2:
                        _REDIRECT_SOURCES.add(parts[0].rstrip("/") or "/")
    candidates = {"/" + url_path, "/" + url_path[:-len(".html")]}
    if url_path.endswith("/index.html"):
        candidates.add("/" + url_path[:-len("index.html")].rstrip("/"))
    return any(c.rstrip("/") in _REDIRECT_SOURCES or c in _REDIRECT_SOURCES
               for c in candidates)

def scan_local_files(directory, domain):
    """
    Scan a directory for HTML files and return a dict of:
      { url: { "hreflang": {lang: url, ...} } }
    """
    pages = {}
    domain = domain.rstrip("/")
    directory = os.path.abspath(directory)

    skip = {".git", "node_modules", ".github", "__pycache__", ".cloudflare"}

    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if d not in skip]

        for filename in files:
            filepath = os.path.join(root, filename)
            relpath = os.path.relpath(filepath, directory)

            if not filename.endswith(".html") and not filename.endswith(".htm"):
                continue

            url_path = relpath.replace(os.sep, "/")

            # Cloudflare Pages serves extensionless URLs and 308-redirects the
            # .html form. Emitting .html here made Google file every sitemap
            # entry as "Page with redirect" and skip indexing it. Emit the
            # extensionless URL that actually serves 200.
            if url_path == "index.html":
                url = f"{domain}/"
            elif url_path.endswith("/index.html"):
                url = f"{domain}/{url_path[:-len('index.html')]}"
            else:
                url = f"{domain}/{url_path[:-len('.html')]}"

            # Don't advertise URLs that _redirects sends elsewhere.
            if _is_redirected(url_path, directory):
                continue

            # Don't advertise archived experiments or local dev/test pages.
            # These are kept on disk deliberately but must never be offered
            # to search engines as indexable content.
            if _is_non_public(url_path):
                continue

            try:
                with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                    html = f.read()
                parser = HreflangExtractor()
                parser.feed(html)
                hreflang = parser.hreflang
            except Exception:
                html = ""
                hreflang = {}

            # A page whose canonical points at a DIFFERENT url is telling Google not to
            # index it. Listing it in the sitemap at the same time is a contradiction,
            # and it lands the page in Search Console's "Alternate page with proper
            # canonical tag" bucket -- which is where most of this site sat before
            # 2026-09-14. Found by smoke-check.py on 2026-09-16: two duplicate articles
            # canonicalised to their English-slugged twins and were in the sitemap anyway.
            m = re.search(r'rel="canonical"[^>]*?href="([^"]+)"', html)
            if m:
                canon = m.group(1).rstrip("/")
                if canon and canon.rstrip("/") != url.rstrip("/"):
                    continue

            pages[url] = {"hreflang": hreflang}

    return pages


def assign_priority(url):
    """Assign priority based on URL depth/type."""
    from urllib.parse import urlparse
    path = urlparse(url).path.rstrip("/")
    if path == "" or path == "/":
        return "1.0"
    if "/blog/" in path and path.count("/") > 1:
        return "0.7"
    if "/cities/" in path and path.count("/") > 2:
        return "0.7"
    if "/estados/" in path and path.count("/") > 1:
        return "0.7"
    return "0.8"


def generate_sitemap(pages, output_path):
    """Generate sitemap.xml from discovered pages."""
    NS = "http://www.sitemaps.org/schemas/sitemap/0.9"
    XHTML = "http://www.w3.org/1999/xhtml"

    ET.register_namespace("", NS)
    ET.register_namespace("xhtml", XHTML)

    urlset = ET.Element("urlset", xmlns=NS)
    urlset.set("xmlns:xhtml", XHTML)

    today = date.today().isoformat()
    sorted_urls = sorted(pages.keys())

    for page_url in sorted_urls:
        info = pages[page_url]
        url_el = ET.SubElement(urlset, "url")

        loc = ET.SubElement(url_el, "loc")
        loc.text = page_url

        for lang, href in info.get("hreflang", {}).items():
            link = ET.SubElement(url_el, "xhtml:link")
            link.set("rel", "alternate")
            link.set("hreflang", lang)
            link.set("href", href)

        lastmod = ET.SubElement(url_el, "lastmod")
        lastmod.text = today

        changefreq = ET.SubElement(url_el, "changefreq")
        changefreq.text = "weekly"

        priority_el = ET.SubElement(url_el, "priority")
        priority_el.text = assign_priority(page_url)

    tree = ET.ElementTree(urlset)
    ET.indent(tree, space="  ")

    with open(output_path, "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        # XSL stylesheet removed - causes Google sitemap parser failures
        tree.write(f, encoding="unicode", xml_declaration=False)

    return len(sorted_urls)


def main():
    parser = argparse.ArgumentParser(description="Generate sitemap.xml from local HTML files")
    parser.add_argument("--domain", required=True, help="The site domain (e.g. https://beneficiosmedicare.com)")
    parser.add_argument("--dir", default=".", help="Directory to scan for HTML files (default: current dir)")
    parser.add_argument("--output", "-o", default="sitemap.xml", help="Output file path (default: sitemap.xml)")
    args = parser.parse_args()

    domain = args.domain.rstrip("/")
    if not domain.startswith("http"):
        domain = "https://" + domain

    print(f"Scanning {args.dir} for HTML files...")
    pages = scan_local_files(args.dir, domain)
    print(f"Found {len(pages)} pages.")

    if not pages:
        print("No HTML files found.")
        return

    count = generate_sitemap(pages, args.output)
    print(f"Sitemap written to {args.output} with {count} URLs.")


if __name__ == "__main__":
    main()
