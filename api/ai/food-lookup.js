// /api/ai/food-lookup.js
// AI Food Lookup — entitlement-aware (Pro/Trial unlimited) + 3/day free-pass for others.
// Returns fields expected by AIFoodLookupBox: name, brand, quantity_input, serving{}, calories, macros.

import { supabaseAdmin } from "../_lib/supabaseAdmin.js";
import OpenAI from "openai";

export const config = { api: { bodyParser: false } };
export const maxDuration = 10;

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

/* ---------------- utils ---------------- */
async function readJson(req) {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function dayKeyUTC(d = new Date()) { return d.toISOString().slice(0, 10); }
function base64UrlDecode(s) {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "====".slice(b64.length % 4) : "";
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
function headerClientId(req) {
  const cid = (req.headers["x-client-id"] || "").toString().trim();
  if (cid) return cid.slice(0, 128);
  const ip = (req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "0.0.0.0")
    .toString().split(",")[0].trim();
  return `ip:${ip}`;
}
function idKey(req, userId) { return userId ? `uid:${userId}` : headerClientId(req); }
function nowSec() { return Math.floor(Date.now() / 1000); }
function tsToSec(ts) {
  if (!ts) return 0;
  const n = typeof ts === "number" ? ts : Math.floor(new Date(ts).getTime() / 1000);
  return Number.isFinite(n) ? n : 0;
}

/* ---------------- entitlement (matches /api/ai/generate.js) ---------------- */
const ENTITLED = new Set(["active", "trialing", "past_due"]);

async function isEntitled(user_id) {
  if (!user_id || !supabaseAdmin) return false;

  try {
    const { data: ent, error } = await supabaseAdmin
      .from("v_user_entitlements")
      .select("status, trial_end")
      .eq("user_id", user_id)
      .maybeSingle();
    if (!error && ent) {
      const status = String(ent.status || "").toLowerCase();
      const trialEnd = tsToSec(ent.trial_end);
      return ENTITLED.has(status) || trialEnd > nowSec();
    }
  } catch {}

  try {
    const { data, error } = await supabaseAdmin
      .from("app_subscriptions")
      .select("status, trial_end, updated_at")
      .eq("user_id", user_id)
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error || !data?.length) return false;
    const row = data[0];
    const status = String(row.status || "").toLowerCase();
    const trialEnd = tsToSec(row.trial_end);
    return ENTITLED.has(status) || trialEnd > nowSec();
  } catch { return false; }
}

/* ---------------- free-pass (feature bucket: food_lookup) ---------------- */
const FREE_LIMIT = 3;

async function allowFree(req, userId) {
  const feature = "food_lookup";
  const clientId = idKey(req, userId);
  const today = dayKeyUTC();

  // Try DB first (so limits are consistent across devices)
  if (supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin
        .from("ai_free_passes")
        .select("uses")
        .eq("client_id", clientId)
        .eq("feature", feature)
        .eq("day_key", today)
        .maybeSingle();

      if (!data) {
        const ins = await supabaseAdmin
          .from("ai_free_passes")
          .insert([{ client_id: clientId, user_id: userId || null, feature, day_key: today, uses: 1 }])
          .select("uses")
          .single();
        return !ins.error;
      }

      const uses = Number(data.uses || 0);
      if (uses >= FREE_LIMIT) return false;

      const upd = await supabaseAdmin
        .from("ai_free_passes")
        .update({ uses: uses + 1, user_id: userId || null })
        .eq("client_id", clientId)
        .eq("feature", feature)
        .eq("day_key", today)
        .select("uses")
        .single();
      return !upd.error;
    } catch {
      // fall through to permissive local allow if DB hiccups
      return true;
    }
  }

  // If no DB access, be permissive (or you can add an in-memory map here)
  return true;
}

/* ---------------- helpers for quantity/serving ---------------- */
function parseQtyToGrams(qtyText) {
  if (!qtyText) return null;
  const s = String(qtyText).trim().toLowerCase();
  const g = s.match(/(\d+(?:\.\d+)?)\s*g\b/);
  if (g) return Math.max(1, Math.round(parseFloat(g[1])));
  return null;
}

