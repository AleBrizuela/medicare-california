#!/usr/bin/env node
// T-108 gate: every page listed in the manifest must have each stamped fragment
// byte-identical to its family partial (crosslang substituted back in for header).
// Exits 1 and prints every mismatch if anything drifted from its partial.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "SHIP/now/2026-10-20_T-108-mc-manifest.json"), "utf8"));

function markerRe(field) {
  return new RegExp(`<!-- shared:${field} -->[\\s\\S]*?<!-- /shared:${field} -->`);
}
function loadPartial(field, family) {
  return fs.readFileSync(path.join(ROOT, `partials/${field}--${family}.html`), "utf8").replace(/\n$/, "");
}

let failures = [];
let checked = 0;
for (const [filePath, fields] of Object.entries(manifest.page)) {
  const text = fs.readFileSync(path.join(ROOT, filePath), "utf8");
  for (const [field, info] of Object.entries(fields)) {
    if (field === "fav" || field === "font") continue; // not stamped this pass
    checked++;
    let partial = loadPartial(field, info.family);
    if (field === "header" && info.crosslang) partial = partial.replaceAll("__CROSSLANG__", info.crosslang);
    const expected = `<!-- shared:${field} -->\n${partial}\n<!-- /shared:${field} -->`;
    const m = text.match(markerRe(field));
    if (!m) {
      failures.push(`${filePath}: no <!-- shared:${field} --> markers found`);
    } else if (m[0] !== expected) {
      failures.push(`${filePath}: ${field} content does not match partial '${info.family}'`);
    }
  }
}

console.log(`Checked ${checked} field-instances across ${Object.keys(manifest.page).length} pages.`);
if (failures.length) {
  console.log(`FAIL: ${failures.length} mismatch(es):`);
  for (const f of failures) console.log(" -", f);
  process.exit(1);
} else {
  console.log("PASS: every stamped fragment matches its partial exactly.");
}
