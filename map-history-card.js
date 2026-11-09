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

// MapLibre 6.x (what HA ships) is ESM-only with a separate worker file. The build
// (scripts/build.mjs) ships maplibre-gl.mjs, maplibre-gl-worker.mjs and
// maplibre-gl.css next to this card (flat, as HACS release assets), so they are loaded
// from the card's own URL. No runtime network request leaves the Home Assistant host.
const CARD_VERSION = "0.3.1"; // x-release-please-version
const MAPLIBRE_BASE = new URL("./", import.meta.url).href;

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
// UI strings. English is the fallback for any missing key or language.
// Included: en, nl, de, fr, es, it, pt, pl, ru, zh (Simplified). To add one, copy the
// `en` block under its ISO 639-1 code; scripts/check-translations.mjs guards the keys.
// {name}-style placeholders are filled in by _t().
const STRINGS = {
  en: {
    tabPeople: "People", tabDevices: "Devices",
    all: "all", none: "none", default: "default", invert: "invert",
    period: "Period", from: "From", to: "To", refresh: "Refresh", customRange: "custom range",
    unitHour: "h", unitDay: "d", unitMeter: "m",
    handleLabel: "Move the panel up or down",
    groupOn: "Group overlapping markers", groupOff: "Show markers separately",
    resetView: "Reset view",
    home: "Home", notHome: "Away", unknown: "Unknown",
    noPeople: "No people found.", noDevices: "No devices found.",
    summary: "{n} of {total} selected · {range}",
    pickSome: "Pick one or more people or devices.",
    pickStart: "Pick a valid start date.",
    endAfterStart: "The end date must be after the start date.",
    loading: "Loading history…",
    loadFailed: "Could not load history: {msg}",
    noData: "No location data found for this period.",
    noWebGL: "This browser does not support WebGL2, so the vector map cannot be drawn.",
    maplibreFailed: "MapLibre could not be loaded (are the maplibre-gl files next to the card missing? Reinstall via Marketplace (HACS))",
    mapFailed: "Could not load the map: {msg}",
    zoneTip: "{name} · radius {m} m",
    nowTitle: "{name} — now", startTitle: "{name} — start",
    approxZone: "~ position from zone {zone} (no GPS)", approxNoZone: "~ position from zone (no GPS)",
    tipStatus: "status", tipAccuracy: "accuracy", tipSpeed: "speed", tipAltitude: "altitude",
    tipCourse: "heading", tipBattery: "battery", tipSource: "source", speedUnit: "km/h",
    retry: "Tap to retry",
  },
  nl: {
    tabPeople: "Mensen", tabDevices: "Apparaten",
    all: "alles", none: "geen", default: "standaard", invert: "omkeren",
    period: "Periode", from: "Van", to: "Tot", refresh: "Ververs", customRange: "eigen periode",
    unitHour: "u", unitDay: "d", unitMeter: "m",
    handleLabel: "Paneel omhoog of omlaag",
    groupOn: "Overlappende markers groeperen", groupOff: "Markers los tonen",
    resetView: "Zoom herstellen",
    home: "Thuis", notHome: "Onderweg", unknown: "Onbekend",
    noPeople: "Geen personen gevonden.", noDevices: "Geen apparaten gevonden.",
    summary: "{n} van {total} geselecteerd · {range}",
    pickSome: "Kies een of meerdere personen of apparaten.",
    pickStart: "Kies een geldige startdatum.",
    endAfterStart: "Einddatum moet na de startdatum liggen.",
    loading: "Geschiedenis laden…",
    loadFailed: "Kon geschiedenis niet laden: {msg}",
    noData: "Geen locatiegegevens gevonden voor deze periode.",
    noWebGL: "Deze browser ondersteunt geen WebGL2, dus de vectorkaart kan niet getekend worden.",
    maplibreFailed: "MapLibre kon niet geladen worden (ontbreken de maplibre-gl-bestanden naast de kaart? Installeer opnieuw via Marketplace (HACS))",
    mapFailed: "Kaart laden mislukt: {msg}",
    zoneTip: "{name} · straal {m} m",
    nowTitle: "{name} — nu", startTitle: "{name} — start",
    approxZone: "~ positie via zone {zone} (geen GPS)", approxNoZone: "~ positie via zone (geen GPS)",
    tipStatus: "status", tipAccuracy: "nauwkeurigheid", tipSpeed: "snelheid", tipAltitude: "hoogte",
    tipCourse: "richting", tipBattery: "batterij", tipSource: "bron", speedUnit: "km/u",
    retry: "Tik om opnieuw te proberen",
  },
  de: {
    tabPeople: "Personen", tabDevices: "Geräte", all: "alle", none: "keine", default: "Standard", invert: "umkehren",
    period: "Zeitraum", from: "Von", to: "Bis", refresh: "Aktualisieren", customRange: "eigener Zeitraum",
    unitHour: "Std", unitDay: "T", unitMeter: "m", handleLabel: "Panel nach oben oder unten bewegen",
    groupOn: "Überlappende Markierungen gruppieren", groupOff: "Markierungen einzeln anzeigen",
    resetView: "Ansicht zurücksetzen", home: "Zuhause", notHome: "Abwesend", unknown: "Unbekannt",
    noPeople: "Keine Personen gefunden.", noDevices: "Keine Geräte gefunden.",
    summary: "{n} von {total} ausgewählt · {range}", pickSome: "Wähle eine oder mehrere Personen oder Geräte.",
    pickStart: "Wähle ein gültiges Startdatum.", endAfterStart: "Das Enddatum muss nach dem Startdatum liegen.",
    loading: "Verlauf wird geladen…", loadFailed: "Verlauf konnte nicht geladen werden: {msg}",
    noData: "Keine Standortdaten für diesen Zeitraum gefunden.",
    noWebGL: "Dieser Browser unterstützt kein WebGL2, daher kann die Vektorkarte nicht dargestellt werden.",
    maplibreFailed: "MapLibre konnte nicht geladen werden (fehlen die maplibre-gl-Dateien neben der Karte? Über den Marketplace (HACS) neu installieren)",
    mapFailed: "Karte konnte nicht geladen werden: {msg}", zoneTip: "{name} · Radius {m} m",
    nowTitle: "{name} — jetzt", startTitle: "{name} — Start", approxZone: "~ Position über Zone {zone} (kein GPS)",
    approxNoZone: "~ Position über Zone (kein GPS)", tipStatus: "Status", tipAccuracy: "Genauigkeit",
    tipSpeed: "Geschwindigkeit", tipAltitude: "Höhe", tipCourse: "Richtung", tipBattery: "Akku", tipSource: "Quelle",
    speedUnit: "km/h",
    retry: "Tippen zum Wiederholen",
  },
  fr: {
    tabPeople: "Personnes", tabDevices: "Appareils", all: "tout", none: "aucun", default: "défaut",
    invert: "inverser", period: "Période", from: "Du", to: "Au", refresh: "Actualiser",
    customRange: "période personnalisée", unitHour: "h", unitDay: "j", unitMeter: "m",
    handleLabel: "Déplacer le panneau vers le haut ou le bas", groupOn: "Regrouper les marqueurs superposés",
    groupOff: "Afficher les marqueurs séparément", resetView: "Réinitialiser la vue", home: "Maison",
    notHome: "Absent", unknown: "Inconnu", noPeople: "Aucune personne trouvée.", noDevices: "Aucun appareil trouvé.",
    summary: "{n} sur {total} sélectionné(s) · {range}",
    pickSome: "Choisissez une ou plusieurs personnes ou appareils.",
    pickStart: "Choisissez une date de début valide.",
    endAfterStart: "La date de fin doit être postérieure à la date de début.", loading: "Chargement de l’historique…",
    loadFailed: "Impossible de charger l’historique : {msg}",
    noData: "Aucune donnée de localisation pour cette période.",
    noWebGL: "Ce navigateur ne prend pas en charge WebGL2 ; la carte vectorielle ne peut pas être affichée.",
    maplibreFailed: "Impossible de charger MapLibre (les fichiers maplibre-gl sont-ils absents à côté de la carte ? Réinstallez via Marketplace (HACS))",
    mapFailed: "Impossible de charger la carte : {msg}", zoneTip: "{name} · rayon {m} m",
    nowTitle: "{name} — maintenant", startTitle: "{name} — départ",
    approxZone: "~ position d’après la zone {zone} (pas de GPS)",
    approxNoZone: "~ position d’après la zone (pas de GPS)", tipStatus: "statut", tipAccuracy: "précision",
    tipSpeed: "vitesse", tipAltitude: "altitude", tipCourse: "cap", tipBattery: "batterie", tipSource: "source",
    speedUnit: "km/h",
    retry: "Touchez pour réessayer",
  },
  es: {
    tabPeople: "Personas", tabDevices: "Dispositivos", all: "todo", none: "nada", default: "predeterminado",
    invert: "invertir", period: "Periodo", from: "Desde", to: "Hasta", refresh: "Actualizar",
    customRange: "periodo personalizado", unitHour: "h", unitDay: "d", unitMeter: "m",
    handleLabel: "Subir o bajar el panel", groupOn: "Agrupar marcadores superpuestos",
    groupOff: "Mostrar marcadores por separado", resetView: "Restablecer vista", home: "Casa", notHome: "Fuera",
    unknown: "Desconocido", noPeople: "No se encontraron personas.", noDevices: "No se encontraron dispositivos.",
    summary: "{n} de {total} seleccionados · {range}", pickSome: "Elige una o varias personas o dispositivos.",
    pickStart: "Elige una fecha de inicio válida.",
    endAfterStart: "La fecha de fin debe ser posterior a la de inicio.", loading: "Cargando historial…",
    loadFailed: "No se pudo cargar el historial: {msg}",
    noData: "No se encontraron datos de ubicación para este periodo.",
    noWebGL: "Este navegador no admite WebGL2, por lo que no se puede dibujar el mapa vectorial.",
    maplibreFailed: "No se pudo cargar MapLibre (¿faltan los archivos maplibre-gl junto a la tarjeta? Reinstala desde Marketplace (HACS))",
    mapFailed: "No se pudo cargar el mapa: {msg}", zoneTip: "{name} · radio {m} m", nowTitle: "{name} — ahora",
    startTitle: "{name} — inicio", approxZone: "~ posición según la zona {zone} (sin GPS)",
    approxNoZone: "~ posición según la zona (sin GPS)", tipStatus: "estado", tipAccuracy: "precisión",
    tipSpeed: "velocidad", tipAltitude: "altitud", tipCourse: "rumbo", tipBattery: "batería", tipSource: "fuente",
    speedUnit: "km/h",
    retry: "Toca para reintentar",
  },
  it: {
    tabPeople: "Persone", tabDevices: "Dispositivi", all: "tutti", none: "nessuno", default: "predefinito",
    invert: "inverti", period: "Periodo", from: "Da", to: "A", refresh: "Aggiorna",
    customRange: "periodo personalizzato", unitHour: "h", unitDay: "g", unitMeter: "m",
    handleLabel: "Sposta il pannello in alto o in basso", groupOn: "Raggruppa i marcatori sovrapposti",
    groupOff: "Mostra i marcatori separatamente", resetView: "Reimposta la vista", home: "Casa",
    notHome: "Fuori casa", unknown: "Sconosciuto", noPeople: "Nessuna persona trovata.",
    noDevices: "Nessun dispositivo trovato.", summary: "{n} di {total} selezionati · {range}",
    pickSome: "Scegli una o più persone o dispositivi.", pickStart: "Scegli una data di inizio valida.",
    endAfterStart: "La data di fine deve essere successiva a quella di inizio.",
    loading: "Caricamento della cronologia…", loadFailed: "Impossibile caricare la cronologia: {msg}",
    noData: "Nessun dato di posizione trovato per questo periodo.",
    noWebGL: "Questo browser non supporta WebGL2, quindi la mappa vettoriale non può essere disegnata.",
    maplibreFailed: "Impossibile caricare MapLibre (mancano i file maplibre-gl accanto alla scheda? Reinstalla tramite Marketplace (HACS))",
    mapFailed: "Impossibile caricare la mappa: {msg}", zoneTip: "{name} · raggio {m} m", nowTitle: "{name} — ora",
    startTitle: "{name} — inizio", approxZone: "~ posizione dedotta dalla zona {zone} (senza GPS)",
    approxNoZone: "~ posizione dedotta dalla zona (senza GPS)", tipStatus: "stato", tipAccuracy: "precisione",
    tipSpeed: "velocità", tipAltitude: "altitudine", tipCourse: "direzione", tipBattery: "batteria",
    tipSource: "fonte", speedUnit: "km/h",
    retry: "Tocca per riprovare",
  },
  pt: {
    tabPeople: "Pessoas", tabDevices: "Dispositivos", all: "todos", none: "nenhum", default: "predefinido",
    invert: "inverter", period: "Período", from: "De", to: "Até", refresh: "Atualizar",
    customRange: "período personalizado", unitHour: "h", unitDay: "d", unitMeter: "m",
    handleLabel: "Mover o painel para cima ou para baixo", groupOn: "Agrupar marcadores sobrepostos",
    groupOff: "Mostrar marcadores separadamente", resetView: "Repor vista", home: "Casa", notHome: "Fora de casa",
    unknown: "Desconhecido", noPeople: "Nenhuma pessoa encontrada.", noDevices: "Nenhum dispositivo encontrado.",
    summary: "{n} de {total} selecionados · {range}", pickSome: "Escolha uma ou mais pessoas ou dispositivos.",
    pickStart: "Escolha uma data de início válida.",
    endAfterStart: "A data de fim tem de ser posterior à data de início.", loading: "A carregar o histórico…",
    loadFailed: "Não foi possível carregar o histórico: {msg}",
    noData: "Não foram encontrados dados de localização para este período.",
    noWebGL: "Este navegador não suporta WebGL2, por isso o mapa vetorial não pode ser desenhado.",
    maplibreFailed: "Não foi possível carregar o MapLibre (faltam os ficheiros maplibre-gl junto ao cartão? Reinstale através do Marketplace (HACS))",
    mapFailed: "Não foi possível carregar o mapa: {msg}", zoneTip: "{name} · raio {m} m", nowTitle: "{name} — agora",
    startTitle: "{name} — início", approxZone: "~ posição pela zona {zone} (sem GPS)",
    approxNoZone: "~ posição pela zona (sem GPS)", tipStatus: "estado", tipAccuracy: "precisão",
    tipSpeed: "velocidade", tipAltitude: "altitude", tipCourse: "direção", tipBattery: "bateria", tipSource: "origem",
    speedUnit: "km/h",
    retry: "Toque para tentar novamente",
  },
  pl: {
    tabPeople: "Osoby", tabDevices: "Urządzenia", all: "wszystkie", none: "żadne", default: "domyślne",
    invert: "odwróć", period: "Okres", from: "Od", to: "Do", refresh: "Odśwież", customRange: "własny okres",
    unitHour: "h", unitDay: "d", unitMeter: "m", handleLabel: "Przesuń panel w górę lub w dół",
    groupOn: "Grupuj nakładające się znaczniki", groupOff: "Pokaż znaczniki osobno", resetView: "Resetuj widok",
    home: "W domu", notHome: "Poza domem", unknown: "Nieznany", noPeople: "Nie znaleziono osób.",
    noDevices: "Nie znaleziono urządzeń.", summary: "Wybrano {n} z {total} · {range}",
    pickSome: "Wybierz jedną lub więcej osób albo urządzeń.", pickStart: "Wybierz prawidłową datę początkową.",
    endAfterStart: "Data końcowa musi być późniejsza niż początkowa.", loading: "Wczytywanie historii…",
    loadFailed: "Nie udało się wczytać historii: {msg}", noData: "Brak danych o lokalizacji dla tego okresu.",
    noWebGL: "Ta przeglądarka nie obsługuje WebGL2, więc mapa wektorowa nie może zostać narysowana.",
    maplibreFailed: "Nie udało się wczytać MapLibre (czy brakuje plików maplibre-gl obok karty? Zainstaluj ponownie przez Marketplace (HACS))",
    mapFailed: "Nie udało się wczytać mapy: {msg}", zoneTip: "{name} · promień {m} m", nowTitle: "{name} — teraz",
    startTitle: "{name} — początek", approxZone: "~ pozycja ze strefy {zone} (bez GPS)",
    approxNoZone: "~ pozycja ze strefy (bez GPS)", tipStatus: "stan", tipAccuracy: "dokładność", tipSpeed: "prędkość",
    tipAltitude: "wysokość", tipCourse: "kierunek", tipBattery: "bateria", tipSource: "źródło", speedUnit: "km/h",
    retry: "Dotknij, aby ponowić",
  },
  ru: {
    tabPeople: "Люди", tabDevices: "Устройства", all: "все", none: "ничего", default: "по умолчанию",
    invert: "инвертировать", period: "Период", from: "С", to: "По", refresh: "Обновить", customRange: "свой период",
    unitHour: "ч", unitDay: "д", unitMeter: "м", handleLabel: "Переместить панель вверх или вниз",
    groupOn: "Группировать перекрывающиеся маркеры", groupOff: "Показывать маркеры отдельно",
    resetView: "Сбросить вид", home: "Дома", notHome: "Не дома", unknown: "Неизвестно", noPeople: "Люди не найдены.",
    noDevices: "Устройства не найдены.", summary: "Выбрано {n} из {total} · {range}",
    pickSome: "Выберите одного или нескольких людей или устройств.", pickStart: "Выберите корректную дату начала.",
    endAfterStart: "Дата окончания должна быть позже даты начала.", loading: "Загрузка истории…",
    loadFailed: "Не удалось загрузить историю: {msg}", noData: "Нет данных о местоположении за этот период.",
    noWebGL: "Этот браузер не поддерживает WebGL2, поэтому векторную карту нельзя отобразить.",
    maplibreFailed: "Не удалось загрузить MapLibre (нет файлов maplibre-gl рядом с карточкой? Переустановите через Marketplace (HACS))",
    mapFailed: "Не удалось загрузить карту: {msg}", zoneTip: "{name} · радиус {m} м", nowTitle: "{name} — сейчас",
    startTitle: "{name} — начало", approxZone: "~ позиция по зоне {zone} (без GPS)",
    approxNoZone: "~ позиция по зоне (без GPS)", tipStatus: "статус", tipAccuracy: "точность", tipSpeed: "скорость",
    tipAltitude: "высота", tipCourse: "курс", tipBattery: "батарея", tipSource: "источник", speedUnit: "км/ч",
    retry: "Нажмите, чтобы повторить",
  },
  zh: {
    tabPeople: "人员", tabDevices: "设备", all: "全选", none: "全不选", default: "默认", invert: "反选", period: "时间段", from: "从",
    to: "到", refresh: "刷新", customRange: "自定义时间段", unitHour: "小时", unitDay: "天", unitMeter: "米",
    handleLabel: "上下移动面板", groupOn: "合并重叠的标记", groupOff: "单独显示标记", resetView: "重置视图", home: "在家", notHome: "离家",
    unknown: "未知", noPeople: "未找到人员。", noDevices: "未找到设备。", summary: "已选择 {n}/{total} · {range}",
    pickSome: "请选择一个或多个人员或设备。", pickStart: "请选择有效的开始日期。", endAfterStart: "结束日期必须晚于开始日期。", loading: "正在加载历史记录…",
    loadFailed: "无法加载历史记录：{msg}", noData: "此时间段内没有位置数据。", noWebGL: "此浏览器不支持 WebGL2，无法绘制矢量地图。",
    maplibreFailed: "无法加载 MapLibre（卡片旁的 maplibre-gl 文件是否缺失？请通过 Marketplace（HACS）重新安装）", mapFailed: "无法加载地图：{msg}", zoneTip: "{name} · 半径 {m} 米",
    nowTitle: "{name} — 现在", startTitle: "{name} — 起点", approxZone: "~ 根据区域 {zone} 推算的位置（无 GPS）",
    approxNoZone: "~ 根据区域推算的位置（无 GPS）", tipStatus: "状态", tipAccuracy: "精度", tipSpeed: "速度", tipAltitude: "海拔",
    tipCourse: "方向", tipBattery: "电量", tipSource: "来源", speedUnit: "km/h",
    retry: "点击重试",
  },
};

