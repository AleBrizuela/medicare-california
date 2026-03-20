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

            if url_path == "index.html":
                url = f"{domain}/"
            elif url_path.endswith("/index.html"):
                url = f"{domain}/{url_path[:-len('index.html')]}"
            else:
                url = f"{domain}/{url_path}"

            try:
                with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                    html = f.read()
                parser = HreflangExtractor()
                parser.feed(html)
                hreflang = parser.hreflang
            except Exception:
                hreflang = {}

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
