import fs from "fs/promises";

const OVERPASS_URLS = (process.env.OVERPASS_URLS || "https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const USER_AGENT = process.env.OVERPASS_USER_AGENT || "AegeanVoicePOIBuild/1.0 (ops@aegeantaxi.com)";
const MAX_PER_TYPE = Number(process.env.POI_MAX_PER_TYPE || 600);

const AREAS = [
  { id: "mykonos", name: "Mykonos", aliases: ["mykonos"], lat: 37.4467, lng: 25.3289, radiusM: 18000 },
  { id: "santorini", name: "Santorini", aliases: ["santorini", "thira"], lat: 36.3932, lng: 25.4615, radiusM: 22000 },
  { id: "rhodes", name: "Rhodes", aliases: ["rhodes", "rodos"], lat: 36.4341, lng: 28.2176, radiusM: 45000 },
  { id: "kos", name: "Kos", aliases: ["kos"], lat: 36.8926, lng: 27.2877, radiusM: 28000 },
  { id: "corfu", name: "Corfu", aliases: ["corfu", "kerkyra"], lat: 39.6243, lng: 19.9217, radiusM: 42000 },
  { id: "heraklion", name: "Heraklion", aliases: ["heraklion", "iraklio"], lat: 35.3387, lng: 25.1442, radiusM: 28000 },
  { id: "paros", name: "Paros", aliases: ["paros"], lat: 37.0855, lng: 25.1501, radiusM: 26000 },
  { id: "milos", name: "Milos", aliases: ["milos"], lat: 36.728, lng: 24.446, radiusM: 24000 },
  { id: "athens", name: "Athens", aliases: ["athens", "athina"], lat: 37.9838, lng: 23.7275, radiusM: 38000 },
  { id: "tinos", name: "Tinos", aliases: ["tinos"], lat: 37.539, lng: 25.1633, radiusM: 21000 },
  { id: "naxos", name: "Naxos", aliases: ["naxos"], lat: 37.1047, lng: 25.3761, radiusM: 30000 },
  { id: "kefalonia", name: "Kefalonia", aliases: ["kefalonia", "cephalonia"], lat: 38.1754, lng: 20.5692, radiusM: 46000 },
  { id: "kea", name: "Kea", aliases: ["kea", "tzia"], lat: 37.6167, lng: 24.3333, radiusM: 21000 },
  { id: "zakynthos", name: "Zakynthos", aliases: ["zakynthos", "zante"], lat: 37.787, lng: 20.8999, radiusM: 35000 },
  { id: "bodrum", name: "Bodrum", aliases: ["bodrum"], lat: 37.0344, lng: 27.4305, radiusM: 28000 },
  { id: "lefkada", name: "Lefkada", aliases: ["lefkada", "lefkas"], lat: 38.8303, lng: 20.7044, radiusM: 36000 },
];

const TYPE_RULES = [
  { type: "airport", test: (t) => t.aeroway === "aerodrome" || t.aeroway === "terminal" },
  { type: "port", test: (t) => t.amenity === "ferry_terminal" || t.harbour === "yes" || t.seamark_type === "harbour" || t.man_made === "pier" },
  { type: "town_center", test: (t) => ["city", "town", "village"].includes(t.place) },
  { type: "beach", test: (t) => t.natural === "beach" },
  { type: "beach_club", test: (t) => t.leisure === "beach_resort" || t.club === "beach_club" },
  { type: "hotel", test: (t) => ["hotel", "resort", "guest_house", "hostel", "apartment"].includes(t.tourism) },
  { type: "restaurant", test: (t) => t.amenity === "restaurant" || t.amenity === "fast_food" },
  { type: "bar", test: (t) => ["bar", "pub", "nightclub", "cafe"].includes(t.amenity) },
];

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickType(tags) {
  for (const rule of TYPE_RULES) {
    if (rule.test(tags)) return rule.type;
  }
  return null;
}

function getLatLng(el) {
  if (Number.isFinite(el.lat) && Number.isFinite(el.lon)) return { lat: el.lat, lng: el.lon };
  if (el.center && Number.isFinite(el.center.lat) && Number.isFinite(el.center.lon)) {
    return { lat: el.center.lat, lng: el.center.lon };
  }
  return null;
}

function toPoi(area, el) {
  const tags = el.tags || {};
  const type = pickType(tags);
  if (!type) return null;
  const coords = getLatLng(el);
  if (!coords) return null;

  const name = tags.name || tags["name:en"] || `${type} ${area.name}`;
  const id = `${area.id}_${type}_${name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return {
    id,
    type,
    name,
    lat: coords.lat,
    lng: coords.lng,
    aliases: Array.from(new Set([normalize(name), normalize(tags["name:en"]), normalize(tags["name:el"])].filter(Boolean))),
    source: "osm_overpass",
    tags,
  };
}

function dedupeAndCap(pois) {
  const typeBuckets = new Map();
  for (const poi of pois) {
    if (!typeBuckets.has(poi.type)) typeBuckets.set(poi.type, []);
    typeBuckets.get(poi.type).push(poi);
  }

  const out = [];
  for (const [type, list] of typeBuckets) {
    const seen = new Set();
    let count = 0;
    for (const poi of list) {
      const key = `${normalize(poi.name)}|${poi.lat.toFixed(5)}|${poi.lng.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(poi);
      count += 1;
      if (count >= MAX_PER_TYPE) break;
    }
  }
  return out;
}

