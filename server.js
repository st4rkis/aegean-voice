import dotenv from "dotenv";
import crypto from "crypto";
import express from "express";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocket, WebSocketServer } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env"), override: true });

const app = express();
app.use(express.json({ limit: "6mb" }));
app.use(express.urlencoded({ extended: false }));

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://voice-gateway.aegean.taxi").replace(/\/+$/, "");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
const OPENAI_VOICE = (process.env.OPENAI_VOICE || "coral").trim();
const OPENAI_TEMPERATURE = Math.max(0.6, Number(process.env.OPENAI_TEMPERATURE || 0.7));
const OPENAI_STT_MODEL = (process.env.OPENAI_STT_MODEL || "gpt-4o-transcribe").trim();
const ASSISTANT_LANGUAGE_MODE = (process.env.ASSISTANT_LANGUAGE_MODE || "en").trim().toLowerCase(); // en|auto
const VOICE_STACK_MODE = (process.env.VOICE_STACK_MODE || "deepgram_elevenlabs_fsm").trim().toLowerCase();
const OPENAI_RATE_TEXT_INPUT_USD_PER_1M = Number(process.env.OPENAI_RATE_TEXT_INPUT_USD_PER_1M || 5);
const OPENAI_RATE_TEXT_OUTPUT_USD_PER_1M = Number(process.env.OPENAI_RATE_TEXT_OUTPUT_USD_PER_1M || 20);
const OPENAI_RATE_AUDIO_INPUT_USD_PER_1M = Number(process.env.OPENAI_RATE_AUDIO_INPUT_USD_PER_1M || 40);
const OPENAI_RATE_AUDIO_OUTPUT_USD_PER_1M = Number(process.env.OPENAI_RATE_AUDIO_OUTPUT_USD_PER_1M || 80);
const USD_TO_EUR = Number(process.env.USD_TO_EUR || 0.8456);
const OPENAI_BLEND_USD_PER_1M = Number(process.env.OPENAI_BLEND_USD_PER_1M || 45);
const OPENAI_CALL_TOKEN_BUDGET = Math.max(1000, Number(process.env.OPENAI_CALL_TOKEN_BUDGET || 6000));

const GREETING_TEXT = (
  process.env.GREETING_TEXT || "Welcome to Aegean Taxi! Can I have your pickup location please?"
).trim();
const PREP_TEXT = (
  process.env.PREP_TEXT ||
  "Aegean Taxi. To book fast, please say island, pickup, destination, passengers, and when. For price checks, say your pickup and destination."
).trim();
const RECORDING_NOTICE = (process.env.RECORDING_NOTICE || "Calls may be recorded for quality purposes.").trim();
const USE_PREP_TALK = /^true$/i.test(process.env.USE_PREP_TALK || "false");

const WS_SHARED_SECRET = process.env.WS_SHARED_SECRET || "";

// ONDE Operator API
const BACKEND_MODE = String(process.env.BACKEND_MODE || "nq").trim().toLowerCase();
const ACTIVE_BACKEND_MODE = "nq";
const ONDE_BASE_URL = (process.env.ONDE_BASE_URL || process.env.ONDE_HOSTNAME || "https://api-sandbox.onde.app")
  .replace(/^api\./, "https://api.")
  .replace(/\/+$/, "");
