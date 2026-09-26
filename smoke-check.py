#!/usr/bin/env python3
"""
smoke-check.py -- the other half of the gate.

site-check.py reads files. Every defect that escaped it this week was a
files-versus-server disagreement, which a file reader cannot see in principle:

  * contact.html served a blank page for six months while the file looked fine
  * /index-es returned HTTP 200 because _redirects was missing one line
  * the site returned 200 for every nonexistent URL, so no link check meant anything
  * 62 of 87 pages scrolled sideways at 375px, invisible to every text check
  * a CSS fix reached the server and not the visitor, because the stylesheet URL
    never changes and is cached for four hours

So this one asks the running site, not the repo.

    python3 smoke-check.py --base https://medicare-california.com
    python3 smoke-check.py --base https://staging.medicare-california.pages.dev --layout
    python3 smoke-check.py --base https://beneficiosmedicare.com --dir ../../beneficiosmedicare/00-beneficiosmedicare

--layout drives the installed Chrome over the DevTools Protocol at 375px wide and
asserts no page scrolls sideways and every page has a way to navigate. It needs no
pip packages: the CDP client below is about 60 lines of socket code.

Exit 0 clean, 1 on any failure, 2 on a usage problem.
"""

import argparse
import base64
import json
import os
import re
import socket
import ssl
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict

UA = "Mozilla/5.0 (smoke-check; +https://medicare-california.com)"
MOBILE_W = 375
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def _ssl_context():
    """This Python's default trust store is empty on this Mac (the python.org build
    ships without one until you run Install Certificates.command), so every https
    fetch failed with CERTIFICATE_VERIFY_FAILED and the checker reported HTTP 0 for
    the whole site. Try certifi, then the system bundle, and keep verification on."""
    for loader in (
        lambda: __import__("certifi").where(),
        lambda: "/etc/ssl/cert.pem",
    ):
        try:
            path = loader()
            if path and os.path.exists(path):
                return ssl.create_default_context(cafile=path)
        except Exception:
            continue
    return ssl.create_default_context()


SSL_CTX = _ssl_context()


# ─────────────────────────── findings ───────────────────────────

class Findings:
    def __init__(self):
        self.items = defaultdict(list)
        self.n_err = 0
        self.n_warn = 0

    def error(self, kind, where, detail=""):
        self.items[("error", kind)].append((where, detail))
        self.n_err += 1

    def warn(self, kind, where, detail=""):
        self.items[("warn", kind)].append((where, detail))
        self.n_warn += 1

    def report(self):
        for sev in ("error", "warn"):
            for (s, kind), rows in sorted(self.items.items()):
                if s != sev:
                    continue
                tag = "FAIL" if sev == "error" else "WARN"
                files = len({w for w, _ in rows})
                print(f"\n  [{tag}] {kind} — {len(rows)} occurrence(s) in {files} place(s)")
                for where, detail in rows[:25]:
                    print(f"      {where}")
                    if detail:
                        print(f"          {detail}")
                if len(rows) > 25:
                    print(f"      ... +{len(rows) - 25} more")
        print("\n" + "-" * 72)
        print(f"  {self.n_err} error(s), {self.n_warn} warning(s)")
        if not self.n_err and not self.n_warn:
            print("  clean")
        print("-" * 72)


# ─────────────────────────── http ───────────────────────────

def fetch(url, method="GET", redirect=False):
    """Return (status, headers, body). redirect=False means do NOT follow."""
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None

    handlers = [urllib.request.HTTPSHandler(context=SSL_CTX)]
    if not redirect:
        handlers.append(NoRedirect)
    opener = urllib.request.build_opener(*handlers)
    req = urllib.request.Request(url, method=method, headers={"User-Agent": UA})
    # Cloudflare throttles a fast sweep with 409/429. Those are about our request rate,
    # not the site, and reporting them as failures produced false alarms on healthy
    # pages. Back off and retry before believing them.
    for attempt in range(3):
        try:
            with opener.open(req, timeout=25) as r:
                return r.status, dict(r.headers), r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (409, 429, 503) and attempt < 2:
                time.sleep(2 * (attempt + 1))
                continue
            break
        except Exception:
            break
    try:
        with opener.open(req, timeout=25) as r:
            return r.status, dict(r.headers), r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", "replace")
        except Exception:
            pass
        return e.code, dict(e.headers or {}), body
    except Exception as e:
        return 0, {}, f"__ERR__ {e}"


