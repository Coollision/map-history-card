// Renders the README screenshots with sample data (no real names or places).
//   cd scripts/screenshots && npm install && node screenshots.mjs [outDir]
// Needs Google Chrome (CHROME=/path/to/chrome to override) and internet access
// (OpenFreeMap tiles, the MapLibre files from node_modules, and @mdi/svg icons).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = path.resolve(process.argv[2] || path.join(root, "docs/images"));
const chrome = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const STYLES = { "/static/map/light.json": "positron", "/static/map/dark.json": "dark" };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  try {
    if (STYLES[url]) {
      const r = await fetch("https://tiles.openfreemap.org/styles/" + STYLES[url]);
      res.setHeader("content-type", "application/json");
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    const file = url === "/" || url === "/index.html" ? path.join(here, "index.html")
      : url === "/map-history-card.js" ? path.join(root, "map-history-card.js")
      : /^\/maplibre-gl(-worker)?\.mjs$|^\/maplibre-gl\.css$/.test(url.split("?")[0])
        ? path.join(root, "node_modules", "maplibre-gl", "dist", url.split("?")[0].slice(1)) : null;
    if (!file) { res.statusCode = 404; return res.end(); }
    res.setHeader("content-type", /\.m?js$/.test(file) ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    res.end(fs.readFileSync(file));
  } catch (e) { res.statusCode = 500; res.end(String(e)); }
});
await new Promise((r) => server.listen(0, r));
let errors = 0;
const base = "http://localhost:" + server.address().port + "/";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: chrome, headless: "new",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const card = (p, fn, ...a) => p.evaluate((f, ...args) => new Function("r", "c", "return (" + f + ")(r, c, ...arguments[2])")(
  document.querySelector("map-history-card").shadowRoot, document.querySelector("map-history-card"), args), fn.toString(), ...a);
const drawn = async (p) => {
  await p.waitForFunction(() => {
    const c = document.querySelector("map-history-card");
    const m = c && c.shadowRoot && c.shadowRoot.querySelector("#map");
    return m && m.classList.contains("drawn");
  }, { timeout: 60000 });
  await sleep(4000);
};
async function open(dark) {
  const p = await browser.newPage();
  await p.setViewport({ width: 1100, height: 640, deviceScaleFactor: 2 });
  p.on("pageerror", (e) => { errors++; console.log("pageerror:", String(e).slice(0, 200)); });
  // Failed requests (404, blocked network) log as console errors.
  p.on("console", (m) => {
    if (m.type() !== "error" || /status of 404/.test(m.text() + m.location().url)) return;
    errors++; console.log("console.error:", m.text().slice(0, 200));
  });
  await p.goto(base + (dark ? "?dark" : ""));
  await drawn(p);
  return p;
}
const range = async (p, label) => {
  await card(p, (r, c, l) => [...r.querySelectorAll(".chips button")].find((x) => x.textContent.trim() === l).click(), label);
  await sleep(6000);
};
const click = async (p, sel) => { await card(p, (r, c, s) => r.querySelector(s).click(), sel); await sleep(1500); };
async function hover(p, idx) {
  const [x, y] = await card(p, (r, c, i) => {
    const f = c._geo.points.filter((q) => !q.properties.start)[i];
    const px = c._map.project(f.geometry.coordinates);
    return [px.x, px.y];
  }, idx);
  await p.mouse.move(x - 5, y - 5);
  await p.mouse.move(x, y);
  await sleep(1500);
}

fs.mkdirSync(outDir, { recursive: true });
const shot = (p, name) => p.screenshot({ path: path.join(outDir, name + ".png") });

let p = await open(false);
await shot(p, "people-light");
await range(p, "3d"); await hover(p, 40); await shot(p, "history-light"); await p.close();

p = await open(true);
await range(p, "3d"); await hover(p, 25); await shot(p, "history-dark"); await p.close();

p = await open(false);
await click(p, "[data-act=none]");
await click(p, "[data-tab=device_tracker]");
await click(p, '.list [data-entity="device_tracker.bike"]'); await sleep(4000);
await range(p, "24h"); await shot(p, "devices-light"); await p.close();

await browser.close();
server.close();
console.log("wrote screenshots to", outDir);
if (errors) { console.log(errors + " page error(s)"); process.exitCode = 1; }
