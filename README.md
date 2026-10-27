# Map History Card

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://hacs.xyz)
[![Validate](https://github.com/Coollision/map-history-card/actions/workflows/validate.yml/badge.svg)](https://github.com/Coollision/map-history-card/actions/workflows/validate.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

A Lovelace card that draws the **location history of several people and trackers** over **any start/end date and time**, on a map styled like the one introduced in Home Assistant 2026.10.

Home Assistant's built-in map card shows where things are now, and its new overview shows a person's recent stops. It cannot draw a GPS trail over a time range you pick. This card does, for as many entities as you select.

> **Unofficial.** This is a community project. It is not affiliated with, endorsed by, or sponsored by Home Assistant, Nabu Casa or the Open Home Foundation. See [Credits and licence](#credits-and-licence).

## Features

- **Trails over a custom range.** Pick start and end, or use the 3h / 12h / 24h / 3d / 7d quick ranges. Every entity gets its own coloured trail. Hover or tap a point for time, state, accuracy, speed, altitude, bearing, battery and coordinates, wherever the tracker reports them.
- **HA 2026.10 map look.** Vector map with Home Assistant's own light and dark styles (follows your theme), floating picture markers, a shared bubble for people in the same spot, and zone circles with their icon and colour.
- **HA-style overview panel.** A floating card with *People* and *Devices* tabs on desktop, and a bottom sheet on phones that you drag between peek, half and full height.
- **Current positions always shown**, even for someone who has not moved in the selected window.
- **Router / Wi-Fi trackers handled.** Trackers that report only a zone name (no coordinates) are placed at that zone's centre and marked as approximate.
- **No helpers.** No `input_*` entities or backend setup. Your selection is remembered in the browser's `localStorage`; the date range always starts as "last N hours" so you never reopen stale dates.
- Works with [auto-entities](https://github.com/thomasloven/lovelace-auto-entities) so the picker can follow your people and trackers automatically.

## Requirements

| | |
|---|---|
| Home Assistant | **2026.10 or newer.** The card uses the vector-map tile proxy and styles added in that release. |
| Browser | WebGL2 (any current desktop or mobile browser). Without it the card shows a message instead of a map. |
| Network | The browser must reach `cdn.jsdelivr.net` once to load the MapLibre library. Map tiles are fetched through **your own** Home Assistant instance (the card never talks to anyone else's), not from the internet directly. |
| Recorder | Location history comes from the recorder, so entities need to be recorded (the default). |

## Installation

### HACS (custom repository)

This card is not in the default HACS list yet, so add it as a custom repository.

1. [![Open your Home Assistant instance and open this repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=Coollision&repository=map-history-card&category=plugin)
   or, manually: HACS → ⋮ (top right) → **Custom repositories** → repository `https://github.com/Coollision/map-history-card`, type **Dashboard** → **Add**.
2. Find **Map History Card** in HACS and click **Download**.
3. Reload the browser (hard refresh). HACS registers the resource for you; if it did not, add it under *Settings → Dashboards → ⋮ → Resources*:
   - URL: `/hacsfiles/map-history-card/map-history-card.js`
   - Type: **JavaScript module**

### Manual

1. Download `map-history-card.js` from the [latest release](https://github.com/Coollision/map-history-card/releases) (or from the `main` branch).
2. Copy it to `<config>/www/map-history-card.js`.
3. Add a dashboard resource: URL `/local/map-history-card.js`, type **JavaScript module**. Append `?v=2` (and bump it) after updates to defeat browser caching.

## Usage

The card works best in a **panel** view, where it fills the whole screen like Home Assistant's own map.

### Minimal

```yaml
views:
  - title: History
    path: history
    icon: mdi:history
    panel: true
    cards:
      - type: custom:map-history-card
        pick_entities:
          - person.alice
          - person.bob
          - device_tracker.car
          - zone.home
          - zone.work
```

`pick_entities` is the list offered in the picker. `person.*` and `device_tracker.*` entries become selectable; `zone.*` entries are drawn as zones (you can also list them under `zone_entities`).

### Automatic roster with auto-entities

Let [auto-entities](https://github.com/thomasloven/lovelace-auto-entities) hand every person, tracker and zone to the card, so new ones show up by themselves:

```yaml
views:
  - title: History
    path: history
    icon: mdi:history
    panel: true
    cards:
      - type: custom:auto-entities
        card:
          type: custom:map-history-card
          default_hours: 24
          default_selected:
            - person.alice
            - person.bob
        filter:
          include:
            - domain: person
            - domain: device_tracker
            - domain: zone
        # auto-entities requires a placeholder; the real list is injected live
        entities:
          - zone.home
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `entities` | list | | Roster injected by auto-entities. `person.*` and `device_tracker.*` become selectable, `zone.*` are drawn. |
| `pick_entities` | list | | Explicit allow-list for the picker. Overrides `entities` for people and trackers, in exactly this order. |
| `zone_entities` | list | zones in `entities` | Zones to draw. |
| `default_selected` | list | | Entities ticked the first time the card loads in a browser (and on **standaard**). |
| `default_domains` | list | `[person]` | Used when `default_selected` is not set: select every entity of these domains. |
| `default_hours` | number | `12` | Length of the initial "last N hours" window. |
| `max_points` | number | `300` | Hoverable points per trail. The drawn line always uses every point; only the dots are thinned. |
| `height` | number (px) | fills the view | Fixed card height. Leave unset in a panel view. |
| `language` | string | your HA language | Force the card's language, see [Languages](#languages). Falls back to English for unsupported ones. |

### Using the card

- **Tabs** switch between people and devices. Tap a row to show or hide that entity's trail; its ring colour is its trail colour.
- **all / none / default / invert** (*alles / geen / standaard / omkeren* in Dutch) select all, none, the default selection, or invert, within the current tab.
- **Period** holds the quick ranges and the exact start and end. Change them or press **Refresh** to reload.
- **Top-right buttons:** group or ungroup overlapping people (a bubble shows who is stacked; tap it to zoom in) and reset the view to fit the trails.
- **Phone:** drag the handle of the bottom sheet, or tap it, to move between peek, half and full height.

### Colours

Like Home Assistant's map, every entity gets a colour from the theme's `--color-1 … --color-54` sequence, in order of creation in the entity registry (people and trackers share one sequence, zones another, the home zone uses the primary colour). An entity therefore has the same colour here as on the built-in map, and unticking one never recolours the rest.

## How it works

1. The card loads [MapLibre GL JS](https://maplibre.org) 5.24 from jsDelivr.
2. It fetches Home Assistant's own style (`/static/map/light.json` or `dark.json`, picked from your theme) and asks the websocket for a tile token (`map_tiles/access_token`), refreshed every 20 minutes. Tiles are requested from your instance (`/api/map_tiles`) with that token.
3. History is fetched with `history/history_during_period` (`significant_changes_only: false`, otherwise trackers that stay in `not_home` lose nearly every GPS update) and drawn as GeoJSON layers.

## Troubleshooting

- **"MapLibre could not be loaded".** The browser could not reach `cdn.jsdelivr.net` (ad blocker, DNS filter, offline). Allow that host, or tell me and I will look at self-hosting the library.
- **Blank grey map.** Tiles are being refused, usually because the tile token is missing. Check you run Home Assistant 2026.10+, then look at the browser console and network tab for 403 responses on `/api/map_tiles/...`.
- **"This browser does not support WebGL2".** Your browser or device cannot do WebGL2. Home Assistant's own map falls back to a raster map there; this card does not.
- **Card looks stale after an update.** Hard-refresh, and bump the `?v=` on a manual resource URL.
- **No trail for a tracker.** The entity must record `latitude`/`longitude` attributes in the recorder. Router-based trackers only draw approximate zone positions.

## Languages

The card follows your Home Assistant language (Profile → Language). To force a language for one card, set `language: de` (any code below).

| Code | Language | Code | Language |
|---|---|---|---|
| `en` | English (fallback) | `pl` | Polski |
| `nl` | Nederlands | `pt` | Português (also used for `pt-BR`) |
| `de` | Deutsch | `ru` | Русский |
| `fr` | Français | `zh` | 简体中文 (Simplified Chinese) |
| `es` | Español | `it` | Italiano |

Any other language shows English, with dates and times still formatted for your locale.

The English and Dutch texts were written by the author; the other eight are machine-assisted translations that nobody has proofread natively yet. Corrections are very welcome as a pull request or issue.

**Adding or fixing a language:** in [`map-history-card.js`](map-history-card.js), copy the `en` block of the `STRINGS` table under your language code and translate the values, keeping `{placeholders}` exactly as they are. CI runs [`scripts/check-translations.mjs`](scripts/check-translations.mjs) and fails if a key or placeholder is missing, so run `node scripts/check-translations.mjs` before you push.

## Updates and releases

Versions follow [semantic versioning](https://semver.org) and are produced automatically from [conventional commits](https://www.conventionalcommits.org) (`feat:` → minor, `fix:` → patch, `feat!:` → major) by [release-please](https://github.com/googleapis/release-please). Each release attaches `map-history-card.js`, which HACS downloads, so HACS shows a normal update when a new version ships. The MapLibre version the card loads is kept current by Renovate within the 5.x line, and the GitHub Actions by Dependabot. Changes are listed in [CHANGELOG.md](CHANGELOG.md) and the [releases page](https://github.com/Coollision/map-history-card/releases).

## Known limitations

- No visual card editor yet; configure in YAML.
- No raster fallback for devices without WebGL2.
- MapLibre 5.24 is used instead of the 6.x that Home Assistant ships, because 6.x has no single-file build that a custom card can load from a CDN.

## Credits and licence

Released under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for full attribution.

- **Home Assistant frontend** (Apache-2.0): the design this card follows (overview panel, bottom sheet, markers, zone circles, colour ordering) and the tile-access protocol come from [home-assistant/frontend](https://github.com/home-assistant/frontend). The card is an independent implementation and contains none of its source files.
- **MapLibre GL JS** (BSD-3-Clause) renders the map. It is loaded from a CDN, not bundled.
- **Map style and data:** Home Assistant's map style is based on the [VersaTiles](https://versatiles.org) "colorful" style; tiles use the Shortbread schema and come from **© [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors** (ODbL). The map displays this attribution.

"Home Assistant" is a trademark of its owner and is used here only to describe compatibility.
