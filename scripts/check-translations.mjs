// Fails when a language is missing a key, has an extra or empty one, or uses
// different {placeholders} than English; and when the code asks for a key that
// English does not define. Run: node scripts/check-translations.mjs
import fs from "node:fs";
import vm from "node:vm";

const file = new URL("../map-history-card.js", import.meta.url);
const source = fs.readFileSync(file, "utf8");
const match = source.match(/const STRINGS = (\{[\s\S]*?\n\});/);
if (!match) {
  console.error("STRINGS table not found in map-history-card.js");
  process.exit(1);
}
const STRINGS = vm.runInNewContext("(" + match[1] + ")");
const placeholders = (text) => (text.match(/\{\w+\}/g) || []).sort().join();
const base = Object.keys(STRINGS.en);
const errors = [];

for (const [code, table] of Object.entries(STRINGS)) {
  const keys = Object.keys(table);
  for (const k of base) {
    if (!(k in table)) errors.push(`${code}: missing "${k}"`);
    else if (!String(table[k]).trim()) errors.push(`${code}: empty "${k}"`);
    else if (placeholders(table[k]) !== placeholders(STRINGS.en[k])) {
      errors.push(`${code}: "${k}" placeholders differ from en (${placeholders(table[k])} vs ${placeholders(STRINGS.en[k])})`);
    }
  }
  for (const k of keys) if (!base.includes(k)) errors.push(`${code}: unknown key "${k}"`);
}

const used = new Set([...source.matchAll(/_t\(\s*"(\w+)"/g)].map((m) => m[1]));
for (const k of used) if (!base.includes(k)) errors.push(`code uses undefined key "${k}"`);
// keys chosen at runtime (this._t(cond ? "a" : "b")) are not caught by the regex above
for (const m of source.matchAll(/_t\([^")]*\?\s*"(\w+)"\s*:\s*"(\w+)"/g)) {
  for (const k of [m[1], m[2]]) if (!base.includes(k)) errors.push(`code uses undefined key "${k}"`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`OK: ${Object.keys(STRINGS).length} languages (${Object.keys(STRINGS).join(", ")}), ${base.length} keys each`);