const ONDE_OPERATOR_TOKEN = process.env.ONDE_OPERATOR_TOKEN || process.env.ONDE_API_KEY || "";
const ONDE_AUTH_SCHEME = process.env.ONDE_AUTH_SCHEME ?? "Bearer";
const ONDE_TIMEOUT_MS = Number(process.env.ONDE_TIMEOUT_MS || 7000);
const NQ_BASE_URL = String(process.env.NQ_BASE_URL || "").trim().replace(/\/+$/, "");
const NQ_TIMEOUT_MS = Number(process.env.NQ_TIMEOUT_MS || 7000);
const NQ_SERVICE_TOKEN = String(process.env.NQ_SERVICE_TOKEN || "").trim();
const NQ_CALL_NUMBER_ID = String(process.env.NQ_CALL_NUMBER_ID || "").trim();
const NQ_COMPANY_ID = String(process.env.NQ_COMPANY_ID || "").trim();
const NQ_COMPANY_CODE = String(process.env.NQ_COMPANY_CODE || "").trim();
const NQ_PUBLIC_CLIENT_ID = String(process.env.NQ_PUBLIC_CLIENT_ID || "").trim();
const NQ_PUBLIC_CLIENT_SECRET = String(process.env.NQ_PUBLIC_CLIENT_SECRET || "").trim();
const NQ_TRANSCRIPT_ENABLED = !/^false$/i.test(String(process.env.NQ_TRANSCRIPT_ENABLED || "true"));
const ONDE_ALLOWED_VEHICLE_TYPES = new Set(
  String(process.env.ONDE_ALLOWED_VEHICLE_TYPES || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
);

// Optional geocoder/place resolver owned by Aegean
const PLACE_RESOLVER_URL = (process.env.PLACE_RESOLVER_URL || "").replace(/\/+$/, "");
const PLACE_RESOLVER_KEY = process.env.PLACE_RESOLVER_KEY || "";
const NOMINATIM_BASE_URL = (process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org").replace(/\/+$/, "");
const NOMINATIM_USER_AGENT = process.env.NOMINATIM_USER_AGENT || "AegeanVoiceResolver/1.0 (ops@aegeantaxi.com)";
const NOMINATIM_EMAIL = process.env.NOMINATIM_EMAIL || "";
const NOMINATIM_COUNTRY_CODES = process.env.NOMINATIM_COUNTRY_CODES || "gr";
const NOMINATIM_MIN_INTERVAL_MS = Math.max(0, Number(process.env.NOMINATIM_MIN_INTERVAL_MS || 1200));
const ENABLE_NOMINATIM_FALLBACK = !/^false$/i.test(process.env.ENABLE_NOMINATIM_FALLBACK || "false");
const POI_DB_PATH = process.env.POI_DB_PATH || path.join(__dirname, "data", "poi-db.json");
const ONDE_SERVICE_TYPES_PATH = process.env.ONDE_SERVICE_TYPES_PATH || path.join(__dirname, "data", "service-types.json");
const ORDER_MEMORY_PATH = process.env.ORDER_MEMORY_PATH || path.join(__dirname, "data", "order-memory.json");
const CALL_AUDIT_PATH = process.env.CALL_AUDIT_PATH || path.join(__dirname, "data", "call-audit.json");
const CALL_AUDIT_MAX = Math.max(200, Number(process.env.CALL_AUDIT_MAX || 5000));
const DASHBOARD_CALLS_FILE = path.join(__dirname, "dashboard", "calls.html");

// Optional WhatsApp notifier
const WHATSAPP_BASE_URL = (process.env.WHATSAPP_BASE_URL || "").replace(/\/+$/, "");
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY || "";
const WHATSAPP_SEND_PATH = process.env.WHATSAPP_SEND_PATH || "/ai/send-whatsapp";
const WHATSAPP_PROVIDER = (process.env.WHATSAPP_PROVIDER || "custom").trim().toLowerCase();
const WHATSAPP_META_API_VERSION = (process.env.WHATSAPP_META_API_VERSION || "v22.0").trim();
const WHATSAPP_META_PHONE_NUMBER_ID = (process.env.WHATSAPP_META_PHONE_NUMBER_ID || "").trim();
const WHATSAPP_META_TOKEN = (process.env.WHATSAPP_META_TOKEN || "").trim();
const ATHENS_TIMEZONE = process.env.OPS_TIMEZONE || "Europe/Athens";
const DEEPGRAM_API_KEY = String(process.env.DEEPGRAM_API_KEY || "").trim();
const DEEPGRAM_MODEL = String(process.env.DEEPGRAM_MODEL || "nova-2").trim();
const DEEPGRAM_LANGUAGE = String(process.env.DEEPGRAM_LANGUAGE || "en").trim();
const DEEPGRAM_ENDPOINTING_MS = Math.max(100, Number(process.env.DEEPGRAM_ENDPOINTING_MS || 500));
const ELEVENLABS_API_KEY = String(process.env.ELEVENLABS_API_KEY || "").trim();
const ELEVENLABS_VOICE_ID = String(process.env.ELEVENLABS_VOICE_ID || "").trim();
const ELEVENLABS_MODEL_ID = String(process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5").trim();
const ELEVENLABS_BASE_URL = (String(process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io") || "").replace(/\/+$/, "");
const ELEVENLABS_OUTPUT_FORMAT = String(process.env.ELEVENLABS_OUTPUT_FORMAT || "pcm_16000").trim();
const ELEVENLABS_TTS_TIMEOUT_MS = Math.max(1500, Number(process.env.ELEVENLABS_TTS_TIMEOUT_MS || 9000));
const CALL_RESPONSE_TIMEOUT_MS = Math.max(20000, Number(process.env.CALL_RESPONSE_TIMEOUT_MS || 45000));

const VONAGE_SAMPLE_RATE = 16000;
const OPENAI_SAMPLE_RATE = 24000;
let lastNominatimCallAt = 0;
const placeCache = new Map();
const nqCallContextCache = new Map();
const nqPublicTokenCache = new Map();
const nqVehicleCategoryCache = new Map();

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeVehiclePreference(value) {
  const v = normalizeText(value);
  if (!v) return "";
  if (v === "standard" || v === "car" || v === "sedan" || v === "economy") return "standard";
  if (v === "van" || v === "minivan" || v === "mini van") return "van";
  return v;
}

function mapToOndeVehicleType(value) {
  const normalized = normalizeVehiclePreference(value);
  if (!normalized || ONDE_ALLOWED_VEHICLE_TYPES.size === 0) return null;
  for (const allowed of ONDE_ALLOWED_VEHICLE_TYPES) {
    if (normalizeText(allowed) === normalized) return allowed;
  }
  return null;
}

function sanitizeOndeVehicleType(value) {
  if (!value) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;
  if (ONDE_ALLOWED_VEHICLE_TYPES.size === 0) return undefined;
  for (const allowed of ONDE_ALLOWED_VEHICLE_TYPES) {
    if (normalizeText(allowed) === normalizeText(raw)) return allowed;
  }
  return undefined;
}

function normalizeClientCategory(value) {
  const v = normalizeText(value);
  if (!v) return "";
  if (v.includes("mini")) return "minibus";
  if (v.includes("van") || v.includes("microbus")) return "van";
  if (v.includes("economy") || v.includes("standard") || v.includes("car")) return "economy";
  return "";
}

function selectClientCategory({ requestedVehicleType, passengers }) {
  const explicit = normalizeClientCategory(requestedVehicleType);
  if (explicit) return explicit;
  const pax = Number(passengers || 1);
  if (pax > 8) return "minibus";
  if (pax > 4) return "van";
  return ONDE_SERVICE_TYPES.defaultCategory || "economy";
}

function resolveOndeServiceType({ island, requestedVehicleType, passengers }) {
  const areaId = canonicalAreaId(island || "");
  if (!areaId) return null;
  const areaMap = ONDE_SERVICE_TYPES.areas?.[areaId];
  if (!areaMap || typeof areaMap !== "object") return null;
  const category = selectClientCategory({ requestedVehicleType, passengers });
  return areaMap[category] || areaMap.economy || null;
}

function loadPoiDb() {
  try {
    const raw = fs.readFileSync(POI_DB_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.areas)) return { areas: [], byAlias: new Map(), byId: new Map(), totalPois: 0 };
    const byAlias = new Map();
    const byId = new Map();
    let totalPois = 0;
    for (const area of parsed.areas) {
      const areaId = String(area.id || "").trim();
      if (!areaId) continue;
      const aliases = new Set([areaId, area.name, ...(Array.isArray(area.aliases) ? area.aliases : [])].map(normalizeText).filter(Boolean));
      byId.set(areaId, area);
      totalPois += Array.isArray(area.pois) ? area.pois.length : 0;
      for (const alias of aliases) byAlias.set(alias, areaId);
    }
    return { areas: parsed.areas, byAlias, byId, totalPois };
  } catch {
    return { areas: [], byAlias: new Map(), byId: new Map(), totalPois: 0 };
  }
}

function loadOndeServiceTypes() {
  try {
    const raw = fs.readFileSync(ONDE_SERVICE_TYPES_PATH, "utf8");
    const parsed = JSON.parse(raw);
    const areas = parsed?.areas && typeof parsed.areas === "object" ? parsed.areas : {};
    return {
      defaultCategory: normalizeText(parsed?.defaultCategory || "economy") || "economy",
      areas,
    };
  } catch {
    return {
      defaultCategory: "economy",
      areas: {},
    };
  }
}

function loadOrderMemory() {
  try {
    const raw = fs.readFileSync(ORDER_MEMORY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { byPhone: {} };
    if (!parsed.byPhone || typeof parsed.byPhone !== "object") return { byPhone: {} };
    return parsed;
  } catch {
    return { byPhone: {} };
  }
}

function saveOrderMemory(state) {
  try {
    fs.mkdirSync(path.dirname(ORDER_MEMORY_PATH), { recursive: true });
    fs.writeFileSync(ORDER_MEMORY_PATH, JSON.stringify(state, null, 2), "utf8");
  } catch {}
}

function rememberOrderForPhone(phone, orderInfo) {
  const p = normalizePhoneE164(phone || "");
  if (!p || !orderInfo?.orderId) return;
  const memory = loadOrderMemory();
  if (!memory.byPhone[p]) memory.byPhone[p] = [];
  memory.byPhone[p].unshift({
    orderId: orderInfo.orderId,
    createdAt: nowIso(),
    island: orderInfo.island || "",
    pickupLabel: orderInfo.pickupLabel || "",
    dropoffLabel: orderInfo.dropoffLabel || "",
  });
  memory.byPhone[p] = memory.byPhone[p].slice(0, 20);
  saveOrderMemory(memory);
}

function findLatestOrderForPhone(phone) {
  const p = normalizePhoneE164(phone || "");
  if (!p) return null;
  const memory = loadOrderMemory();
  const list = memory.byPhone?.[p];
  if (!Array.isArray(list) || list.length === 0) return null;
  return list[0];
}

function loadCallAudit() {
  try {
    const raw = fs.readFileSync(CALL_AUDIT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { calls: [] };
    if (!Array.isArray(parsed.calls)) return { calls: [] };
    return { calls: parsed.calls };
  } catch {
    return { calls: [] };
  }
}

function saveCallAudit(state) {
  try {
    fs.mkdirSync(path.dirname(CALL_AUDIT_PATH), { recursive: true });
    fs.writeFileSync(CALL_AUDIT_PATH, JSON.stringify(state, null, 2), "utf8");
  } catch {}
}

function classifyCallStatus(call) {
  if (call?.bookingCreated) return { code: "BOOKED", color: "green" };
  if (call?.cancelActionDone) return { code: "CANCELLED", color: "purple" };
  if (call?.bookingFailures > 0) return { code: "BOOKING_FAILED", color: "red" };
  if (call?.resolveFailures > 0) return { code: "LOCATION_ISSUE", color: "orange" };
  if (call?.quoteFailures > 0) return { code: "PRICE_ISSUE", color: "amber" };
  if (call?.endCallRequested) return { code: "ENDED_UNRESOLVED", color: "red" };
  if (call?.turns === 0) return { code: "NO_INTERACTION", color: "slate" };
  if (call?.priceCheckDone) return { code: "PRICE_ONLY", color: "blue" };
  return { code: "INCOMPLETE", color: "slate" };
}

function upsertCallAuditEntry(entry) {
  const audit = loadCallAudit();
  const uuid = String(entry?.uuid || "");
  if (!uuid) return;
  const idx = audit.calls.findIndex((c) => c.uuid === uuid);
  if (idx >= 0) {
    audit.calls[idx] = { ...audit.calls[idx], ...entry };
  } else {
    audit.calls.unshift(entry);
  }
  audit.calls.sort((a, b) => (String(b.startedAt || b.timestamp || "")).localeCompare(String(a.startedAt || a.timestamp || "")));
  if (audit.calls.length > CALL_AUDIT_MAX) audit.calls = audit.calls.slice(0, CALL_AUDIT_MAX);
  saveCallAudit(audit);
}

const POI_DB = loadPoiDb();
const SUPPORTED_AREAS = POI_DB.areas.map((a) => a.name);
const ONDE_SERVICE_TYPES = loadOndeServiceTypes();

function canonicalAreaId(value) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return POI_DB.byAlias.get(normalized) || "";
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const toRad = (n) => (n * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimateTripMetrics(originLat, originLng, destLat, destLng) {
  const airDistanceKm = haversineMeters(originLat, originLng, destLat, destLng) / 1000;
  const roadFactor = 1.28;
  const distanceKm = Math.max(0.5, airDistanceKm * roadFactor);
  const avgSpeedKmh = 28;
  const fixedBufferMin = 5;
  const timeMin = Math.max(5, (distanceKm / avgSpeedKmh) * 60 + fixedBufferMin);
  return {
    airDistanceKm,
    distanceKm,
    timeMin,
  };
}

function estimateFallbackFare({ passengers, distanceKm, timeMin, vehicleType }) {
  const vehicleHint = normalizeText(vehicleType);
  const isVan = vehicleHint === "van" || vehicleHint === "minivan" || Number(passengers || 1) > 4;
  const base = isVan ? 45 : 36;
  const perMinute = isVan ? 1.75 : 1.2;
  const perKm = isVan ? 0.8 : 0.5;

  const extraMinutes = Math.max(0, timeMin - 30);
  const extraKm = Math.max(0, distanceKm - 8);
  const total = base + extraMinutes * perMinute + extraKm * perKm;
  const rounded = Math.round(total);
  return {
    vehicleClass: isVan ? "van" : "standard",
    estimatedFareEur: rounded,
    rawFareEur: Number(total.toFixed(2)),
    extraMinutes: Number(extraMinutes.toFixed(1)),
    extraKm: Number(extraKm.toFixed(2)),
    baseFareEur: base,
  };
}

function hasWaypointCoords(wp) {
  const lat = wp?.placeLatLng?.lat ?? wp?.exactLatLng?.lat;
  const lng = wp?.placeLatLng?.lng ?? wp?.exactLatLng?.lng;
  return Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
}

function safeNum(n) {
  return Number.isFinite(Number(n)) ? Number(n) : 0;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function athensYmdFromMs(ms, plusDays = 0) {
  const dt = new Date(ms + plusDays * 86400000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ATHENS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dt);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return y && m && d ? `${y}-${m}-${d}` : "";
}

function athensOffsetForDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
  if (!m) return "+02:00";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  const tzPart = new Intl.DateTimeFormat("en-US", {
    timeZone: ATHENS_TIMEZONE,
    timeZoneName: "shortOffset",
  }).formatToParts(probe).find((p) => p.type === "timeZoneName")?.value || "GMT+2";
  const mm = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(tzPart);
  if (!mm) return "+02:00";
  return `${mm[1]}${pad2(mm[2])}:${pad2(mm[3] || "00")}`;
}

function parseDateToken(raw, referenceMs) {
  const value = String(raw || "").trim().toLowerCase();
  if (!value) return "";
  if (value === "today") return athensYmdFromMs(referenceMs, 0);
  if (value === "tomorrow") return athensYmdFromMs(referenceMs, 1);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{4}))?$/.exec(value);
  if (!dmy) return "";
  const d = pad2(dmy[1]);
  const m = pad2(dmy[2]);
  const y = dmy[3] || athensYmdFromMs(referenceMs).slice(0, 4);
  return `${y}-${m}-${d}`;
}

function parseTimeToken(raw, rawPeriod = "") {
  const txt = normalizeText(raw);
  const periodHint = normalizeText(rawPeriod);
  const periodMatch = /\b(am|pm)\b/.exec(txt) || /\b(am|pm)\b/.exec(periodHint);
  const candidates = [];
  const rx = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/g;
  for (let m = rx.exec(txt); m; m = rx.exec(txt)) {
    candidates.push({
      hour: Number(m[1]),
      minute: m[2] ? Number(m[2]) : 0,
      ampm: (m[3] || "").toLowerCase(),
    });
  }
  const pick = candidates[candidates.length - 1];
  if (!pick) return { ok: false, reason: "missing_time" };
  let hour = pick.hour;
  const minute = pick.minute;
  if (Number.isNaN(hour) || Number.isNaN(minute) || minute < 0 || minute > 59) {
    return { ok: false, reason: "invalid_time" };
  }
  const ampm = pick.ampm || periodMatch?.[1] || "";
  if (ampm) {
    if (hour < 1 || hour > 12) return { ok: false, reason: "invalid_time" };
    if (ampm === "pm" && hour !== 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    return { ok: true, hhmm: `${pad2(hour)}:${pad2(minute)}` };
  }
  if (hour > 23) return { ok: false, reason: "invalid_time" };
  if (hour <= 12) return { ok: false, reason: "ambiguous_hour_needs_am_pm" };
  return { ok: true, hhmm: `${pad2(hour)}:${pad2(minute)}` };
}

function normalizeScheduledPickup(args, referenceMs) {
  const rawPickupTime = String(args?.pickup_time || "").trim();
  const bookingFor = String(args?.booking_for || "").trim().toLowerCase();
  if (bookingFor === "now" || normalizeText(rawPickupTime) === "now") {
    return { mode: "now", ok: true, iso: "now", needsClarification: false, reason: "", localDate: "", localTime: "" };
  }
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|z)$/i.test(rawPickupTime)) {
    const dt = /^(\d{4}-\d{2}-\d{2})t(\d{2}:\d{2})/i.exec(rawPickupTime);
    return {
      mode: "later",
      ok: true,
      iso: rawPickupTime.replace(/z$/i, "+00:00"),
      needsClarification: false,
      reason: "",
      localDate: dt?.[1] || "",
      localTime: dt?.[2] || "",
    };
  }

  const shouldBeLater = bookingFor === "later" || Boolean(rawPickupTime || args?.pickup_date || args?.pickup_clock);
  if (!shouldBeLater) {
    return { mode: "unknown", ok: false, iso: "", needsClarification: true, reason: "ask_now_or_later", localDate: "", localTime: "" };
  }

  let dateToken = String(args?.pickup_date || "").trim();
  let timeToken = String(args?.pickup_clock || "").trim();
  let timePeriod = String(args?.pickup_time_period || "").trim();
  if (!dateToken && rawPickupTime) {
    const rawNorm = normalizeText(rawPickupTime);
    if (/\btoday\b/.test(rawNorm)) dateToken = "today";
    else if (/\btomorrow\b/.test(rawNorm)) dateToken = "tomorrow";
    else {
      dateToken = /(\d{4}-\d{2}-\d{2})/.exec(rawPickupTime)?.[1] || /(\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{4})?)/.exec(rawPickupTime)?.[1] || "";
    }
  }
  if (!timeToken && rawPickupTime) timeToken = rawPickupTime;
  if (!timePeriod && rawPickupTime) timePeriod = /\b(am|pm)\b/i.exec(rawPickupTime)?.[1] || "";

  const ymd = parseDateToken(dateToken, referenceMs);
  if (!ymd) return { mode: "later", ok: false, iso: "", needsClarification: true, reason: "missing_or_invalid_date", localDate: "", localTime: "" };

  const tm = parseTimeToken(timeToken, timePeriod);
  if (!tm.ok) return { mode: "later", ok: false, iso: "", needsClarification: true, reason: tm.reason, localDate: ymd, localTime: "" };

  const iso = `${ymd}T${tm.hhmm}:00${athensOffsetForDate(ymd)}`;
  return { mode: "later", ok: true, iso, needsClarification: false, reason: "", localDate: ymd, localTime: tm.hhmm };
}

const PASSENGER_WORDS = new Map([
  ["one", 1], ["two", 2], ["three", 3], ["four", 4], ["five", 5],
  ["six", 6], ["seven", 7], ["eight", 8], ["nine", 9], ["ten", 10],
  ["ένα", 1], ["δυο", 2], ["δύο", 2], ["τρεις", 3], ["τρια", 3], ["τρία", 3],
  ["τέσσερα", 4], ["τεσσερα", 4], ["πέντε", 5], ["πεντε", 5], ["έξι", 6], ["εξι", 6],
  ["επτά", 7], ["επτα", 7], ["οκτώ", 8], ["οκτω", 8],
]);

function parsePassengerCountFromText(text) {
  const norm = normalizeText(text);
  const direct = /\b(\d{1,2})\b/.exec(norm);
  if (direct) {
    const n = Number(direct[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 24) return n;
  }
  for (const [word, value] of PASSENGER_WORDS.entries()) {
    if (norm.includes(word)) return value;
  }
  return 0;
}

function looksLikeValidName(text) {
  const raw = String(text || "").trim();
  if (raw.length < 2) return false;
  const norm = normalizeText(raw);
  if (!norm) return false;
  if (/^\d+$/.test(norm)) return false;
  if (/\b(yes|no|ok|okay|sure|correct|confirm|book|cancel|now|later|ναι|οχι|όχι)\b/.test(norm)) return false;
  return /[a-zA-Z\u0370-\u03ff]/.test(raw);
}

function detectYesNo(text) {
  const n = normalizeText(text);
  if (!n) return "unknown";
  if (/\b(yes|yeah|yep|correct|ok|okay|sure|book|go ahead|proceed|confirm|ναι|σωστα|σωστό|ok)\b/.test(n)) return "yes";
  if (/\b(no|nope|cancel|stop|negative|not now|οχι|όχι|άκυρο|ακυρο)\b/.test(n)) return "no";
  return "unknown";
}

function detectNowLater(text) {
  const n = normalizeText(text);
  if (!n) return "unknown";
  if (/\b(now|immediately|right now|asap|τωρα|τώρα|αμεσα|άμεσα)\b/.test(n)) return "now";
  if (/\b(later|tomorrow|today at|prebook|schedule|scheduled|αυριο|αύριο|μετα|μετά|προκρατηση|προκράτηση)\b/.test(n)) return "later";
  return "unknown";
}

function detectPriceIntent(text) {
  const n = normalizeText(text);
  return /\b(price|cost|fare|how much|estimate|τιμη|τιμή|κοστος|κόστος)\b/.test(n);
}

function detectHumanEscalationIntent(text) {
  const n = normalizeText(text);
  return /\b(human|agent|operator|representative|person|ανθρωπο|άνθρωπο|εκπροσωπο|εκπρόσωπο|operator)\b/.test(n);
}

function detectExplicitNoAgent(text) {
  const n = normalizeText(text);
  return /\b(no agent|dont transfer|do not transfer|no human|χωρις ανθρωπο|χωρίς άνθρωπο|οχι ανθρωπο)\b/.test(n);
}

function areaAliasIndex() {
  const rows = [];
  for (const area of POI_DB.areas) {
    const areaId = String(area?.id || "").trim();
    if (!areaId) continue;
    const names = [areaId, area?.name, ...(Array.isArray(area?.aliases) ? area.aliases : [])]
      .map((x) => normalizeText(x))
      .filter(Boolean);
    for (const alias of names) {
      rows.push({ alias, areaId });
    }
  }
  rows.sort((a, b) => b.alias.length - a.alias.length);
  return rows;
}

const AREA_ALIASES = areaAliasIndex();

function detectAreaIdInText(text) {
  const norm = normalizeText(text);
  if (!norm) return "";
  const direct = canonicalAreaId(norm);
  if (direct) return direct;
  for (const row of AREA_ALIASES) {
    if (norm.includes(row.alias)) return row.areaId;
  }
  return "";
}

function pickupModeFromType(type, label) {
  const t = normalizeText(type);
  const l = normalizeText(label);
  if (t.includes("airport") || l.includes("airport") || l.includes("aerodromio")) return "airport";
  if (t.includes("port") || t.includes("harbor") || l.includes("port") || l.includes("limani")) return "port";
  return "other";
}

function hasTransportArrivalInfo(state) {
  const hasRef = Boolean(String(state.transportRef || "").trim());
  const hasOriginEta = Boolean(String(state.transportOrigin || "").trim()) && Boolean(String(state.transportEta || "").trim());
  return hasRef || hasOriginEta;
}

function buildTransportNotes(state) {
  if (state.pickupMode !== "airport" && state.pickupMode !== "port") return "";
  const parts = [];
  if (state.transportRef) parts.push(`${state.pickupMode === "airport" ? "Flight" : "Vessel"}: ${state.transportRef}`);
  if (state.transportOrigin) parts.push(`Origin: ${state.transportOrigin}`);
  if (state.transportEta) parts.push(`ETA: ${state.transportEta}`);
  return parts.length ? `${state.pickupMode === "airport" ? "Airport" : "Port"} pickup info - ${parts.join(", ")}` : "";
}

function extractRealtimeUsage(evt) {
  const usage = evt?.response?.usage || evt?.usage || {};
  const inText = safeNum(usage?.input_text_tokens ?? usage?.input_text_token_count ?? usage?.text_input_tokens);
  const outText = safeNum(usage?.output_text_tokens ?? usage?.output_text_token_count ?? usage?.text_output_tokens);
  const inAudio = safeNum(usage?.input_audio_tokens ?? usage?.input_audio_token_count ?? usage?.audio_input_tokens);
  const outAudio = safeNum(usage?.output_audio_tokens ?? usage?.output_audio_token_count ?? usage?.audio_output_tokens);
  const total = safeNum(usage?.total_tokens ?? usage?.total_token_count);
  return {
    inputTextTokens: inText,
    outputTextTokens: outText,
    inputAudioTokens: inAudio,
    outputAudioTokens: outAudio,
    totalTokens: total || inText + outText + inAudio + outAudio,
  };
}

function estimateOpenAiCost(usageTotals) {
  const usd =
    (usageTotals.inputTextTokens / 1_000_000) * OPENAI_RATE_TEXT_INPUT_USD_PER_1M +
    (usageTotals.outputTextTokens / 1_000_000) * OPENAI_RATE_TEXT_OUTPUT_USD_PER_1M +
    (usageTotals.inputAudioTokens / 1_000_000) * OPENAI_RATE_AUDIO_INPUT_USD_PER_1M +
    (usageTotals.outputAudioTokens / 1_000_000) * OPENAI_RATE_AUDIO_OUTPUT_USD_PER_1M;
  const eur = usd * USD_TO_EUR;
  return {
    usd: Number(usd.toFixed(6)),
    eur: Number(eur.toFixed(6)),
  };
}

function estimateOpenAiCostRangeFromTotal(totalTokens) {
  const t = safeNum(totalTokens);
  const minUsd = (t / 1_000_000) * OPENAI_RATE_TEXT_INPUT_USD_PER_1M;
  const maxUsd = (t / 1_000_000) * OPENAI_RATE_AUDIO_OUTPUT_USD_PER_1M;
  const blendUsd = (t / 1_000_000) * OPENAI_BLEND_USD_PER_1M;
  return {
    min: { usd: Number(minUsd.toFixed(6)), eur: Number((minUsd * USD_TO_EUR).toFixed(6)) },
    blend: { usd: Number(blendUsd.toFixed(6)), eur: Number((blendUsd * USD_TO_EUR).toFixed(6)) },
    max: { usd: Number(maxUsd.toFixed(6)), eur: Number((maxUsd * USD_TO_EUR).toFixed(6)) },
  };
}

function nowIso() {
  return new Date().toISOString();
}

function toWsBaseUrl(httpBase) {
  return httpBase.replace(/^https:\/\//i, "wss://").replace(/^http:\/\//i, "ws://");
}

function maskPhone(phone) {
  if (!phone || phone.length < 6) return phone;
  return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
}

function normalizePhoneE164(raw, defaultCountryCode = "+30") {
  const value = String(raw || "").trim();
  if (!value) return "";
  const hasPlus = value.includes("+");
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";

  if (hasPlus && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.startsWith("00") && digits.length > 2) return `+${digits.slice(2)}`;
  if (digits.startsWith("0") && digits.length >= 10) return `${defaultCountryCode}${digits.slice(1)}`;

  // If caller ID already looks like international (11-15 digits, no leading zero), keep it as-is with plus.
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;

  // Local/national numbers fallback to the default country code.
  if (digits.length >= 7 && digits.length <= 10) return `${defaultCountryCode}${digits}`;

  return `+${digits}`;
}

function bytesToInt16LE(buf) {
  return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
}

function int16ToBufferLE(int16) {
  return Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength);
}

function resamplePcm16Linear(inputBuf, inRate, outRate) {
  if (inRate === outRate) return inputBuf;
  if (!inputBuf || inputBuf.length < 2) return Buffer.alloc(0);
  const inSamples = bytesToInt16LE(inputBuf);
  const inLen = inSamples.length;
  const ratio = outRate / inRate;
  const outLen = Math.max(1, Math.floor(inLen * ratio));
  const outSamples = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i / ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = inSamples[Math.min(idx, inLen - 1)];
    const s1 = inSamples[Math.min(idx + 1, inLen - 1)];
    outSamples[i] = Math.max(-32768, Math.min(32767, Math.round(s0 + (s1 - s0) * frac)));
  }
  return int16ToBufferLE(outSamples);
}

function b64FromBuf(buf) {
  return Buffer.from(buf).toString("base64");
}

function bufFromB64(b64) {
  return Buffer.from(b64, "base64");
}

function signWsToken(uuid, ts) {
  return crypto.createHmac("sha256", WS_SHARED_SECRET).update(`${uuid}:${ts}`).digest("hex");
}

function verifyWsToken(uuid, ts, sig) {
  if (!WS_SHARED_SECRET) return true;
  if (!uuid || !ts || !sig) return false;
  const age = Math.abs(Date.now() - Number(ts));
  if (!Number.isFinite(age) || age > 5 * 60 * 1000) return false;
  const expected = signWsToken(uuid, ts);
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function safeJsonParse(input) {
  try {
    return JSON.parse(input);
  } catch {
    return {};
  }
}

function clean(obj) {
  if (Array.isArray(obj)) return obj.map(clean).filter((v) => v !== undefined);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const next = clean(v);
      if (next !== undefined && next !== null && !(typeof next === "string" && next.trim() === "")) {
        out[k] = next;
      }
    }
    return out;
  }
  return obj === undefined ? undefined : obj;
}

async function requestJson(url, options = {}, timeoutMs = ONDE_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    const txt = await res.text();
    let data;
    try {
      data = txt ? JSON.parse(txt) : {};
    } catch {
      data = { raw: txt };
    }
    if (!res.ok) {
      throw new Error(`http_${res.status}:${JSON.stringify(data)}`);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNominatimFloat(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function resolverCacheKey(payload) {
  return JSON.stringify({
    island: (payload?.island || "").toLowerCase().trim(),
    query: (payload?.query || "").toLowerCase().trim(),
    kind: payload?.kind || "",
    language: (payload?.language || "").toLowerCase().trim(),
  });
}

function buildResolverQuery(payload) {
  const parts = [];
  const query = String(payload?.query || "").trim();
  const island = String(payload?.island || "").trim();
  if (query) parts.push(query);
  if (island && !query.toLowerCase().includes(island.toLowerCase())) parts.push(island);
  if (!query.toLowerCase().includes("greece")) parts.push("Greece");
  return parts.join(", ");
}

function mapNominatimToWaypoint(item) {
  const lat = parseNominatimFloat(item?.lat);
  const lng = parseNominatimFloat(item?.lon);
  return clean({
    exactLatLng: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined,
    placeLatLng: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined,
    premise: item?.name || item?.display_name || undefined,
    poiName: item?.display_name || item?.name || undefined,
    houseNumber: item?.address?.house_number,
    street: item?.address?.road,
    subLocality: item?.address?.suburb,
    locality: item?.address?.town || item?.address?.village,
    city: item?.address?.city || item?.address?.town || item?.address?.village,
    district: item?.address?.county,
    province: item?.address?.state,
    country: item?.address?.country,
    postalCode: item?.address?.postcode,
    countryCode: item?.address?.country_code?.toUpperCase(),
  });
}

function scorePoiMatch(queryNorm, poi, areaName = "") {
  if (!queryNorm) return 0;
  const areaNorm = normalizeText(areaName || "");
  const areaTokens = new Set(areaNorm.split(" ").filter(Boolean));
  const genericStopwords = new Set([
    "hotel", "resort", "restaurant", "bar", "beach", "club", "beachclub", "apartments", "apartment",
    "studios", "villa", "villas", "airport", "port", "harbor", "harbour", "town", "center", "centre",
    "limani", "chora", "hora", "mykonos", "santorini", "rhodes", "kos", "corfu", "heraklion", "paros",
    "milos", "athens", "tinos", "naxos", "kefalonia", "kea", "zakynthos", "zante", "bodrum", "lefkada",
  ]);
  function coreTokens(text) {
    return normalizeText(text)
      .split(" ")
      .filter((t) => t && !areaTokens.has(t) && !genericStopwords.has(t));
  }
  const queryBase = areaNorm ? normalizeText(queryNorm.replace(new RegExp(`\\b${areaNorm}\\b`, "g"), " ")) : queryNorm;
  const rawCandidates = [normalizeText(poi.name), ...(Array.isArray(poi.aliases) ? poi.aliases.map(normalizeText) : [])].filter(Boolean);
  const candidates = new Set();
  for (const c of rawCandidates) {
    candidates.add(c);
    if (areaNorm && c.includes(areaNorm)) {
      const stripped = normalizeText(c.replace(new RegExp(`\\b${areaNorm}\\b`, "g"), " "));
      const strippedTokens = stripped.split(" ").filter(Boolean);
      const meaningfulTokens = strippedTokens.filter((t) => !genericStopwords.has(t));
      if (meaningfulTokens.length > 0) candidates.add(stripped);
    }
  }
  const queryJoined = queryNorm.replace(/\s+/g, "");
  const queryBaseJoined = queryBase.replace(/\s+/g, "");
  const queryCoreJoined = coreTokens(queryBase).join("");
  let best = 0;

  function levenshtein(a, b) {
    const m = a.length;
    const n = b.length;
    if (!m) return n;
    if (!n) return m;
    const dp = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[j] = Math.min(
          dp[j] + 1,
          dp[j - 1] + 1,
          prev + cost
        );
        prev = tmp;
      }
    }
    return dp[n];
  }

  function trigramSet(s) {
    const out = new Set();
    for (let i = 0; i + 2 < s.length; i++) out.add(s.slice(i, i + 3));
    return out;
  }

  function hasTrigramOverlap(a, b) {
    if (a.length < 5 || b.length < 5) return false;
    const aa = trigramSet(a);
    if (!aa.size) return false;
    let overlaps = 0;
    for (const tri of trigramSet(b)) {
      if (aa.has(tri)) overlaps += 1;
      if (overlaps >= 2) return true;
    }
    return false;
  }

  for (const cand of candidates) {
    if (!cand) continue;
    const candJoined = cand.replace(/\s+/g, "");
    const candCoreJoined = coreTokens(cand).join("");
    if (queryNorm === cand || queryBase === cand) best = Math.max(best, 1.0);
    else if (
      (queryJoined && candJoined && (candJoined.includes(queryJoined) || queryJoined.includes(candJoined))) ||
      (queryBaseJoined && candJoined && (candJoined.includes(queryBaseJoined) || queryBaseJoined.includes(candJoined))) ||
      (queryCoreJoined && candCoreJoined && (candCoreJoined.includes(queryCoreJoined) || queryCoreJoined.includes(candCoreJoined)))
    ) {
      best = Math.max(best, queryCoreJoined && candCoreJoined ? 0.94 : 0.9);
    }
    else if (queryJoined && candJoined) {
      const qv = queryCoreJoined || queryBaseJoined || queryJoined;
      const cv = candCoreJoined || candJoined;
      const maxLen = Math.max(qv.length, cv.length);
      if (maxLen >= 6 && hasTrigramOverlap(qv, cv)) {
        const d = levenshtein(qv, cv);
        if (d <= 2) best = Math.max(best, 0.86);
        else if (d <= 4) best = Math.max(best, 0.74);
      }
    }
    else if (cand.includes(queryNorm) || queryNorm.includes(cand)) best = Math.max(best, 0.82);
    else {
      const qTokens = queryNorm.split(" ");
      const cTokens = cand.split(" ");
      const overlap = qTokens.filter((t) => cTokens.includes(t)).length;
      const tokenScore = overlap / Math.max(1, qTokens.length);
      best = Math.max(best, tokenScore * 0.75);
    }
  }
  return best;
}

function hasAnyToken(queryNorm, tokens) {
  const padded = ` ${queryNorm} `;
  return tokens.some((t) => {
    const tt = normalizeText(t);
    if (!tt) return false;
    if (tt.length <= 3) return padded.includes(` ${tt} `);
    return padded.includes(` ${tt} `) || queryNorm === tt;
  });
}

function scoreTypeBoost(queryNorm, poi) {
  const type = String(poi.type || "");
  const name = normalizeText(poi.name || "");
  let boost = 0;

  const airportQuery = hasAnyToken(queryNorm, ["airport", "aerodrome", "aerodromio", "αεροδρ"]);
  const portQuery = !airportQuery && hasAnyToken(queryNorm, ["port", "harbor", "harbour", "limani", "λιμανι", "λιμάνι"]);
  const townQuery = hasAnyToken(queryNorm, ["town", "center", "centre", "chora", "hora", "χωρα", "χώρα"]);

  if (airportQuery) {
    if (type === "airport") boost += 0.45;
    if (name.includes("airport") || name.includes("αερο")) boost += 0.2;
    if (type === "town_center") boost -= 0.3;
  }

  if (portQuery) {
    if (type === "port") boost += 0.45;
    if (name.includes("port") || name.includes("harbor") || name.includes("harbour") || name.includes("λιμαν")) boost += 0.2;
    if (type === "town_center") boost -= 0.2;
  }

  if (townQuery) {
    if (type === "town_center") boost += 0.3;
  }

  // If caller did not ask for a port-like location, penalize transport/port variants.
  if (!portQuery && !airportQuery) {
    if (type === "port") boost -= 0.28;
    if (
      name.includes("boat") ||
      name.includes("ferry") ||
      name.includes("pier") ||
      name.includes("harbor") ||
      name.includes("harbour")
    ) {
      boost -= 0.22;
    }
  }

  return boost;
}

function waypointFromPoi(poi) {
  return clean({
    exactLatLng: { lat: poi.lat, lng: poi.lng },
    placeLatLng: { lat: poi.lat, lng: poi.lng },
    premise: poi.name,
    poiName: poi.name,
    countryCode: poi.countryCode || undefined,
  });
}

function resolvePlaceFromLocalDb(payload) {
  const islandRaw = String(payload?.island || "").trim();
  if (!islandRaw) {
    return {
      error: "missing_island",
      message: "Please tell me which island you are located in first.",
    };
  }

  const areaId = canonicalAreaId(islandRaw);
  if (!areaId) {
    return {
      error: "unsupported_island",
      message: "Unfortunately we do not operate in that area.",
      supported: SUPPORTED_AREAS,
    };
  }

  const queryNorm = normalizeText(payload?.query || "");
  if (!queryNorm) return { error: "missing_query" };

  const area = POI_DB.byId.get(areaId);
  const pois = Array.isArray(area?.pois) ? area.pois : [];
  const rankedRaw = pois
    .map((poi) => ({
      poi,
      score: scorePoiMatch(queryNorm, poi, area?.name || "") + scoreTypeBoost(queryNorm, poi),
    }))
    .filter((x) => x.score >= 0.45)
    .sort((a, b) => b.score - a.score);

  const airportQuery = hasAnyToken(queryNorm, ["airport", "aerodrome", "aerodromio", "αεροδρ"]);
  const portQuery = !airportQuery && hasAnyToken(queryNorm, ["port", "harbor", "harbour", "limani", "λιμανι", "λιμάνι"]);

  if (airportQuery) {
    const airportIdx = rankedRaw.findIndex((x) => x.poi.type === "airport");
    if (airportIdx > 0) {
      const [airport] = rankedRaw.splice(airportIdx, 1);
      rankedRaw.unshift(airport);
    }
  }
  if (portQuery) {
    const portIdx = rankedRaw.findIndex((x) => x.poi.type === "port");
    if (portIdx > 0) {
      const [port] = rankedRaw.splice(portIdx, 1);
      rankedRaw.unshift(port);
    }
  }

  const ranked = rankedRaw
    .slice(0, 5)
    .map((x) => ({
      place_id: x.poi.id,
      label: x.poi.name,
      confidence: Number(Math.min(0.99, 0.5 + x.score * 0.5).toFixed(2)),
      lat: x.poi.lat,
      lng: x.poi.lng,
      waypoint: waypointFromPoi(x.poi),
      type: x.poi.type,
      source: x.poi.source || "poi_db",
    }));

  if (!ranked.length) {
    return {
      error: "poi_not_found_in_area",
      message: "I could not find that location in this area. Please spell the location name.",
      area: area?.name || islandRaw,
    };
  }

  return {
    provider: "poi_db",
    area: area?.name || islandRaw,
    kind: payload?.kind,
    query: payload?.query,
    best: ranked[0],
    alternatives: ranked.slice(1),
  };
}

async function resolvePlaceWithNominatim(payload) {
  const query = buildResolverQuery(payload);
  if (!query) return { error: "missing_query" };

  const cacheKey = resolverCacheKey(payload);
  const cached = placeCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < 10 * 60 * 1000) {
    return cached.value;
  }

  const waitMs = NOMINATIM_MIN_INTERVAL_MS - (Date.now() - lastNominatimCallAt);
  if (waitMs > 0) await sleep(waitMs);
  lastNominatimCallAt = Date.now();

  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    addressdetails: "1",
    limit: "5",
    countrycodes: NOMINATIM_COUNTRY_CODES,
  });
  if (payload?.language) params.set("accept-language", payload.language);
  if (NOMINATIM_EMAIL) params.set("email", NOMINATIM_EMAIL);

  const data = await requestJson(`${NOMINATIM_BASE_URL}/search?${params.toString()}`, {
    method: "GET",
    headers: {
      "User-Agent": NOMINATIM_USER_AGENT,
      Accept: "application/json",
    },
  });

  const list = Array.isArray(data) ? data : [];
  const ranked = list.map((item, index) => {
    const importance = Number.isFinite(Number(item?.importance)) ? Number(item.importance) : 0;
    const confidence = Math.max(0.1, Math.min(0.98, importance + (index === 0 ? 0.12 : 0)));
    return {
      place_id: String(item?.place_id || ""),
      label: item?.display_name || item?.name || "",
      confidence: Number(confidence.toFixed(2)),
      lat: parseNominatimFloat(item?.lat),
      lng: parseNominatimFloat(item?.lon),
      waypoint: mapNominatimToWaypoint(item),
    };
  }).filter((x) => x.label && Number.isFinite(x.lat) && Number.isFinite(x.lng));

  const areaId = canonicalAreaId(payload?.island || "");
  const area = areaId ? POI_DB.byId.get(areaId) : null;
  const bounded = area && Number.isFinite(area.lat) && Number.isFinite(area.lng) && Number.isFinite(area.radiusM)
    ? ranked.filter((x) => haversineMeters(area.lat, area.lng, x.lat, x.lng) <= area.radiusM * 1.35)
    : ranked;

  const value = {
    query,
    kind: payload?.kind,
    best: bounded[0] || null,
    alternatives: bounded.slice(1, 4),
    provider: "nominatim",
  };

  placeCache.set(cacheKey, { cachedAt: Date.now(), value });
  return value;
}