def sitemap_paths(base, f):
    status, _, body = fetch(base + "/sitemap.xml", redirect=True)
    if status != 200:
        f.error("sitemap-unreachable", "/sitemap.xml", f"HTTP {status}")
        return []
    locs = re.findall(r"<loc>([^<]+)</loc>", body)
    if not locs:
        f.error("sitemap-empty", "/sitemap.xml", "no <loc> entries")
    out = []
    for u in locs:
        p = re.sub(r"^https?://[^/]+", "", u) or "/"
        out.append(p)
    return out


NON_PUBLIC = ("index-v", "index-dev", "index-localtest", "index-current", "404",
              "bot-evals", "widget")
SKIP_DIRS = {".git", "node_modules", ".github", "__pycache__", ".cloudflare", "images",
             "tools"}


def offsitemap_paths(root, sitemap, redirects):
    """Pages that are served but deliberately absent from the sitemap.

    A page that canonicals to the other domain is correctly excluded from the sitemap,
    and was therefore invisible to every check here -- which is how four pages went to
    staging carrying the other site's stylesheet, favicon and footer links. Anything
    Cloudflare will serve gets checked, whether or not we advertise it.
    """
    have = {p.rstrip("/") or "/" for p in sitemap}
    red = {s.rstrip("/") for s in redirects}
    out = []
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for fn in files:
            if not fn.endswith(".html"):
                continue
            stem = fn[:-5]
            if stem.startswith(NON_PUBLIC):
                continue
            rel = os.path.relpath(os.path.join(dirpath, fn), root).replace(os.sep, "/")
            if rel.endswith("index.html"):
                # a directory index is served at the slashed URL; the bare form 308s
                url = "/" + rel[:-len("index.html")]
            else:
                url = "/" + rel[:-5]
            if (url.rstrip("/") or "/") in {p.rstrip("/") or "/" for p in have} \
               or url.rstrip("/") in red:
                continue
            out.append(url)
    return sorted(out)


def load_redirect_sources(root):
    p = os.path.join(root, "_redirects")
    if not os.path.exists(p):
        return []
    srcs = []
    for line in open(p, encoding="utf-8", errors="ignore"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) >= 2 and parts[0].startswith("/"):
            srcs.append(parts[0])
    return srcs


# ─────────────────────────── http-level checks ───────────────────────────

def check_sitemap_urls(base, paths, f):
    """Every URL we tell search engines to index must actually serve a page."""
    for p in paths:
        status, hdr, _ = fetch(base + p)
        if status == 0:
            f.error("unreachable", p, "connection failed")
        elif 300 <= status < 400:
            f.error("sitemap-url-redirects", p,
                    f"HTTP {status} -> {hdr.get('Location','?')} (in sitemap but not served)")
        elif status != 200:
            f.error("sitemap-url-not-200", p, f"HTTP {status}")


def check_soft_404(base, f):
    """The bug that made every link check meaningless: a missing page returning 200."""
    probe = "/smoke-check-nonexistent-" + base64.b32encode(os.urandom(5)).decode().lower()
    status, _, body = fetch(base + probe, redirect=True)
    if status == 200:
        f.error("soft-404", probe,
                "a nonexistent URL returns HTTP 200 — every link check on this site is "
                "meaningless until a 404.html exists")
    elif status != 404:
        f.warn("unexpected-404-status", probe, f"HTTP {status}, expected 404")
    else:
        # a real 404 should not invite indexing
        hdr_robots = ""
        s2, h2, b2 = fetch(base + probe, redirect=True)
        if "noindex" not in (h2.get("X-Robots-Tag", "") + b2).lower():
            f.warn("404-not-noindex", probe, "404 page has no noindex")


def check_redirects_fire(base, srcs, f):
    """A _redirects line only protects you if the SERVED url redirects.

    Cloudflare serves the extensionless form, so /x.html redirecting while /x does
    not leaves /x live. That is exactly how /index-es stayed indexable."""
    seen = set()
    for src in srcs:
        for cand in {src, src[:-5] if src.endswith(".html") else src}:
            if cand in seen or "*" in cand or ":" in cand:
                continue
            seen.add(cand)
            status, hdr, _ = fetch(base + cand)
            if status == 200:
                f.error("redirect-source-serves-200", cand,
                        "_redirects lists this but it returns 200 — the redirect never fires")
            elif status == 0:
                f.warn("redirect-source-unreachable", cand)