/* ---------------- OpenAI call (returns strict shape) ---------------- */
const OPENAI_TIMEOUT_MS = 6000;
function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, ms);
    promise.then(v => { if (!done) { done = true; clearTimeout(t); resolve(v); } })
           .catch(() => { if (!done) { done = true; clearTimeout(t); resolve(fallback); } });
  });
}

async function llmNutrition({ food, brand, quantity }) {
  if (!openai) return null;

  const sys = `You output nutrition for ONE food item. Return ONLY valid JSON:
{"name":"Greek Yogurt","brand":"Fage","quantity_input":"170 g","serving":{"amount":170,"unit":"g","grams":170},"calories":120,"protein_g":20,"carbs_g":6,"fat_g":0,"confidence":0.8,"notes":"..."}
Rules:
- "name" is the generic food name (no brand inside).
- If brand provided, set "brand" to it; otherwise brand may be null or omitted.
- Echo the human "quantity_input" and give a concrete "serving" with amount/unit and grams if known.
- All macro fields and calories are NUMBERS. "confidence" is 0.0–1.0.
- No extra fields, no markdown.`;

  const usr = `Food: ${food}
Brand: ${brand || "n/a"}
Quantity: ${quantity || "n/a"}
Output the JSON exactly with keys as in the schema.`;

  const call = openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: usr }
    ],
    temperature: 0.2
  });

  const res = await withTimeout(call, OPENAI_TIMEOUT_MS, null);
  if (!res) return null;

  const txt = res?.choices?.[0]?.message?.content || "";
  try {
    const j = JSON.parse(txt);
    // Light sanity:
    ["calories","protein_g","carbs_g","fat_g","confidence"].forEach(k => {
      if (typeof j[k] === "string") j[k] = Number(j[k]) || 0;
      if (!Number.isFinite(j[k])) j[k] = 0;
    });
    return j;
  } catch {
    return null;
  }
}

/* ---------------- handler ---------------- */
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

  const userId = getUserIdFromHeaders(req);

  // 1) Pro/Trial users bypass limits entirely
  const entitled = await isEntitled(userId);
  if (!entitled) {
    // 2) Non-entitled: 3/day per client (separate "food_lookup" bucket)
    const allowed = await allowFree(req, userId);
    if (!allowed) {
      res.status(402).json({ error: "Upgrade required", reason: "limit_reached" });
      return;
    }
  }

  try {
    // Try LLM first
    const j = await llmNutrition({ food, brand, quantity });
    if (j) {
      // Ensure UI keys exist even if LLM omitted them
      const grams = j?.serving?.grams ?? parseQtyToGrams(quantity) ?? null;
      res.status(200).json({
        name: j.name || food,
        brand: j.brand ?? (brand || null),
        quantity_input: j.quantity_input ?? (quantity || null),
        serving: j.serving ?? (grams
          ? { amount: grams, unit: "g", grams }
          : { amount: 1, unit: "serving", grams: null }),
        calories: Math.max(0, Number(j.calories) || 0),
        protein_g: Math.max(0, Number(j.protein_g) || 0),
        carbs_g: Math.max(0, Number(j.carbs_g) || 0),
        fat_g: Math.max(0, Number(j.fat_g) || 0),
        confidence: typeof j.confidence === "number" ? Math.max(0, Math.min(1, j.confidence)) : 0.7,
        notes: j.notes || null
      });
      return;
    }

    // Fallback heuristic (no OpenAI / parse fail)
    const grams = parseQtyToGrams(quantity) || 150;
    // conservative baseline (per 100g) to avoid wild values:
    const per100 = { cal: 60, p: 10, c: 4, f: 0 };
    const factor = grams / 100;
    res.status(200).json({
      name: food,
      brand: brand || null,
      quantity_input: quantity || null,
      serving: { amount: grams, unit: "g", grams },
      calories: Math.round(per100.cal * factor),
      protein_g: Math.round(per100.p * factor),
      carbs_g: Math.round(per100.c * factor),
      fat_g: Math.round(per100.f * factor),
      confidence: 0.5,
      notes: "Estimated from generic per-100g baseline."
    });
  } catch (e) {
    console.error("[food-lookup] error:", e);
    res.status(500).json({ error: "Internal error" });
  }
}