function ondeHeaders() {
  const scheme = String(ONDE_AUTH_SCHEME || "").trim();
  const authValue = scheme ? `${scheme} ${ONDE_OPERATOR_TOKEN}` : ONDE_OPERATOR_TOKEN;
  return {
    "Content-Type": "application/json",
    ...(ONDE_OPERATOR_TOKEN ? { Authorization: authValue } : {}),
  };
}

function makeIdempotencyKey(prefix, callState) {
  const base = [prefix, callState?.uuid || crypto.randomUUID(), Date.now()].join("-");
  return base.slice(0, 120);
}

function nqServiceHeaders(extra = {}, companyId = "") {
  return {
    "Content-Type": "application/json",
    ...(NQ_SERVICE_TOKEN ? { Authorization: `Bearer ${NQ_SERVICE_TOKEN}` } : {}),
    ...(companyId ? { "x-company-id": companyId } : {}),
    ...extra,
  };
}

async function nqResolveCompanyContextByNumber(numberId) {
  const key = String(numberId || "").trim();
  if (!NQ_BASE_URL || !NQ_SERVICE_TOKEN || !key) return null;
  const cached = nqCallContextCache.get(key);
  if (cached && Date.now() - cached.cachedAt < 10 * 60 * 1000) return cached.value;
  try {
    const data = await requestJson(
      `${NQ_BASE_URL}/v1/private/channels/resolve/call/${encodeURIComponent(key)}`,
      {
        method: "GET",
        headers: nqServiceHeaders(),
      },
      NQ_TIMEOUT_MS
    );
    const value = {
      companyId: String(data?.company_id || "").trim(),
      companyCode: String(data?.code || "").trim(),
    };
    if (value.companyId) nqCallContextCache.set(key, { cachedAt: Date.now(), value });
    return value.companyId ? value : null;
  } catch (err) {
    console.log("nq_resolve_company_error", {
      numberId: key,
      message: err?.message || String(err),
    });
    return null;
  }
}

async function ensureNqCallContext(callState) {
  if (!callState) return { companyId: "", companyCode: "" };
  if (callState.companyId || callState.companyCode) {
    return { companyId: callState.companyId || "", companyCode: callState.companyCode || "" };
  }
  if (NQ_COMPANY_ID || NQ_COMPANY_CODE) {
    callState.companyId = NQ_COMPANY_ID || callState.companyId || "";
    callState.companyCode = NQ_COMPANY_CODE || callState.companyCode || "";
    return { companyId: callState.companyId || "", companyCode: callState.companyCode || "" };
  }
  const numberId = callState.numberId || NQ_CALL_NUMBER_ID;
  if (!numberId) return { companyId: "", companyCode: "" };
  const resolved = await nqResolveCompanyContextByNumber(numberId);
  if (resolved?.companyId) {
    callState.companyId = resolved.companyId;
    callState.companyCode = resolved.companyCode || callState.companyCode || "";
  }
  return { companyId: callState.companyId || "", companyCode: callState.companyCode || "" };
}

async function nqListVehicleCategories(companyId) {
  const key = String(companyId || "").trim();
  if (!NQ_BASE_URL || !NQ_SERVICE_TOKEN || !key) return [];
  const cached = nqVehicleCategoryCache.get(key);
  if (cached && Date.now() - cached.cachedAt < 10 * 60 * 1000) {
    return cached.items;
  }
  try {
    const data = await requestJson(
      `${NQ_BASE_URL}/v1/private/companies/${encodeURIComponent(key)}/vehicle-categories?limit=100`,
      {
        method: "GET",
        headers: nqServiceHeaders({}, key),
      },
      NQ_TIMEOUT_MS
    );
    const items = Array.isArray(data?.items)
      ? data.items
          .map((item) => ({
            name: String(item?.name || "").trim(),
            status: String(item?.status || "").trim().toLowerCase(),
            capacity: Number(item?.passenger_capacity || 0),
          }))
          .filter((item) => item.name && item.status !== "disabled")
      : [];
    nqVehicleCategoryCache.set(key, { cachedAt: Date.now(), items });
    return items;
  } catch (err) {
    console.log("nq_list_vehicle_categories_error", {
      companyId: key,
      message: err?.message || String(err),
    });
    return [];
  }
}

function pickNqVehicleCategoryName(categories, requestedVehicleType, passengers) {
  if (!Array.isArray(categories) || categories.length === 0) return undefined;
  const requestedRaw = String(requestedVehicleType || "").trim();
  const requestedNorm = normalizeText(requestedRaw);
  const pax = Math.max(1, Number(passengers || 1) || 1);

  if (requestedNorm) {
    const exact = categories.find((c) => normalizeText(c.name) === requestedNorm);
    if (exact?.name) return exact.name;
  }

  const pref = normalizeVehiclePreference(requestedVehicleType);
  const withCapacity = categories
    .filter((c) => Number.isFinite(c.capacity) && c.capacity > 0)
    .sort((a, b) => a.capacity - b.capacity);

  if (pref === "van") {
    const byName = categories.find((c) => /van|minivan|mini bus|minibus|bus/i.test(c.name));
    if (byName?.name) return byName.name;
    const byCapacity = withCapacity.find((c) => c.capacity >= Math.max(5, pax));
    if (byCapacity?.name) return byCapacity.name;
    return withCapacity[withCapacity.length - 1]?.name || categories[0]?.name || undefined;
  }

  const standardLike = categories.find((c) => /economy|standard|sedan|car/i.test(c.name));
  if (pref === "standard" && standardLike?.name) return standardLike.name;
  const smallestThatFits = withCapacity.find((c) => c.capacity >= pax);
  if (smallestThatFits?.name) return smallestThatFits.name;
  return standardLike?.name || withCapacity[0]?.name || categories[0]?.name || undefined;
}

async function resolveNqVehicleCategoryName(callState, requestedVehicleType, passengers) {
  const ctx = await ensureNqCallContext(callState);
  if (!ctx.companyId) return undefined;
  const categories = await nqListVehicleCategories(ctx.companyId);
  return pickNqVehicleCategoryName(categories, requestedVehicleType, passengers);
}