def check_canonicals(base, paths, f):
    """A page must claim itself, or it hands its ranking to another URL."""
    host = re.sub(r"^https?://", "", base).rstrip("/")
    for p in paths:
        status, _, body = fetch(base + p, redirect=True)
        if status != 200:
            continue
        m = re.search(r'rel="canonical"[^>]*?href="([^"]+)"', body)
        if not m:
            f.warn("no-canonical", p)
            continue
        canon = m.group(1)
        want = f"https://{host}{p}".rstrip("/") or f"https://{host}/"
        if canon.rstrip("/") != want.rstrip("/"):
            # only flag when it points somewhere on our own host: cross-site is deliberate
            if host in canon:
                f.error("canonical-mismatch", p, f"claims {canon}")
        if ".html" in canon:
            f.error("canonical-has-html", p, canon)


def check_assets(base, paths, f, sample=None):
    """A 404 on a stylesheet is invisible to every text check and breaks the page."""
    pages = paths if sample is None else paths[:sample]
    checked = {}
    for p in pages:
        status, _, body = fetch(base + p, redirect=True)
        if status != 200:
            continue
        refs = re.findall(r'(?:href|src)="([^"]+\.(?:css|js))(\?[^"]*)?"', body)
        for path, query in refs:
            if path.startswith(("http://", "https://", "//")):
                continue
            # Cloudflare injects its own email-obfuscation script at the edge. It is not
            # ours, we cannot version it, and warning about it buries the real findings.
            if path.startswith("/cdn-cgi/"):
                continue
            # local asset: must exist, and must be versioned or a CSS fix never lands
            abs_url = base + path if path.startswith("/") else base + os.path.normpath(
                os.path.join(os.path.dirname(p), path)).replace("\\", "/")
            if abs_url not in checked:
                st, _, _ = fetch(abs_url + (query or ""), redirect=True)
                checked[abs_url] = st
            if checked[abs_url] != 200:
                f.error("asset-404", p, f"{path} -> HTTP {checked[abs_url]}")
            if not query:
                f.warn("asset-not-versioned", p,
                       f"{path} has no ?v= — a fix to it will not reach cached visitors")


# ─────────────────────────── minimal CDP client ───────────────────────────

class WS:
    """The smallest websocket client that can talk to Chrome. No pip packages."""

    def __init__(self, url):
        m = re.match(r"ws://([^:/]+):(\d+)(/.*)", url)
        if not m:
            raise ValueError(f"bad ws url: {url}")
        host, port, path = m.group(1), int(m.group(2)), m.group(3)
        self.sock = socket.create_connection((host, port), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            f"GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n\r\n".encode()
        )
        buf = b""
        while b"\r\n\r\n" not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise IOError("handshake closed")
            buf += chunk
        if b"101" not in buf.split(b"\r\n")[0]:
            raise IOError(f"handshake failed: {buf.split(chr(13).encode())[0]!r}")
        self.buf = buf.split(b"\r\n\r\n", 1)[1]
        self.next_id = 0

    def _recv_exact(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise IOError("closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, obj):
        payload = json.dumps(obj).encode()
        mask = os.urandom(4)
        n = len(payload)
        if n < 126:
            hdr = struct.pack("!BB", 0x81, 0x80 | n)
        elif n < 1 << 16:
            hdr = struct.pack("!BBH", 0x81, 0x80 | 126, n)
        else:
            hdr = struct.pack("!BBQ", 0x81, 0x80 | 127, n)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(hdr + mask + masked)

    def recv(self):
        while True:
            b1, b2 = struct.unpack("!BB", self._recv_exact(2))
            opcode, ln = b1 & 0x0F, b2 & 0x7F
            if ln == 126:
                ln = struct.unpack("!H", self._recv_exact(2))[0]
            elif ln == 127:
                ln = struct.unpack("!Q", self._recv_exact(8))[0]
            data = self._recv_exact(ln)
            if opcode == 0x8:
                raise IOError("chrome closed the socket")
            if opcode in (0x9, 0xA):
                continue
            return json.loads(data)

    def call(self, method, params=None, timeout=40):
        self.next_id += 1
        mid = self.next_id
        self.send({"id": mid, "method": method, "params": params or {}})
        deadline = time.time() + timeout
        while time.time() < deadline:
            msg = self.recv()
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})
        raise TimeoutError(method)

    def close(self):
        try:
            self.sock.close()
        except Exception:
            pass


