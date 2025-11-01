// /api/ai/food-lookup.js
//
// Dedicated endpoint for *single food* nutrition lookup.
// Keeps /api/ai/generate focused on workout|meal|coach.
// Uses the same free-pass gating (3/day per client) but only for the "food" feature.

import { supabaseAdmin } from "../_lib/supabaseAdmin.js";
import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export const config = { api: { bodyParser: false } };
export const maxDuration = 10;

/* ---------- tiny utils ---------- */
async function readJson(req) {
  try {
    const bufs = [];
    for await (const chunk of req) bufs.push(chunk);
    const raw = Buffer.concat(bufs).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function dayKeyUTC(d = new Date()) { return d.toISOString().slice(0, 10); }
function headerClientId(req) {
  const cid = (req.headers["x-client-id"] || "").toString().trim();
  if (cid) return cid.slice(0, 128);
  const ip = (req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "0.0.0.0")
    .toString().split(",")[0].trim();
  return `ip:${ip}`;
}
function base64UrlDecode(str) {
  try {
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "====".slice(0, 4 - (b64.length % 4)) : "";
    return JSON.parse(Buffer.from(b64 + pad, "base64").toString("utf8"));
  } catch { return null; }
}
function getUserIdFromHeaders(req) {
  const hdr = (req.headers["x-supabase-user-id"] || req.headers["x-user-id"] || "").toString().trim();
  if (hdr) return hdr;
  const auth = (req.headers["authorization"] || "").toString().trim();
  if (auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7);
    const parts = token.split(".");
    if (parts.length >= 2) {
      const payload = base64UrlDecode(parts[1]);
      const sub = payload?.sub || payload?.user_id || payload?.uid;
      if (sub) return String(sub);
    }
  }
  return null;
}

/* ---------- free-pass gating (feature = 'food') ---------- */
const FREE_LIMIT = 3;
const mem = new Map();

async function allowFree(req, userId) {
  const feature = "food";
  const clientId = userId ? `uid:${userId}` : headerClientId(req);
  const key = `${clientId}:${feature}`;
  const today = dayKeyUTC();
  const rec = mem.get(key);
  if (!rec || rec.day !== today) {
    mem.set(key, { uses: 1, day: today });
    // try to persist
    try {
      await supabaseAdmin?.from("ai_free_passes").insert({
        client_id: clientId, user_id: userId || null, feature, day_key: today, uses: 1
      });
    } catch {}
    return true;
  }
  if (rec.uses < FREE_LIMIT) {
    rec.uses += 1;
    try {
      await supabaseAdmin?.from("ai_free_passes")
        .update({ uses: rec.uses, user_id: userId || null })
        .eq("client_id", clientId).eq("feature", feature).eq("day_key", today);
    } catch {}
    return true;
  }
  return false;
}

/* ---------- OpenAI call with strict schema ---------- */
const OPENAI_TIMEOUT_MS = 6000;
function withTimeout(p, ms, fallback) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, ms);
    p.then((v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } })
     .catch(() => { if (!done) { done = true; clearTimeout(t); resolve(fallback); } });
  });
}

// very light normalization for obvious “g” units
function parseQtyToGrams(qtyText) {
  if (!qtyText) return null;
  const s = String(qtyText).trim().toLowerCase();
  const g = s.match(/(\d+(?:\.\d+)?)\s*g\b/);
  if (g) return Math.max(1, Math.round(parseFloat(g[1])));
  return null; // let LLM figure out cups/pieces if provided
}

async function llmNutrition({ food, brand, quantity }) {
  if (!openai) {
    // fallback heuristic if OPENAI key not set
    const grams = parseQtyToGrams(quantity) || 150;
    // simple yogurt-like baseline; better than 650 kcal nonsense
    const per100 = { cal: 60, p: 10, c: 4, f: 0 }; // 100g baseline
    const factor = grams / 100;
    return {
      title: `${brand ? brand + " " : ""}${food}${quantity ? " — " + quantity : ""}`,
      calories: Math.round(per100.cal * factor),
      protein_g: Math.round(per100.p * factor),
      carbs_g: Math.round(per100.c * factor),
      fat_g: Math.round(per100.f * factor),
    };
  }

  const sys = `You output nutrition for ONE food item. Return ONLY valid JSON:
{"title":"...","calories":123,"protein_g":12,"carbs_g":10,"fat_g":2}
Rules:
- If brand or quantity are present, reflect them in "title".
- Prefer verified, typical values. If uncertain, output a reasonable estimate.
- All macro fields must be numbers (no strings).`;

  const user = `Food: ${food}
Brand: ${brand || "n/a"}
Quantity: ${quantity || "n/a"}
Return exactly: title, calories, protein_g, carbs_g, fat_g (numbers).`;

  const call = openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    temperature: 0.2
  });

  const res = await withTimeout(call, OPENAI_TIMEOUT_MS, null);
  if (!res) return null;

  const txt = res?.choices?.[0]?.message?.content || "";
  try {
    const j = JSON.parse(txt);
    const out = {
      title: j.title || `${brand ? brand + " " : ""}${food}${quantity ? " — " + quantity : ""}`,
      calories: Number(j.calories || 0),
      protein_g: Number(j.protein_g || 0),
      carbs_g: Number(j.carbs_g || 0),
      fat_g: Number(j.fat_g || 0),
    };
    // sanity clamp — avoid crazy 600kcal for yogurt
    ["calories","protein_g","carbs_g","fat_g"].forEach(k => {
      if (!Number.isFinite(out[k]) || out[k] < 0) out[k] = 0;
    });
    return out;
  } catch {
    return null;
  }
}

/* ---------- handler ---------- */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = await readJson(req);
  const food = String(body?.food || "").trim();
  const brand = (body?.brand || "").trim();
  const quantity = (body?.quantity || "").trim();

  if (!food) {
    res.status(400).json({ error: "Missing food" });
    return;
  }

  // free-pass (you can remove if you want unlimited lookups)
  const userId = getUserIdFromHeaders(req);
  const allowed = await allowFree(req, userId);
  if (!allowed) {
    res.status(402).json({ error: "Upgrade required" });
    return;
  }

  try {
    const data = await llmNutrition({ food, brand, quantity });
    if (!data) {
      // final guard — modest baseline rather than nonsense
      const grams = parseQtyToGrams(quantity) || 150;
      const per100 = { cal: 60, p: 10, c: 4, f: 0 };
      const factor = grams / 100;
      res.status(200).json({
        title: `${brand ? brand + " " : ""}${food}${quantity ? " — " + quantity : ""}`,
        calories: Math.round(per100.cal * factor),
        protein_g: Math.round(per100.p * factor),
        carbs_g: Math.round(per100.c * factor),
        fat_g: Math.round(per100.f * factor),
      });
      return;
    }
    res.status(200).json(data);
  } catch (e) {
    console.error("[food-lookup] error:", e);
    res.status(500).json({ error: "Internal error" });
  }
}
