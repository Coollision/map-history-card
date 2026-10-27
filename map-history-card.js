/**
 * @license Apache-2.0
 * map-history-card - https://github.com/Coollision/map-history-card
 * Visual design and map-tile access follow the Home Assistant frontend
 * (https://github.com/home-assistant/frontend, Apache-2.0); see NOTICE.
 * Unofficial community card: not affiliated with or endorsed by Home Assistant
 * or the Open Home Foundation.
 */

// map-history-card
// Location-history card in the Home Assistant 2026.10 map style: MapLibre
// vector map (HA's own light/dark style, served through core's token-guarded
// tile proxy), a floating overview panel on desktop that becomes a drag sheet
// on phones, floating picture markers with a tail, shared bubbles for people
// in the same spot, and zone circles with their icon.
//
// What HA's own map card cannot do, and this one does: pick any start/end
// range and draw the full GPS trail of several entities on the map.
//
// No helper entities. The roster comes from auto-entities (same as the Map
// tab's `entities:`); UI selection state lives in localStorage.
//
// Config:
//   type: custom:map-history-card
//   entities: [...]           # usually injected live by a wrapping auto-entities card
//   pick_entities: [...]      # optional allow-list for the picker (overrides entities)
//   default_selected: [...]   # optional, else default_domains
//   default_domains: [person] # optional
//   default_hours: 12         # optional
//   zone_entities: [...]      # optional; defaults to zone.* out of `entities`
//   height: 480               # optional, px (else fills the view)
//   max_points: 300           # optional, hoverable points per trail

// HA ships 6.x, but 6.x is ESM-only with a separate worker file (no single-file
// build that a custom card can load cross-origin). 5.24.0 is the last line with
// a self-contained UMD + inline worker; HA's light/dark style JSON validates
// against its style spec.
const MAPLIBRE_VERSION = "5.24.0";
const MAPLIBRE_CSS = "https://cdn.jsdelivr.net/npm/maplibre-gl@" + MAPLIBRE_VERSION + "/dist/maplibre-gl.css";
const MAPLIBRE_JS = "https://cdn.jsdelivr.net/npm/maplibre-gl@" + MAPLIBRE_VERSION + "/dist/maplibre-gl.js";

// HA's map proxy (homeassistant/components/map_tiles) and the styles the frontend ships.
const TILES_PATH = "/api/map_tiles";
const TOKEN_HEADER = "X-Map-Tiles-Token";
const TOKEN_REFRESH_MS = 20 * 60 * 1000; // core rotates every 30 min, keeps two live
const STYLE_URL = { light: "/static/map/light.json", dark: "/static/map/dark.json" };

const STORAGE_KEY = "map-history-card:selection:v2";
const HOME_ZONE = "zone.home";
const COLOR_COUNT = 54; // HA defines --color-1 .. --color-54
const FALLBACK_COLORS = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#46f0f0",
  "#f032e6", "#9a6324", "#808000", "#008080", "#e6beff", "#800000",
];
const QUICK_RANGES = [
  { h: 3, label: "3u" }, { h: 12, label: "12u" }, { h: 24, label: "24u" },
  { h: 72, label: "3d" }, { h: 168, label: "7d" },
];

const MDI_RESET = "mdi:image-filter-center-focus";
const MDI_GROUP_ON = "mdi:google-circles-communities";
const MDI_GROUP_OFF = "mdi:dots-hexagon";

let maplibrePromise;
function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (!maplibrePromise) {
    maplibrePromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = MAPLIBRE_JS;
      script.onload = () => resolve(window.maplibregl);
      script.onerror = () => {
        maplibrePromise = undefined;
        reject(new Error("MapLibre kon niet geladen worden"));
      };
      document.head.appendChild(script);
    });
  }
  return maplibrePromise;
}

// MapLibre draws with WebGL2; HA falls back to a raster map without it, this
// card simply says so.
function supportsWebGL2() {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ok = Boolean(gl);
    gl && gl.getExtension("WEBGL_lose_context") && gl.getExtension("WEBGL_lose_context").loseContext();
    return ok;
  } catch (e) {
    return false;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Evenly thins a list to `max` items, ALWAYS keeping first and last.
function decimate(items, max) {
  if (items.length <= max) return items;
  const step = (items.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i++) out.push(items[Math.round(i * step)]);
  return out;
}

function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) +
    "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

function readStorage() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function writeStorage(data) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    // private browsing / storage disabled
  }
}

// A geodesic-ish circle polygon (radius in metres) for zone footprints.
function circlePolygon(lat, lon, metres, steps) {
  const ring = [];
  const dLat = metres / 111320;
  const dLon = metres / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return ring;
}