class Chrome:
    def __init__(self, port=9333):
        if not os.path.exists(CHROME):
            raise FileNotFoundError(CHROME)
        self.proc = subprocess.Popen(
            [CHROME, "--headless=new", f"--remote-debugging-port={port}",
             "--no-first-run", "--no-default-browser-check", "--disable-gpu",
             "--hide-scrollbars", f"--window-size={MOBILE_W},900",
             "--user-data-dir=" + os.path.join(os.path.sep, "tmp", f"smoke-chrome-{port}")],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        ws_url = None
        for _ in range(60):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2) as r:
                    ws_url = json.load(r)["webSocketDebuggerUrl"]
                break
            except Exception:
                time.sleep(0.5)
        if not ws_url:
            raise IOError("Chrome did not expose a debugging port")
        self.browser = WS(ws_url)
        tgt = self.browser.call("Target.createTarget", {"url": "about:blank"})["targetId"]
        info = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json"))
        page = next(t for t in info if t["id"] == tgt)
        self.page = WS(page["webSocketDebuggerUrl"])
        self.page.call("Page.enable")
        self.page.call("Runtime.enable")
        self.page.call("Emulation.setDeviceMetricsOverride",
                       {"width": MOBILE_W, "height": 812, "deviceScaleFactor": 2,
                        "mobile": True})

    def measure(self, url):
        self.page.call("Page.navigate", {"url": url})
        # wait for the load event rather than guessing
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                msg = self.page.recv()
            except IOError:
                break
            if msg.get("method") == "Page.loadEventFired":
                break
        time.sleep(0.4)  # let late CSS settle
        js = """(() => {
          const d = document;
          // innerWidth is the LAYOUT viewport, and a mobile browser widens it to fit an
          // overflowing page -- so scrollWidth - innerWidth is always 0 on exactly the
          // pages this check exists to catch. Measure against the device width instead.
          const deviceW = 375;
          const navLinks = [...d.querySelectorAll(
            '.blog-nav-links a,.desktop-nav a,.nav-links a,.site-nav a,nav a')]
            .filter(a => a.offsetWidth > 0 && a.offsetHeight > 0).length;
          // .sm-burger is the shared site-chrome header stamped onto most pages on 2026-09-18;
          // without it this check reported ~95 pages as having no navigation when every
          // one had a working 44px menu button (verified by hand 2026-09-25).
          const ham = d.querySelector('.sm-burger,.mobile-menu-btn,.mob,.hamburger,[aria-label="Menu"]');
          const hamR = ham ? ham.getBoundingClientRect() : null;
          const hamVisible = !!(hamR && hamR.width > 0 && hamR.height > 0 &&
                                getComputedStyle(ham).display !== 'none');
          const hamW = hamR ? Math.round(hamR.width) : 0;
          const hamH = hamR ? Math.round(hamR.height) : 0;
          const wide = [...d.querySelectorAll('*')]
            .filter(e => e.getBoundingClientRect().right > deviceW + 1)
            .slice(0, 3)
            .map(e => e.tagName.toLowerCase() +
                 (e.className ? '.' + String(e.className).trim().split(/\\s+/)[0] : ''));
          return JSON.stringify({
            deviceW, innerW: innerWidth,
            // documentElement.scrollWidth is what the user can actually scroll to.
            // body.scrollWidth is NOT: with overflow-x:hidden it still reports the
            // pre-clip content width, which reads as a 14px overflow on a page that
            // does not scroll sideways at all. Keep the two signals apart -- scrollable
            // overflow is the error, clipped content is a warning.
            overflow: Math.max(d.documentElement.scrollWidth, innerWidth) - deviceW,
            clipped: Math.max(d.body.scrollWidth, d.documentElement.scrollWidth) - deviceW,
            navLinks, hamW, hamH, hamVisible, wide,
            viewportMeta: !!d.querySelector('meta[name="viewport"]')
          });
        })()"""
        r = self.page.call("Runtime.evaluate", {"expression": js, "returnByValue": True})
        return json.loads(r["result"]["value"])

    def close(self):
        try:
            self.page.close()
            self.browser.close()
        finally:
            self.proc.terminate()


