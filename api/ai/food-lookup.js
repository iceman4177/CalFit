// /api/ai/food-lookup.js
//
// Dedicated endpoint for *single food* nutrition lookup with entitlement bypass
// and server-side free-pass gating (3/day). Includes dev helpers:
//   • ?reset=1  — reset today's counter for this client id
//   • ?dbg=1    — include debug payload in responses

import { supabaseAdmin } from "../_lib/supabaseAdmin.js";
import OpenAI from "openai";
import { parse } from "url";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export const config = { api: { bodyParser: false } };
export const maxDuration = 10;

/* ---------------- utils ---------------- */
async function readJson(req) {
  try {
    const bufs = [];
    for await (const c of req) bufs.push(c);
    const raw = Buffer.concat(bufs).toString("utf8");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
const dayKeyUTC = (d = new Date()) => d.toISOString().slice(0, 10);

function headerClientId(req) {
  // explicit header wins
  const cid = (req.headers["x-client-id"] || "").toString().trim();
  if (cid) return cid.slice(0, 128);

  // fallback: IP (first in x-forwarded-for), stable per network
  const ip = (req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "0.0.0.0")
    .toString()
    .split(",")[0]
    .trim();
  return `ip:${ip}`;
}

function base64UrlDecode(str) {
  try {
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "====".slice(0, 4 - (b64.length % 4)) : "";
    return JSON.parse(Buffer.from(b64 + pad, "base64").toString("utf8"));
  } catch {
    return null;
  }
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

/* --------------- entitlement --------------- */
const ENTITLED = new Set(["active", "trialing", "past_due"]);
const nowSec = () => Math.floor(Date.now() / 1000);
const tsToSec = (ts) => (ts ? Math.floor(new Date(ts).getTime() / 1000) : 0);

async function isEntitled(user_id) {
  if (!user_id || !supabaseAdmin) return false;

  // Prefer entitlement view if present
  try {
    const { data, error } = await supabaseAdmin
      .from("v_user_entitlements")
      .select("status, trial_end")
      .eq("user_id", user_id)
      .maybeSingle();

    if (!error && data) {
      const status = String(data.status || "").toLowerCase();
      const trialOk = tsToSec(data.trial_end) > nowSec();
      return ENTITLED.has(status) || trialOk;
    }
  } catch {}

  // Fallback to app_subscriptions (most recent row)
  try {
    const { data, error } = await supabaseAdmin
      .from("app_subscriptions")
      .select("status, trial_end, updated_at")
      .eq("user_id", user_id)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (!error && data?.length) {
      const row = data[0];
      const status = String(row.status || "").toLowerCase();
      const trialOk = tsToSec(row.trial_end) > nowSec();
      return ENTITLED.has(status) || trialOk;
    }
  } catch {}
  return false;
}

/* --------------- free-pass (feature='food') --------------- */
const FREE_LIMIT = 3;

async function dbGetUses({ clientId, feature, today }) {
  const { data, error } = await supabaseAdmin
    .from("ai_free_passes")
    .select("uses")
    .eq("client_id", clientId)
    .eq("feature", feature)
    .eq("day_key", today)
    .maybeSingle();
  if (error && error.code !== "PGRST116") return { uses: 0, error };
  return { uses: data?.uses || 0 };
}

async function dbSetUses({ clientId, userId, feature, today, uses }) {
  // upsert pattern
  const { error } = await supabaseAdmin
    .from("ai_free_passes")
    .upsert(
      { client_id: clientId, user_id: userId || null, feature, day_key: today, uses },
      { onConflict: "client_id,feature,day_key" }
    );
  return { error };
}

async function dbResetToday({ clientId, feature, today }) {
  await supabaseAdmin
    .from("ai_free_passes")
    .delete()
    .eq("client_id", clientId)
    .eq("feature", feature)
    .eq("day_key", today);
}

async function allowFoodFeature(req, userId, { dbg = false, reset = false } = {}) {
  const feature = "food";
  const today = dayKeyUTC();
  const clientId = userId ? `uid:${userId}` : headerClientId(req);

  if (reset && supabaseAdmin) {
    await dbResetToday({ clientId, feature, today });
    return { allowed: true, remaining: FREE_LIMIT, debug: { clientId, today, reset: true } };
  }

  // Pro/Trial bypass
  if (await isEntitled(userId)) {
    return { allowed: true, remaining: Infinity, debug: dbg ? { clientId, today, entitled: true } : undefined };
  }

  // Anonymous or non-pro user limit
  if (!supabaseAdmin) {
    // Extremely rare fallback: if admin client missing, just allow (don’t hard gate)
    return { allowed: true, remaining: FREE_LIMIT, debug: dbg ? { clientId, today, fallback: "no-admin" } : undefined };
  }

  const { uses } = await dbGetUses({ clientId, feature, today });
  if (uses >= FREE_LIMIT) {
    return { allowed: false, remaining: 0, debug: dbg ? { clientId, today, uses } : undefined };
  }

  await dbSetUses({ clientId, userId, feature, today, uses: uses + 1 });
  return {
    allowed: true,
    remaining: Math.max(0, FREE_LIMIT - (uses + 1)),
    debug: dbg ? { clientId, today, uses: uses + 1 } : undefined
  };
}

/* ---------- OpenAI nutrition ---------- */
const OPENAI_TIMEOUT_MS = 6000;
function withTimeout(promise, ms, fallback) {
  return new Promise((resolve) => {
    let done = false;
    const t = setTimeout(() => { if (!done) { done = true; resolve(fallback); } }, ms);
    promise.then((v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } })
      .catch(() => { if (!done) { done = true; clearTimeout(t); resolve(fallback); } });
  });
}

function parseQtyToGrams(qtyText) {
  if (!qtyText) return null;
  const s = String(qtyText).trim().toLowerCase();
  const g = s.match(/(\d+(?:\.\d+)?)\s*g\b/);
  if (g) return Math.max(1, Math.round(parseFloat(g[1])));
  return null;
}

async function llmNutrition({ food, brand, quantity }) {
  if (!openai) {
    const grams = parseQtyToGrams(quantity) || 150;
    const per100 = { cal: 60, p: 10, c: 4, f: 0 };
    const k = grams / 100;
    return {
      name: food,
      brand: brand || null,
      quantity_input: quantity || null,
      serving: { amount: grams, unit: "g", grams },
      calories: Math.round(per100.cal * k),
      protein_g: Math.round(per100.p * k),
      carbs_g: Math.round(per100.c * k),
      fat_g: Math.round(per100.f * k),
      confidence: 0.4,
      notes: "Fallback estimate (no OpenAI key)."
    };
  }

  const sys = `Return ONLY valid JSON with these keys:
{"name":"...","brand":"...","quantity_input":"...","serving":{"amount":150,"unit":"g","grams":150},"calories":123,"protein_g":12,"carbs_g":10,"fat_g":2}
- Numbers must be numbers.`;
  const usr = `Food: ${food}
Brand: ${brand || "n/a"}
Quantity: ${quantity || "n/a"}`;

  const call = openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
    temperature: 0.2
  });

  const res = await withTimeout(call, OPENAI_TIMEOUT_MS, null);
  if (!res) return null;

  const txt = res?.choices?.[0]?.message?.content || "";
  try {
    const j = JSON.parse(txt);
    const out = {
      name: j.name || food,
      brand: j.brand || (brand || null),
      quantity_input: j.quantity_input || (quantity || null),
      serving: j.serving && typeof j.serving === "object" ? j.serving : null,
      calories: Number(j.calories || 0),
      protein_g: Number(j.protein_g || 0),
      carbs_g: Number(j.carbs_g || 0),
      fat_g: Number(j.fat_g || 0),
      confidence: typeof j.confidence === "number" ? j.confidence : undefined,
      notes: j.notes || undefined
    };
    ["calories","protein_g","carbs_g","fat_g"].forEach(k => {
      if (!Number.isFinite(out[k]) || out[k] < 0) out[k] = 0;
    });
    return out;
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

  const { query } = parse(req.url, true);
  const dbg = String(query?.dbg || "") === "1";
  const reset = String(query?.reset || "") === "1";

  const body = await readJson(req);
  const food = String(body?.food || "").trim();
  const brand = (body?.brand || "").trim();
  const quantity = (body?.quantity || "").trim();

  if (!food) {
    res.status(400).json({ error: "Missing food" });
    return;
  }

  const userId = getUserIdFromHeaders(req);
  const gate = await allowFoodFeature(req, userId, { dbg, reset });

  if (!gate.allowed) {
    res.status(402).json(dbg ? { error: "Upgrade required", reason: "limit_reached", debug: gate.debug } : { error: "Upgrade required", reason: "limit_reached" });
    return;
  }

  try {
    const data = await llmNutrition({ food, brand, quantity });
    if (!data) {
      const grams = parseQtyToGrams(quantity) || 150;
      const per100 = { cal: 60, p: 10, c: 4, f: 0 };
      const k = grams / 100;
      const fallback = {
        name: food,
        brand: brand || null,
        quantity_input: quantity || null,
        serving: { amount: grams, unit: "g", grams },
        calories: Math.round(per100.cal * k),
        protein_g: Math.round(per100.p * k),
        carbs_g: Math.round(per100.c * k),
        fat_g: Math.round(per100.f * k),
        confidence: 0.3,
        notes: "Heuristic fallback."
      };
      res.status(200).json(dbg ? { ...fallback, debug: gate.debug } : fallback);
      return;
    }
    res.status(200).json(dbg ? { ...data, debug: gate.debug } : data);
  } catch (e) {
    console.error("[food-lookup] error:", e);
    res.status(500).json({ error: "Internal error" });
  }
}