async function fetchAreaPois(area) {
  const query = `[out:json][timeout:180];\n(\n  node(around:${area.radiusM},${area.lat},${area.lng})["aeroway"];\n  way(around:${area.radiusM},${area.lat},${area.lng})["aeroway"];\n  relation(around:${area.radiusM},${area.lat},${area.lng})["aeroway"];\n  node(around:${area.radiusM},${area.lat},${area.lng})["amenity"~"^(ferry_terminal|restaurant|fast_food|bar|pub|nightclub|cafe)$"];\n  way(around:${area.radiusM},${area.lat},${area.lng})["amenity"~"^(ferry_terminal|restaurant|fast_food|bar|pub|nightclub|cafe)$"];\n  relation(around:${area.radiusM},${area.lat},${area.lng})["amenity"~"^(ferry_terminal|restaurant|fast_food|bar|pub|nightclub|cafe)$"];\n  node(around:${area.radiusM},${area.lat},${area.lng})["natural"="beach"];\n  way(around:${area.radiusM},${area.lat},${area.lng})["natural"="beach"];\n  relation(around:${area.radiusM},${area.lat},${area.lng})["natural"="beach"];\n  node(around:${area.radiusM},${area.lat},${area.lng})["tourism"~"^(hotel|resort|guest_house|hostel|apartment)$"];\n  way(around:${area.radiusM},${area.lat},${area.lng})["tourism"~"^(hotel|resort|guest_house|hostel|apartment)$"];\n  relation(around:${area.radiusM},${area.lat},${area.lng})["tourism"~"^(hotel|resort|guest_house|hostel|apartment)$"];\n  node(around:${area.radiusM},${area.lat},${area.lng})["place"~"^(city|town|village)$"];\n  way(around:${area.radiusM},${area.lat},${area.lng})["place"~"^(city|town|village)$"];\n  relation(around:${area.radiusM},${area.lat},${area.lng})["place"~"^(city|town|village)$"];\n  node(around:${area.radiusM},${area.lat},${area.lng})["harbour"];\n  node(around:${area.radiusM},${area.lat},${area.lng})["seamark:type"="harbour"];\n  node(around:${area.radiusM},${area.lat},${area.lng})["man_made"="pier"];\n);\nout center;`;

  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    for (const overpassUrl of OVERPASS_URLS) {
      try {
        const res = await fetch(overpassUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": USER_AGENT,
          },
          body: `data=${encodeURIComponent(query)}`,
        });
        if (!res.ok) {
          const txt = await res.text();
          lastErr = new Error(`overpass_${res.status}:${txt.slice(0, 500)}`);
          continue;
        }
        const data = await res.json();
        const elements = Array.isArray(data?.elements) ? data.elements : [];
        const pois = elements.map((el) => toPoi(area, el)).filter(Boolean);
        return dedupeAndCap(pois);
      } catch (err) {
        lastErr = err;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 3000 * (attempt + 1)));
  }
  throw lastErr || new Error("overpass_failed");
}

async function loadExternalProviders() {
  const path = "data/provider_imports.json";
  try {
    const raw = await fs.readFile(path, "utf8");
    const json = JSON.parse(raw);
    return Array.isArray(json?.pois) ? json.pois : [];
  } catch {
    return [];
  }
}

function mergeProviderPois(areas, providerPois) {
  if (!providerPois.length) return;
  const byArea = new Map(areas.map((a) => [a.id, a]));
  for (const ext of providerPois) {
    const areaId = normalize(ext.areaId || ext.area || "").replace(/\s+/g, "_");
    const area = byArea.get(areaId);
    if (!area) continue;
    if (!ext.name || !Number.isFinite(Number(ext.lat)) || !Number.isFinite(Number(ext.lng))) continue;
    area.pois.push({
      id: `${area.id}_${normalize(ext.type || "poi")}_${normalize(ext.name).replace(/\s+/g, "_")}`,
      type: ext.type || "poi",
      name: ext.name,
      lat: Number(ext.lat),
      lng: Number(ext.lng),
      aliases: Array.from(new Set([normalize(ext.name), ...(Array.isArray(ext.aliases) ? ext.aliases.map(normalize) : [])].filter(Boolean))),
      source: ext.source || "external",
      url: ext.url || undefined,
    });
  }

  for (const area of areas) {
    area.pois = dedupeAndCap(area.pois);
  }
}

async function build() {
  const areas = [];
  for (const area of AREAS) {
    console.log(`Fetching ${area.name}...`);
    let pois = [];
    try {
      pois = await fetchAreaPois(area);
    } catch (err) {
      console.error(`  Failed ${area.name}: ${err.message}`);
    }
    console.log(`  ${pois.length} POIs`);
    areas.push({
      id: area.id,
      name: area.name,
      aliases: area.aliases,
      lat: area.lat,
      lng: area.lng,
      radiusM: area.radiusM,
      pois,
    });
  }

  const externalPois = await loadExternalProviders();
  mergeProviderPois(areas, externalPois);

  const db = {
    generatedAt: new Date().toISOString(),
    source: "osm_overpass_plus_provider_imports",
    totalPois: areas.reduce((acc, a) => acc + a.pois.length, 0),
    areas,
  };

  await fs.writeFile("data/poi-db.json", JSON.stringify(db, null, 2));
  console.log(`Wrote data/poi-db.json with ${db.totalPois} POIs`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
