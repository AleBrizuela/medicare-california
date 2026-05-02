#!/usr/bin/env python3
"""
Generate blog index cards from /blog/*.html metadata.

Scans the blog folder, extracts metadata from each post (title, description,
lang, datePublished, word count), and replaces the contents of
<!-- BLOG-CARDS-START --> ... <!-- BLOG-CARDS-END --> in blog/index.html
with auto-generated cards sorted newest first.

Usage:
    python generate_blog_index.py --dir .

Designed to run as a build step on Cloudflare Pages, similar to
generate_sitemap.py. Output is idempotent: re-running produces the same
cards from the same /blog/*.html input.
"""

import argparse
import json
import re
import subprocess
from datetime import date as _date
from html.parser import HTMLParser
from pathlib import Path


SKIP = {"index.html"}


class HeadAndCount(HTMLParser):
    """Pulls <title>, <meta name=description>, <html lang>, and counts words in <body>."""
    def __init__(self):
        super().__init__()
        self.title = ""
        self.description = ""
        self.lang = ""
        self._in_title = False
        self._in_body = False
        self._body_text = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "html":
            self.lang = a.get("lang", "")
        if tag == "title":
            self._in_title = True
        if tag == "meta" and a.get("name") == "description":
            self.description = a.get("content", "")
        if tag == "body":
            self._in_body = True
        if self._in_body and tag in ("script", "style"):
            self._in_body = False
            self._skip_until = tag

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        if hasattr(self, "_skip_until") and tag == self._skip_until:
            del self._skip_until
            self._in_body = True

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        if self._in_body:
            self._body_text.append(data)

    @property
    def word_count(self):
        text = " ".join(self._body_text)
        return len(re.findall(r"\w+", text))


def extract_date_published(html: str) -> str | None:
    """Find datePublished in any JSON-LD block, or article:published_time meta tag."""
    # JSON-LD - tolerant of trailing commas and other quirks
    for match in re.finditer(r"datePublished[\"\']?\s*:\s*[\"\']([0-9]{4}-[0-9]{2}-[0-9]{2})", html):
        return match.group(1)
    # Meta tag fallback
    m = re.search(r'<meta\s+property="article:published_time"\s+content="([0-9]{4}-[0-9]{2}-[0-9]{2})', html)
    if m:
        return m.group(1)
    return None


