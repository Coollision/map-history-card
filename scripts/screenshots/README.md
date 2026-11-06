# README screenshots

`index.html` mounts the real `map-history-card.js` with a mocked `hass` (invented people, trails and zones), and `screenshots.mjs` drives headless Chrome through four views and writes them to `docs/images/`.

```sh
cd scripts/screenshots
npm install
node screenshots.mjs        # or: CHROME=/path/to/chrome node screenshots.mjs [outDir]
```

It needs Google Chrome and internet access (OpenFreeMap tiles, the MapLibre CDN copy, `@mdi/svg` icons). Nothing here talks to a real Home Assistant.