// `language` in the card config wins, then the user's HA language; the base
// code ("nl" out of "nl-BE") picks the table, the full tag formats dates.
function resolveLanguage(config, hass) {
  const raw = (config && config.language) ||
    (hass && hass.locale && hass.locale.language) || (hass && hass.language) || "en";
  const base = String(raw).toLowerCase().split("-")[0];
  return { code: STRINGS[base] ? base : "en", locale: String(raw) };
}

const QUICK_RANGES = [3, 12, 24, 72, 168].map((h) => ({ h }));

const MDI_RESET = "mdi:image-filter-center-focus";
const MDI_GROUP_ON = "mdi:google-circles-communities";
const MDI_GROUP_OFF = "mdi:dots-hexagon";

let maplibrePromise;
function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (!maplibrePromise) {
    maplibrePromise = import(MAPLIBRE_BASE + "maplibre-gl.mjs?v=" + CARD_VERSION).then((mod) => (mod.Map ? mod : mod.default)).catch(() => {
      maplibrePromise = undefined;
      throw new Error("maplibre-load-failed");
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

  /* Loading hint over the map; turns into a tap-to-retry pill when a load gives up */
  #loading:not([hidden]) {
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2;
    display: flex; align-items: center; gap: 8px; max-width: calc(100% - 120px); padding: 6px 12px;
    border-radius: var(--ha-border-radius-pill, 999px); background: var(--card-background-color);
    color: var(--secondary-text-color); font-size: var(--ha-font-size-s, 12px);
    box-shadow: var(--ha-box-shadow-s, 0 1px 3px rgba(0,0,0,.2)); pointer-events: none;
  }
  #loading.retry { cursor: pointer; pointer-events: auto; }
  #loading .txt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #loading .spin {
    flex: none; width: 14px; height: 14px; box-sizing: border-box; border-radius: 50%;
    border: 2px solid var(--divider-color); border-top-color: var(--primary-color);
    animation: mhc-spin 800ms linear infinite;
  }
  @keyframes mhc-spin { to { transform: rotate(360deg); } }

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

  // Translated string with {placeholder} substitution; falls back to English.
  _t(key, vars) {
    const table = STRINGS[this._lang ? this._lang.code : "en"] || STRINGS.en;
    let text = table[key] !== undefined ? table[key] : (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (vars) for (const k of Object.keys(vars)) text = text.split("{" + k + "}").join(String(vars[k]));
    return text;
  }

  _rangeLabel(h) {
    return h % 24 === 0 && h >= 48 ? (h / 24) + this._t("unitDay") : h + this._t("unitHour");
  }

  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    const first = !this._config;
    this._config = config;
    if (this._hass) this._lang = resolveLanguage(config, this._hass);
    if (first) {
      this._built = false;
      return;
    }
    // auto-entities re-calls setConfig whenever its roster changes: keep the DOM and map.
    if (this._built) {
      this._refreshEntityList();
      this._requestRefresh();
    }
  }

  set hass(hass) {
    const wasDark = this._dark;
    this._hass = hass;
    this._lang = resolveLanguage(this._config, hass);
    this._dark = Boolean(hass.themes && hass.themes.darkMode);
    if (!this._built) {
      this._build();
      return;
    }
    if (wasDark !== undefined && wasDark !== this._dark) this._applyTheme();
    this._refreshEntityList();
    // A refresh that came too early, or a failed one once the connection is back.
    // Only on the reconnect edge: a failure while connected waits for a tap, it
    // must not re-run on every state update.
    const connected = hass.connected !== false;
    const reconnected = connected && this._wasConnected === false;
    this._wasConnected = connected;
    if (this._pendingRefresh || (this._lastFailed && reconnected)) this._requestRefresh();
  }

  connectedCallback() {
    window.clearTimeout(this._teardownTimer);
    this._teardownTimer = undefined;
    if (this._onWindowResize) window.addEventListener("resize", this._onWindowResize);
    if (this._map) {
      this._observeSize();
      window.setTimeout(() => {
        this._fitHeight();
        this._map.resize();
        this._refit();
      }, 0);
    } else if (this._maplibre) {
      // Torn down while detached (see disconnectedCallback): build it again.
      this._initMapWhenSized();
    }
  }

  disconnectedCallback() {
    if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = undefined; }
    if (this._onWindowResize) window.removeEventListener("resize", this._onWindowResize);
    window.clearTimeout(this._resizeTimer);
    window.clearTimeout(this._heightTimer);
    // Detached for a while (auto-entities re-rendering, a background tab): free
    // the WebGL context. connectedCallback cancels this if the card comes back.
    window.clearTimeout(this._teardownTimer);
    this._teardownTimer = window.setTimeout(() => {
      this._teardownTimer = undefined;
      this._teardownMap();
    }, 10000);
  }

  _teardownMap() {
    if (!this._map) return;
    this._map.remove();
    this._map = undefined;
    this._mapLoaded = false;
    this._layersReady = false;
    this._popup = undefined;
    this._layerEventsBound = false;
    this._markers = [];
    this._zoneMarkers = [];
    window.clearInterval(this._tokenTimer);
    this._tokenTimer = undefined;
    this._mapEl.classList.remove("drawn");
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
      '<link rel="stylesheet" data-maplibre-css>' +
      "<ha-card>" +
      '  <div id="map"></div>' +
      '  <div id="buttons"></div>' +
      '  <div id="loading" hidden></div>' +
      '  <div id="overview">' +
      '    <div id="handle" role="button" tabindex="0" aria-label="' + this._t("handleLabel") + '"></div>' +
      '    <div class="tabs" role="tablist" style="--tab-count:2;--tab-index:0">' +
      '      <div class="pill"></div>' +
      '      <div class="tablist">' +
      '        <button role="tab" data-tab="person" aria-selected="true">' + this._t("tabPeople") + '</button>' +
      '        <button role="tab" data-tab="device_tracker" aria-selected="false">' + this._t("tabDevices") + '</button>' +
      "      </div>" +
      "    </div>" +
      '    <div class="actions">' +
      '      <button class="chip" data-act="all">' + this._t("all") + '</button>' +
      '      <button class="chip" data-act="none">' + this._t("none") + '</button>' +
      '      <button class="chip" data-act="default">' + this._t("default") + '</button>' +
      '      <button class="chip" data-act="invert">' + this._t("invert") + '</button>' +
      "    </div>" +
      '    <div class="list" role="group"></div>' +
      '    <div class="summary"></div>' +
      '    <div class="status" aria-live="polite"></div>' +
      '    <div class="range open">' +
      '      <button class="range-head" aria-expanded="true"><span class="label">' + this._t("period") + '</span>' +
      '        <span class="hint"></span><ha-icon icon="mdi:chevron-down"></ha-icon></button>' +
      '      <div class="range-body">' +
      '        <div class="chips"></div>' +
      '        <div class="dates">' +
      '          <label>' + this._t("from") + '<input type="datetime-local" class="start"></label>' +
      '          <label>' + this._t("to") + '<input type="datetime-local" class="end"></label>' +
      "        </div>" +
      '        <button class="refresh">' + this._t("refresh") + '</button>' +
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
    this._loadingEl = $("#loading");
    // Tap (or Enter) on the pill only does something in the retry state.
    const retryTap = (ev) => {
      if (ev.type === "keydown" && ev.key !== "Enter" && ev.key !== " ") return;
      if (!this._loadingEl.classList.contains("retry")) return;
      ev.preventDefault();
      this._lastFailed = false;
      this._requestRefresh();
    };
    this._loadingEl.addEventListener("click", retryTap);
    this._loadingEl.addEventListener("keydown", retryTap);
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
      this._setStatus(this._t("noWebGL"));
      return;
    }
    try {
      this._maplibre = await loadMapLibre();
      this._root.querySelector("link[data-maplibre-css]").href = MAPLIBRE_BASE + "maplibre-gl.css?v=" + CARD_VERSION;
    } catch (err) {
      this._setStatus(this._t("maplibreFailed"));
      return;
    }
    this._initMapWhenSized();
  }

  _buildButtons() {
    this._buttonsEl.innerHTML =
      '<button class="group"><ha-icon></ha-icon></button>' +
      '<button class="reset" aria-label="' + this._t("resetView") + '" title="' + this._t("resetView") + '"><ha-icon icon="' + MDI_RESET + '"></ha-icon></button>';
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
    const groupLabel = this._t(this._group ? "groupOn" : "groupOff");
    this._groupBtn.title = groupLabel;
    this._groupBtn.setAttribute("aria-label", groupLabel);
  }

  _buildRangeChips() {
    const wrap = this._root.querySelector(".range .chips");
    wrap.innerHTML = QUICK_RANGES.map(
      (r) => '<button class="chip range-chip" data-h="' + r.h + '">' + this._rangeLabel(r.h) + "</button>"
    ).join("");
    wrap.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-h]");
      if (!btn) return;
      const now = new Date();
      this._rangeHours = Number(btn.dataset.h);
      this._startEl.value = this._start = toLocalInputValue(new Date(now.getTime() - this._rangeHours * 3600 * 1000));
      this._endEl.value = this._end = toLocalInputValue(now);
      this._syncRangeChips();
      this._requestRefresh();
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
      this._requestRefresh();
    };
    this._startEl.addEventListener("change", onDates);
    this._endEl.addEventListener("change", onDates);
    $(".refresh").addEventListener("click", () => this._requestRefresh());
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
      this._defaultsPending = false;
      row.setAttribute("aria-checked", String(this._selected.has(eid)));
      this._persist();
      this._centerOnSelectionLive();
      this._requestRefresh();
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
    const range = this._rangeHours ? this._rangeLabel(this._rangeHours) : this._t("customRange");
    const s = this._root.querySelector(".summary");
    if (s) s.textContent = this._t("summary", { n: this._selected.size, total, range });
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
        this._mapLoaded = true;
        this._onOverviewResized();
        this._observeSize();
        this._centerOnSelectionLive();
        this._requestRefresh();
      });
    } catch (err) {
      this._setStatus(this._t("mapFailed", { msg: err.message || err }));
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
      const style = await this._loadStyle();
      // diff:false replaces every source and layer (a diff would keep ours
      // without firing style.load), so the style.load handler re-adds them.
      this._layersReady = false;
      this._map.setStyle(style, { diff: false });
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
    this._layersReady = true;
    if (this._pendingRefresh || this._lastFailed) this._requestRefresh();
  }

  // Not gated on isStyleLoaded(): that stays false while tiles load, which used
  // to drop the data for good. Missing sources mean the data is pushed later.
  _pushGeo() {
    if (!this._map) return;
    const fc = (features) => ({ type: "FeatureCollection", features });
    const ids = ["zones", "lines", "points"];
    const srcs = ids.map((id) => this._map.getSource("mhc-" + id));
    if (srcs.some((src) => !src)) { this._geoDirty = true; return; }
    ids.forEach((id, i) => srcs[i].setData(fc(this._geo[id])));
    this._geoDirty = false;
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

  // Floating pill over the map: a spinner while a load is (re)trying.
  _showLoading(on, attempt) {
    const el = this._loadingEl;
    if (!el) return;
    el.classList.remove("retry");
    el.removeAttribute("role");
    el.removeAttribute("tabindex");
    el.hidden = !on;
    if (!on) { el.textContent = ""; return; }
    el.innerHTML = '<span class="spin"></span><span class="txt"></span>';
    el.querySelector(".txt").textContent = this._t("loading") + (attempt > 1 ? " (" + attempt + ")" : "");
  }

  // The same pill, as a tap target, once the load has given up.
  _showRetry(msg) {
    const el = this._loadingEl;
    if (!el) return;
    el.innerHTML = '<span class="txt"></span>';
    el.querySelector(".txt").textContent = this._t("loadFailed", { msg }) + " · " + this._t("retry");
    el.classList.add("retry");
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.hidden = false;
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
    this._defaultsPending = false;
    this._renderList();
    this._persist();
    this._centerOnSelectionLive();
    this._requestRefresh();
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
    if (state === "home") return this._t("home");
    if (state === "not_home") return this._t("notHome");
    if (state === "unavailable" || state === "unknown") return this._t("unknown");
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
        this._requestRefresh();
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

    // Until a real roster exists (auto-entities first hands over a one-entry
    // placeholder) there is nothing to judge a selection against: pruning now
    // would wipe the saved selection and persist it empty.
    let defaultsJustApplied = false;
    if (candidates.length > 0) {
      let changed = false;
      // Only prune against a roster that looks real: a one-entry placeholder
      // must not wipe the saved selection (it would be persisted empty), and
      // neither may an empty hass.states (not loaded yet: every entity looks gone).
      // Entities that no longer exist at all are always dropped.
      const states = this._hass.states || {};
      const haveStates = Object.keys(states).length > 0;
      for (const sel of haveStates ? Array.from(this._selected) : []) {
        const gone = !states[sel];
        if (gone || (candidates.length > 1 && !candidates.includes(sel))) { this._selected.delete(sel); changed = true; }
      }
      // Pruning emptied the selection (everything saved left the roster): fall
      // back to the defaults. Only then -- a deliberate "geen" is also empty
      // and must stay empty.
      if (changed && this._selected.size === 0) this._defaultsPending = true;
      if (this._defaultsPending) {
        const defaults = this._defaultSelection(candidates);
        // Stay pending (until the user touches the selection) so a later,
        // fuller roster still adds the rest of the defaults.
        const same = defaults.length === this._selected.size && defaults.every((d) => this._selected.has(d));
        if (defaults.length > 0 && !same) {
          this._selected = new Set(defaults);
          defaultsJustApplied = true;
          changed = true;
          this._centerOnSelectionLive();
        }
      }
      if (changed) this._persist();
    }

    this._renderList();
    if (defaultsJustApplied) this._requestRefresh();
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
      this._listEl.innerHTML = '<div class="empty">' + this._t(this._tab === "person" ? "noPeople" : "noDevices") + "</div>";
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
      el.title = this._t("zoneTip", { name: this._labelFor(eid), m: Math.round(metres) });
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
    const html = this._pointTooltip(this._t("nowTitle", { name: item.label }), item.live, item.liveAttrs, { approx: item.approx, zone: item.zone });
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
    if (point && point.approx) rows.push(point.zone ? this._t("approxZone", { zone: point.zone }) : this._t("approxNoZone"));
    const when = rec.last_updated || rec.last_changed || (rec.lu ? rec.lu * 1000 : null);
    if (when) {
      const d = new Date(when);
      if (!Number.isNaN(d.getTime())) {
        rows.push(d.toLocaleDateString(this._lang.locale, { day: "2-digit", month: "2-digit" }) + " " +
          d.toLocaleTimeString(this._lang.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      }
    }
    const state = rec.state !== undefined ? rec.state : rec.s;
    if (state) rows.push(this._t("tipStatus") + ": " + this._prettyState(state).toLowerCase());
    if (typeof attrs.gps_accuracy === "number") rows.push(this._t("tipAccuracy") + ": ±" + Math.round(attrs.gps_accuracy) + " " + this._t("unitMeter"));
    if (typeof attrs.speed === "number" && attrs.speed > 0) rows.push(this._t("tipSpeed") + ": " + Math.round(attrs.speed * 3.6) + " " + this._t("speedUnit"));
    if (typeof attrs.altitude === "number") rows.push(this._t("tipAltitude") + ": " + Math.round(attrs.altitude) + " " + this._t("unitMeter"));
    if (typeof attrs.course === "number" && attrs.course > 0) rows.push(this._t("tipCourse") + ": " + Math.round(attrs.course) + "°");
    if (typeof attrs.battery_level === "number") rows.push(this._t("tipBattery") + ": " + Math.round(attrs.battery_level) + "%");
    if (attrs.source_type) rows.push(this._t("tipSource") + ": " + attrs.source_type);
    if (typeof attrs.latitude === "number" && typeof attrs.longitude === "number") {
      rows.push(attrs.latitude.toFixed(5) + ", " + attrs.longitude.toFixed(5));
    }
    return '<div class="tip"><b>' + escapeHtml(title) + "</b><br><span>" + rows.map(escapeHtml).join("<br>") + "</span></div>";
  }

  // ---- history -----------------------------------------------------------

  // Everything a draw needs: the map, its load, the layers, a real roster.
  _isReady() {
    return Boolean(this._map && this._mapLoaded && this._layersReady && this._hass &&
      Object.keys(this._hass.states || {}).length > 0 && this._candidateOrder !== undefined);
  }

  // Asks for a history refresh. Before the map is ready the request is kept
  // (pending) and run once it is; bursts collapse into one run.
  _requestRefresh() {
    this._pendingRefresh = true;
    if (!this._isReady()) return;
    window.clearTimeout(this._refreshTimer);
    this._refreshTimer = window.setTimeout(() => {
      this._refreshTimer = undefined;
      this._pendingRefresh = false;
      this._refreshHistory();
    }, 50);
  }

  // history_during_period can fail or come back empty while the connection is
  // flapping. Retry with backoff; the last attempt's outcome is used as is.
  async _fetchHistory(params, requestId) {
    const delays = this._retryDelays || [1000, 2000, 4000];
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0) {
        if (requestId !== this._requestId) return null;
        this._showLoading(true, attempt + 1);
        await new Promise((r) => window.setTimeout(r, delays[attempt - 1]));
        if (requestId !== this._requestId) return null;
      }
      const last = attempt >= delays.length;
      let result;
      try {
        result = await this._hass.callWS(params);
      } catch (err) {
        if (last) throw err;
        continue;
      }
      if (last || !this._historyMissing(result, params.entity_ids)) return result;
    }
  }

  // Nothing back for any selected entity, while HA already knows a live
  // position for one of them: the response was lost, not the history empty.
  _historyMissing(result, selected) {
    if (this._hass.connected === false) return false;
    if (selected.some((eid) => result && result[eid] && result[eid].length)) return false;
    return selected.some((eid) => {
      const a = this._hass.states[eid] && this._hass.states[eid].attributes;
      return Boolean(a && typeof a.latitude === "number" && typeof a.longitude === "number");
    });
  }

  // Which mhc-* sources are missing, or hold other than this._geo says.
  async _geoMismatch() {
    let missing = false;
    let stale = false;
    for (const id of ["zones", "lines", "points"]) {
      const src = this._map.getSource("mhc-" + id);
      if (!src) { missing = true; continue; }
      try {
        const data = await src.getData();
        if (((data && data.features) || []).length !== this._geo[id].length) stale = true;
      } catch (e) {
        stale = true;
      }
    }
    return { missing, stale };
  }

  // After a draw, check the sources really hold this._geo (a style swap or a
  // lost setData leaves them empty). Repairs once, then gives up quietly.
  async _verifyDraw(requestId) {
    await new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 1500);
      this._map.once("idle", () => { window.clearTimeout(timer); resolve(); });
    });
    if (requestId !== this._requestId || !this._map) return;
    let state = await this._geoMismatch();
    if (!state.missing && !state.stale) { this._verifyRetried = false; return; }
    this._pushGeo();
    state = await this._geoMismatch();
    if (!state.missing && !state.stale) { this._verifyRetried = false; return; }
    if (state.missing) { this._layersReady = false; this._installLayers(); }
    if (!this._verifyRetried) {
      this._verifyRetried = true;
      this._requestRefresh();
    }
  }

  async _refreshHistory() {
    // Bumped before any early return, so an older request still in flight can
    // never land on top of a newer selection (or an empty one).
    const requestId = (this._requestId = (this._requestId || 0) + 1);
    this._showLoading(false);
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
      this._setStatus(this._t("pickSome"));
      fitTo(zoneBounds());
      return;
    }

    const startDate = this._startEl.value ? new Date(this._startEl.value) : null;
    const endDate = this._endEl.value ? new Date(this._endEl.value) : new Date();
    if (!startDate || Number.isNaN(startDate.getTime())) { this._setStatus(this._t("pickStart")); return; }
    if (endDate.getTime() <= startDate.getTime()) { this._setStatus(this._t("endAfterStart")); return; }

    this._setStatus(this._t("loading"));

    const params = {
      type: "history/history_during_period",
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
      entity_ids: selected,
      minimal_response: false,
      no_attributes: false,
      // Default (true) drops every row whose state string is unchanged, which is
      // nearly every GPS update of a tracker sitting in "not_home".
      significant_changes_only: false,
    };
    let result;
    try {
      result = await this._fetchHistory(params, requestId);
    } catch (err) {
      if (requestId !== this._requestId) return;
      this._lastFailed = true;
      this._setStatus(this._t("loadFailed", { msg: err.message || err }));
      this._showRetry(err.message || err);
      return;
    }
    if (requestId !== this._requestId || result === null) return;
    this._lastFailed = false;
    this._showLoading(false);

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
          properties: { color, approx: false, start: true, tip: this._pointTooltip(this._t("startTitle", { name: label }), first.rec, first.attrs, first) },
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
    this._setStatus(any ? "" : this._t("noData"));
    this._verifyDraw(requestId);
  }
}

customElements.define("map-history-card", MapHistoryCard);
console.info("%c MAP-HISTORY-CARD %c v" + CARD_VERSION + " ", "color:#fff;background:#03a9f4;font-weight:700", "color:#03a9f4;background:#fff;font-weight:700");
window.customCards = window.customCards || [];
window.customCards.push({
  type: "map-history-card",
  name: "Map History Card",
  description: "Multi-entity location history over a picked date/time range, in the Home Assistant 2026.10 map style.",
});
