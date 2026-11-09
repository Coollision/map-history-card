// Builds the release folder dist/: the card plus the MapLibre files it loads
// from its own URL. Flat on purpose: HACS downloads release assets into one
// folder, so there are no subfolders. Run: node scripts/build.mjs
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const maplibre = join(root, "node_modules", "maplibre-gl", "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(root, "map-history-card.js"), join(dist, "map-history-card.js"));
for (const f of ["maplibre-gl.mjs", "maplibre-gl-worker.mjs", "maplibre-gl.css"]) {
  await cp(join(maplibre, f), join(dist, f));
  // The .map files are not shipped; drop the pointer so DevTools does not 404.
  if (f.endsWith(".mjs")) {
    const p = join(dist, f);
    await writeFile(p, (await readFile(p, "utf8")).replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, "\n"));
  }
}
await cp(join(root, "node_modules", "maplibre-gl", "LICENSE.txt"), join(dist, "maplibre-gl-LICENSE.txt"));
console.log("built dist/ (card + MapLibre, flat)");