def check_layout(base, paths, f):
    """The check that would have caught 62 of 87 pages in one run."""
    try:
        chrome = Chrome()
    except Exception as e:
        f.warn("layout-skipped", "chrome", f"could not start Chrome: {e}")
        return
    try:
        for p in paths:
            try:
                m = chrome.measure(base + p)
            except Exception as e:
                f.warn("layout-error", p, str(e)[:90])
                continue
            if m["overflow"] > 0:
                f.error("mobile-overflow", p,
                        f"lays out {m['deviceW'] + m['overflow']}px wide on a {MOBILE_W}px screen "
                        f"(+{m['overflow']}px)"
                        + (f" — widest: {', '.join(m['wide'])}" if m["wide"] else ""))
            elif m["clipped"] > 1 and m["wide"]:
                # overflow-x:hidden is hiding it rather than fixing it: nothing scrolls,
                # but content is being cut off the side of the screen
                f.warn("clipped-overflow", p,
                       f"content runs {m['clipped']}px past a {MOBILE_W}px screen and is "
                       f"clipped by overflow-x:hidden — widest: {', '.join(m['wide'])}")
            if not m["viewportMeta"]:
                f.error("no-viewport-meta", p, "page cannot render responsively at all")
            if m["navLinks"] == 0 and not m["hamVisible"]:
                f.error("no-mobile-nav", p,
                        "no visible nav link and no visible hamburger — there is no way "
                        "to navigate from this page on a phone")
            elif m["navLinks"] == 0 and min(m["hamW"], m["hamH"]) < 44:
                # the audience is 65+; WCAG 2.5.8 wants 24px minimum, Apple and Google
                # both say 44px, and this is the only way off the page
                f.warn("tap-target-too-small", p,
                       f"the only navigation is a {m['hamW']}x{m['hamH']}px hamburger "
                       f"(want 44x44 minimum)")
    finally:
        chrome.close()


# ─────────────────────────── main ───────────────────────────

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="site root, e.g. https://medicare-california.com")
    ap.add_argument("--dir", default=".", help="repo root, for _redirects")
    ap.add_argument("--layout", action="store_true",
                    help="also drive Chrome at 375px (slower, catches layout)")
    ap.add_argument("--only", help="comma-separated check names")
    ap.add_argument("--report", action="store_true", help="never exit non-zero")
    ap.add_argument("--assets-sample", type=int, default=None,
                    help="only check assets on the first N pages")
    a = ap.parse_args()

    base = a.base.rstrip("/")
    if not base.startswith("http"):
        print("--base needs a scheme, e.g. https://medicare-california.com", file=sys.stderr)
        return 2

    f = Findings()
    print(f"smoke-check — {base}")
    paths = sitemap_paths(base, f)
    print(f"  {len(paths)} URLs in sitemap.xml")
    srcs = load_redirect_sources(os.path.abspath(a.dir))
    print(f"  {len(srcs)} _redirects sources")
    extra = offsitemap_paths(os.path.abspath(a.dir), paths, srcs)
    if extra:
        paths = paths + extra
        print(f"  {len(extra)} served but not in sitemap (checked anyway)")

    checks = {
        "sitemap": lambda: check_sitemap_urls(base, paths, f),
        "soft404": lambda: check_soft_404(base, f),
        "redirects": lambda: check_redirects_fire(base, srcs, f),
        "canonical": lambda: check_canonicals(base, paths, f),
        "assets": lambda: check_assets(base, paths, f, a.assets_sample),
    }
    # layout is always available by name; --layout adds it to the DEFAULT set, because it
    # is slow. `--only layout` should not need `--layout` as well.
    checks["layout"] = lambda: check_layout(base, paths, f)

    if a.only:
        selected = a.only.split(",")
    else:
        selected = [k for k in checks if k != "layout" or a.layout]
    print(f"  checks: {', '.join(selected)}\n")
    for name in selected:
        if name not in checks:
            print(f"  unknown check: {name}", file=sys.stderr)
            return 2
        t0 = time.time()
        checks[name]()
        print(f"  {name:10s} {time.time() - t0:6.1f}s")

    f.report()
    if a.report:
        return 0
    return 1 if f.n_err else 0


if __name__ == "__main__":
    sys.exit(main())