async function nqIssuePublicToken(companyId) {
  if (!NQ_BASE_URL || !NQ_PUBLIC_CLIENT_ID || !NQ_PUBLIC_CLIENT_SECRET || !companyId) {
    return "";
  }
  const cache = nqPublicTokenCache.get(companyId);
  if (cache && cache.token && cache.expiresAt > Date.now() + 45_000) {
    return cache.token;
  }
  try {
    const data = await requestJson(
      `${NQ_BASE_URL}/v1/public/auth/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: NQ_PUBLIC_CLIENT_ID,
          client_secret: NQ_PUBLIC_CLIENT_SECRET,
          tenant_id: companyId,
        }),
      },
      NQ_TIMEOUT_MS
    );
    const token = String(data?.access_token || "").trim();
    if (!token) return "";
    const expiresIn = Number(data?.expires_in_sec || data?.expires_in || 900);
    nqPublicTokenCache.set(companyId, {
      token,
      expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
    });
    return token;
  } catch (err) {
    console.log("nq_public_token_error", {
      companyId,
      message: err?.message || String(err),
    });
    return "";
  }
}

async function nqCreateQuote(callState, input) {
  if (!NQ_BASE_URL) return { error: "nq_not_configured" };
  const ctx = await ensureNqCallContext(callState);
  if (!ctx.companyId) return { error: "nq_company_not_resolved" };
  const token = await nqIssuePublicToken(ctx.companyId);
  if (!token) return { error: "nq_public_token_unavailable" };
  try {
    return await requestJson(
      `${NQ_BASE_URL}/v1/public/dispatch/quotes`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "idempotency-key": makeIdempotencyKey("nq-quote", callState),
        },
        body: JSON.stringify(
          clean({
            tenant_id: ctx.companyId,
            pickup: input?.pickup,
            dropoff: input?.dropoff,
            vehicle_category: input?.vehicle_category,
          })
        ),
      },
      NQ_TIMEOUT_MS
    );
  } catch (err) {
    return {
      error: "nq_quote_failed",
      message: err?.message || String(err),
    };
  }
}

async function nqCreateOrder(callState, payload) {
  if (!NQ_BASE_URL || !NQ_SERVICE_TOKEN) return { error: "nq_not_configured" };
  const ctx = await ensureNqCallContext(callState);
  const numberId = callState?.numberId || NQ_CALL_NUMBER_ID;
  try {
    if (numberId) {
      return await requestJson(
        `${NQ_BASE_URL}/v1/private/channels/call/orders`,
        {
          method: "POST",
          headers: nqServiceHeaders(
            { "idempotency-key": makeIdempotencyKey("nq-call-order", callState) },
            ctx.companyId
          ),
          body: JSON.stringify(
            clean({
              number_id: numberId,
              ...payload,
            })
          ),
        },
        NQ_TIMEOUT_MS
      );
    }
    if (!ctx.companyId) {
      return { error: "nq_company_not_resolved" };
    }
    return await requestJson(
      `${NQ_BASE_URL}/v1/private/orders/orders`,
      {
        method: "POST",
        headers: nqServiceHeaders(
          { "idempotency-key": makeIdempotencyKey("nq-order", callState) },
          ctx.companyId
        ),
        body: JSON.stringify(
          clean({
            source_channel: "call",
            ...payload,
          })
        ),
      },
      NQ_TIMEOUT_MS
    );
  } catch (err) {
    return {
      error: "nq_create_order_failed",
      message: err?.message || String(err),
    };
  }
}

async function nqCancelOrder(callState, orderId, reason = "client_request") {
  if (!NQ_BASE_URL || !NQ_SERVICE_TOKEN) return { error: "nq_not_configured" };
  if (!orderId) return { error: "missing_order_id" };
  const ctx = await ensureNqCallContext(callState);
  if (!ctx.companyId) return { error: "nq_company_not_resolved" };
  try {
    return await requestJson(
      `${NQ_BASE_URL}/v1/private/orders/orders/${encodeURIComponent(orderId)}/cancel`,
      {
        method: "POST",
        headers: nqServiceHeaders(
          { "idempotency-key": makeIdempotencyKey("nq-cancel", callState) },
          ctx.companyId
        ),
        body: JSON.stringify({ reason }),
      },
      NQ_TIMEOUT_MS
    );
  } catch (err) {
    return {
      error: "nq_cancel_order_failed",
      message: err?.message || String(err),
    };
  }
}

async function ondeCreateOrder(orderRequest) {
  if (!ONDE_BASE_URL || !ONDE_OPERATOR_TOKEN) {
    return { error: "onde_not_configured" };
  }
  console.log("onde_create_order_request", {
    waypoints: Array.isArray(orderRequest?.waypoints) ? orderRequest.waypoints.length : 0,
    hasClientPhone: Boolean(orderRequest?.client?.phone),
    numberOfSeats: orderRequest?.numberOfSeats,
    pickupTime: orderRequest?.pickupTime || "now",
  });
  try {
    return await requestJson(`${ONDE_BASE_URL}/dispatch/v1/order/`, {
      method: "POST",
      headers: ondeHeaders(),
      body: JSON.stringify(clean(orderRequest)),
    });
  } catch (err) {
    console.log("onde_create_order_error", {
      message: err?.message || String(err),
    });
    return {
      error: "onde_create_order_failed",
      message: err?.message || String(err),
    };
  }
}

async function ondeGetTariffs(query) {
  if (!ONDE_BASE_URL || !ONDE_OPERATOR_TOKEN) {
    return { error: "onde_not_configured" };
  }
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(clean(query || {}))) {
    if (Array.isArray(v)) {
      for (const item of v) params.append(k, String(item));
    } else {
      params.set(k, String(v));
    }
  }
  const url = `${ONDE_BASE_URL}/dispatch/v1/tariff${params.toString() ? `?${params.toString()}` : ""}`;
  try {
    return await requestJson(url, { method: "GET", headers: ondeHeaders() });
  } catch (err) {
    console.log("onde_get_tariffs_error", { message: err?.message || String(err) });
    return { error: "onde_get_tariffs_failed", message: err?.message || String(err) };
  }
}

async function ondeGetOrderOffer(orderId) {
  if (!ONDE_BASE_URL || !ONDE_OPERATOR_TOKEN) {
    return { error: "onde_not_configured" };
  }
  try {
    return await requestJson(`${ONDE_BASE_URL}/dispatch/v1/order/${encodeURIComponent(orderId)}/offer`, {
      method: "GET",
      headers: ondeHeaders(),
    });
  } catch (err) {
    console.log("onde_get_offer_error", { message: err?.message || String(err), orderId });
    return { error: "onde_get_offer_failed", message: err?.message || String(err) };
  }
}

function firstString(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function findShareLocationUrl(obj) {
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== "object") return "";
    if (seen.has(node)) return "";
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = walk(item);
        if (found) return found;
      }
      return "";
    }
    for (const value of Object.values(node)) {
      if (typeof value === "string" && value.includes("sharelocation.online")) return value;
    }
    for (const value of Object.values(node)) {
      const found = walk(value);
      if (found) return found;
    }
    return "";
  };
  return walk(obj);
}

function buildBookingWhatsappMessage({ offer, orderResult }) {
  const driverName = firstString(
    offer?.driver?.name,
    [offer?.driver?.firstName, offer?.driver?.lastName].filter(Boolean).join(" "),
    offer?.driverName
  );
  const driverPhone = firstString(offer?.driver?.phone, offer?.driverPhone);
  const carModel = firstString(
    offer?.driver?.car?.model,
    offer?.driver?.carModel,
    offer?.car?.model,
    offer?.carModel
  );
  const plate = firstString(
    offer?.driver?.car?.numberPlate,
    offer?.driver?.car?.plate,
    offer?.car?.numberPlate,
    offer?.car?.plate
  );
  const liveLocation = firstString(
    findShareLocationUrl(offer),
    findShareLocationUrl(orderResult),
    orderResult?.shareLocationUrl,
    orderResult?.trackingUrl
  );

  return [
    "Aegean Taxi Booking Confirmation:",
    "",
    `Driver Phone: ${driverPhone || "Pending assignment"}`,
    `Driver Name : ${driverName || "Pending assignment"}`,
    `Car Model: ${carModel || "Pending assignment"}`,
    `Number plate: ${plate || "Pending assignment"}`,
    "",
    `Live Location: ${liveLocation || "Will be shared when a driver is assigned."}`,
  ].join("\n");
}

async function ondeCancelOrder(orderId, reason) {
  if (!ONDE_BASE_URL || !ONDE_OPERATOR_TOKEN) {
    return { error: "onde_not_configured" };
  }
  if (!orderId) {
    return { error: "missing_order_id" };
  }

  const encodedId = encodeURIComponent(orderId);
  const body = clean({ reason: reason || "client_request" });
  const attempts = [
    { method: "POST", url: `${ONDE_BASE_URL}/dispatch/v1/order/${encodedId}/cancel`, body },
    { method: "POST", url: `${ONDE_BASE_URL}/dispatch/v1/order/${encodedId}/cancellation`, body },
    { method: "PATCH", url: `${ONDE_BASE_URL}/dispatch/v1/order/${encodedId}`, body: clean({ status: "CANCELLED", ...body }) },
  ];

  let lastErr = null;
  for (const attempt of attempts) {
    try {
      const result = await requestJson(attempt.url, {
        method: attempt.method,
        headers: ondeHeaders(),
        body: attempt.body ? JSON.stringify(attempt.body) : undefined,
      });
      return {
        ok: true,
        orderId,
        method: attempt.method,
        endpoint: attempt.url,
        result,
      };
    } catch (err) {
      lastErr = err;
    }
  }

  return {
    error: "onde_cancel_order_failed",
    orderId,
    message: lastErr?.message || "Unknown cancel error",
  };
}

async function resolvePlace(payload) {
  const local = resolvePlaceFromLocalDb(payload);
  if (!local.error) return local;
  if (local.error === "unsupported_island" || local.error === "missing_island") return local;

  if (PLACE_RESOLVER_URL) {
    try {
      const remote = await requestJson(PLACE_RESOLVER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(PLACE_RESOLVER_KEY ? { Authorization: `Bearer ${PLACE_RESOLVER_KEY}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      if (remote?.best || remote?.waypoint) return remote;
      if (!ENABLE_NOMINATIM_FALLBACK) return remote;
    } catch (err) {
      console.log("remote_resolver_error", {
        message: err?.message || String(err),
        island: payload?.island || "",
        kind: payload?.kind || "",
      });
      if (!ENABLE_NOMINATIM_FALLBACK) {
        return {
          ...local,
          error: "resolver_remote_failed",
          message: "Location resolver is temporarily unavailable.",
        };
      }
    }
  }

  if (!ENABLE_NOMINATIM_FALLBACK) return local;
  const nominatim = await resolvePlaceWithNominatim(payload);
  if (!nominatim?.best) {
    return {
      ...local,
      provider: "poi_db",
    };
  }
  return nominatim;
}

async function sendWhatsapp(payload) {
  const normalizedPhone = String(payload?.phone || "").replace(/[^\d]/g, "");
  if (!normalizedPhone) {
    return { skipped: true, reason: "missing_phone" };
  }

  if (WHATSAPP_PROVIDER === "meta_cloud") {
    if (!WHATSAPP_META_TOKEN || !WHATSAPP_META_PHONE_NUMBER_ID) {
      return { skipped: true, reason: "whatsapp_meta_not_configured" };
    }
    return requestJson(
      `https://graph.facebook.com/${WHATSAPP_META_API_VERSION}/${encodeURIComponent(WHATSAPP_META_PHONE_NUMBER_ID)}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${WHATSAPP_META_TOKEN}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: normalizedPhone,
          type: "text",
          text: {
            body: String(payload?.message || "Your ride details are confirmed.").slice(0, 4096),
          },
        }),
      }
    );
  }

  if (!WHATSAPP_BASE_URL) {
    return { skipped: true, reason: "whatsapp_not_configured" };
  }
  return requestJson(
    `${WHATSAPP_BASE_URL}${WHATSAPP_SEND_PATH.startsWith("/") ? WHATSAPP_SEND_PATH : `/${WHATSAPP_SEND_PATH}`}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(WHATSAPP_API_KEY ? { "X-API-Key": WHATSAPP_API_KEY } : {}),
      },
      body: JSON.stringify({ ...payload, phone: normalizedPhone }),
    }
  );
}

function extractOrderId(result) {
  return String(
    result?.orderId ||
      result?.order_id ||
      result?.order?.orderId ||
      result?.order?.order_id ||
      ""
  ).trim();
}

function normalizeConversationPhone(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeConversationName(value) {
  return String(value || "").trim().toLowerCase();
}

function buildNqConversationId(callState) {
  const companyId = String(callState?.companyId || NQ_COMPANY_ID || "").trim();
  if (!companyId) return "";
  const callId = String(callState?.uuid || "").trim().toLowerCase();
  const phone = normalizeConversationPhone(callState?.phone || callState?.from || "");
  const name = normalizeConversationName(callState?.name || "");
  const payload = `${companyId}|${phone}|${name}|${callId}`;
  const digest = crypto.createHash("sha1").update(payload).digest("hex").slice(0, 14);
  return `conv_${companyId}_${digest}`;
}

function transcriptSenderFromSpeaker(speaker) {
  const s = String(speaker || "").trim().toLowerCase();
  if (s === "caller" || s === "client" || s === "user") return "caller";
  if (s === "agent") return "agent";
  return "system";
}

async function sinkTranscriptToNq(callState, speaker, text) {
  if (ACTIVE_BACKEND_MODE !== "nq" || !NQ_TRANSCRIPT_ENABLED) return;
  const cleanedText = String(text || "").trim();
  if (!cleanedText || !NQ_BASE_URL || !NQ_SERVICE_TOKEN) return;

  await ensureNqCallContext(callState);
  if (!callState?.companyId) return;

  if (!callState.nqConversationId) {
    callState.nqConversationId = buildNqConversationId(callState);
  }
  if (!callState.nqConversationId) return;

  try {
    await requestJson(
      `${NQ_BASE_URL}/v1/private/channels/call/transcripts`,
      {
        method: "POST",
        headers: nqServiceHeaders({ "idempotency-key": makeIdempotencyKey("nq-transcript", callState) }, callState.companyId),
        body: JSON.stringify(
          clean({
            number_id: callState.numberId || NQ_CALL_NUMBER_ID || undefined,
            company_id: callState.companyId,
            call_id: callState.uuid,
            conversation_id: callState.nqConversationId,
            customer_name: callState.name || undefined,
            customer_phone: callState.phone || undefined,
            sender: transcriptSenderFromSpeaker(speaker),
            text: cleanedText,
          })
        ),
      },
      NQ_TIMEOUT_MS
    );
  } catch (err) {
    console.log("nq_transcript_sink_error", {
      uuid: callState?.uuid || "",
      message: err?.message || String(err),
    });
  }
}

function extractAssistantTextFromOutputItem(item) {
  if (!item || typeof item !== "object") return "";
  const collected = [];
  const content = Array.isArray(item.content) ? item.content : [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    if (typeof part.text === "string" && part.text.trim()) collected.push(part.text.trim());
    if (typeof part.transcript === "string" && part.transcript.trim()) collected.push(part.transcript.trim());
    if (typeof part.output_text === "string" && part.output_text.trim()) collected.push(part.output_text.trim());
  }
  return collected.join(" ").replace(/\s+/g, " ").trim();
}

function waypointFromParts(rawAddress, lat, lng) {
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return {
      exactLatLng: { lat, lng },
      placeLatLng: { lat, lng },
      premise: rawAddress || undefined,
      poiName: rawAddress || undefined,
    };
  }
  return {
    premise: rawAddress || undefined,
    poiName: rawAddress || undefined,
  };
}

const callRegistry = new Map();

app.get("/", (req, res) => res.status(200).send("OK"));

function callStateToDashboardEntry(callState) {
  const startedAt = callState?.startedAt ? new Date(callState.startedAt).toISOString() : nowIso();
  const durationMs = callState?.startedAt ? Date.now() - callState.startedAt : 0;
  const base = {
    uuid: callState?.uuid || "",
    backendMode: ACTIVE_BACKEND_MODE,
    startedAt,
    endedAt: null,
    durationMs,
    from: callState?.from || "",
    to: callState?.to || "",
    intent: callState?.intent || "unknown",
    island: callState?.island || "",
    pickup: callState?.pickupRaw || "",
    dropoff: callState?.dropoffRaw || "",
    passengers: Number(callState?.passengers || 0) || 0,
    turns: Number(callState?.turnCount || 0) || 0,
    bookingCreated: Boolean(callState?.orderId),
    orderId: callState?.orderId || "",
    priceCheckDone: Boolean(callState?.lastTariffs),
    whatsappSent: Boolean(callState?.whatsappStatus?.sent),
    bookingFailures: Number(callState?.bookingFailures || 0) || 0,
    resolveFailures: Number(callState?.resolveFailures || 0) || 0,
    quoteFailures: Number(callState?.quoteFailures || 0) || 0,
    cancelActionDone: Boolean(callState?.cancelActionDone),
    endCallRequested: Boolean(callState?.endCallRequested),
    endCallReason: callState?.endCallReason || "",
    bookingFor: callState?.bookingFor || "unknown",
    pickupTime: callState?.pickupTime || "now",
    scheduledDate: callState?.scheduledDate || "",
    scheduledTime: callState?.scheduledTime || "",
    category: callState?.vehicleTypePreference || "",
    clientName: callState?.name || "",
    parsedSummary: callState?.parsedSummary || null,
    handover: callState?.handover || null,
    transcripts: Array.isArray(callState?.transcripts) ? callState.transcripts.slice(-120) : [],
    reviewed: false,
    reviewLabel: "",
    reviewNotes: "",
    openaiUsageTotals: callState?.openaiUsageTotals || {
      inputTextTokens: 0,
      outputTextTokens: 0,
      inputAudioTokens: 0,
      outputAudioTokens: 0,
      totalTokens: 0,
    },
    openaiEstimatedCostRange: estimateOpenAiCostRangeFromTotal(callState?.openaiUsageTotals?.totalTokens || 0),
  };
  const status = classifyCallStatus(base);
  return { ...base, statusCode: status.code, statusColor: status.color };
}

app.get("/dashboard/calls", (req, res) => {
  res.sendFile(DASHBOARD_CALLS_FILE);
});

app.get("/api/dashboard/calls", (req, res) => {
  const limitRaw = Number(req.query?.limit || 200);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(2000, limitRaw)) : 200;
  const dateFilter = String(req.query?.date || "").trim();
  const audit = loadCallAudit();
  const active = Array.from(callRegistry.values()).map((c) => callStateToDashboardEntry(c));
  const activeByUuid = new Map(active.map((x) => [x.uuid, x]));
  const merged = [];
  for (const row of active) merged.push(row);
  for (const row of audit.calls) {
    if (activeByUuid.has(row.uuid)) continue;
    merged.push(row);
  }
  merged.sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")));
  const filtered = dateFilter
    ? merged.filter((c) => String(c.startedAt || "").slice(0, 10) === dateFilter)
    : merged;
  res.json({ ok: true, count: filtered.length, calls: filtered.slice(0, limit) });
});

app.post("/api/dashboard/calls/:uuid/review", (req, res) => {
  const uuid = String(req.params?.uuid || "").trim();
  if (!uuid) {
    res.status(400).json({ ok: false, error: "missing_uuid" });
    return;
  }
  const reviewed = Boolean(req.body?.reviewed);
  const reviewLabel = String(req.body?.reviewLabel || "").slice(0, 64);
  const reviewNotes = String(req.body?.reviewNotes || "").slice(0, 2000);
  const audit = loadCallAudit();
  const idx = audit.calls.findIndex((c) => c.uuid === uuid);
  if (idx < 0) {
    res.status(404).json({ ok: false, error: "call_not_found" });
    return;
  }
  audit.calls[idx] = {
    ...audit.calls[idx],
    reviewed,
    reviewLabel,
    reviewNotes,
    reviewedAt: reviewed ? nowIso() : null,
  };
  saveCallAudit(audit);
  res.json({ ok: true, call: audit.calls[idx] });
});

app.post("/ai/resolve-place", async (req, res) => {
  try {
    const payload = {
      island: req.body?.island || "",
      query: req.body?.query || "",
      kind: req.body?.kind || "",
      language: req.body?.language || "en",
    };
    const result = await resolvePlace(payload);
    res.json(result);
  } catch (err) {
    res.status(502).json({
      error: "resolver_failed",
      message: err?.message || String(err),
    });
  }
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    time: nowIso(),
    hasOpenAIKey: Boolean(OPENAI_API_KEY),
    model: OPENAI_REALTIME_MODEL,
    voice: OPENAI_VOICE,
    sttModel: OPENAI_STT_MODEL,
    voiceStackMode: VOICE_STACK_MODE,
    deepgramModel: DEEPGRAM_MODEL,
    elevenLabsVoiceId: ELEVENLABS_VOICE_ID || "",
    integrations: {
      backendMode: ACTIVE_BACKEND_MODE,
      ondeConfigured: false,
      ondeModeDisabled: true,
      nqConfigured: Boolean(NQ_BASE_URL && NQ_SERVICE_TOKEN),
      nqCallNumberIdConfigured: Boolean(NQ_CALL_NUMBER_ID),
      nqCompanyIdConfigured: Boolean(NQ_COMPANY_ID),
      nqQuoteConfigured: Boolean(NQ_PUBLIC_CLIENT_ID && NQ_PUBLIC_CLIENT_SECRET),
      nqTranscriptEnabled: Boolean(NQ_TRANSCRIPT_ENABLED),
      placeResolverConfigured: Boolean(PLACE_RESOLVER_URL || NOMINATIM_BASE_URL),
      placeResolverMode: PLACE_RESOLVER_URL ? "poi_db+remote+optional_nominatim" : "poi_db+internal_nominatim",
      poiDbLoaded: POI_DB.totalPois > 0,
      poiDbPois: POI_DB.totalPois,
      supportedAreas: SUPPORTED_AREAS,
      whatsappConfigured: WHATSAPP_PROVIDER === "meta_cloud"
        ? Boolean(WHATSAPP_META_TOKEN && WHATSAPP_META_PHONE_NUMBER_ID)
        : Boolean(WHATSAPP_BASE_URL),
      whatsappProvider: WHATSAPP_PROVIDER,
      wsTokenEnabled: Boolean(WS_SHARED_SECRET),
      deepgramConfigured: Boolean(DEEPGRAM_API_KEY),
      elevenlabsConfigured: Boolean(ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID),
    },
  });
});

app.post("/vonage/voice/event", (req, res) => {
  const uuid = req.body?.uuid || req.query?.uuid || "unknown";
  const status = req.body?.status || req.body?.type || "unknown";
  const call = callRegistry.get(uuid);
  console.log("vonage_event", {
    uuid,
    status,
    timestamp: nowIso(),
    durationMs: call ? Date.now() - call.startedAt : undefined,
    body: req.body || {},
    query: req.query || {},
  });
  res.status(204).send();
});

