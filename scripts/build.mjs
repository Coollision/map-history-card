// Builds the release folder dist/: the card plus the MapLibre files it loads
// from its own URL (dist/maplibre/). Run: node scripts/build.mjs
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const maplibre = join(root, "node_modules", "maplibre-gl", "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(join(dist, "maplibre"), { recursive: true });
await cp(join(root, "map-history-card.js"), join(dist, "map-history-card.js"));
for (const f of ["maplibre-gl.mjs", "maplibre-gl-worker.mjs", "maplibre-gl.css"]) {
  await cp(join(maplibre, f), join(dist, "maplibre", f));
}
await cp(join(root, "node_modules", "maplibre-gl", "LICENSE.txt"), join(dist, "maplibre", "LICENSE.txt"));
console.log("built dist/ (card + maplibre/)");