def git_first_seen_date(file_path: Path) -> str | None:
    """Use git log to find when the file was first added."""
    try:
        result = subprocess.run(
            ["git", "log", "--diff-filter=A", "--follow", "--format=%aI", "--reverse", "--", file_path.name],
            cwd=file_path.parent,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            first_line = result.stdout.strip().split("\n")[0]
            return first_line[:10]
    except Exception:
        pass
    return None


def pick_tag(filename: str, title: str, lang: str) -> tuple[str, str]:
    """Map keywords in filename + title to a tag class and label.
    Returns (css_class, label). Labels match site language."""
    s = (filename + " " + title).lower()
    is_en = lang.startswith("en")
    rules = [
        # (keyword pattern, css class, label EN, label ES)
        (r"\baep\b|inscripcion-anual|annual-enrollment", "tag-aep", "AEP", "AEP"),
        (r"\boep\b|ending-california|termina|open-enrollment", "tag-oep", "OEP", "OEP"),
        (r"turning-65|cumplir-65|inicial|65-anos", "tag-iep", "Turning 65", "Cumplir 65"),
        (r"special-enrollment|sep\b|periodos-especiales", "tag-iep", "SEP", "SEP"),
        (r"hmo-vs-ppo|vs-medigap|comparar|wellness-visit-vs", "tag-comparar", "Compare", "Comparar"),
        (r"checklist", "tag-checklist", "Checklist", "Checklist"),
        (r"penalties|residentes-permanentes|late-enrollment", "tag-consejos", "Tips", "Consejos"),
        (r"dental|vision|hearing|preventive|wellness|vaccine|diabetes", "tag-guia", "Health", "Salud"),
        (r"supplement|medigap|part-b|irmaa|parte-a|parte-d|seguro-empleador|costos|cost", "tag-guia", "Coverage", "Cobertura"),
        (r"medi-cal|dual|doble|jubilacion|familias|viajes|empleador", "tag-guia", "Guide", "Guia"),
    ]
    for pat, css, en_label, es_label in rules:
        if re.search(pat, s):
            return css, (en_label if is_en else es_label)
    return ("tag-guia", "Guide" if is_en else "Guia")


MONTHS_ES = {
    "01":"enero","02":"febrero","03":"marzo","04":"abril","05":"mayo","06":"junio",
    "07":"julio","08":"agosto","09":"septiembre","10":"octubre","11":"noviembre","12":"diciembre"
}
MONTHS_EN = ["", "January","February","March","April","May","June","July","August","September","October","November","December"]


def format_date(date_iso: str, lang: str) -> str:
    y, m, d = date_iso.split("-")
    if lang.startswith("en"):
        return f"{MONTHS_EN[int(m)]} {int(d)}, {y}"
    return f"{int(d)} de {MONTHS_ES[m]}, {y}"


def estimate_read_time(word_count: int, lang: str) -> str:
    wpm = 200 if lang.startswith("en") else 180
    minutes = max(2, round(word_count / wpm))
    return f"{minutes} min read" if lang.startswith("en") else f"{minutes} min de lectura"


def build_card(meta: dict) -> str:
    return (
        f'            <a href="{meta["filename"]}" class="blog-card">\n'
        f'                <div class="blog-card-content">\n'
        f'                    <span class="blog-tag {meta["tag_css"]}">{meta["tag_label"]}</span>\n'
        f'                    <h2>{meta["title"]}</h2>\n'
        f'                    <p>{meta["description"]}</p>\n'
        f'                    <div class="blog-card-meta">\n'
        f'                        <span>{meta["date_str"]}</span>\n'
        f'                        <span>&middot;</span>\n'
        f'                        <span>{meta["read_str"]}</span>\n'
        f'                    </div>\n'
        f'                </div>\n'
        f'            </a>'
    )


def collect_metadata(blog_dir: Path) -> list[dict]:
    posts = []
    for f in sorted(blog_dir.glob("*.html")):
        if f.name in SKIP:
            continue
        html = f.read_text(encoding="utf-8")
        parser = HeadAndCount()
        try:
            parser.feed(html)
        except Exception:
            pass

        date_iso = extract_date_published(html)
        if not date_iso:
            date_iso = git_first_seen_date(f)
        if not date_iso:
            date_iso = _date.today().isoformat()

        tag_css, tag_label = pick_tag(f.name, parser.title, parser.lang)

        # Trim common site-name suffixes from <title> ("Title | Brand" or "Title - Brand")
        clean_title = parser.title.strip()
        for sep in (" | ", " - ", " — "):
            if sep in clean_title:
                # Only strip if the right side looks like a brand name (short, not a sentence)
                left, _, right = clean_title.rpartition(sep)
                if right and len(right) < 50 and right.count(" ") <= 6:
                    clean_title = left.strip()

        posts.append({
            "filename": f.name,
            "title": clean_title or f.stem.replace("-", " ").title(),
            "description": parser.description.strip(),
            "lang": parser.lang,
            "date_iso": date_iso,
            "date_str": format_date(date_iso, parser.lang),
            "read_str": estimate_read_time(parser.word_count, parser.lang),
            "tag_css": tag_css,
            "tag_label": tag_label,
        })

    posts.sort(key=lambda m: m["date_iso"], reverse=True)
    return posts


START_MARKER = "<!-- BLOG-CARDS-START -->"
END_MARKER = "<!-- BLOG-CARDS-END -->"


def find_matching_div_close(content: str, open_pos: int) -> int | None:
    """Given a string and a position right after `<div ...>`, find the position of
    the matching `</div>` accounting for nested <div> elements."""
    depth = 1
    i = open_pos
    while i < len(content):
        next_open = content.find("<div", i)
        next_close = content.find("</div>", i)
        if next_close == -1:
            return None
        if next_open != -1 and next_open < next_close:
            depth += 1
            i = next_open + 4
        else:
            depth -= 1
            if depth == 0:
                return next_close
            i = next_close + 6
    return None


def update_index(index_path: Path, cards_html: str) -> bool:
    content = index_path.read_text(encoding="utf-8")

    if START_MARKER in content and END_MARKER in content:
        # Subsequent run: replace between markers
        pattern = re.compile(
            re.escape(START_MARKER) + r"(.*?)" + re.escape(END_MARKER),
            re.DOTALL
        )
        replacement = START_MARKER + "\n" + cards_html + "\n            " + END_MARKER
        content = pattern.sub(replacement, content)
        index_path.write_text(content, encoding="utf-8")
        return True

    # Bootstrap: find <div class="blog-grid"> opener, walk to its matching close
    grid_open_match = re.search(r'<div class="blog-grid"[^>]*>', content)
    if not grid_open_match:
        print(f"  WARN: no <div class='blog-grid'> found in {index_path}")
        return False

    open_end = grid_open_match.end()
    close_start = find_matching_div_close(content, open_end)
    if close_start is None:
        print(f"  WARN: could not find matching </div> for blog-grid in {index_path}")
        return False

    new_block = (
        grid_open_match.group(0)
        + "\n            " + START_MARKER + "\n"
        + cards_html
        + "\n            " + END_MARKER + "\n        "
    )
    content = content[:grid_open_match.start()] + new_block + content[close_start:]
    index_path.write_text(content, encoding="utf-8")
    return True


def detect_site_lang(index_html: str) -> str:
    """Read the <html lang="..."> attribute from the blog index page itself.
    That defines the site's primary language. Posts in other languages
    are accessible directly but do not appear on this listing."""
    m = re.search(r'<html[^>]*\blang="([a-z]{2})"', index_html, re.IGNORECASE)
    return m.group(1).lower() if m else ""


def main():
    parser = argparse.ArgumentParser(description="Regenerate blog/index.html from /blog/*.html metadata")
    parser.add_argument("--dir", default=".", help="Site root containing blog/ subfolder")
    parser.add_argument("--lang", default=None, help="Filter posts to this language (overrides auto-detect)")
    args = parser.parse_args()

    site_root = Path(args.dir).resolve()
    blog_dir = site_root / "blog"
    index_path = blog_dir / "index.html"

    if not index_path.exists():
        print(f"ERROR: {index_path} not found")
        return 1

    site_lang = (args.lang or detect_site_lang(index_path.read_text(encoding="utf-8"))).lower()
    if not site_lang:
        print("WARN: no <html lang=...> found and no --lang flag, listing all posts")

    posts = collect_metadata(blog_dir)
    print(f"Found {len(posts)} posts in {blog_dir}")

    if site_lang:
        before = len(posts)
        posts = [p for p in posts if p["lang"].lower().startswith(site_lang)]
        print(f"Filtered to lang='{site_lang}': {len(posts)} posts (dropped {before - len(posts)})")

    cards_html = "\n".join(build_card(p) for p in posts)
    update_index(index_path, cards_html)
    print(f"Wrote {len(posts)} cards to {index_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