app.post("/vonage/voice/answer", (req, res) => {
  const uuid = req.body?.uuid || req.query?.uuid || crypto.randomUUID();
  const from = req.body?.from || req.query?.from || "";
  const to = req.body?.to || req.query?.to || "";

  const wsBase = toWsBaseUrl(PUBLIC_BASE_URL);
  const ts = Date.now();
  const sig = WS_SHARED_SECRET ? signWsToken(uuid, ts) : "";

  const wsUrl =
    `${wsBase}/vonage/voice/ws` +
    `?uuid=${encodeURIComponent(uuid)}` +
    `&from=${encodeURIComponent(from)}` +
    `&to=${encodeURIComponent(to)}` +
    (WS_SHARED_SECRET ? `&ts=${encodeURIComponent(String(ts))}&sig=${encodeURIComponent(sig)}` : "");

  const ncco = [];
  if (USE_PREP_TALK) {
    ncco.push({
      action: "talk",
      text: `${PREP_TEXT} ${RECORDING_NOTICE}`,
      language: "en-GB",
    });
  }
  ncco.push({
    action: "connect",
    endpoint: [{ type: "websocket", uri: wsUrl, "content-type": "audio/l16;rate=16000" }],
  });

  console.log("answer_sent", {
    uuid,
    from: maskPhone(from),
    to,
    wsToken: WS_SHARED_SECRET ? "enabled" : "disabled",
    nccoActions: ncco.map((x) => x.action),
  });

  res.json(ncco);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (!req.url?.startsWith("/vonage/voice/ws")) {
    socket.destroy();
    return;
  }
  const parsed = new URL(req.url, "http://localhost");
  const uuid = parsed.searchParams.get("uuid") || "";
  const ts = parsed.searchParams.get("ts") || "";
  const sig = parsed.searchParams.get("sig") || "";
  if (!verifyWsToken(uuid, ts, sig)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

function shutdown(label, vonageWs, openaiWs, callState) {
  if (callState && !callState.endedAt) {
    callState.endedAt = Date.now();
    void sinkTranscriptToNq(callState, "system", `Call ended (${label})`);
    const cost = estimateOpenAiCost(callState.openaiUsageTotals);
    const costRange = estimateOpenAiCostRangeFromTotal(callState.openaiUsageTotals.totalTokens);
    const startedAt = new Date(callState.startedAt).toISOString();
    const endedAt = new Date(callState.endedAt).toISOString();
    const status = classifyCallStatus({
      bookingCreated: Boolean(callState.orderId),
      cancelActionDone: Boolean(callState.cancelActionDone),
      bookingFailures: callState.bookingFailures,
      resolveFailures: callState.resolveFailures,
      quoteFailures: callState.quoteFailures,
      endCallRequested: callState.endCallRequested,
      turns: callState.turnCount,
      priceCheckDone: Boolean(callState.lastTariffs),
    });
    upsertCallAuditEntry({
      uuid: callState.uuid,
      startedAt,
      endedAt,
      durationMs: callState.endedAt - callState.startedAt,
      from: callState.from || "",
      to: callState.to || "",
      label,
      turns: callState.turnCount,
      intent: callState.intent,
      action: callState.action,
      language: callState.language,
      island: callState.island || "",
      pickup: callState.pickupRaw || "",
      dropoff: callState.dropoffRaw || "",
      passengers: Number(callState.passengers || 0),
      bookingFor: callState.bookingFor || "unknown",
      pickupTime: callState.pickupTime || "now",
      scheduledDate: callState.scheduledDate || "",
      scheduledTime: callState.scheduledTime || "",
      category: callState.vehicleTypePreference || "",
      clientName: callState.name || "",
      parsedSummary: callState.parsedSummary || null,
      handover: callState.handover || null,
      transcripts: Array.isArray(callState.transcripts) ? callState.transcripts.slice(-120) : [],
      bookingCreated: Boolean(callState.orderId),
      orderId: callState.orderId || "",
      priceCheckDone: Boolean(callState.lastTariffs),
      whatsappSent: Boolean(callState.whatsappStatus?.sent),
      bookingFailures: callState.bookingFailures,
      resolveFailures: callState.resolveFailures,
      quoteFailures: callState.quoteFailures,
      cancelActionDone: Boolean(callState.cancelActionDone),
      endCallRequested: Boolean(callState.endCallRequested),
      endCallReason: callState.endCallReason || "",
      statusCode: status.code,
      statusColor: status.color,
      openaiUsageTotals: callState.openaiUsageTotals,
      openaiEstimatedCost: cost,
      openaiEstimatedCostRange: costRange,
    });
    console.log("call_closed", {
      uuid: callState.uuid,
      label,
      durationMs: callState.endedAt - callState.startedAt,
      turns: callState.turnCount,
      intent: callState.intent,
      priceCheckDone: Boolean(callState.lastTariffs),
      bookingCreated: Boolean(callState.orderId),
      whatsappSent: Boolean(callState.whatsappStatus?.sent),
      openaiUsageTotals: callState.openaiUsageTotals,
      openaiEstimatedCost: cost,
      openaiEstimatedCostRange: costRange,
    });
  }
  try {
    vonageWs?.close();
  } catch {}
  try {
    openaiWs?.close(1000, label);
  } catch {}
}

function updateCallDetails(state, args) {
  if (typeof args.intent === "string") state.intent = args.intent;
  if (typeof args.language === "string") state.language = args.language;
  if (typeof args.island === "string") {
    const areaId = canonicalAreaId(args.island);
    if (areaId && POI_DB.byId.get(areaId)?.name) state.island = POI_DB.byId.get(areaId).name;
    else state.island = args.island;
  }
  if (typeof args.pickup === "string") {
    const nextPickupRaw = args.pickup;
    const pickupChanged = normalizeText(nextPickupRaw) !== normalizeText(state.pickupRaw);
    state.pickupRaw = nextPickupRaw;
    if (pickupChanged) {
      state.pickupWaypoint = null;
      state.pickupLabel = "";
      state.pickupType = "";
      state.pickupMode = pickupModeFromType("", nextPickupRaw);
    }
  }
  if (typeof args.pickup === "string" && args.pickup.trim() && (!state.pickupWaypoint || state.pickupMode === "other")) {
    state.pickupMode = pickupModeFromType("", args.pickup);
  }
  if (typeof args.dropoff === "string") {
    const nextDropoffRaw = args.dropoff;
    const dropoffChanged = normalizeText(nextDropoffRaw) !== normalizeText(state.dropoffRaw);
    state.dropoffRaw = nextDropoffRaw;
    if (dropoffChanged) {
      state.dropoffWaypoint = null;
    }
  }
  if (
    typeof args.pickup_time === "string" ||
    typeof args.booking_for === "string" ||
    typeof args.pickup_date === "string" ||
    typeof args.pickup_clock === "string" ||
    typeof args.pickup_time_period === "string"
  ) {
    const parsed = normalizeScheduledPickup(args, state.startedAt);
    state.pickupTime = parsed.iso || state.pickupTime;
    state.bookingFor = parsed.mode !== "unknown" ? parsed.mode : state.bookingFor;
    state.pickupTimeNeedsClarification = parsed.needsClarification;
    state.pickupTimeClarificationReason = parsed.reason;
    state.scheduledDate = parsed.localDate;
    state.scheduledTime = parsed.localTime;
  }
  if (typeof args.passengers === "number" && Number.isFinite(args.passengers)) {
    state.passengers = Math.max(1, Math.floor(args.passengers));
    state.passengersCaptured = true;
  }
  if (typeof args.name === "string") {
    state.name = args.name;
    if (args.name.trim()) state.nameCaptured = true;
  }
  if (typeof args.phone === "string" && args.phone.trim()) state.phone = normalizePhoneE164(args.phone.trim());
  if (typeof args.vehicle_type === "string" && args.vehicle_type.trim()) state.vehicleTypePreference = normalizeVehiclePreference(args.vehicle_type);
  if (typeof args.arrival_reference === "string" && args.arrival_reference.trim()) state.transportRef = args.arrival_reference.trim();
  if (typeof args.arrival_origin === "string" && args.arrival_origin.trim()) state.transportOrigin = args.arrival_origin.trim();
  if (typeof args.arrival_eta === "string" && args.arrival_eta.trim()) state.transportEta = args.arrival_eta.trim();
  if (typeof args.order_id === "string" && args.order_id.trim()) state.orderId = args.order_id.trim();
  if (typeof args.action === "string" && args.action.trim()) state.action = args.action.trim().toLowerCase();
  if (typeof args.pickup_lat === "number" && typeof args.pickup_lng === "number") {
    state.pickupWaypoint = waypointFromParts(state.pickupRaw, args.pickup_lat, args.pickup_lng);
  }
  if (typeof args.dropoff_lat === "number" && typeof args.dropoff_lng === "number") {
    state.dropoffWaypoint = waypointFromParts(state.dropoffRaw, args.dropoff_lat, args.dropoff_lng);
  }
}

function toolsDefinition() {
  return [
    {
      type: "function",
      name: "capture_call_details",
      description: "Capture or update caller intent and booking/price-check fields.",
      parameters: {
        type: "object",
        properties: {
          intent: { type: "string", enum: ["price_check", "booking", "unknown"] },
          language: { type: "string" },
          island: { type: "string" },
          pickup: { type: "string" },
          pickup_lat: { type: "number" },
          pickup_lng: { type: "number" },
          dropoff: { type: "string" },
          dropoff_lat: { type: "number" },
          dropoff_lng: { type: "number" },
          passengers: { type: "number" },
          vehicle_type: { type: "string", enum: ["standard", "van", "minivan"] },
          booking_for: { type: "string", enum: ["now", "later", "unknown"] },
          pickup_time: { type: "string" },
          pickup_date: { type: "string" },
          pickup_clock: { type: "string" },
          pickup_time_period: { type: "string", enum: ["am", "pm"] },
          name: { type: "string" },
          phone: { type: "string" },
          arrival_reference: { type: "string" },
          arrival_origin: { type: "string" },
          arrival_eta: { type: "string" },
          order_id: { type: "string" },
          action: { type: "string", enum: ["book", "price_check", "cancel", "unknown"] },
          wants_human: { type: "boolean" },
        },
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "resolve_place",
      description: "Resolve free-text place into dispatch-compatible waypoint coordinates and label.",
      parameters: {
        type: "object",
        properties: {
          island: { type: "string" },
          query: { type: "string" },
          kind: { type: "string", enum: ["pickup", "dropoff"] },
          language: { type: "string" },
        },
        required: ["query", "kind"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "get_price_quote",
      description: "Get fare estimation for price checks.",
      parameters: {
        type: "object",
        properties: {
          origin_lat: { type: "number" },
          origin_lng: { type: "number" },
          destination_lat: { type: "number" },
          destination_lng: { type: "number" },
          pickup_time: { type: "string" },
          number_of_seats: { type: "number" },
          vehicle_type: { type: "string" },
          tariff_type: { type: "string" },
          payment_method: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "create_booking",
      description: "Create order after caller confirms.",
      parameters: {
        type: "object",
        properties: {
          pickup_waypoint: { type: "object" },
          dropoff_waypoint: { type: "object" },
          passengers: { type: "number" },
          pickup_time: { type: "string" },
          phone: { type: "string" },
          name: { type: "string" },
          notes: { type: "string" },
          vehicle_type: { type: "string" },
          tariff_type: { type: "string" },
          tariff_id: { type: "string" },
          payment_methods: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "send_whatsapp_confirmation",
      description: "Send booking details via WhatsApp.",
      parameters: {
        type: "object",
        properties: {
          phone: { type: "string" },
          message: { type: "string" },
          booking_id: { type: "string" },
        },
        required: ["phone", "message"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "cancel_booking",
      description: "Cancel an existing booking by order ID or latest booking from caller phone.",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string" },
          phone: { type: "string" },
          reason: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "escalate_to_human",
      description: "Escalate call to human workflow.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
          summary: { type: "string" },
        },
        required: ["reason"],
        additionalProperties: false,
      },
    },
    {
      type: "function",
      name: "end_call",
      description: "End the call when task cannot be completed and caller does not want a human agent.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
          final_message: { type: "string" },
        },
        required: ["reason"],
        additionalProperties: false,
      },
    },
  ];
}

function orchestrationPrompt(state) {
  const languageRule =
    ASSISTANT_LANGUAGE_MODE === "en"
      ? "Speak in ENGLISH only."
      : "Reply in caller language.";
  return [
    "You are Athena, Aegean Taxi call agent.",
    languageRule,
    `Greet once with: "${GREETING_TEXT}"`,
    "Ask one question at a time, max 8 words.",
    "Booking order: island -> now/later -> pickup -> dropoff -> passengers.",
    "If later and hour is ambiguous, ask AM/PM.",
    `Supported areas: ${SUPPORTED_AREAS.join(", ")}.`,
    "If unsupported area, say not available and call end_call.",
    "Always call capture_call_details after caller reply.",
    "Use resolve_place only after island is known.",
    "If place fails twice, ask spelling once then escalate_to_human.",
    "Run get_price_quote before create_booking.",
    "Create booking only with both coordinates and explicit confirmation.",
    "Never ask vehicle class, only passengers.",
    `Caller phone: ${state.phone || "missing"}`,
  ].join("\n");
}

function responseGuardPrompt(state) {
  const languageGuard =
    ASSISTANT_LANGUAGE_MODE === "en"
      ? "Speak in ENGLISH only."
      : "Reply in caller language.";
  const phoneGuard = state.phone
    ? `Caller phone is ${state.phone}. Do NOT ask for phone number.`
    : "Caller phone missing. Ask for phone number only once right before booking creation.";
  const nameGuard = state.name
    ? `Caller name is ${state.name}. Do NOT ask for name again.`
    : "Caller name missing. Ask for name only once right before final booking confirmation.";
  return `${languageGuard}\n${phoneGuard}\n${nameGuard}`;
}

function deepgramListenUrl() {
  const params = new URLSearchParams({
    model: DEEPGRAM_MODEL || "nova-2",
    language: DEEPGRAM_LANGUAGE || "en",
    smart_format: "true",
    interim_results: "true",
    encoding: "linear16",
    sample_rate: String(VONAGE_SAMPLE_RATE),
    channels: "1",
    endpointing: String(DEEPGRAM_ENDPOINTING_MS),
    punctuate: "true",
    numerals: "true",
  });
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

async function elevenLabsSynthesizePcm(text) {
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID || !ELEVENLABS_BASE_URL) {
    return { error: "elevenlabs_not_configured" };
  }
  const payload = {
    text: String(text || "").trim(),
    model_id: ELEVENLABS_MODEL_ID,
    voice_settings: {
      stability: 0.45,
      similarity_boost: 0.75,
      speed: 1.0,
      use_speaker_boost: true,
    },
  };
  if (!payload.text) return { error: "missing_tts_text" };
  const url =
    `${ELEVENLABS_BASE_URL}/v1/text-to-speech/${encodeURIComponent(ELEVENLABS_VOICE_ID)}` +
    `?output_format=${encodeURIComponent(ELEVENLABS_OUTPUT_FORMAT)}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ELEVENLABS_TTS_TIMEOUT_MS);
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/octet-stream",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return {
        error: "elevenlabs_tts_failed",
        status: resp.status,
        message: errText.slice(0, 220),
      };
    }
    const ab = await resp.arrayBuffer();
    const pcm = Buffer.from(ab);
    if (!pcm.length) return { error: "elevenlabs_empty_audio" };
    return { pcm };
  } catch (err) {
    return { error: "elevenlabs_tts_failed", message: err?.message || String(err) };
  }
}

async function streamPcm16ToVonage(vonageWs, pcm) {
  if (!pcm || !pcm.length) return;
  const chunkBytes = 640; // 20ms @ 16kHz mono PCM16
  for (let off = 0; off < pcm.length; off += chunkBytes) {
    if (!vonageWs || vonageWs.readyState !== WebSocket.OPEN) break;
    const chunk = pcm.subarray(off, Math.min(off + chunkBytes, pcm.length));
    vonageWs.send(chunk);
    await sleep(20);
  }
}

function waypointCoords(waypoint) {
  return {
    lat: waypoint?.placeLatLng?.lat ?? waypoint?.exactLatLng?.lat ?? null,
    lng: waypoint?.placeLatLng?.lng ?? waypoint?.exactLatLng?.lng ?? null,
  };
}

async function resolveWaypointForCall(callState, kind, query) {
  const result = await resolvePlace({
    island: callState.island,
    query,
    kind,
    language: callState.language || "en",
  });
  const wp = result?.best?.waypoint || result?.waypoint || null;
  if (!wp) return { result, waypoint: null };
  if (kind === "pickup") {
    callState.pickupWaypoint = wp;
    callState.pickupRaw = query;
    callState.pickupLabel = result?.best?.label || wp?.poiName || wp?.premise || query;
    callState.pickupType = result?.best?.type || "";
    callState.pickupMode = pickupModeFromType(callState.pickupType, callState.pickupLabel);
  } else {
    callState.dropoffWaypoint = wp;
    callState.dropoffRaw = query;
  }
  return { result, waypoint: wp };
}

async function buildQuoteFromState(callState) {
  const pickup = waypointCoords(callState.pickupWaypoint);
  const dropoff = waypointCoords(callState.dropoffWaypoint);
  if (!Number.isFinite(Number(pickup.lat)) || !Number.isFinite(Number(pickup.lng)) ||
      !Number.isFinite(Number(dropoff.lat)) || !Number.isFinite(Number(dropoff.lng))) {
    return { error: "missing_waypoint_coordinates" };
  }
  const vehicleType = normalizeVehiclePreference(callState.vehicleTypePreference);

  if (ACTIVE_BACKEND_MODE === "nq") {
    const nqQuote = await nqCreateQuote(callState, {
      pickup: { lat: Number(pickup.lat), lng: Number(pickup.lng) },
      dropoff: { lat: Number(dropoff.lat), lng: Number(dropoff.lng) },
      vehicle_category: vehicleType || undefined,
    });
    if (nqQuote && !nqQuote.error && Number.isFinite(Number(nqQuote.quoted_price))) {
      return {
        fare: Number(nqQuote.quoted_price),
        currency: nqQuote.currency || "EUR",
        etaMinutes: Number(nqQuote.eta_minutes || 0),
        distanceKm: Number(nqQuote.distance_km || 0),
        source: "nq_quote",
      };
    }
  }

  const metrics = estimateTripMetrics(Number(pickup.lat), Number(pickup.lng), Number(dropoff.lat), Number(dropoff.lng));
  const fallback = estimateFallbackFare({
    passengers: callState.passengers,
    distanceKm: metrics.distanceKm,
    timeMin: metrics.timeMin,
    vehicleType: vehicleType || (callState.passengers > 4 ? "van" : "standard"),
  });
  return {
    fare: fallback.estimatedFareEur,
    currency: "EUR",
    etaMinutes: Number(metrics.timeMin.toFixed(0)),
    distanceKm: Number(metrics.distanceKm.toFixed(1)),
    source: "fallback",
  };
}

function summarizeRideForSpeech(callState) {
  const whenText = callState.bookingFor === "later"
    ? `${callState.scheduledDate || ""} ${callState.scheduledTime || ""}`.trim()
    : "now";
  return [
    `Island ${callState.island}.`,
    `Pickup ${callState.pickupLabel || callState.pickupRaw}.`,
    `Dropoff ${callState.dropoffRaw}.`,
    `Passengers ${callState.passengers || 1}.`,
    `Time ${whenText}.`,
  ].join(" ");
}

wss.on("connection", (vonageWs, req) => {
  const url = new URL(req.url, "http://localhost");
  const uuid = url.searchParams.get("uuid") || crypto.randomUUID();
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";

  if (VOICE_STACK_MODE === "legacy_openai_realtime" && !OPENAI_API_KEY) {
    shutdown("missing_openai_key", vonageWs, null, null);
    return;
  }
  if (VOICE_STACK_MODE === "deepgram_elevenlabs_fsm" && (!DEEPGRAM_API_KEY || !ELEVENLABS_API_KEY || !ELEVENLABS_VOICE_ID)) {
    shutdown("missing_deepgram_or_elevenlabs_key", vonageWs, null, null);
    return;
  }

  const callState = {
    uuid,
    from,
    to,
    startedAt: Date.now(),
    endedAt: null,
    turnCount: 0,
    action: "unknown",
    intent: "unknown",
    language: "en",
    island: "",
    pickupRaw: "",
    dropoffRaw: "",
    pickupWaypoint: null,
    dropoffWaypoint: null,
    passengers: 1,
    passengersCaptured: false,
    vehicleTypePreference: "",
    bookingFor: "unknown",
    pickupTime: "now",
    pickupTimeNeedsClarification: false,
    pickupTimeClarificationReason: "",
    scheduledDate: "",
    scheduledTime: "",
    pickupMode: "other",
    pickupType: "",
    pickupLabel: "",
    numberId: NQ_CALL_NUMBER_ID || "",
    companyId: NQ_COMPANY_ID || "",
    companyCode: NQ_COMPANY_CODE || "",
    nqConversationId: "",
    transportRef: "",
    transportOrigin: "",
    transportEta: "",
    phone: from && from !== "Unknown" ? normalizePhoneE164(from) : "",
    name: "",
    nameCaptured: false,
    orderId: "",
    lastTariffs: null,
    whatsappStatus: null,
    resolveFailures: 0,
    spellingAsked: {
      pickup: false,
      dropoff: false,
    },
    quoteFailures: 0,
    lastQuoteSignature: "",
    lastQuoteResult: null,
    bookingFailures: 0,
    cancelActionDone: false,
    endCallRequested: false,
    endCallReason: "",
    endCallMessage: "",
    transcripts: [],
    parsedSummary: null,
    handover: null,
    openaiUsageTotals: {
      inputTextTokens: 0,
      outputTextTokens: 0,
      inputAudioTokens: 0,
      outputAudioTokens: 0,
      totalTokens: 0,
    },
  };
  callRegistry.set(uuid, callState);
  void sinkTranscriptToNq(callState, "system", `Call started (${uuid})`);

  if (VOICE_STACK_MODE === "deepgram_elevenlabs_fsm") {
    console.log("voice_stack_call_start", {
      uuid,
      stack: VOICE_STACK_MODE,
      deepgramModel: DEEPGRAM_MODEL,
      elevenVoiceId: ELEVENLABS_VOICE_ID || "missing",
    });

    let callClosed = false;
    let awaitingUserReply = false;
    let activeStage = "ask_island";
    let pendingLaterText = "";
    let retryPickup = 0;
    let retryDropoff = 0;
    let responseTimer = null;
    let deepgramReady = false;
    let deepgramFinalParts = [];
    let lastCallerAt = Date.now();

    const deepgramWs = new WebSocket(deepgramListenUrl(), {
      headers: { Authorization: `Token ${DEEPGRAM_API_KEY}` },
    });

    const deepgramKeepAlive = setInterval(() => {
      if (deepgramWs.readyState !== WebSocket.OPEN) return;
      try {
        deepgramWs.send(JSON.stringify({ type: "KeepAlive" }));
      } catch {}
    }, 8000);

    let speechChain = Promise.resolve();
    let utteranceChain = Promise.resolve();

    function clearResponseTimer() {
      if (responseTimer) {
        clearTimeout(responseTimer);
        responseTimer = null;
      }
    }

    function armResponseTimer() {
      clearResponseTimer();
      responseTimer = setTimeout(() => {
        if (callClosed || !awaitingUserReply) return;
        void scheduleSpeak(
          "I did not hear a response. Please call us again when ready. Goodbye.",
          false
        ).then(() => closeCall("caller_timeout"));
      }, CALL_RESPONSE_TIMEOUT_MS);
    }

    function closeCall(label) {
      if (callClosed) return;
      callClosed = true;
      clearResponseTimer();
      clearInterval(deepgramKeepAlive);
      shutdown(label, vonageWs, deepgramWs, callState);
      callRegistry.delete(uuid);
    }

    async function scheduleSpeak(text, waitForReply = true) {
      const line = String(text || "").trim();
      if (!line || callClosed) return;
      speechChain = speechChain.then(async () => {
        if (callClosed) return;
        awaitingUserReply = false;
        clearResponseTimer();
        callState.transcripts.push({ at: nowIso(), speaker: "assistant", text: line });
        if (callState.transcripts.length > 200) callState.transcripts = callState.transcripts.slice(-200);
        void sinkTranscriptToNq(callState, "assistant", line);
        const tts = await elevenLabsSynthesizePcm(line);
        if (tts?.error || !tts?.pcm?.length) {
          console.log("elevenlabs_tts_error", {
            uuid,
            error: tts?.error || "unknown",
            message: tts?.message || "",
          });
          closeCall("elevenlabs_tts_error");
          return;
        }
        await streamPcm16ToVonage(vonageWs, tts.pcm);
        if (!callClosed && waitForReply) {
          awaitingUserReply = true;
          armResponseTimer();
        }
      });
      return speechChain;
    }

    async function askHumanOrEnd(reasonCode, reasonPrompt) {
      callState.handover = {
        reason: reasonCode,
        summary: summarizeRideForSpeech(callState),
        at: nowIso(),
      };
      activeStage = "ask_human";
      await scheduleSpeak(`${reasonPrompt} Do you want a human agent?`, true);
    }

    async function resolveAndValidate(kind, rawText) {
      const { result, waypoint } = await resolveWaypointForCall(callState, kind, rawText);
      console.log("fsm_resolve", {
        uuid,
        kind,
        query: rawText,
        label: result?.best?.label || "",
        confidence: result?.best?.confidence ?? null,
        ok: Boolean(waypoint),
      });
      if (waypoint) return { ok: true, result, waypoint };
      if (kind === "pickup") callState.resolveFailures += 1;
      if (kind === "dropoff") callState.resolveFailures += 1;
      return { ok: false, result };
    }

    async function createBookingFromState() {
      const pickup = waypointCoords(callState.pickupWaypoint);
      const dropoff = waypointCoords(callState.dropoffWaypoint);
      const parsedPickupTime = normalizeScheduledPickup({
        booking_for: callState.bookingFor,
        pickup_time: callState.pickupTime,
        pickup_date: callState.scheduledDate,
        pickup_clock: callState.scheduledTime,
      }, callState.startedAt);
      if (parsedPickupTime.mode === "later" && (!parsedPickupTime.ok || parsedPickupTime.needsClarification)) {
        return { error: "pickup_time_needs_clarification" };
      }
      const combinedNotes = buildTransportNotes(callState) || undefined;
      const nqVehicleCategoryName = await resolveNqVehicleCategoryName(
        callState,
        callState.vehicleTypePreference,
        callState.passengers
      );
      const payload = clean({
        customer_name: callState.name || undefined,
        customer_phone: callState.phone || undefined,
        pickup: {
          lat: Number(pickup.lat),
          lng: Number(pickup.lng),
          address: callState.pickupLabel || callState.pickupRaw || undefined,
        },
        dropoff: {
          lat: Number(dropoff.lat),
          lng: Number(dropoff.lng),
          address: callState.dropoffRaw || undefined,
        },
        notes: combinedNotes,
        passenger_count: callState.passengers || 1,
        scheduled_at: parsedPickupTime.mode === "later" ? parsedPickupTime.iso : undefined,
        vehicle_category_name: nqVehicleCategoryName,
      });
      return nqCreateOrder(callState, payload);
    }

    async function processCallerUtterance(transcript) {
      if (callClosed || !awaitingUserReply) return;
      const text = String(transcript || "").trim();
      if (!text) return;
      lastCallerAt = Date.now();
      callState.turnCount += 1;
      callState.transcripts.push({ at: nowIso(), speaker: "caller", text });
      if (callState.transcripts.length > 200) callState.transcripts = callState.transcripts.slice(-200);
      void sinkTranscriptToNq(callState, "caller", text);
      console.log("stt_transcript", { uuid, transcript: text, stage: activeStage });

      const noAgent = detectExplicitNoAgent(text);
      const wantsHuman = detectHumanEscalationIntent(text) && !noAgent;
      if (wantsHuman && activeStage !== "ask_human") {
        callState.handover = { reason: "requested_human", summary: text, at: nowIso() };
        await scheduleSpeak("I will transfer this to a human agent now. Goodbye.", false);
        closeCall("human_requested");
        return;
      }

      if (activeStage === "ask_human") {
        const yn = detectYesNo(text);
        if (yn === "yes") {
          await scheduleSpeak("I will transfer this to a human agent now. Goodbye.", false);
          closeCall("handover_requested");
          return;
        }
        await scheduleSpeak("Understood. I will end this call now. Goodbye.", false);
        closeCall("end_call_no_human");
        return;
      }

      if (activeStage === "ask_island") {
        const areaId = detectAreaIdInText(text);
        const area = areaId ? POI_DB.byId.get(areaId) : null;
        if (!area?.name) {
          await scheduleSpeak("Which island is the booking for?", true);
          return;
        }
        if (!SUPPORTED_AREAS.includes(area.name)) {
          await scheduleSpeak("Unfortunately we do not operate in that area. Goodbye.", false);
          closeCall("unsupported_island");
          return;
        }
        callState.island = area.name;
        activeStage = "ask_now_later";
        await scheduleSpeak(`Great. Booking for ${callState.island}. Is this for now or later?`, true);
        return;
      }

      if (activeStage === "ask_now_later") {
        const mode = detectNowLater(text);
        if (mode === "unknown") {
          await scheduleSpeak("Please say now or later.", true);
          return;
        }
        callState.bookingFor = mode;
        if (mode === "now") {
          callState.pickupTime = "now";
          activeStage = "ask_pickup";
          await scheduleSpeak("What is your pickup location?", true);
          return;
        }
        activeStage = "ask_later_time";
        await scheduleSpeak("Please tell me date and time.", true);
        return;
      }

      if (activeStage === "ask_later_time" || activeStage === "ask_later_time_clarify") {
        const candidate = activeStage === "ask_later_time_clarify" ? `${pendingLaterText} ${text}` : text;
        const parsed = normalizeScheduledPickup(
          { booking_for: "later", pickup_time: candidate },
          callState.startedAt
        );
        if (!parsed.ok) {
          if (parsed.reason === "ambiguous_hour_needs_am_pm") {
            pendingLaterText = candidate;
            activeStage = "ask_later_time_clarify";
            await scheduleSpeak("Is that AM or PM?", true);
            return;
          }
          await scheduleSpeak("Please say date and time like tomorrow five PM.", true);
          return;
        }
        callState.pickupTime = parsed.iso;
        callState.scheduledDate = parsed.localDate;
        callState.scheduledTime = parsed.localTime;
        activeStage = "ask_pickup";
        await scheduleSpeak("What is your pickup location?", true);
        return;
      }

      if (activeStage === "ask_pickup") {
        const resolved = await resolveAndValidate("pickup", text);
        if (!resolved.ok) {
          retryPickup += 1;
          if (retryPickup >= 2) {
            await askHumanOrEnd(
              "pickup_not_found",
              "I still could not find your pickup location."
            );
            return;
          }
          await scheduleSpeak("I could not find pickup. Please spell it slowly.", true);
          return;
        }
        retryPickup = 0;
        activeStage = "confirm_pickup";
        await scheduleSpeak(`I understood pickup as ${callState.pickupLabel || callState.pickupRaw}. Is that correct?`, true);
        return;
      }

      if (activeStage === "confirm_pickup") {
        const yn = detectYesNo(text);
        if (yn === "yes") {
          activeStage = "ask_dropoff";
          await scheduleSpeak("What is your dropoff location?", true);
          return;
        }
        if (yn === "no") {
          callState.pickupWaypoint = null;
          callState.pickupRaw = "";
          callState.pickupLabel = "";
          callState.pickupType = "";
          callState.pickupMode = "other";
          retryPickup += 1;
          if (retryPickup >= 2) {
            await askHumanOrEnd(
              "pickup_not_confirmed",
              "I still could not confirm your pickup location."
            );
            return;
          }
          activeStage = "ask_pickup";
          await scheduleSpeak("Please repeat your pickup location and spell it if needed.", true);
          return;
        }
        await scheduleSpeak("Please answer yes or no.", true);
        return;
      }

      if (activeStage === "ask_dropoff") {
        const resolved = await resolveAndValidate("dropoff", text);
        if (!resolved.ok) {
          retryDropoff += 1;
          if (retryDropoff >= 2) {
            await askHumanOrEnd(
              "dropoff_not_found",
              "I still could not find your dropoff location."
            );
            return;
          }
          await scheduleSpeak("I could not find dropoff. Please spell it slowly.", true);
          return;
        }
        retryDropoff = 0;
        activeStage = "confirm_dropoff";
        await scheduleSpeak(`I understood dropoff as ${callState.dropoffRaw}. Is that correct?`, true);
        return;
      }

      if (activeStage === "confirm_dropoff") {
        const yn = detectYesNo(text);
        if (yn === "yes") {
          activeStage = "ask_passengers";
          await scheduleSpeak("How many passengers?", true);
          return;
        }
        if (yn === "no") {
          callState.dropoffWaypoint = null;
          callState.dropoffRaw = "";
          retryDropoff += 1;
          if (retryDropoff >= 2) {
            await askHumanOrEnd(
              "dropoff_not_confirmed",
              "I still could not confirm your dropoff location."
            );
            return;
          }
          activeStage = "ask_dropoff";
          await scheduleSpeak("Please repeat your dropoff location and spell it if needed.", true);
          return;
        }
        await scheduleSpeak("Please answer yes or no.", true);
        return;
      }

      if (activeStage === "ask_passengers") {
        const pax = parsePassengerCountFromText(text);
        if (!pax) {
          await scheduleSpeak("Please tell me number of passengers.", true);
          return;
        }
        callState.passengers = Math.max(1, pax);
        callState.passengersCaptured = true;
        callState.vehicleTypePreference = callState.passengers > 4 ? "van" : "standard";
        activeStage = "ask_name";
        await scheduleSpeak("What name should I use for this booking?", true);
        return;
      }

      if (activeStage === "ask_name") {
        const candidate = String(text || "").replace(/[^\p{L}\p{N}\s.'-]/gu, " ").trim();
        if (!looksLikeValidName(candidate)) {
          await scheduleSpeak("Please repeat the name for the booking.", true);
          return;
        }
        callState.name = candidate;
        callState.nameCaptured = true;
        callState.intent = detectPriceIntent(text) ? "price_check" : "booking";
        const quote = await buildQuoteFromState(callState);
        if (quote?.error) {
          callState.quoteFailures += 1;
          await askHumanOrEnd(
            "quote_failed",
            "I could not calculate the price right now."
          );
          return;
        }
        callState.lastTariffs = quote;
        activeStage = "confirm_booking";
        await scheduleSpeak(
          `${summarizeRideForSpeech(callState)} The price is about ${quote.fare} euros. Do you want me to submit this booking now?`,
          true
        );
        return;
      }

      if (activeStage === "confirm_booking") {
        const yn = detectYesNo(text);
        if (yn === "unknown") {
          await scheduleSpeak("Please say yes to book, or no to stop.", true);
          return;
        }
        if (yn === "no") {
          await scheduleSpeak("Understood. No booking was submitted. Goodbye.", false);
          closeCall("price_only_no_booking");
          return;
        }
        const result = await createBookingFromState();
        const orderId = extractOrderId(result);
        if (!orderId) {
          callState.bookingFailures += 1;
          await askHumanOrEnd(
            "create_booking_failed",
            "I could not submit the booking."
          );
          return;
        }
        callState.orderId = orderId;
        rememberOrderForPhone(callState.phone, {
          orderId,
          island: callState.island,
          pickupLabel: callState.pickupLabel || callState.pickupRaw,
          dropoffLabel: callState.dropoffRaw,
        });
        const waPhone = normalizePhoneE164(callState.phone);
        if (waPhone) {
          try {
            const waText = `Aegean Taxi booking confirmed. Order ID ${orderId}.`;
            const waRes = await sendWhatsapp({ phone: waPhone, message: waText, booking_id: orderId, channel: "voice_ai_v1" });
            callState.whatsappStatus = {
              sent: Boolean(waRes && !waRes.error && !waRes.skipped),
              reason: waRes?.reason || "",
            };
          } catch (waErr) {
            callState.whatsappStatus = {
              sent: false,
              reason: "whatsapp_send_failed",
            };
            console.log("whatsapp_send_error", {
              uuid,
              message: waErr?.message || String(waErr),
            });
          }
        }
        await scheduleSpeak(`Booking confirmed. Your order id is ${orderId}. Thank you for calling Aegean Taxi. Goodbye.`, false);
        closeCall("booking_completed");
      }
    }

    deepgramWs.on("open", () => {
      deepgramReady = true;
      console.log("deepgram_ws_open", { uuid, model: DEEPGRAM_MODEL, language: DEEPGRAM_LANGUAGE });
      const greetingOnly = String(GREETING_TEXT || "Welcome to Aegean Taxi.")
        .replace(/\?.*$/s, "")
        .trim() || "Welcome to Aegean Taxi.";
      void (async () => {
        await scheduleSpeak(greetingOnly, false);
        await scheduleSpeak("Which island is the booking for?", true);
      })();
    });

    deepgramWs.on("message", (raw) => {
      if (callClosed) return;
      const evt = safeJsonParse(raw.toString());
      if (!evt || evt.type !== "Results") return;
      const transcript = String(evt?.channel?.alternatives?.[0]?.transcript || "").trim();
      if (evt.is_final && transcript) deepgramFinalParts.push(transcript);
      if (!evt.speech_final) return;
      const merged = deepgramFinalParts.join(" ").trim() || transcript;
      deepgramFinalParts = [];
      if (!merged) return;
      utteranceChain = utteranceChain
        .then(() => processCallerUtterance(merged))
        .catch((err) => {
          console.log("fsm_process_error", { uuid, message: err?.message || String(err) });
          closeCall("fsm_process_error");
        });
    });

    deepgramWs.on("close", (code, reason) => {
      console.log("deepgram_ws_closed", { uuid, code, reason: reason?.toString?.() || "" });
      closeCall("deepgram_ws_closed");
    });

    deepgramWs.on("error", (err) => {
      console.log("deepgram_ws_error", { uuid, message: err?.message || String(err) });
      closeCall("deepgram_ws_error");
    });

    vonageWs.on("message", (msg) => {
      if (!deepgramReady || callClosed) return;
      if (typeof msg === "string") return;
      if (deepgramWs.readyState !== WebSocket.OPEN) return;
      try {
        deepgramWs.send(Buffer.from(msg));
      } catch {}
    });

    vonageWs.on("close", () => closeCall("vonage_ws_closed"));
    vonageWs.on("error", () => closeCall("vonage_ws_error"));
    return;
  }

  const openaiWs = new WebSocket(
    `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(OPENAI_REALTIME_MODEL)}`,
    {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1",
      },
    }
  );

  let openaiReady = false;
  let responseActive = false;
  let allowUserSpeechAtMs = Number.MAX_SAFE_INTEGER;
  let greetingDone = false;
  let initialGreetingQueued = false;
  let initialGreetingAttempts = 0;
  let initialIslandQuestionQueued = false;
  let inSpeech = false;
  let pendingResponse = null;
  let waitForCallerReply = false;
  let rateLimitBackoffUntilMs = 0;
  let lastResponseCreateAt = 0;

  function safeSend(obj) {
    if (!openaiWs || openaiWs.readyState !== WebSocket.OPEN) return false;
    try {
      openaiWs.send(JSON.stringify(obj));
      return true;
    } catch {
      return false;
    }
  }

  function requestModelResponse(extraInstructions = "", options = {}) {
    const normalizedOptions = {
      maxOutputTokens: Number(options?.maxOutputTokens || 96),
      waitForCaller: Boolean(options?.waitForCaller),
    };
    const maxOutputTokens = normalizedOptions.maxOutputTokens;
    if (!openaiReady) return false;
    if (Date.now() - lastResponseCreateAt < 650) {
      pendingResponse = { instructions: extraInstructions || "", options: normalizedOptions };
      return true;
    }
    if (Date.now() < rateLimitBackoffUntilMs) {
      pendingResponse = { instructions: extraInstructions || "", options: normalizedOptions };
      return true;
    }
    if (inSpeech) {
      pendingResponse = { instructions: extraInstructions || "", options: normalizedOptions };
      return true;
    }
    if (responseActive) {
      pendingResponse = { instructions: extraInstructions || "", options: normalizedOptions };
      return true;
    }
    responseActive = true;
    const guard = responseGuardPrompt(callState);
    const response = {
      modalities: ["audio", "text"],
      max_output_tokens: maxOutputTokens,
    };
    response.instructions = [guard, extraInstructions].filter(Boolean).join("\n");
    const sent = safeSend({
      type: "response.create",
      response,
    });
    lastResponseCreateAt = Date.now();
    if (!sent) {
      responseActive = false;
      pendingResponse = { instructions: extraInstructions || "", options: normalizedOptions };
      console.log("openai_send_failed", { uuid, type: "response.create" });
      return false;
    }
    if (normalizedOptions.waitForCaller) {
      waitForCallerReply = true;
    }
    return true;
  }

  function requestEndCall(reason, finalMessage) {
    callState.endCallRequested = true;
    callState.endCallReason = reason || "task_not_completed";
    callState.endCallMessage = finalMessage || "Sorry, I cannot complete this request right now. Please call again later.";
  }

  function nextRequiredQuestionInstruction() {
    if (!callState.island) return "Ask only this question: Which island is the booking for?";
    if (callState.bookingFor === "unknown") return "Ask only this question: Is the booking for now or later?";
    if (!callState.pickupRaw) return "Ask only this question: What is your pickup location?";
    if (callState.pickupRaw && !callState.pickupWaypoint) {
      return "Ask only this question: Please repeat or spell your pickup location.";
    }
    if (!callState.dropoffRaw) return "Ask only this question: What is your dropoff location?";
    if (callState.dropoffRaw && !callState.dropoffWaypoint) {
      return "Ask only this question: Please repeat or spell your dropoff location.";
    }
    if (!callState.passengersCaptured) return "Ask only this question: How many passengers?";
    if (!callState.nameCaptured || !String(callState.name || "").trim()) {
      return "Ask only this question: What name should I put on the booking?";
    }
    return "";
  }

  async function executeTool(name, args) {
    const autoResolveFromState = async (kind) => {
      const isDropoff = kind === "dropoff";
      const raw = isDropoff ? callState.dropoffRaw : callState.pickupRaw;
      const existing = isDropoff ? callState.dropoffWaypoint : callState.pickupWaypoint;
      if (!callState.island || !raw || existing) {
        return {
          attempted: false,
          resolved: Boolean(existing),
        };
      }
      const result = await resolvePlace({
        island: callState.island,
        query: raw,
        kind: isDropoff ? "dropoff" : "pickup",
        language: callState.language || "en",
      });
      const wp = result?.best?.waypoint || result?.waypoint || null;
      if (!wp) {
        return {
          attempted: true,
          resolved: false,
          error: result?.error || "resolve_failed",
          message: result?.message || "",
        };
      }
      if (isDropoff) {
        callState.dropoffWaypoint = wp;
      } else {
        callState.pickupWaypoint = wp;
        const best = result?.best || {};
        callState.pickupLabel = best.label || wp?.poiName || wp?.premise || "";
        callState.pickupType = best.type || "";
        callState.pickupMode = pickupModeFromType(callState.pickupType, callState.pickupLabel);
      }
      return {
        attempted: true,
        resolved: true,
        label: result?.best?.label || wp?.poiName || wp?.premise || "",
        confidence: result?.best?.confidence,
      };
    };

    if (name === "capture_call_details") {
      updateCallDetails(callState, args || {});
      callState.parsedSummary = {
        from: callState.pickupRaw || "",
        to: callState.dropoffRaw || "",
        bookingFor: callState.bookingFor || "unknown",
        pickupTime: callState.pickupTime || "now",
        scheduledDate: callState.scheduledDate || "",
        scheduledTime: callState.scheduledTime || "",
        category: callState.vehicleTypePreference || "",
        passengers: Number(callState.passengers || 0),
        name: callState.name || "",
        island: callState.island || "",
      };
      const pickupAuto = await autoResolveFromState("pickup");
      const dropoffAuto = await autoResolveFromState("dropoff");
      return {
        captured: true,
        wants_human: Boolean(args?.wants_human),
        auto_resolve: {
          pickup: pickupAuto,
          dropoff: dropoffAuto,
        },
        action_hints: {
          resolve_pickup_now: Boolean(callState.island && callState.pickupRaw && !callState.pickupWaypoint),
          resolve_dropoff_now: Boolean(callState.island && callState.dropoffRaw && !callState.dropoffWaypoint),
          ready_for_price_quote: Boolean(callState.pickupWaypoint && callState.dropoffWaypoint && callState.bookingFor !== "unknown"),
          ready_for_booking: Boolean(
            callState.pickupWaypoint &&
            callState.dropoffWaypoint &&
            callState.bookingFor !== "unknown" &&
            Number(callState.passengers || 0) >= 1 &&
            callState.passengersCaptured &&
            callState.nameCaptured
          ),
        },
        state: {
          action: callState.action,
          intent: callState.intent,
          island: callState.island,
          pickup: callState.pickupRaw,
          dropoff: callState.dropoffRaw,
          has_pickup_waypoint: Boolean(callState.pickupWaypoint),
          has_dropoff_waypoint: Boolean(callState.dropoffWaypoint),
          passengers: callState.passengers,
          passengers_captured: callState.passengersCaptured,
          name_captured: callState.nameCaptured,
          vehicle_type: callState.vehicleTypePreference,
          booking_for: callState.bookingFor,
          pickup_time: callState.pickupTime,
          pickup_time_needs_clarification: callState.pickupTimeNeedsClarification,
          pickup_time_clarification_reason: callState.pickupTimeClarificationReason,
          pickup_mode: callState.pickupMode,
          needs_transport_details: false,
          has_phone: Boolean(callState.phone),
        },
      };
    }

    if (name === "resolve_place") {
      const island = args?.island || callState.island;
      const kind = args?.kind === "dropoff" ? "dropoff" : "pickup";
      if (!callState.island) {
        return {
          error: "island_required_first",
          message: "Please ask which island the booking is for first.",
        };
      }
      if (callState.bookingFor === "unknown") {
        return {
          error: "booking_time_mode_required",
          message: "Please ask if this booking is for now or later before locations.",
        };
      }
      console.log("tool_call", { uuid, name, kind: args?.kind, query: args?.query, island });
      const result = await resolvePlace({
        island,
        query: args?.query,
        kind,
        language: args?.language || callState.language,
      });

      if (result?.error === "unsupported_island") {
        requestEndCall("unsupported_island", "Unfortunately we do not operate in that area.");
      }
      if (result?.error === "poi_not_found_in_area") {
        if (!callState.spellingAsked[kind]) {
          callState.spellingAsked[kind] = true;
          result.message = "I could not find that location. Please spell the location name letter by letter.";
          result.next_action = "ask_spelling_once";
        } else {
          requestEndCall(
            "poi_not_found_after_spelling",
            "Sorry, I still could not find that location in our service database. I cannot complete this request right now. Goodbye."
          );
        }
      } else if (result?.best) {
        callState.spellingAsked[kind] = false;
      }

      const wp = result?.best?.waypoint || result?.waypoint;
      if (wp && kind === "pickup") callState.pickupWaypoint = wp;
      if (wp && kind === "dropoff") callState.dropoffWaypoint = wp;
      if (wp && kind === "pickup") {
        const best = result?.best || {};
        callState.pickupLabel = best.label || wp?.poiName || wp?.premise || "";
        callState.pickupType = best.type || "";
        callState.pickupMode = pickupModeFromType(callState.pickupType, callState.pickupLabel);
      }
      if (!wp) callState.resolveFailures += 1;
      console.log("tool_result", {
        uuid,
        name,
        success: Boolean(wp),
        error: result?.error || null,
        message: result?.message || null,
        label: result?.best?.label || result?.label || "",
        confidence: result?.best?.confidence,
      });
      return result;
    }

    if (name === "get_price_quote") {
      console.log("tool_call", { uuid, name });
      if (!callState.island) {
        return { error: "island_required_first", message: "Please ask which island first." };
      }
      if (callState.bookingFor === "unknown") {
        return { error: "booking_time_mode_required", message: "Please ask if booking is now or later first." };
      }
      const originLat = args?.origin_lat !== undefined
        ? Number(args.origin_lat)
        : Number(callState.pickupWaypoint?.placeLatLng?.lat ?? callState.pickupWaypoint?.exactLatLng?.lat);
      const originLng = args?.origin_lng !== undefined
        ? Number(args.origin_lng)
        : Number(callState.pickupWaypoint?.placeLatLng?.lng ?? callState.pickupWaypoint?.exactLatLng?.lng);
      const destinationLat = args?.destination_lat !== undefined
        ? Number(args.destination_lat)
        : Number(callState.dropoffWaypoint?.placeLatLng?.lat ?? callState.dropoffWaypoint?.exactLatLng?.lat);
      const destinationLng = args?.destination_lng !== undefined
        ? Number(args.destination_lng)
        : Number(callState.dropoffWaypoint?.placeLatLng?.lng ?? callState.dropoffWaypoint?.exactLatLng?.lng);

      const origin = Number.isFinite(originLat) && Number.isFinite(originLng) ? `${originLat},${originLng}` : "";
      const destination = Number.isFinite(destinationLat) && Number.isFinite(destinationLng) ? `${destinationLat},${destinationLng}` : "";
      const parsedPickupTime = normalizeScheduledPickup({
        booking_for: callState.bookingFor,
        pickup_time: args?.pickup_time || callState.pickupTime,
        pickup_date: callState.scheduledDate,
        pickup_clock: callState.scheduledTime,
      }, callState.startedAt);

      if (!origin || !destination) {
        return { error: "missing_origin_or_destination_coordinates" };
      }
      if (parsedPickupTime.mode === "later" && (!parsedPickupTime.ok || parsedPickupTime.needsClarification)) {
        return {
          error: "pickup_time_needs_clarification",
          message: "Please confirm exact pickup time with AM or PM.",
        };
      }

      const vehicleType = normalizeVehiclePreference(args?.vehicle_type || callState.vehicleTypePreference);
      const ondeServiceType = sanitizeOndeVehicleType(
        resolveOndeServiceType({
          island: callState.island,
          requestedVehicleType: vehicleType,
          passengers: args?.number_of_seats || callState.passengers,
        }) || mapToOndeVehicleType(vehicleType)
      );
      const quoteSignature = JSON.stringify({
        origin,
        destination,
        pickupTime: parsedPickupTime.mode === "later" ? parsedPickupTime.iso : "now",
        seats: args?.number_of_seats || callState.passengers,
        vehicleType,
        ondeServiceType,
      });
      if (callState.lastQuoteSignature === quoteSignature && callState.lastQuoteResult) {
        return callState.lastQuoteResult;
      }

      let quoteRaw = null;
      let list = [];
      let first = null;

      if (ACTIVE_BACKEND_MODE === "nq") {
        const nqQuote = await nqCreateQuote(callState, {
          pickup: { lat: originLat, lng: originLng },
          dropoff: { lat: destinationLat, lng: destinationLng },
          vehicle_category: vehicleType || undefined,
        });
        quoteRaw = nqQuote;
        if (nqQuote && !nqQuote.error && Number.isFinite(Number(nqQuote.quoted_price))) {
          first = {
            tariffId: nqQuote.quote_id || null,
            name: "NQ Estimated Fare",
            currency: nqQuote.currency || "EUR",
            fixedCost: Number(nqQuote.quoted_price),
            cost: Number(nqQuote.quoted_price),
            minimumCharge: Number(nqQuote.quoted_price),
            maximumCharge: Number(nqQuote.quoted_price),
            etaMinutes: Number(nqQuote.eta_minutes || 0),
            distanceKm: Number(nqQuote.distance_km || 0),
          };
          list = [first];
        }
      } else {
        const tariffs = await ondeGetTariffs({
          origin,
          destination,
          pickupTime: parsedPickupTime.mode === "later" ? parsedPickupTime.iso : undefined,
          numberOfSeats: args?.number_of_seats || callState.passengers,
          vehicleType: ondeServiceType || undefined,
          tariffType: args?.tariff_type,
          paymentMethods: args?.payment_method,
        });
        quoteRaw = tariffs;
        list = tariffs?.tariffs || [];
        first = list[0] || null;
      }

      callState.lastTariffs = quoteRaw;
      if (quoteRaw?.error) {
        callState.quoteFailures += 1;
      }
      let fallbackEstimate = null;
      if (!first || quoteRaw?.error) {
        const metrics = estimateTripMetrics(originLat, originLng, destinationLat, destinationLng);
        const fare = estimateFallbackFare({
          passengers: args?.number_of_seats || callState.passengers,
          distanceKm: metrics.distanceKm,
          timeMin: metrics.timeMin,
          vehicleType,
        });
        fallbackEstimate = {
          provider: "internal_fallback",
          currency: "EUR",
          estimatedFareEur: fare.estimatedFareEur,
          speakText: `about ${fare.estimatedFareEur} euros`,
          vehicleClass: fare.vehicleClass,
          estimatedDistanceKm: Number(metrics.distanceKm.toFixed(2)),
          estimatedTimeMin: Number(metrics.timeMin.toFixed(1)),
          details: fare,
        };
      }
      console.log("tool_result", {
        uuid,
        name,
        tariffsCount: list.length,
        bestTariffId: first?.tariffId,
        bestCost: first?.cost,
        currency: first?.currency,
        usedFallback: Boolean(fallbackEstimate),
        fallbackFare: fallbackEstimate?.estimatedFareEur,
      });
      const quoteResult = {
        error: quoteRaw?.error || null,
        error_message: quoteRaw?.message || null,
        fallback_estimate: fallbackEstimate,
        tariffs_count: list.length,
        best: first
          ? {
              tariffId: first.tariffId,
              name: first.name,
              currency: first.currency,
              fixedCost: first.fixedCost,
              cost: first.cost,
              minimumCharge: first.minimumCharge,
              maximumCharge: first.maximumCharge,
            }
          : null,
        raw: quoteRaw,
      };
      callState.lastQuoteSignature = quoteSignature;
      callState.lastQuoteResult = quoteResult;
      return quoteResult;
    }

    if (name === "create_booking") {
      console.log("tool_call", { uuid, name, hasPickup: Boolean(callState.pickupWaypoint), hasDropoff: Boolean(callState.dropoffWaypoint) });
      if (!callState.island) {
        return { error: "island_required_first", message: "Please ask which island first." };
      }
      if (callState.bookingFor === "unknown") {
        return { error: "booking_time_mode_required", message: "Please ask if booking is now or later first." };
      }
      console.log("openai_usage_checkpoint_before_create_booking", {
        uuid,
        usage: callState.openaiUsageTotals,
        estimatedCost: estimateOpenAiCost(callState.openaiUsageTotals),
        estimatedCostRange: estimateOpenAiCostRangeFromTotal(callState.openaiUsageTotals.totalTokens),
      });
      const pickupWaypoint = args?.pickup_waypoint || callState.pickupWaypoint || waypointFromParts(callState.pickupRaw);
      const dropoffWaypoint = args?.dropoff_waypoint || callState.dropoffWaypoint || waypointFromParts(callState.dropoffRaw);
      if (!hasWaypointCoords(pickupWaypoint) || !hasWaypointCoords(dropoffWaypoint)) {
        return {
          error: "missing_waypoint_coordinates",
          message: "Pickup and dropoff coordinates are required before booking.",
        };
      }
      const parsedPickupTime = normalizeScheduledPickup({
        booking_for: callState.bookingFor,
        pickup_time: args?.pickup_time || callState.pickupTime,
        pickup_date: callState.scheduledDate,
        pickup_clock: callState.scheduledTime,
      }, callState.startedAt);
      if (parsedPickupTime.mode === "later" && (!parsedPickupTime.ok || parsedPickupTime.needsClarification)) {
        return {
          error: "pickup_time_needs_clarification",
          message: "Please confirm whether pickup time is AM or PM and provide exact time.",
        };
      }
      const pickupCoords = {
        lat: pickupWaypoint?.placeLatLng?.lat ?? pickupWaypoint?.exactLatLng?.lat ?? null,
        lng: pickupWaypoint?.placeLatLng?.lng ?? pickupWaypoint?.exactLatLng?.lng ?? null,
      };
      const dropoffCoords = {
        lat: dropoffWaypoint?.placeLatLng?.lat ?? dropoffWaypoint?.exactLatLng?.lat ?? null,
        lng: dropoffWaypoint?.placeLatLng?.lng ?? dropoffWaypoint?.exactLatLng?.lng ?? null,
      };

      const combinedNotes = [args?.notes, buildTransportNotes(callState)].filter(Boolean).join(" | ");
      const normalizedClientPhone = normalizePhoneE164(args?.phone || callState.phone) || undefined;
      const requestedVehicleType = args?.vehicle_type || callState.vehicleTypePreference || "";
      const requestedPassengers = args?.passengers || callState.passengers;
      const nqVehicleCategoryName = await resolveNqVehicleCategoryName(
        callState,
        requestedVehicleType,
        requestedPassengers
      );
      const orderPayloadOnde = clean({
        waypoints: [pickupWaypoint, dropoffWaypoint],
        client: {
          name: args?.name || callState.name || undefined,
          phone: normalizedClientPhone,
        },
        notes: combinedNotes || undefined,
        numberOfSeats: args?.passengers || callState.passengers,
        pickupTime: parsedPickupTime.mode === "later" ? parsedPickupTime.iso : undefined,
        vehicleType: sanitizeOndeVehicleType(
          resolveOndeServiceType({
            island: callState.island,
            requestedVehicleType,
            passengers: args?.passengers || callState.passengers,
          }) || mapToOndeVehicleType(requestedVehicleType)
        ),
        tariffType: args?.tariff_type,
        tariffId: args?.tariff_id,
        paymentMethods: args?.payment_methods?.length ? args.payment_methods : ["CASH"],
      });
      const orderPayloadNq = clean({
        customer_name: args?.name || callState.name || undefined,
        customer_phone: normalizedClientPhone,
        pickup: {
          lat: pickupCoords.lat,
          lng: pickupCoords.lng,
          address: pickupWaypoint?.poiName || pickupWaypoint?.premise || callState.pickupRaw || undefined,
        },
        dropoff: {
          lat: dropoffCoords.lat,
          lng: dropoffCoords.lng,
          address: dropoffWaypoint?.poiName || dropoffWaypoint?.premise || callState.dropoffRaw || undefined,
        },
        notes: combinedNotes || undefined,
        passenger_count: args?.passengers || callState.passengers,
        scheduled_at: parsedPickupTime.mode === "later" ? parsedPickupTime.iso : undefined,
        vehicle_category_name: nqVehicleCategoryName,
      });
      console.log("create_booking_payload", {
        uuid,
        backendMode: ACTIVE_BACKEND_MODE,
        pickupLabel: pickupWaypoint?.poiName || pickupWaypoint?.premise || null,
        pickupCoords,
        dropoffLabel: dropoffWaypoint?.poiName || dropoffWaypoint?.premise || null,
        dropoffCoords,
        numberOfSeats: orderPayloadOnde?.numberOfSeats || orderPayloadNq?.passenger_count || null,
        vehicleType: orderPayloadOnde?.vehicleType || orderPayloadNq?.vehicle_category_name || null,
        requestedVehicleType: requestedVehicleType || null,
        resolvedNqVehicleCategory: nqVehicleCategoryName || null,
        pickupTime: orderPayloadOnde?.pickupTime || orderPayloadNq?.scheduled_at || "now",
        pickupMode: callState.pickupMode,
        transportRef: callState.transportRef || null,
        transportOrigin: callState.transportOrigin || null,
        transportEta: callState.transportEta || null,
        hasClientPhone: Boolean(normalizedClientPhone),
      });

      let result = null;
      let offer = null;
      if (ACTIVE_BACKEND_MODE === "nq") {
        result = await nqCreateOrder(callState, orderPayloadNq);
      } else {
        result = await ondeCreateOrder(orderPayloadOnde);
        const ondeOrderId = extractOrderId(result);
        if (ondeOrderId) {
          try {
            offer = await ondeGetOrderOffer(ondeOrderId);
            console.log("onde_offer", {
              uuid,
              orderId: ondeOrderId,
              eta: offer?.eta || null,
              driverId: offer?.driver?.driverId || null,
              hasShareLocation: Boolean(findShareLocationUrl(offer)),
            });
          } catch {}
        }
      }

      const createdOrderId = extractOrderId(result);
      if (createdOrderId) callState.orderId = createdOrderId;
      if (!createdOrderId) callState.bookingFailures += 1;
      console.log("tool_result", {
        uuid,
        name,
        backendMode: ACTIVE_BACKEND_MODE,
        orderId: createdOrderId || null,
        error: result?.error || null,
      });

      if (!callState.orderId) return result;

      rememberOrderForPhone(normalizedClientPhone || callState.phone, {
        orderId: callState.orderId,
        island: callState.island,
        pickupLabel: pickupWaypoint?.poiName || pickupWaypoint?.premise || "",
        dropoffLabel: dropoffWaypoint?.poiName || dropoffWaypoint?.premise || "",
      });

      const bookingResult = offer ? { ...result, offer } : result;
      const waPhone = normalizePhoneE164(args?.phone || callState.phone);
      if (waPhone) {
        const waMessage = buildBookingWhatsappMessage({ offer, orderResult: bookingResult });
        const waRes = await sendWhatsapp({
          phone: waPhone,
          message: waMessage,
          booking_id: callState.orderId,
          channel: "voice_ai_v1",
        });
        const waAccepted = Boolean(waRes && !waRes.error && !waRes.skipped);
        const waMessageId = waRes?.messages?.[0]?.id || null;
        callState.whatsappStatus = {
          sent: waAccepted && Boolean(waMessageId),
          reason: waRes?.reason || (waRes?.error ? "whatsapp_send_failed" : ""),
          status: waAccepted ? "accepted_by_provider" : "not_accepted",
          messageId: waMessageId,
        };
        console.log("whatsapp_auto_send", {
          uuid,
          bookingId: callState.orderId,
          provider: WHATSAPP_PROVIDER,
          messageId: waMessageId,
          sent: callState.whatsappStatus.sent,
          status: callState.whatsappStatus.status,
          reason: callState.whatsappStatus.reason || null,
          error: waRes?.error || waRes?.error_data || null,
        });
      }

      return bookingResult;
    }

    if (name === "send_whatsapp_confirmation") {
      console.log("tool_call", { uuid, name, hasPhone: Boolean(args?.phone || callState.phone) });
      const result = await sendWhatsapp({
        phone: normalizePhoneE164(args?.phone || callState.phone),
        message: args?.message || "Your ride details are confirmed.",
        booking_id: args?.booking_id || callState.orderId,
        channel: "voice_ai_v1",
      });
      callState.whatsappStatus = {
        sent: Boolean(result && !result.error && !result.skipped),
        reason: result?.reason,
      };
      console.log("tool_result", {
        uuid,
        name,
        sent: callState.whatsappStatus.sent,
        reason: callState.whatsappStatus.reason || null,
      });
      return result;
    }

    if (name === "cancel_booking") {
      const candidateOrderId =
        (typeof args?.order_id === "string" && args.order_id.trim() ? args.order_id.trim() : "") ||
        callState.orderId ||
        findLatestOrderForPhone(args?.phone || callState.phone)?.orderId ||
        "";
      const phone = normalizePhoneE164(args?.phone || callState.phone);
      console.log("tool_call", {
        uuid,
        name,
        orderId: candidateOrderId || null,
        hasPhone: Boolean(phone),
      });
      if (!candidateOrderId) {
        return {
          error: "cancel_order_not_found",
          message: "I could not find a recent booking to cancel. Please provide your booking ID.",
        };
      }
      const result = ACTIVE_BACKEND_MODE === "nq"
        ? await nqCancelOrder(callState, candidateOrderId, args?.reason || "client_request")
        : await ondeCancelOrder(candidateOrderId, args?.reason || "client_request");
      if (result && !result.error) callState.cancelActionDone = true;
      console.log("tool_result", {
        uuid,
        name,
        backendMode: ACTIVE_BACKEND_MODE,
        orderId: candidateOrderId,
        ok: Boolean(result && !result.error),
        error: result?.error || null,
      });
      return result;
    }

    if (name === "escalate_to_human") {
      console.log("tool_call", { uuid, name, reason: args?.reason || "manual_escalation" });
      callState.handover = {
        reason: args?.reason || "manual_escalation",
        summary: args?.summary || "",
        at: nowIso(),
      };
      return {
        action: "callback_or_live_transfer",
        queued: true,
        reason: args?.reason || "manual_escalation",
      };
    }

    if (name === "end_call") {
      const reason = args?.reason || "task_not_completed";
      const finalMessage = args?.final_message || "Sorry, I cannot complete this request right now. Thank you for calling Aegean Taxi. Goodbye.";
      console.log("tool_call", { uuid, name, reason });
      requestEndCall(reason, finalMessage);
      return {
        action: "end_call",
        reason,
        final_message: finalMessage,
      };
    }

    return { error: `unknown_tool:${name}` };
  }

  async function handleFunctionCallItem(item) {
    const callId = item.call_id;
    const toolName = item.name;
    const args = safeJsonParse(item.arguments || "{}");
    callState.turnCount += 1;
    console.log("function_call_item", { uuid, toolName, turn: callState.turnCount });

    let output;
    try {
      output = await executeTool(toolName, args);
    } catch (err) {
      output = { error: "tool_execution_failed", message: err?.message || String(err) };
    }

    safeSend({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(output),
      },
    });

    if (callState.endCallRequested) {
      requestModelResponse(
        `Say exactly: "${callState.endCallMessage}"\nThen say exactly: "Goodbye."\nDo not ask more questions.`
      );
      setTimeout(() => shutdown("end_call_requested", vonageWs, openaiWs, callState), 4000);
      return;
    }

    if (toolName === "capture_call_details") {
      const nextQ = nextRequiredQuestionInstruction();
      if (nextQ) {
        requestModelResponse(`${nextQ}\nAsk one question only.`, { waitForCaller: true, maxOutputTokens: 80 });
        return;
      }
      requestModelResponse(
        "All required fields are captured. If caller asked for price or booking, call get_price_quote now and ask only one confirmation question."
      );
      return;
    }

    if (toolName === "get_price_quote") {
      requestModelResponse(
        "Say the price in one short sentence and ask only: Do you want me to book it now?",
        { waitForCaller: true, maxOutputTokens: 90 }
      );
      return;
    }

    if (toolName === "create_booking") {
      requestModelResponse(
        "Confirm booking created in one short sentence and stop."
      );
      return;
    }

    if (toolName === "cancel_booking") {
      requestModelResponse(
        "Confirm cancellation result in one short sentence and stop."
      );
      return;
    }

    requestModelResponse();
  }

  function initOpenAI() {
    const sent = safeSend({
      type: "session.update",
      session: {
        voice: OPENAI_VOICE,
        modalities: ["audio", "text"],
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: { model: OPENAI_STT_MODEL },
        turn_detection: {
          type: "server_vad",
          threshold: 0.88,
          prefix_padding_ms: 300,
          silence_duration_ms: 700,
        },
        temperature: OPENAI_TEMPERATURE,
        instructions: orchestrationPrompt(callState),
        tool_choice: "auto",
        tools: toolsDefinition(),
      },
    });
    if (!sent) {
      console.log("openai_send_failed", { uuid, type: "session.update" });
    }
    responseActive = false;
    greetingDone = false;
    initialGreetingQueued = false;
    allowUserSpeechAtMs = Number.MAX_SAFE_INTEGER;
  }

  function queueInitialGreetingOnce() {
    if (initialGreetingQueued) return;
    initialGreetingAttempts += 1;
    const seeded = safeSend({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "Begin the call now. Say the greeting exactly as instructed.",
          },
        ],
      },
    });
    if (!seeded) {
      console.log("openai_send_failed", { uuid, type: "conversation.item.create" });
      setTimeout(() => queueInitialGreetingOnce(), 700);
      return;
    }
    const ok = requestModelResponse(
      `Say this greeting once: "${GREETING_TEXT}"`,
      { maxOutputTokens: 220 }
    );
    if (!ok) {
      setTimeout(() => queueInitialGreetingOnce(), 700);
      return;
    }
    initialGreetingQueued = true;
    console.log("initial_greeting_queued", { uuid });
  }

  openaiWs.on("open", () => {
    console.log("openai_ws_open", { uuid });
    openaiReady = true;
    if (ACTIVE_BACKEND_MODE === "nq") {
      ensureNqCallContext(callState).then((ctx) => {
        if (ctx.companyId || ctx.companyCode) {
          console.log("nq_call_context_ready", {
            uuid,
            companyId: ctx.companyId || "",
            companyCode: ctx.companyCode || "",
            numberId: callState.numberId || "",
          });
        }
      });
    }
    initOpenAI();
    setTimeout(() => queueInitialGreetingOnce(), 1200);
  });

  openaiWs.on("message", async (raw) => {
    const evt = safeJsonParse(raw.toString());
    if (!evt?.type) return;

    if (evt.type === "conversation.item.input_audio_transcription.completed") {
      if (evt?.transcript) {
        waitForCallerReply = false;
        callState.transcripts.push({
          at: nowIso(),
          speaker: "caller",
          text: String(evt.transcript),
        });
        if (callState.transcripts.length > 200) callState.transcripts = callState.transcripts.slice(-200);
        void sinkTranscriptToNq(callState, "caller", evt.transcript);
      }
      console.log("stt_transcript", {
        uuid,
        transcript: evt?.transcript || "",
      });
    }

    if (evt.type === "session.updated") {
      console.log("openai_session_updated", { uuid });
      queueInitialGreetingOnce();
      return;
    }

    if (evt.type === "response.created") {
      responseActive = true;
      console.log("openai_response_created", { uuid });
    }

    if (evt.type === "response.done") {
      const status = evt?.response?.status || "unknown";
      const statusDetails = evt?.response?.status_details || evt?.response?.error || null;
      const incompleteReason = statusDetails?.reason || statusDetails?.error?.code || "";
      const errorCode = statusDetails?.error?.code || "";
      const greetingConsideredDelivered = status === "completed";
      console.log("openai_response_done", { uuid, status, statusDetails });
      if (status === "failed" && errorCode === "rate_limit_exceeded") {
        rateLimitBackoffUntilMs = Date.now() + 1500;
      }
      if (status === "failed" && !greetingDone && initialGreetingAttempts < 3) {
        initialGreetingQueued = false;
        setTimeout(() => queueInitialGreetingOnce(), 450);
      }
      const usage = extractRealtimeUsage(evt);
      callState.openaiUsageTotals.inputTextTokens += usage.inputTextTokens;
      callState.openaiUsageTotals.outputTextTokens += usage.outputTextTokens;
      callState.openaiUsageTotals.inputAudioTokens += usage.inputAudioTokens;
      callState.openaiUsageTotals.outputAudioTokens += usage.outputAudioTokens;
      callState.openaiUsageTotals.totalTokens += usage.totalTokens;
      if (callState.openaiUsageTotals.totalTokens >= OPENAI_CALL_TOKEN_BUDGET && !callState.endCallRequested) {
        requestEndCall(
          "token_budget_exceeded",
          "Sorry, I am having difficulty completing this call right now. Please hold for a human agent."
        );
      }
      if (usage.totalTokens > 0) {
        console.log("openai_response_usage", {
          uuid,
          usage,
          runningTotals: callState.openaiUsageTotals,
          runningCost: estimateOpenAiCost(callState.openaiUsageTotals),
          runningCostRange: estimateOpenAiCostRangeFromTotal(callState.openaiUsageTotals.totalTokens),
        });
      }

      responseActive = false;
      if (!greetingDone && greetingConsideredDelivered) {
        greetingDone = true;
        allowUserSpeechAtMs = Date.now() + 500;
        if (!initialIslandQuestionQueued && !callState.island && callState.turnCount === 0) {
          initialIslandQuestionQueued = true;
          setTimeout(() => {
            requestModelResponse(`Ask exactly this question now: "Which island are you currently in?"`, {
              maxOutputTokens: 24,
              waitForCaller: true,
            });
          }, 120);
        }
      }
      if (!greetingDone && status === "incomplete" && incompleteReason === "max_output_tokens") {
        if (initialGreetingAttempts < 3) {
          initialGreetingQueued = false;
          setTimeout(() => queueInitialGreetingOnce(), 450);
        }
      }
      if (!inSpeech && pendingResponse !== null && !waitForCallerReply) {
        const queued = pendingResponse;
        pendingResponse = null;
        requestModelResponse(queued.instructions, queued.options);
      }
      return;
    }

    if (evt.type === "input_audio_buffer.speech_started") {
      // Ignore caller/noise interruptions during the opening greeting.
      if (!greetingDone) return;
      if (Date.now() < allowUserSpeechAtMs) return;
      inSpeech = true;
      return;
    }

    if (evt.type === "input_audio_buffer.speech_stopped") {
      inSpeech = false;
      if (!greetingDone && !responseActive) {
        greetingDone = true;
        requestModelResponse(
          "You are already in-progress with caller speech. Continue directly with this question: Which island are you currently in?",
          { waitForCaller: true, maxOutputTokens: 40 }
        );
      }
      if (pendingResponse !== null && !waitForCallerReply) {
        const queued = pendingResponse;
        pendingResponse = null;
        requestModelResponse(queued.instructions, queued.options);
      }
      return;
    }

    if (evt.type === "response.output_item.done") {
      if (evt.item?.type === "function_call") {
        await handleFunctionCallItem(evt.item);
        return;
      }
      const assistantText = extractAssistantTextFromOutputItem(evt.item);
      if (assistantText) {
        callState.transcripts.push({
          at: nowIso(),
          speaker: "assistant",
          text: assistantText,
        });
        if (callState.transcripts.length > 200) callState.transcripts = callState.transcripts.slice(-200);
        void sinkTranscriptToNq(callState, "assistant", assistantText);
      }
      return;
    }

    if ((evt.type === "response.audio.delta" || evt.type === "response.output_audio.delta") && evt.delta) {
      try {
        const openaiPcm = bufFromB64(evt.delta);
        const vonagePcm = resamplePcm16Linear(openaiPcm, OPENAI_SAMPLE_RATE, VONAGE_SAMPLE_RATE);
        if (vonagePcm.length) vonageWs.send(vonagePcm);
      } catch {}
      return;
    }

    if (evt.type === "error") {
      const code = evt?.error?.code;
      if (code === "response_cancel_not_active" || code === "conversation_already_has_active_response") {
        return;
      }
      console.log("openai_error", { uuid, error: evt.error });
      shutdown("openai_error", vonageWs, openaiWs, callState);
    }
  });

  openaiWs.on("close", (code, reason) => {
    console.log("openai_ws_closed", { uuid, code, reason: reason?.toString?.() || "" });
    shutdown("openai_ws_closed", vonageWs, openaiWs, callState);
  });

  openaiWs.on("error", (err) => {
    console.log("openai_ws_error", { uuid, message: err?.message || String(err) });
    shutdown("openai_ws_error", vonageWs, openaiWs, callState);
  });

  vonageWs.on("message", (msg) => {
    if (!openaiReady) return;
    if (typeof msg === "string") return;

    const vonagePcm = Buffer.from(msg);
    if (vonagePcm.length < 2) return;

    const openaiPcm = resamplePcm16Linear(vonagePcm, VONAGE_SAMPLE_RATE, OPENAI_SAMPLE_RATE);
    if (!openaiPcm.length) return;

    // Keep the greeting non-interruptible to avoid truncation from background noise.
    if (!greetingDone) return;

    safeSend({
      type: "input_audio_buffer.append",
      audio: b64FromBuf(openaiPcm),
    });
  });

  vonageWs.on("close", () => {
    shutdown("vonage_ws_closed", vonageWs, openaiWs, callState);
    callRegistry.delete(uuid);
  });

  vonageWs.on("error", () => {
    shutdown("vonage_ws_error", vonageWs, openaiWs, callState);
    callRegistry.delete(uuid);
  });
});

server.listen(PORT, () => {
  console.log(`server_running port=${PORT}`);
  console.log(`backend_mode=${ACTIVE_BACKEND_MODE}`);
  if (BACKEND_MODE && BACKEND_MODE !== "nq") {
    console.log(`backend_mode_override_requested=${BACKEND_MODE}`);
  }
  console.log(`public_base_url=${PUBLIC_BASE_URL}`);
  console.log(`openai_model=${OPENAI_REALTIME_MODEL}`);
  console.log(`openai_voice=${OPENAI_VOICE}`);
  console.log(`openai_stt_model=${OPENAI_STT_MODEL}`);
  console.log(`voice_stack_mode=${VOICE_STACK_MODE}`);
  console.log(`deepgram_model=${DEEPGRAM_MODEL}`);
  console.log(`deepgram_configured=${Boolean(DEEPGRAM_API_KEY)}`);
  console.log(`elevenlabs_voice_id=${ELEVENLABS_VOICE_ID || "not_set"}`);
  console.log(`elevenlabs_configured=${Boolean(ELEVENLABS_API_KEY && ELEVENLABS_VOICE_ID)}`);
  console.log(`onde_mode_disabled=true`);
  console.log(`nq_base_url=${NQ_BASE_URL || "not_set"}`);
  console.log(`nq_configured=${Boolean(NQ_BASE_URL && NQ_SERVICE_TOKEN)}`);
  console.log(`nq_call_number_id=${NQ_CALL_NUMBER_ID || "not_set"}`);
  console.log(`nq_company_id=${NQ_COMPANY_ID || "not_set"}`);
  console.log(`nq_quote_configured=${Boolean(NQ_PUBLIC_CLIENT_ID && NQ_PUBLIC_CLIENT_SECRET)}`);
  console.log(`nq_transcript_enabled=${Boolean(NQ_TRANSCRIPT_ENABLED)}`);
  console.log(`place_resolver_mode=${PLACE_RESOLVER_URL ? "remote" : "internal_nominatim"}`);
  console.log(`place_resolver_configured=${Boolean(PLACE_RESOLVER_URL || NOMINATIM_BASE_URL)}`);
  console.log(`poi_db_path=${POI_DB_PATH}`);
  console.log(`poi_db_loaded=${POI_DB.totalPois > 0}`);
  console.log(`poi_db_pois=${POI_DB.totalPois}`);
  console.log(`service_types_path=${ONDE_SERVICE_TYPES_PATH}`);
  console.log(`service_types_areas=${Object.keys(ONDE_SERVICE_TYPES.areas || {}).length}`);
  console.log(`supported_areas=${SUPPORTED_AREAS.join(", ")}`);
  console.log(
    `whatsapp_configured=${
      WHATSAPP_PROVIDER === "meta_cloud"
        ? Boolean(WHATSAPP_META_TOKEN && WHATSAPP_META_PHONE_NUMBER_ID)
        : Boolean(WHATSAPP_BASE_URL)
    }`
  );
  console.log(`whatsapp_provider=${WHATSAPP_PROVIDER}`);
  console.log(`ws_token_enabled=${Boolean(WS_SHARED_SECRET)}`);
});