// White content while it contrasts enough with the fill, black otherwise
// (HA's zone marker rule, WCAG 3:1 for graphics).
function contrastingContent(color) {
  const probe = document.createElement("canvas").getContext("2d");
  try {
    probe.fillStyle = "#000";
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    const lin = (c) => {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return 1.05 / (lum + 0.05) >= 3 ? "#ffffff" : "#000000";
  } catch (e) {
    return "#ffffff";
  }
}

const STYLES = `
  :host { display: block; height: 100%; min-height: 420px; }
  * { box-sizing: border-box; }
  ha-card {
    position: relative; height: 100%; overflow: hidden;
    border-radius: var(--ha-card-border-radius, var(--ha-border-radius-lg, 12px));
  }
  #map {
    position: absolute; inset: 0; background: #f5efe5;
    visibility: hidden; opacity: 0; transition: opacity 150ms ease-in;
    --cluster-shadow: drop-shadow(0 1px 2px rgba(0,0,0,.08)) drop-shadow(0 1px 3px rgba(0,0,0,.12));
  }
  #map.drawn { visibility: visible; opacity: 1; }
  #map.dark { background: #191b2c;
    --cluster-shadow: drop-shadow(0 1px 2px rgba(0,0,0,.4)) drop-shadow(0 1px 3px rgba(0,0,0,.5)); }
  #map .maplibregl-canvas { outline: none; }
  .maplibregl-ctrl-top-right, .maplibregl-ctrl-bottom-right { margin-right: 0; }
  .maplibregl-ctrl-bottom-right, .maplibregl-ctrl-bottom-left { margin-bottom: var(--inset-bottom, 0px); }
  .maplibregl-ctrl.maplibregl-ctrl-attrib { color: #000; }
  .dark .maplibregl-ctrl.maplibregl-ctrl-attrib { background-color: rgba(28,28,28,.6); color: #fff; }
  .dark .maplibregl-ctrl-attrib a { color: rgba(255,255,255,.85); }
  .dark .maplibregl-ctrl-attrib.maplibregl-compact { background-color: #1c1c1c; }
  .dark .maplibregl-ctrl-attrib-button { filter: invert(1); }

  /* Tooltips: HA's dark translucent popup */
  .maplibregl-popup-content {
    padding: 8px !important; background: rgba(80,80,80,.9) !important; color: #fff !important;
    border-radius: var(--ha-border-radius-sm, 4px) !important; box-shadow: none !important;
    font-family: var(--ha-font-family-body, inherit); font-size: var(--ha-font-size-s, 12px);
    text-align: center; line-height: 1.5;
  }
  .maplibregl-popup-anchor-bottom .maplibregl-popup-tip { border-top-color: rgba(80,80,80,.9) !important; }
  .maplibregl-popup-anchor-top .maplibregl-popup-tip { border-bottom-color: rgba(80,80,80,.9) !important; }
  .maplibregl-popup-close-button { display: none; }
  .tip b { font-size: 13px; }
  .tip span { opacity: .8; }

  /* Floating map buttons, same spot and look as hui-map-card's #buttons */
  #buttons { position: absolute; top: 12px; right: 4px; z-index: 2; display: flex; flex-direction: column; }
  #buttons button {
    width: 44px; height: 44px; border: none; background: none; cursor: pointer; border-radius: 50%;
    display: flex; align-items: center; justify-content: center; color: #000; padding: 0;
    --mdc-icon-size: 24px;
  }
  #buttons.dark button { color: #fff; }
  #buttons button:hover { background: rgba(127,127,127,.2); }
  #buttons button:focus-visible { outline: 2px solid var(--primary-color); }

  /* Markers: ha-entity-marker (floating) and the cluster bubble */
  .pin { display: flex; flex-direction: column; align-items: center; filter: var(--cluster-shadow); cursor: pointer; }
  .pin .frame {
    width: 44px; height: 44px; border-radius: 50%; overflow: hidden; position: relative; z-index: 1;
    border: 3px solid var(--pin-color, var(--card-background-color, #fff));
    background: var(--card-background-color, #fff); color: var(--primary-text-color);
    display: flex; align-items: center; justify-content: center; font-weight: 500;
  }
  .pin.approx .frame { border-style: dashed; opacity: .85; }
  .pin .frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .pin .tail {
    width: 12px; height: 12px; margin-top: -6px; margin-bottom: 3px; border-radius: 2px;
    background: var(--pin-color, var(--card-background-color, #fff)); transform: rotate(45deg);
  }
  .pin .dot { width: 10px; height: 10px; margin-top: 4px; border-radius: 50%; background: var(--pin-color, #fff); }
  .bubble { display: flex; flex-direction: column; align-items: center; isolation: isolate; filter: var(--cluster-shadow); cursor: pointer; }
  .bubble .body {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 4px; padding: 6px;
    max-width: 148px; border-radius: 14px; background: var(--card-background-color, #fff);
  }
  .bubble .mini {
    width: 32px; height: 32px; border-radius: 50%; overflow: hidden; flex: none;
    border: 2px solid var(--pin-color); background: var(--ha-color-fill-neutral-quiet-resting, #eee);
    display: flex; align-items: center; justify-content: center; font-size: 12px;
    color: var(--primary-text-color); font-weight: 500;
  }
  .bubble .mini img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .bubble .tail { width: 10px; height: 10px; margin-top: -5px; border-radius: 2px;
    background: var(--card-background-color, #fff); transform: rotate(45deg); position: relative; z-index: -1; }
  .zone-circle {
    width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    border: 2px solid var(--card-background-color, #fff); box-shadow: var(--ha-box-shadow-s, 0 1px 3px rgba(0,0,0,.3));
    overflow: hidden; font-size: var(--ha-font-size-s, 12px); font-weight: 500; --mdc-icon-size: 22px;
    transition: opacity 150ms;
  }
  .zone-circle.hidden { opacity: 0; pointer-events: none; }

  /* Overview panel: a floating card on desktop ... */
  #overview {
    position: absolute; z-index: 3; top: var(--ha-space-3, 12px); inset-inline-start: var(--ha-space-3, 12px);
    width: min(360px, calc(100% - 2 * var(--ha-space-3, 12px))); max-height: calc(100% - 2 * var(--ha-space-3, 12px));
    display: flex; flex-direction: column; padding: var(--ha-space-3, 12px);
    border-radius: var(--ha-border-radius-xl, 16px); background: var(--card-background-color);
    color: var(--primary-text-color); box-shadow: var(--ha-box-shadow-m, 0 4px 12px rgba(0,0,0,.25));
  }
  #handle { display: none; }
  .tabs { position: relative; flex: none; padding: var(--ha-space-1, 4px);
    border-radius: var(--ha-border-radius-lg, 12px); background: var(--ha-color-fill-neutral-quiet-resting, rgba(127,127,127,.12)); }
  .tablist { display: flex; gap: var(--ha-space-1, 4px); }
  .tabs .pill {
    position: absolute; inset-block: var(--ha-space-1, 4px);
    --seg: calc((100% - (var(--tab-count) + 1) * var(--ha-space-1, 4px)) / var(--tab-count));
    inset-inline-start: calc(var(--ha-space-1, 4px) + var(--tab-index) * (var(--seg) + var(--ha-space-1, 4px)));
    width: var(--seg); border-radius: calc(var(--ha-border-radius-lg, 12px) - var(--ha-space-1, 4px));
    background: var(--card-background-color); box-shadow: var(--ha-box-shadow-s, 0 1px 3px rgba(0,0,0,.2));
    transition: inset-inline-start 200ms ease;
  }
  .tabs button {
    position: relative; flex: 1; border: none; margin: 0; padding: var(--ha-space-2, 8px) var(--ha-space-3, 12px);
    background: none; cursor: pointer; font: inherit; font-size: var(--ha-font-size-m, 14px);
    font-weight: var(--ha-font-weight-medium, 500); color: var(--secondary-text-color); transition: color 180ms ease-in-out;
    border-radius: calc(var(--ha-border-radius-lg, 12px) - var(--ha-space-1, 4px));
  }
  .tabs button[aria-selected="true"] { color: var(--primary-text-color); }
  .tabs button:focus-visible { outline: 2px solid var(--primary-color); outline-offset: -2px; }
  @media (prefers-reduced-motion: reduce) { .tabs .pill { transition: none; } }

  .actions { flex: none; display: flex; flex-wrap: wrap; gap: 4px; margin-top: var(--ha-space-2, 8px); }
  .chip {
    font: inherit; font-size: var(--ha-font-size-s, 12px); cursor: pointer; padding: 4px 10px;
    border-radius: var(--ha-border-radius-pill, 999px); border: none; color: var(--secondary-text-color);
    background: var(--ha-color-fill-neutral-quiet-resting, rgba(127,127,127,.12));
  }
  .chip:hover { color: var(--primary-text-color); }
  .chip.on { background: var(--primary-color); color: var(--text-primary-color, #fff); }

  .list { flex: 1; min-height: 0; overflow-y: auto; margin-top: var(--ha-space-2, 8px); }
  .row {
    display: flex; align-items: center; gap: var(--ha-space-3, 12px); width: 100%; border: none; background: none;
    font: inherit; color: inherit; text-align: start; cursor: pointer; padding: var(--ha-space-2, 8px);
    border-radius: var(--ha-border-radius-lg, 12px);
  }
  .row:hover, .row:focus-visible { background: var(--ha-color-fill-neutral-quiet-resting, rgba(127,127,127,.12)); outline: none; }
  .avatar {
    --avatar-size: 48px; position: relative; flex: none; width: var(--avatar-size); height: var(--avatar-size);
    border-radius: var(--ha-border-radius-lg, 12px); display: flex; align-items: center; justify-content: center;
    background: var(--ha-color-fill-neutral-quiet-resting, rgba(127,127,127,.12)); color: var(--secondary-text-color);
    font-weight: 500; box-shadow: 0 0 0 0 transparent; transition: box-shadow 150ms;
  }
  .avatar img { width: 100%; height: 100%; object-fit: cover; border-radius: inherit; display: block; }
  .row[aria-checked="true"] .avatar { box-shadow: 0 0 0 3px var(--trail-color); }
  .row[aria-checked="false"] .avatar { opacity: .55; }
  .texts { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .name { font-weight: var(--ha-font-weight-medium, 500); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { color: var(--secondary-text-color); font-size: var(--ha-font-size-s, 12px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .swatch { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--trail-color); opacity: 0; }
  .row[aria-checked="true"] .swatch { opacity: 1; }
  .empty { color: var(--secondary-text-color); font-size: var(--ha-font-size-s, 12px); padding: var(--ha-space-3, 12px); }

  .range {
    flex: none; margin-top: var(--ha-space-2, 8px); padding: var(--ha-space-3, 12px);
    border-radius: var(--ha-border-radius-lg, 12px); background: var(--ha-color-fill-neutral-quiet-resting, rgba(127,127,127,.12));
  }
  .range .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: var(--ha-space-2, 8px); }
  .range .range-chip:not(.on) { background: var(--card-background-color); }
  .range-head {
    display: flex; align-items: center; width: 100%; gap: 8px; border: none; background: none; padding: 0;
    font: inherit; color: var(--primary-text-color); cursor: pointer; text-align: start;
    font-weight: var(--ha-font-weight-medium, 500);
  }
  .range-head .label { flex: 1; }
  .range-head .hint { font-weight: 400; color: var(--secondary-text-color); font-size: var(--ha-font-size-s, 12px); }
  .range-head ha-icon { --mdc-icon-size: 20px; transition: transform 200ms; }
  .range:not(.open) .range-head ha-icon { transform: rotate(-90deg); }
  .range-body { margin-top: var(--ha-space-3, 12px); }
  .range:not(.open) .range-body { display: none; }
  .summary { display: none; }
  .dates { display: flex; flex-wrap: wrap; gap: var(--ha-space-2, 8px); }
  .dates label { flex: 1 1 130px; display: flex; flex-direction: column; gap: 4px;
    font-size: var(--ha-font-size-s, 12px); color: var(--secondary-text-color); }
  .dates input {
    font: inherit; font-size: var(--ha-font-size-m, 14px); padding: 6px 8px; min-width: 0; width: 100%;
    border-radius: var(--ha-border-radius-md, 8px); border: 1px solid var(--divider-color);
    background: var(--card-background-color); color: var(--primary-text-color); color-scheme: light dark;
  }
  .refresh {
    margin-top: var(--ha-space-3, 12px); width: 100%; font: inherit; font-weight: 500; cursor: pointer; border: none;
    padding: 10px; border-radius: var(--ha-border-radius-pill, 999px); background: var(--primary-color);
    color: var(--text-primary-color, #fff);
  }
  .status { flex: none; margin-top: var(--ha-space-2, 8px); min-height: 1.2em; padding: 0 var(--ha-space-2, 8px);
    font-size: var(--ha-font-size-s, 12px); color: var(--secondary-text-color); }

  /* ... and a bottom sheet on phones, as in hui-map-overview */
  @media (max-width: 600px) {
    /* Height is driven by JS (--sheet-h) so the sheet follows the finger and
       snaps to peek / half / full, like HA's ha-snap-bottom-sheet. */
    #overview {
      top: auto; bottom: 0; inset-inline-start: 0; inset-inline-end: 0; width: auto;
      height: var(--sheet-h, 50%); max-height: none; overflow: hidden;
      border-radius: var(--ha-border-radius-2xl, 24px) var(--ha-border-radius-2xl, 24px) 0 0;
      padding: var(--ha-space-7, 28px) max(var(--ha-space-3, 12px), env(safe-area-inset-right))
        max(var(--ha-space-3, 12px), env(safe-area-inset-bottom)) max(var(--ha-space-3, 12px), env(safe-area-inset-left));
      box-shadow: 0 -8px 16px rgba(0,0,0,.2); transition: height 200ms ease;
    }
    #overview.dragging { transition: none; }
    #overview[data-state="peek"] .list, #overview[data-state="peek"] .actions,
    #overview[data-state="peek"] .range, #overview[data-state="peek"] .status { display: none; }
    #overview[data-state="peek"] .summary { display: block; }
    .summary { padding: var(--ha-space-2, 8px) var(--ha-space-2, 8px) 0; color: var(--secondary-text-color);
      font-size: var(--ha-font-size-s, 12px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .range:not(.open) .range-body { display: none; }
    .list { overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
    #handle {
      display: flex; position: absolute; top: 0; left: 0; right: 0; height: 36px; align-items: center;
      justify-content: center; cursor: grab; touch-action: none; z-index: 1;
    }
    #handle::after { content: ""; width: 40px; height: 4px; border-radius: var(--ha-border-radius-md, 8px); background: var(--divider-color); }
    #handle:active::after { background: var(--secondary-text-color); }
    #buttons { top: 8px; }
  }
`;

class MapHistoryCard extends HTMLElement {
  constructor() {
    super();
    this._root = this.attachShadow({ mode: "open" });
    this._tab = "person";
    this._geo = { zones: [], lines: [], points: [] };
    this._markers = [];
    this._zoneMarkers = [];
    this._token = undefined;
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    const first = !this._config;
    this._config = config;
    if (first) {
      this._built = false;
      return;
    }
    // auto-entities re-calls setConfig whenever its roster changes: keep the DOM and map.
    if (this._built) {
      this._refreshEntityList();
      this._refreshHistory();
    }
  }

  set hass(hass) {
    const wasDark = this._dark;
    this._hass = hass;
    this._dark = Boolean(hass.themes && hass.themes.darkMode);
    if (!this._built) {
      this._build();
      return;
    }
    if (wasDark !== undefined && wasDark !== this._dark) this._applyTheme();
    this._refreshEntityList();
  }

  connectedCallback() {
    if (this._onWindowResize) window.addEventListener("resize", this._onWindowResize);
    if (this._map) {
      this._observeSize();
      window.setTimeout(() => {
        this._fitHeight();
        this._map.resize();
        this._refit();
      }, 0);
    }
  }

  disconnectedCallback() {
    if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = undefined; }
    if (this._onWindowResize) window.removeEventListener("resize", this._onWindowResize);
    window.clearTimeout(this._resizeTimer);
    window.clearTimeout(this._heightTimer);
  }

  getCardSize() { return 8; }

  // ---- build -------------------------------------------------------------

  async _build() {
    if (this._built) return;
    this._built = true;

    const saved = readStorage();
    const now = new Date();
    const hours = typeof this._config.default_hours === "number" ? this._config.default_hours : 12;
    this._selected = new Set(saved.selected || []);
    this._defaultsPending = !Array.isArray(saved.selected) || saved.selected.length === 0;
    // `spread` is the stored name of the grouping toggle (bubbles for overlapping people).
    this._group = saved.spread !== false;
    // The range is NOT restored: a persisted window goes stale the moment the tab closes.
    this._start = toLocalInputValue(new Date(now.getTime() - hours * 3600 * 1000));
    this._end = toLocalInputValue(now);
    this._rangeHours = hours;

    this._root.innerHTML =
      "<style>" + STYLES + "</style>" +
      '<link rel="stylesheet" href="' + MAPLIBRE_CSS + '">' +
      "<ha-card>" +
      '  <div id="map"></div>' +
      '  <div id="buttons"></div>' +
      '  <div id="overview">' +
      '    <div id="handle" role="button" tabindex="0" aria-label="Paneel omhoog of omlaag"></div>' +
      '    <div class="tabs" role="tablist" style="--tab-count:2;--tab-index:0">' +
      '      <div class="pill"></div>' +
      '      <div class="tablist">' +
      '        <button role="tab" data-tab="person" aria-selected="true">Mensen</button>' +
      '        <button role="tab" data-tab="device_tracker" aria-selected="false">Apparaten</button>' +
      "      </div>" +
      "    </div>" +
      '    <div class="actions">' +
      '      <button class="chip" data-act="all">alles</button>' +
      '      <button class="chip" data-act="none">geen</button>' +
      '      <button class="chip" data-act="default">standaard</button>' +
      '      <button class="chip" data-act="invert">omkeren</button>' +
      "    </div>" +
      '    <div class="list" role="group"></div>' +
      '    <div class="summary"></div>' +
      '    <div class="status" aria-live="polite"></div>' +
      '    <div class="range open">' +
      '      <button class="range-head" aria-expanded="true"><span class="label">Periode</span>' +
      '        <span class="hint"></span><ha-icon icon="mdi:chevron-down"></ha-icon></button>' +
      '      <div class="range-body">' +
      '        <div class="chips"></div>' +
      '        <div class="dates">' +
      '          <label>Van<input type="datetime-local" class="start"></label>' +
      '          <label>Tot<input type="datetime-local" class="end"></label>' +
      "        </div>" +
      '        <button class="refresh">Ververs</button>' +
      "      </div>" +
      "    </div>" +
      "  </div>" +
      "</ha-card>";

    const $ = (sel) => this._root.querySelector(sel);
    this._mapEl = $("#map");
    this._overviewEl = $("#overview");
    this._listEl = $(".list");
    this._statusEl = $(".status");
    this._startEl = $(".start");
    this._endEl = $(".end");
    this._buttonsEl = $("#buttons");
    this._startEl.value = this._start;
    this._endEl.value = this._end;

    this._buildButtons();
    this._buildRangeChips();
    this._wireOverview();

    this._onWindowResize = () => {
      window.clearTimeout(this._heightTimer);
      this._heightTimer = window.setTimeout(() => this._fitHeight(), 120);
    };
    window.addEventListener("resize", this._onWindowResize);

    this._refreshEntityList();
    this._fitHeight();

    if (!supportsWebGL2()) {
      this._setStatus("Deze browser ondersteunt geen WebGL2, dus de vectorkaart kan niet getekend worden.");
      return;
    }
    try {
      this._maplibre = await loadMapLibre();
    } catch (err) {
      this._setStatus(err.message);
      return;
    }
    this._initMapWhenSized();
  }

  _buildButtons() {
    this._buttonsEl.innerHTML =
      '<button class="group" aria-label="Markers groeperen"><ha-icon></ha-icon></button>' +
      '<button class="reset" aria-label="Zoom herstellen" title="Zoom herstellen"><ha-icon icon="' + MDI_RESET + '"></ha-icon></button>';
    this._groupBtn = this._buttonsEl.querySelector(".group");
    this._groupBtn.addEventListener("click", () => {
      this._group = !this._group;
      this._syncButtons();
      this._persist();
      this._drawCurrentMarkers();
    });
    this._buttonsEl.querySelector(".reset").addEventListener("click", () => this._refit());
    this._syncButtons();
  }

  _syncButtons() {
    this._buttonsEl.classList.toggle("dark", Boolean(this._dark));
    const icon = this._groupBtn.querySelector("ha-icon");
    icon.setAttribute("icon", this._group ? MDI_GROUP_ON : MDI_GROUP_OFF);
    this._groupBtn.title = this._group ? "Overlappende markers groeperen" : "Markers los tonen";
  }

  _buildRangeChips() {
    const wrap = this._root.querySelector(".range .chips");
    wrap.innerHTML = QUICK_RANGES.map(
      (r) => '<button class="chip range-chip" data-h="' + r.h + '">' + r.label + "</button>"
    ).join("");
    wrap.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-h]");
      if (!btn) return;
      const now = new Date();
      this._rangeHours = Number(btn.dataset.h);
      this._startEl.value = this._start = toLocalInputValue(new Date(now.getTime() - this._rangeHours * 3600 * 1000));
      this._endEl.value = this._end = toLocalInputValue(now);
      this._syncRangeChips();
      this._refreshHistory();
    });
    this._syncRangeChips();
  }

  _syncRangeChips() {
    this._root.querySelectorAll(".range-chip").forEach((c) =>
      c.classList.toggle("on", Number(c.dataset.h) === this._rangeHours)
    );
    this._updateSummary();
  }

  _wireOverview() {
    const $ = (sel) => this._root.querySelector(sel);
    const tabs = this._root.querySelector(".tabs");
    tabs.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-tab]");
      if (!btn) return;
      this._tab = btn.dataset.tab;
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b === btn)));
      tabs.style.setProperty("--tab-index", this._tab === "person" ? "0" : "1");
      this._listEl.scrollTop = 0;
      this._renderList();
    });
    const onDates = () => {
      this._start = this._startEl.value;
      this._end = this._endEl.value;
      this._rangeHours = undefined;
      this._syncRangeChips();
      this._refreshHistory();
    };
    this._startEl.addEventListener("change", onDates);
    this._endEl.addEventListener("change", onDates);
    $(".refresh").addEventListener("click", () => this._refreshHistory());
    this._root.querySelector(".actions").addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-act]");
      if (!btn) return;
      const ids = this._tabCandidates();
      const act = btn.dataset.act;
      if (act === "all") this._applySelection(this._merge(ids, true));
      else if (act === "none") this._applySelection(this._merge(ids, false));
      else if (act === "default") this._applySelection(this._defaultSelection(this._candidateOrder || []));
      else if (act === "invert") {
        const cur = new Set(this._selected);
        ids.forEach((id) => (cur.has(id) ? cur.delete(id) : cur.add(id)));
        this._applySelection(Array.from(cur));
      }
    });
    this._listEl.addEventListener("click", (ev) => {
      const row = ev.target.closest(".row");
      if (!row) return;
      const eid = row.dataset.entity;
      if (this._selected.has(eid)) this._selected.delete(eid);
      else this._selected.add(eid);
      row.setAttribute("aria-checked", String(this._selected.has(eid)));
      this._persist();
      this._centerOnSelectionLive();
      this._refreshHistory();
    });

    // Phone sheet: tap or flick the handle to peek/expand.
    const rangeEl = $(".range");
    $(".range-head").addEventListener("click", () => {
      const open = rangeEl.classList.toggle("open");
      $(".range-head").setAttribute("aria-expanded", String(open));
    });
    // On a phone the period starts folded away and the sheet at half height.
    if (this._isPhone()) {
      rangeEl.classList.remove("open");
      $(".range-head").setAttribute("aria-expanded", "false");
    }

    // Sheet: follows the finger, then snaps to peek / half / full.
    const handle = $("#handle");
    const ov = this._overviewEl;
    this._sheetState = "half";
    const heights = () => {
      const total = this._root.querySelector("ha-card").clientHeight;
      const tabs = this._root.querySelector(".tabs").offsetHeight;
      const peek = 36 + tabs + 44 + Math.max(0, parseFloat(getComputedStyle(ov).paddingBottom) || 0);
      return { peek, half: Math.max(peek + 120, Math.round(total * 0.5)), full: Math.round(total * 0.88) };
    };
    const setState = (state) => {
      this._sheetState = state;
      ov.dataset.state = state;
      ov.classList.remove("dragging");
      ov.style.setProperty("--sheet-h", heights()[state] + "px");
      this._onOverviewResized();
    };
    this._setSheetState = setState;
    let drag = null;
    handle.addEventListener("pointerdown", (ev) => {
      handle.setPointerCapture(ev.pointerId);
      drag = { y: ev.clientY, h: ov.getBoundingClientRect().height, t: ev.timeStamp, moved: false };
      ov.classList.add("dragging");
    });
    handle.addEventListener("pointermove", (ev) => {
      if (!drag) return;
      const dy = drag.y - ev.clientY;
      if (Math.abs(dy) > 4) drag.moved = true;
      const hs = heights();
      const h = Math.min(hs.full, Math.max(hs.peek, drag.h + dy));
      ov.style.setProperty("--sheet-h", h + "px");
      ov.dataset.state = h <= hs.peek + 20 ? "peek" : h >= hs.half ? "half" : this._sheetState;
    });
    const release = (ev) => {
      if (!drag) return;
      const hs = heights();
      const cur = ov.getBoundingClientRect().height;
      const velocity = (drag.y - ev.clientY) / Math.max(1, ev.timeStamp - drag.t); // px/ms, + = up
      const order = ["peek", "half", "full"];
      let target;
      if (!drag.moved) {
        // A tap steps to the next state, wrapping from full back to half.
        target = this._sheetState === "full" ? "half" : this._sheetState === "half" ? "full" : "half";
      } else if (Math.abs(velocity) > 0.5) {
        const i = order.indexOf(this._sheetState) + (velocity > 0 ? 1 : -1);
        target = order[Math.min(2, Math.max(0, i))];
      } else {
        target = order.reduce((best, s) => (Math.abs(hs[s] - cur) < Math.abs(hs[best] - cur) ? s : best), "half");
      }
      drag = null;
      setState(target);
    };
    handle.addEventListener("pointerup", release);
    handle.addEventListener("pointercancel", release);
    handle.addEventListener("keydown", (ev) => {
      const order = ["peek", "half", "full"];
      const i = order.indexOf(this._sheetState);
      if (ev.key === "ArrowUp") { ev.preventDefault(); setState(order[Math.min(2, i + 1)]); }
      else if (ev.key === "ArrowDown") { ev.preventDefault(); setState(order[Math.max(0, i - 1)]); }
      else if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setState(i === 2 ? "half" : "full"); }
    });
    if (this._isPhone()) setTimeout(() => setState("half"), 0);
    // Panel size drives where the map's attribution sits and how a fit is padded.
    if (window.ResizeObserver) {
      this._overviewObserver = new ResizeObserver(() => this._onOverviewResized());
      this._overviewObserver.observe(this._overviewEl);
    }
  }

  _isPhone() { return window.matchMedia("(max-width: 600px)").matches; }

  _onOverviewResized() {
    const phone = this._isPhone();
    const h = this._overviewEl.getBoundingClientRect().height;
    this._mapEl.style.setProperty("--inset-bottom", phone ? Math.round(h + 8) + "px" : "0px");
    this._updateSummary();
  }

  // The line shown when the sheet is peeking, and the period's folded hint.
  _updateSummary() {
    if (!this._overviewEl) return;
    const total = this._candidateOrder ? this._candidateOrder.length : 0;
    const range = this._rangeHours
      ? (QUICK_RANGES.find((r) => r.h === this._rangeHours) || { label: this._rangeHours + "u" }).label
      : "eigen periode";
    const s = this._root.querySelector(".summary");
    if (s) s.textContent = this._selected.size + " van " + total + " geselecteerd · " + range;
    const hint = this._root.querySelector(".range-head .hint");
    if (hint) hint.textContent = range;
  }

  _fitPadding() {
    const rect = this._overviewEl.getBoundingClientRect();
    if (this._isPhone()) return { top: 50, right: 60, left: 30, bottom: Math.round(rect.height) + 30 };
    return { top: 40, right: 70, bottom: 40, left: Math.round(rect.width) + 36 };
  }

  // ---- map ---------------------------------------------------------------

  // Core rotates the tile token every 30 min; two are live at once, so a fetch
  // every 20 min is always in time. Without one, every tile is a 403.
  async _ensureToken() {
    if (this._token) return this._token;
    const delays = [0, 400, 1000, 2000];
    for (const d of delays) {
      if (d) await new Promise((r) => window.setTimeout(r, d));
      try {
        const res = await this._hass.callWS({ type: "map_tiles/access_token" });
        this._token = res.token;
        this._startTokenRefresh();
        return this._token;
      } catch (e) {
        // retry
      }
    }
    return undefined;
  }

  _startTokenRefresh() {
    if (this._tokenTimer) return;
    this._tokenTimer = window.setInterval(async () => {
      try {
        const res = await this._hass.callWS({ type: "map_tiles/access_token" });
        this._token = res.token;
      } catch (e) {
        // keep the old one, next interval retries
      }
    }, TOKEN_REFRESH_MS);
  }

  _absolute(path) {
    return path.startsWith("/") ? location.origin + path : path;
  }

  async _loadStyle() {
    const url = STYLE_URL[this._dark ? "dark" : "light"];
    const style = await (await fetch(url)).json();
    // MapLibre resolves these in a worker with no document: they must be absolute.
    if (typeof style.glyphs === "string") style.glyphs = this._absolute(style.glyphs);
    if (Array.isArray(style.sprite)) style.sprite = style.sprite.map((s) => ({ ...s, url: this._absolute(s.url) }));
    else if (typeof style.sprite === "string") style.sprite = this._absolute(style.sprite);
    return style;
  }

  _transformRequest(url) {
    const abs = new URL(url, location.origin);
    if (!abs.pathname.startsWith(TILES_PATH + "/")) return { url: abs.href };
    // Header keeps the URL stable, so the browser's tile cache survives rotations.
    return this._token ? { url: abs.href, headers: { [TOKEN_HEADER]: this._token } } : { url: abs.href };
  }

  _initMapWhenSized() {
    if (this._map || !this._mapEl || !this._maplibre) return;
    const el = this._mapEl;
    const hasSize = () => el.clientWidth > 0 && el.clientHeight > 0;
    if (hasSize()) { this._createMap(); return; }
    if (window.ResizeObserver) {
      const pending = new ResizeObserver(() => {
        if (!hasSize()) return;
        pending.disconnect();
        this._createMap();
      });
      pending.observe(el);
    }
  }

  async _createMap() {
    if (this._map || this._creating) return;
    this._creating = true;
    try {
      await this._ensureToken();
      const style = await this._loadStyle();
      const ml = this._maplibre;
      this._map = new ml.Map({
        container: this._mapEl,
        style,
        // Only a placeholder until the first fit; HA's own home location.
        center: [
          (this._hass.config && this._hass.config.longitude) || 0,
          (this._hass.config && this._hass.config.latitude) || 20,
        ],
        zoom: 11,
        minZoom: 1,
        maxZoom: 19,
        attributionControl: { compact: true },
        transformRequest: (url) => this._transformRequest(url),
        // Tiles/zoom stranding was an issue with Leaflet's animations; MapLibre is fine.
        fadeDuration: 0,
        dragRotate: false,
        pitchWithRotate: false,
      });
      this._map.touchZoomRotate.disableRotation();
      this._isolateGestures(this._mapEl);
      this._applyThemeClass();

      // A 403 means the token rotated out from under us: grab a fresh one once.
      this._map.on("error", (ev) => {
        const status = ev && ev.error && ev.error.status;
        if (status === 403 && !this._refreshingToken) {
          this._refreshingToken = true;
          this._token = undefined;
          this._ensureToken().finally(() => { this._refreshingToken = false; this._map && this._map.triggerRepaint(); });
        }
      });
      this._map.on("style.load", () => this._installLayers());
      this._map.on("zoomend", () => { this._drawCurrentMarkers(); this._syncZoneMarkers(); });
      this._map.once("load", () => {
        this._mapEl.classList.add("drawn");
        this._onOverviewResized();
        this._observeSize();
        this._centerOnSelectionLive();
        this._refreshHistory();
      });
    } catch (err) {
      this._setStatus("Kaart laden mislukt: " + (err.message || err));
    } finally {
      this._creating = false;
    }
  }

  _applyThemeClass() {
    this._mapEl.classList.toggle("dark", Boolean(this._dark));
    this._buttonsEl.classList.toggle("dark", Boolean(this._dark));
  }

  async _applyTheme() {
    this._applyThemeClass();
    if (!this._map) return;
    try {
      this._map.setStyle(await this._loadStyle());
    } catch (e) {
      // keep the current style
    }
    this._drawCurrentMarkers();
  }

  // Layers live in the style, so they have to be re-added after every setStyle.
  _installLayers() {
    const map = this._map;
    const cardBg = this._cssVar("--card-background-color") || (this._dark ? "#1c1c1c" : "#ffffff");
    const empty = { type: "FeatureCollection", features: [] };
    ["zones", "lines", "points"].forEach((id) => {
      if (!map.getSource("mhc-" + id)) map.addSource("mhc-" + id, { type: "geojson", data: empty });
    });
    const add = (layer) => { if (!map.getLayer(layer.id)) map.addLayer(layer); };
    add({ id: "mhc-zone-fill", type: "fill", source: "mhc-zones",
      paint: { "fill-color": ["get", "color"], "fill-opacity": 0.14 } });
    add({ id: "mhc-zone-line", type: "line", source: "mhc-zones",
      paint: { "line-color": ["get", "color"], "line-width": 1.5, "line-opacity": 0.8, "line-dasharray": [3, 2] } });
    add({ id: "mhc-line-casing", type: "line", source: "mhc-lines",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": cardBg, "line-width": 7, "line-opacity": 0.85 } });
    add({ id: "mhc-line", type: "line", source: "mhc-lines",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["get", "color"], "line-width": 4 } });
    add({ id: "mhc-points", type: "circle", source: "mhc-points",
      paint: {
        "circle-radius": ["case", ["get", "start"], 7, 4],
        "circle-color": ["case", ["get", "approx"], cardBg, ["get", "color"]],
        "circle-stroke-color": ["case", ["get", "start"], cardBg, ["get", "color"]],
        "circle-stroke-width": ["case", ["get", "start"], 3, 1.5],
      } });

    if (!this._popup) this._popup = new this._maplibre.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
    if (!this._layerEventsBound) {
      this._layerEventsBound = true;
      const show = (ev) => {
        const f = ev.features && ev.features[0];
        if (!f) return;
        map.getCanvas().style.cursor = "pointer";
        this._popup.setLngLat(f.geometry.coordinates).setHTML(f.properties.tip).addTo(map);
      };
      const hide = () => { map.getCanvas().style.cursor = ""; this._popup.remove(); };
      map.on("mousemove", "mhc-points", show);
      map.on("mouseleave", "mhc-points", hide);
      map.on("click", "mhc-points", show);
      map.on("click", (ev) => {
        if (!map.queryRenderedFeatures(ev.point, { layers: ["mhc-points"] }).length) hide();
      });
    }
    this._pushGeo();
  }

  _pushGeo() {
    if (!this._map || !this._map.isStyleLoaded()) return;
    const fc = (features) => ({ type: "FeatureCollection", features });
    const set = (id, features) => {
      const src = this._map.getSource("mhc-" + id);
      if (src) src.setData(fc(features));
    };
    set("zones", this._geo.zones);
    set("lines", this._geo.lines);
    set("points", this._geo.points);
  }

  _cssVar(name) {
    return getComputedStyle(this).getPropertyValue(name).trim();
  }

  // Swipe plugins read a horizontal map drag as "next view"; stop the gesture
  // START at the map container (Leaflet's reason, same for MapLibre).
  _isolateGestures(el) {
    const swallow = (ev) => ev.stopPropagation();
    ["touchstart", "pointerdown", "mousedown"].forEach((type) => {
      el.addEventListener(type, swallow, { passive: true });
    });
  }

  _observeSize() {
    if (this._resizeObserver || !window.ResizeObserver) return;
    this._resizeObserver = new ResizeObserver(() => {
      if (!this._map) return;
      window.clearTimeout(this._resizeTimer);
      this._resizeTimer = window.setTimeout(() => { this._map.resize(); this._refit(); }, 150);
    });
    this._resizeObserver.observe(this._mapEl);
  }

  // `:host{height:100%}` collapses under auto-entities (no definite height), so
  // measure the room left in the viewport and set it explicitly.
  _fitHeight() {
    const card = this._root.querySelector("ha-card");
    if (!card) return;
    if (typeof this._config.height === "number") {
      card.style.height = this._config.height + "px";
      return;
    }
    const top = this.getBoundingClientRect().top;
    const height = Math.max(420, Math.floor(window.innerHeight - top));
    if (card.style.height === height + "px") return;
    card.style.height = height + "px";
    if (this._map) this._map.resize();
  }

  _refit() {
    if (!this._map) return;
    if (this._lastBounds) {
      this._map.fitBounds(this._lastBounds, { padding: this._fitPadding(), maxZoom: 17, duration: 0 });
    } else {
      this._centerOnSelectionLive();
    }
  }

  _setStatus(text) {
    if (this._statusEl) this._statusEl.textContent = text || "";
  }

  // ---- selection & roster -----------------------------------------------

  _persist() {
    writeStorage({ selected: Array.from(this._selected), spread: !!this._group });
  }

  _merge(ids, on) {
    const cur = new Set(this._selected);
    ids.forEach((id) => (on ? cur.add(id) : cur.delete(id)));
    return Array.from(cur);
  }

  _applySelection(entityIds) {
    this._selected = new Set(entityIds);
    this._renderList();
    this._persist();
    this._centerOnSelectionLive();
    this._refreshHistory();
  }

  _normalizedEntityIds() {
    const entities = Array.isArray(this._config.entities) ? this._config.entities : [];
    return entities
      .map((e) => (typeof e === "string" ? e : e && e.entity))
      .filter((e) => typeof e === "string" && e.length > 0);
  }

  _candidateEntities() {
    if (Array.isArray(this._config.pick_entities)) {
      return this._config.pick_entities.filter((e) => typeof e === "string" && e.length > 0);
    }
    return this._normalizedEntityIds().filter((e) => e.startsWith("person.") || e.startsWith("device_tracker."));
  }

  _defaultSelection(candidates) {
    if (Array.isArray(this._config.default_selected)) {
      return candidates.filter((eid) => this._config.default_selected.includes(eid));
    }
    const domains = Array.isArray(this._config.default_domains) ? this._config.default_domains : ["person"];
    return candidates.filter((eid) => domains.some((d) => eid.startsWith(d + ".")));
  }

  _zoneEntities() {
    if (Array.isArray(this._config.zone_entities)) return this._config.zone_entities;
    return this._normalizedEntityIds().filter((eid) => eid.startsWith("zone."));
  }

  _tabCandidates() {
    return (this._candidateOrder || []).filter((eid) => eid.startsWith(this._tab + "."));
  }

  _labelFor(entityId) {
    const st = this._hass && this._hass.states[entityId];
    return (st && st.attributes && st.attributes.friendly_name) || entityId;
  }

  _prettyState(state) {
    if (state === "home") return "Thuis";
    if (state === "not_home") return "Onderweg";
    if (state === "unavailable" || state === "unknown") return "Onbekend";
    return state;
  }

  // HA gives every entity the same color on every map, from its registry
  // position (persons then trackers share a sequence, zones have their own,
  // home is the primary color). Mirrors entity-map-colors.ts.
  async _loadColorOrder() {
    if (this._colorOrderPromise) return this._colorOrderPromise;
    this._colorOrderPromise = (async () => {
      try {
        const entries = await this._hass.callWS({ type: "config/entity_registry/list" });
        const byCreation = (a, b) => (a.created_at - b.created_at) || String(a.id).localeCompare(String(b.id));
        const dom = (d) => entries.filter((e) => e.entity_id.startsWith(d + ".")).sort(byCreation);
        const zones = dom("zone").filter((e) => e.entity_id !== HOME_ZONE);
        const people = [...dom("person"), ...dom("device_tracker")];
        const index = {};
        [zones, people].forEach((seq) => seq.forEach((e, i) => { index[e.entity_id] = i; }));
        this._colorIndex = index;
        this._renderList();
        this._refreshHistory();
      } catch (e) {
        this._colorIndex = {};
      }
    })();
    return this._colorOrderPromise;
  }

  _hash(eid) {
    let h = 5381;
    for (let i = 0; i < eid.length; i++) h = (h * 33 + eid.charCodeAt(i)) % 2147483647;
    return h;
  }

  _colorFor(eid) {
    if (eid === HOME_ZONE) return this._cssVar("--primary-color") || "#03a9f4";
    let idx = this._colorIndex && this._colorIndex[eid];
    if (idx === undefined) {
      // Registry not loaded (or YAML entity): sorted candidate order, then hash.
      const order = this._candidateOrder || [];
      const pos = order.indexOf(eid);
      idx = pos >= 0 ? pos : this._hash(eid);
    }
    const css = this._cssVar("--color-" + ((idx % COLOR_COUNT) + 1));
    return css || FALLBACK_COLORS[idx % FALLBACK_COLORS.length];
  }

  _refreshEntityList() {
    if (!this._listEl || !this._hass) return;
    if (!this._colorOrderPromise) this._loadColorOrder();
    const candidates = this._candidateEntities().slice().sort((a, b) => {
      const rank = (eid) => (eid.startsWith("person.") ? 0 : 1);
      return rank(a) - rank(b) || this._labelFor(a).localeCompare(this._labelFor(b));
    });
    this._candidateOrder = candidates;

    let defaultsJustApplied = false;
    if (this._defaultsPending && candidates.length > 0) {
      this._selected = new Set(this._defaultSelection(candidates));
      this._defaultsPending = false;
      defaultsJustApplied = true;
      this._persist();
      this._centerOnSelectionLive();
    }
    let changed = false;
    for (const sel of Array.from(this._selected)) {
      if (!candidates.includes(sel)) { this._selected.delete(sel); changed = true; }
    }
    if (changed) this._persist();

    this._renderList();
    if (defaultsJustApplied) this._refreshHistory();
  }

  // Rebuilds only when something visible changed, so the scroll position and
  // focus survive the constant hass updates.
  _renderList() {
    if (!this._listEl || !this._hass) return;
    const ids = this._tabCandidates();
    const sig = ids.map((eid) => {
      const st = this._hass.states[eid];
      return [eid, this._labelFor(eid), st && st.state, st && st.attributes && st.attributes.entity_picture,
        this._selected.has(eid), this._colorFor(eid)].join("|");
    }).join("¦") + "#" + this._tab;
    if (sig === this._listSig) return;
    this._listSig = sig;
    this._updateSummary();

    if (ids.length === 0) {
      this._listEl.innerHTML = '<div class="empty">Geen ' + (this._tab === "person" ? "personen" : "apparaten") + " gevonden.</div>";
      return;
    }
    this._listEl.innerHTML = ids.map((eid) => {
      const st = this._hass.states[eid];
      const label = this._labelFor(eid);
      const pic = st && st.attributes && st.attributes.entity_picture;
      const on = this._selected.has(eid);
      return '<button class="row" role="checkbox" aria-checked="' + on + '" data-entity="' + escapeHtml(eid) + '"' +
        ' style="--trail-color:' + this._colorFor(eid) + '">' +
        '<div class="avatar">' + (pic ? '<img src="' + escapeHtml(pic) + '" alt="">' : escapeHtml(label.slice(0, 2).toUpperCase())) + "</div>" +
        '<div class="texts"><span class="name">' + escapeHtml(label) + "</span>" +
        '<span class="sub">' + escapeHtml(st ? this._prettyState(st.state) : "") + "</span></div>" +
        '<span class="swatch"></span></button>';
    }).join("");
  }

  _centerOnSelectionLive() {
    if (!this._map || !this._hass) return;
    const pts = [];
    for (const eid of this._selected) {
      const a = this._hass.states[eid] && this._hass.states[eid].attributes;
      if (a && typeof a.latitude === "number" && typeof a.longitude === "number") pts.push([a.longitude, a.latitude]);
    }
    if (!pts.length) return;
    const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    this._map.panTo([lon, lat], { duration: 300 });
  }

  // ---- zones -------------------------------------------------------------

  // A router/WiFi tracker has no coordinates, only a state naming a zone:
  // resolve that to the zone's centre and flag it as approximate.
  _resolveZoneCoords(stateStr) {
    if (!stateStr || !this._hass) return null;
    if (["not_home", "unknown", "unavailable", "away", ""].includes(stateStr)) return null;
    const states = this._hass.states;
    for (const eid of Object.keys(states)) {
      if (!eid.startsWith("zone.")) continue;
      const a = states[eid].attributes || {};
      const matches = (eid === HOME_ZONE && stateStr === "home") || (a.friendly_name && a.friendly_name === stateStr);
      if (!matches || typeof a.latitude !== "number" || typeof a.longitude !== "number") continue;
      return { lat: a.latitude, lon: a.longitude, zone: a.friendly_name || eid };
    }
    return null;
  }

  _drawZones() {
    const ml = this._maplibre;
    this._zoneMarkers.forEach((m) => m.marker.remove());
    this._zoneMarkers = [];
    const features = [];
    const out = [];
    for (const eid of this._zoneEntities()) {
      const st = this._hass.states[eid];
      if (!st) continue;
      const a = st.attributes || {};
      if (typeof a.latitude !== "number" || typeof a.longitude !== "number") continue;
      const metres = typeof a.radius === "number" ? a.radius : 100;
      const passive = a.passive === true;
      const color = passive ? this._cssVar("--secondary-text-color") || "#888" : this._colorFor(eid);
      features.push({
        type: "Feature", properties: { color },
        geometry: { type: "Polygon", coordinates: [circlePolygon(a.latitude, a.longitude, metres, 64)] },
      });

      const el = document.createElement("div");
      el.className = "zone-circle";
      el.style.backgroundColor = color;
      el.style.color = contrastingContent(color);
      el.title = this._labelFor(eid) + " · radius " + Math.round(metres) + " m";
      if (a.icon) {
        const icon = document.createElement("ha-icon");
        icon.setAttribute("icon", a.icon);
        el.appendChild(icon);
      } else {
        const span = document.createElement("span");
        span.textContent = this._labelFor(eid).split(" ").map((p) => p[0]).join("").slice(0, 2);
        el.appendChild(span);
      }
      const marker = new ml.Marker({ element: el, anchor: "center" }).setLngLat([a.longitude, a.latitude]).addTo(this._map);
      this._zoneMarkers.push({ marker, el });

      const deg = metres / 111320;
      out.push({
        center: [a.longitude, a.latitude],
        bounds: [[a.longitude - deg / Math.cos((a.latitude * Math.PI) / 180), a.latitude - deg],
          [a.longitude + deg / Math.cos((a.latitude * Math.PI) / 180), a.latitude + deg]],
      });
    }
    this._geo.zones = features;
    this._syncZoneMarkers();
    return out;
  }

  // 24 zone icons would carpet a city-level view; show them once zoomed in.
  _syncZoneMarkers() {
    if (!this._map) return;
    const show = this._map.getZoom() >= 11.5;
    this._zoneMarkers.forEach((z) => z.el.classList.toggle("hidden", !show));
  }

  // ---- current-position markers -----------------------------------------

  _pinHtml(item) {
    const label = item.label;
    const inner = item.picture
      ? '<img src="' + escapeHtml(item.picture) + '" alt="">'
      : escapeHtml(label.slice(0, 2).toUpperCase());
    return inner;
  }

  _drawCurrentMarkers() {
    if (!this._map || !this._maplibre) return;
    this._markers.forEach((m) => m.remove());
    this._markers = [];
    const items = this._nowData || [];
    if (!items.length) return;

    const THRESHOLD = 46;
    const groups = [];
    for (const item of items) {
      const pt = this._map.project(item.ll);
      let placed = false;
      if (this._group) {
        for (const g of groups) {
          if (Math.hypot(pt.x - g.pt.x, pt.y - g.pt.y) <= THRESHOLD) { g.members.push(item); placed = true; break; }
        }
      }
      if (!placed) groups.push({ pt, ll: item.ll, members: [item] });
    }
    for (const g of groups) {
      if (g.members.length === 1) this._addPin(g.members[0]);
      else this._addBubble(g);
    }
  }

  _addPin(item) {
    const el = document.createElement("div");
    el.className = "pin" + (item.approx ? " approx" : "");
    el.style.setProperty("--pin-color", item.color);
    el.innerHTML = '<div class="frame">' + this._pinHtml(item) + '</div><div class="tail"></div><div class="dot"></div>';
    // The dot (10px, 4px gap) is what sits on the coordinate.
    const marker = new this._maplibre.Marker({ element: el, anchor: "bottom", offset: [0, 5] })
      .setLngLat(item.ll).addTo(this._map);
    this._bindMarkerTip(el, marker, item);
    this._markers.push(marker);
  }

  _addBubble(group) {
    const shown = group.members.slice(0, 4);
    const more = group.members.length - shown.length;
    const el = document.createElement("div");
    el.className = "bubble";
    el.innerHTML =
      '<div class="body">' +
      shown.map((m) => '<div class="mini" style="--pin-color:' + m.color + '">' + this._pinHtml(m) + "</div>").join("") +
      (more > 0 ? '<div class="mini" style="--pin-color:transparent">+' + more + "</div>" : "") +
      '</div><div class="tail"></div>';
    const marker = new this._maplibre.Marker({ element: el, anchor: "bottom", offset: [0, 5] })
      .setLngLat(group.ll).addTo(this._map);
    // Tooltip lists everyone in the bubble; a tap zooms in to separate them.
    const names = group.members.map((m) => escapeHtml(m.label)).join("<br>");
    el.addEventListener("mouseenter", () => this._showTip(group.ll, '<div class="tip"><b>' + names + "</b></div>"));
    el.addEventListener("mouseleave", () => this._popup && this._popup.remove());
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._popup && this._popup.remove();
      this._map.easeTo({ center: group.ll, zoom: Math.min(this._map.getZoom() + 2, 19) });
    });
    this._markers.push(marker);
  }

  _bindMarkerTip(el, marker, item) {
    const html = this._pointTooltip(item.label + " — nu", item.live, item.liveAttrs, { approx: item.approx, zone: item.zone });
    el.addEventListener("mouseenter", () => this._showTip(item.ll, html));
    el.addEventListener("mouseleave", () => this._popup && this._popup.remove());
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this._showTip(item.ll, html);
    });
  }

  _showTip(ll, html) {
    if (!this._popup) this._popup = new this._maplibre.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
    this._popup.setLngLat(ll).setHTML(html).addTo(this._map);
  }

  // Waypoint tooltip from whatever the recorder kept; every line is optional.
  _pointTooltip(title, rec, attrs, point) {
    const rows = [];
    if (point && point.approx) rows.push("~ positie via zone" + (point.zone ? " " + point.zone : "") + " (geen GPS)");
    const when = rec.last_updated || rec.last_changed || (rec.lu ? rec.lu * 1000 : null);
    if (when) {
      const d = new Date(when);
      if (!Number.isNaN(d.getTime())) {
        rows.push(d.toLocaleDateString("nl-BE", { day: "2-digit", month: "2-digit" }) + " " +
          d.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      }
    }
    const state = rec.state !== undefined ? rec.state : rec.s;
    if (state) rows.push("status: " + this._prettyState(state).toLowerCase());
    if (typeof attrs.gps_accuracy === "number") rows.push("nauwkeurigheid: ±" + Math.round(attrs.gps_accuracy) + " m");
    if (typeof attrs.speed === "number" && attrs.speed > 0) rows.push("snelheid: " + Math.round(attrs.speed * 3.6) + " km/u");
    if (typeof attrs.altitude === "number") rows.push("hoogte: " + Math.round(attrs.altitude) + " m");
    if (typeof attrs.course === "number" && attrs.course > 0) rows.push("richting: " + Math.round(attrs.course) + "°");
    if (typeof attrs.battery_level === "number") rows.push("batterij: " + Math.round(attrs.battery_level) + "%");
    if (attrs.source_type) rows.push("bron: " + attrs.source_type);
    if (typeof attrs.latitude === "number" && typeof attrs.longitude === "number") {
      rows.push(attrs.latitude.toFixed(5) + ", " + attrs.longitude.toFixed(5));
    }
    return '<div class="tip"><b>' + escapeHtml(title) + "</b><br><span>" + rows.map(escapeHtml).join("<br>") + "</span></div>";
  }

  // ---- history -----------------------------------------------------------

  async _refreshHistory() {
    if (!this._map || !this._hass || !this._maplibre) return;
    const zones = this._drawZones();
    const selected = Array.from(this._selected);

    const fitTo = (bounds) => {
      this._lastBounds = bounds;
      if (bounds) this._map.fitBounds(bounds, { padding: this._fitPadding(), maxZoom: 17, duration: 0 });
    };
    const zoneBounds = () => {
      const b = new this._maplibre.LngLatBounds();
      zones.forEach((z) => b.extend(z.bounds[0]).extend(z.bounds[1]));
      return b.isEmpty() ? null : b;
    };

    if (selected.length === 0) {
      this._geo.lines = []; this._geo.points = []; this._nowData = [];
      this._pushGeo();
      this._drawCurrentMarkers();
      this._setStatus("Kies een of meerdere personen of apparaten.");
      fitTo(zoneBounds());
      return;
    }

    const startDate = this._startEl.value ? new Date(this._startEl.value) : null;
    const endDate = this._endEl.value ? new Date(this._endEl.value) : new Date();
    if (!startDate || Number.isNaN(startDate.getTime())) { this._setStatus("Kies een geldige startdatum."); return; }
    if (endDate.getTime() <= startDate.getTime()) { this._setStatus("Einddatum moet na de startdatum liggen."); return; }

    this._setStatus("Geschiedenis laden…");
    const requestId = (this._requestId = (this._requestId || 0) + 1);

    let result;
    try {
      result = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        entity_ids: selected,
        minimal_response: false,
        no_attributes: false,
        // Default (true) drops every row whose state string is unchanged, which is
        // nearly every GPS update of a tracker sitting in "not_home".
        significant_changes_only: false,
      });
    } catch (err) {
      if (requestId !== this._requestId) return;
      this._setStatus("Kon geschiedenis niet laden: " + (err.message || err));
      return;
    }
    if (requestId !== this._requestId) return;

    const ml = this._maplibre;
    const bounds = new ml.LngLatBounds();
    const maxPoints = typeof this._config.max_points === "number" ? this._config.max_points : 300;
    const lines = [];
    const points = [];
    const nowData = [];
    let any = false;

    selected.forEach((eid) => {
      const color = this._colorFor(eid);
      const label = this._labelFor(eid);
      const records = (result && result[eid]) || [];
      const pts = [];
      for (const rec of records) {
        const attrs = rec.attributes || rec.a || {};
        if (typeof attrs.latitude === "number" && typeof attrs.longitude === "number") {
          pts.push({ ll: [attrs.longitude, attrs.latitude], rec, attrs, approx: false });
          continue;
        }
        const zone = this._resolveZoneCoords(rec.state !== undefined ? rec.state : rec.s);
        if (zone) pts.push({ ll: [zone.lon, zone.lat], rec, attrs, approx: true, zone: zone.zone });
      }
      if (pts.length) {
        any = true;
        if (pts.length > 1) {
          lines.push({ type: "Feature", properties: { color }, geometry: { type: "LineString", coordinates: pts.map((p) => p.ll) } });
        }
        // The line carries every point; only the hoverable dots are thinned.
        decimate(pts, maxPoints).forEach((p) => {
          points.push({
            type: "Feature",
            properties: { color, approx: p.approx, start: false, tip: this._pointTooltip(label, p.rec, p.attrs, p) },
            geometry: { type: "Point", coordinates: p.ll },
          });
        });
        const first = pts[0];
        points.push({
          type: "Feature",
          properties: { color, approx: false, start: true, tip: this._pointTooltip(label + " — start", first.rec, first.attrs, first) },
          geometry: { type: "Point", coordinates: first.ll },
        });
        pts.forEach((p) => bounds.extend(p.ll));
      }

      // The current position is drawn ALWAYS: someone who has not moved has no
      // trail but still needs to be on the map.
      const live = this._hass.states[eid];
      const la = (live && live.attributes) || {};
      let ll = null, approx = false, zone = null;
      if (typeof la.latitude === "number" && typeof la.longitude === "number") ll = [la.longitude, la.latitude];
      else if (live) {
        const z = this._resolveZoneCoords(live.state);
        if (z) { ll = [z.lon, z.lat]; approx = true; zone = z.zone; }
      }
      if (ll) {
        any = true;
        nowData.push({ eid, ll, color, label, approx, zone, picture: la.entity_picture, live, liveAttrs: la });
        bounds.extend(ll);
      }
    });

    this._geo.lines = lines;
    this._geo.points = points;
    this._pushGeo();
    this._nowData = nowData;
    this._drawCurrentMarkers();

    // Fit to the trail; fold a zone in only when it overlaps it, or ~24 zones
    // across several towns would squash the trail to a few pixels.
    let fit = null;
    if (!bounds.isEmpty()) {
      fit = new ml.LngLatBounds(bounds.getSouthWest(), bounds.getNorthEast());
      for (const z of zones) {
        if (bounds.contains(z.center) || (z.bounds[1][0] >= bounds.getWest() && z.bounds[0][0] <= bounds.getEast() &&
          z.bounds[1][1] >= bounds.getSouth() && z.bounds[0][1] <= bounds.getNorth())) {
          fit.extend(z.bounds[0]).extend(z.bounds[1]);
        }
      }
    } else {
      fit = zoneBounds();
    }
    fitTo(fit);
    this._setStatus(any ? "" : "Geen locatiegegevens gevonden voor deze periode.");
  }
}

customElements.define("map-history-card", MapHistoryCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "map-history-card",
  name: "Map History Card",
  description: "Multi-entity location history over a picked date/time range, in the Home Assistant 2026.10 map style.",
});
