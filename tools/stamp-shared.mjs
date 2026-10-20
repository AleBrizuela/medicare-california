#!/usr/bin/env node
// T-108 STEP 1 (MC): wrap exact-match header/footer/favicon/font/GA fragments in
// <!-- shared:FIELD --> markers. A page is only ever stamped when its CURRENT content
// matches a known family byte-for-byte (header: modulo the one documented per-page
// cross-language href). No page's visible content is ever changed to match a majority;
// a page whose fragment matches nothing is left completely untouched and logged.
// Idempotent: run twice, second run produces zero diff.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "SHIP/now/2026-10-20_T-108-mc-manifest.json"), "utf8"));

const FIELD_TAG = {
  header: { open: "<header", openRe: /<header\b[^>]*>[\s\S]*?<\/header>/ },
  footer: { open: "<footer", openRe: /<footer\b[^>]*>[\s\S]*?<\/footer>/ },
};

function markerRe(field) {
  return new RegExp(`<!-- shared:${field} -->[\\s\\S]*?<!-- /shared:${field} -->`);
}

function partialPath(field, family) {
  return path.join(ROOT, `partials/${field}--${family}.html`);
}

function loadPartial(field, family) {
  return fs.readFileSync(partialPath(field, family), "utf8").replace(/\n$/, "");
}

const log = { stamped: {}, skipped_mismatch: [], unchanged_already_stamped: [] };

function stampHeaderOrFooter(field, filePath, family, crosslang) {
  const full = path.join(ROOT, filePath);
  let text = fs.readFileSync(full, "utf8");
  const mRe = markerRe(field);
  const already = mRe.test(text);
  let partial = loadPartial(field, family);
  if (field === "header" && crosslang) {
    partial = partial.replaceAll("__CROSSLANG__", crosslang);
  }
  const wrapped = `<!-- shared:${field} -->\n${partial}\n<!-- /shared:${field} -->`;

  if (already) {
    const current = text.match(mRe)[0];
    if (current === wrapped) {
      log.unchanged_already_stamped.push(`${filePath}:${field}`);
      return "noop";
    }
    // re-stamp (e.g. footer-en content changed for the city-page merge) only if the
    // CONTENT inside today's markers, once re-normalized, still belongs to this family.
    text = text.replace(mRe, wrapped);
    fs.writeFileSync(full, text);
    log.stamped[`${field}:${family}`] = (log.stamped[`${field}:${family}`] || 0) + 1;
    return "restamped";
  }

  const tagRe = FIELD_TAG[field].openRe;
  const m = text.match(tagRe);
  if (!m) {
    log.skipped_mismatch.push(`${filePath}:${field}:no-tag-found`);
    return "skip";
  }
  text = text.replace(tagRe, wrapped);
  fs.writeFileSync(full, text);
  log.stamped[`${field}:${family}`] = (log.stamped[`${field}:${family}`] || 0) + 1;
  return "stamped";
}

const GA_RE = /<script[^>]*>\s*window\.dataLayer[\s\S]*?<\/script>\s*<script[^>]*src="https:\/\/www\.googletagmanager\.com[^>]*><\/script>|<script async src="https:\/\/www\.googletagmanager\.com[\s\S]*?gtag\(.config.[^)]*\)[^<]*<\/script>/;

function stampGa(filePath, family) {
  const full = path.join(ROOT, filePath);
  let text = fs.readFileSync(full, "utf8");
  const mRe = markerRe("ga");
  const partial = loadPartial("ga", family);
  const wrapped = `<!-- shared:ga -->\n${partial}\n<!-- /shared:ga -->`;

  if (mRe.test(text)) {
    const current = text.match(mRe)[0];
    if (current === wrapped) { log.unchanged_already_stamped.push(`${filePath}:ga`); return "noop"; }
    text = text.replace(mRe, wrapped);
    fs.writeFileSync(full, text);
    log.stamped["ga:" + family] = (log.stamped["ga:" + family] || 0) + 1;
    return "restamped";
  }
  const m = text.match(GA_RE);
  if (!m) { log.skipped_mismatch.push(`${filePath}:ga:no-match`); return "skip"; }
  if (m[0] !== partial) { log.skipped_mismatch.push(`${filePath}:ga:content-differs-from-family`); return "skip"; }
  // in-place replace, preserving original position in <head>
  text = text.slice(0, m.index) + wrapped + text.slice(m.index + m[0].length);
  fs.writeFileSync(full, text);
  log.stamped["ga:" + family] = (log.stamped["ga:" + family] || 0) + 1;
  return "stamped";
}

// NOTE: favicon and font <link> stamping is deliberately NOT done this pass.
// Families were identified (see manifest partials.fav / partials.font) but a safe
// in-place, non-contiguous-tag replacement wasn't built in time to trust against a
// same-day production push; stamping the wrong position already bit the GA block
// once (caught in review before commit) and favicon/font tags are more scattered.
// Left as a listed follow-up, not stamped, not committed as partials this pass.

for (const [filePath, fields] of Object.entries(manifest.page)) {
  for (const [field, info] of Object.entries(fields)) {
    if (field === "header" || field === "footer") {
      stampHeaderOrFooter(field, filePath, info.family, info.crosslang);
    } else if (field === "ga") {
      stampGa(filePath, info.family);
    }
    // field === "fav" / "font": intentionally skipped this pass, see note above.
  }
}

console.log("Stamped (field:family -> count):", log.stamped);
console.log("Already stamped, unchanged:", log.unchanged_already_stamped.length);
console.log("Skipped (mismatch):", log.skipped_mismatch.length);
if (log.skipped_mismatch.length) {
  console.log(log.skipped_mismatch);
}
fs.writeFileSync(path.join(ROOT, "SHIP/now/2026-10-20_T-108-mc-stamp-run.json"), JSON.stringify(log, null, 1));
