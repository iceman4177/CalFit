// /api/ai/food-lookup.js
//
// AI nutrition lookup
// - Pro / Trial users: unlimited
// - Everyone else: 3 lookups/day per user_id (if logged in) OR per client_id/ip
//
// Request body:
// { user_id, food, brand, quantity }
//
// Response 200 JSON:
// {
//   name: string,
//   brand: string|null,
//   quantity_input: string,
//   serving: { amount:number, unit:string, grams?:number },
//   calories:number,
//   protein_g:number,
//   carbs_g:number,
//   fat_g:number,
//   confidence:number (0-1),
//   notes?:string
// }
//
// 402 { error: "Upgrade required", reason:"limit_reached" } on cap
//

import { supabaseAdmin } from "../_lib/supabaseAdmin.js";
import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// keep Vercel happy
export const config = { api: { bodyParser: false } };
export const maxDuration = 10;

// ---------- utils ----------
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

// YYYY-MM-DD UTC
function dayKeyUTC(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// Prefer explicit client id header, fallback to IP, but if user_id given
// we'll use that for rate limit.
function headerClientId(req) {
  const cid = (req.headers["x-client-id"] || "").toString().trim();
  if (cid) return cid.slice(0, 128);

  const ip = (
    req.headers["x-forwarded-for"] ||
    req.headers["x-real-ip"] ||
    "0.0.0.0"
  )
    .toString()
    .split(",")[0]
    .trim();
  return `ip:${ip}`;
}

function idKey(req, userId) {
  if (userId) return `uid:${userId}`;
  return headerClientId(req);
}

// ---------- entitlement helpers ----------
async function isProActive(user_id) {
  if (!user_id || !supabaseAdmin) return false;
  const { data, error } = await supabaseAdmin
    .from("app_subscriptions")
    .select("status,current_period_end")
    .eq("user_id", user_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return false;
  const now = Math.floor(Date.now() / 1000);
  const active = ["active", "trialing", "past_due"].includes(data.status);
  return active && (!data.current_period_end || data.current_period_end > now);
}

// --- free-pass tracking (db-backed w/ in-memory fallback) ---
const FREE_LIMIT = 3;

const freeMem = new Map();
// key -> { used:number, day:string }
function memKey(clientId) {
  return `lookup:${clientId}`;
}
function memAllow(clientId) {
  const key = memKey(clientId);
  const today = dayKeyUTC();
  const rec = freeMem.get(key);
  if (!rec || rec.day !== today) {
    freeMem.set(key, { used: 1, day: today });
    return { allowed: true, remaining: FREE_LIMIT - 1 };
  }
  if (rec.used < FREE_LIMIT) {
    rec.used += 1;
    return { allowed: true, remaining: FREE_LIMIT - rec.used };
  }
  return { allowed: false, remaining: 0 };
}

async function dbAllowFoodLookup(clientId, userId) {
  if (!supabaseAdmin) return memAllow(clientId);
  try {
    const today = dayKeyUTC();

    // NOTE: we reuse ai_free_passes table.
    // Make sure feature 'food_lookup' is allowed in the CHECK constraint.
    // If not, either ALTER TABLE or relax the check.
    const { data, error } = await supabaseAdmin
      .from("ai_free_passes")
      .select("uses")
      .eq("client_id", clientId)
      .eq("feature", "food_lookup")
      .eq("day_key", today)
      .maybeSingle();

    // If unexpected error → fallback to memory
    if (error && error.code !== "PGRST116") {
      return memAllow(clientId);
    }

    if (!data) {
      // first use today
      const ins = await supabaseAdmin
        .from("ai_free_passes")
        .insert([{
          client_id: clientId,
          user_id: userId || null,
          feature: "food_lookup",
          day_key: today,
          uses: 1
        }])
        .select("uses")
        .single();

      if (ins.error) {
        return memAllow(clientId);
      }
      return { allowed: true, remaining: FREE_LIMIT - 1 };
    }

    const currentUses = data.uses || 0;
    if (currentUses >= FREE_LIMIT) {
      return { allowed: false, remaining: 0 };
    }

    const upd = await supabaseAdmin
      .from("ai_free_passes")
      .update({ uses: currentUses + 1, user_id: userId || null })
      .eq("client_id", clientId)
      .eq("feature", "food_lookup")
      .eq("day_key", today)
      .select("uses")
      .single();

    if (upd.error) {
      return memAllow(clientId);
    }
    const newUses = upd.data.uses || currentUses + 1;
    return {
      allowed: true,
      remaining: Math.max(0, FREE_LIMIT - newUses)
    };
  } catch {
    return memAllow(clientId);
  }
}

async function allowLookup({ req, userId }) {
  const clientId = idKey(req, userId);
  return dbAllowFoodLookup(clientId, userId);
}

// ---------- timeout helper ----------
const OPENAI_TIMEOUT_MS = 6000;
function withTimeout(promise, ms, onTimeoutValue) {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(onTimeoutValue);
      }
    }, ms);
    promise
      .then((v) => {
        if (!settled) {
          settled = true;
          clearTimeout(t);
          resolve(v);
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(t);
          resolve(onTimeoutValue);
        }
      });
  });
}

// ---------- openAI call ----------
function fallbackNutrition({ food, brand, quantity }) {
  // Super bare fallback in case OpenAI is down.
  // We won't pretend accuracy. We'll just say 0 cals so UI doesn't crash.
  return {
    name: food || "Food item",
    brand: brand || "",
    quantity_input: quantity || "",
    serving: { amount: 1, unit: "serving" },
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    confidence: 0.2,
    notes: "Fallback estimate only."
  };
}

async function callOpenAI({ food, brand, quantity }) {
  if (!openai) {
    return fallbackNutrition({ food, brand, quantity });
  }

  const sys = `
You are a nutrition label assistant.
Return ONLY valid JSON with this exact shape:
{
  "name": "string food name",
  "brand": "string brand or null",
  "quantity_input": "string the user typed for quantity",
  "serving": { "amount": number, "unit": "string", "grams": number },
  "calories": number,
  "protein_g": number,
  "carbs_g": number,
  "fat_g": number,
  "confidence": number,
  "notes": "optional short string"
}
Rules:
- calories, protein_g, carbs_g, fat_g must be numeric (per the given quantity_input).
- confidence is 0 to 1 (your confidence that numbers match a common nutrition label for that brand).
- notes is optional but helpful context (e.g. 'assumes cooked weight').
No markdown, no extra keys.
`;

  const usr = `
Food: ${food || ""}
Brand: ${brand || ""}
Quantity: ${quantity || ""}

Estimate macros and calories for THAT exact quantity.
`;

  const call = openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { role: "system", content: sys.trim() },
      { role: "user", content: usr.trim() }
    ]
  });

  const res = await withTimeout(call, OPENAI_TIMEOUT_MS, null);
  if (!res) {
    return fallbackNutrition({ food, brand, quantity });
  }

  const txt = res?.choices?.[0]?.message?.content || "";
  let parsed = null;
  try { parsed = JSON.parse(txt); } catch {}

  if (!parsed || typeof parsed !== "object") {
    return fallbackNutrition({ food, brand, quantity });
  }

  // harden fields
  return {
    name: parsed.name || food || "Food item",
    brand: parsed.brand || brand || "",
    quantity_input: parsed.quantity_input || quantity || "",
    serving: {
      amount: Number(parsed?.serving?.amount) || 1,
      unit: parsed?.serving?.unit || "serving",
      grams: Number(parsed?.serving?.grams) || undefined
    },
    calories: Number(parsed.calories) || 0,
    protein_g: Number(parsed.protein_g) || 0,
    carbs_g: Number(parsed.carbs_g) || 0,
    fat_g: Number(parsed.fat_g) || 0,
    confidence: Number(parsed.confidence) || 0,
    notes: parsed.notes || ""
  };
}

// ---------- handler ----------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = await readJson(req);
  const user_id = body?.user_id || null;
  const food = (body?.food || "").toString().slice(0,200);
  const brand = (body?.brand || "").toString().slice(0,200);
  const quantity = (body?.quantity || "").toString().slice(0,200);

  if (!food || !quantity) {
    res.status(400).json({ error: "food and quantity required" });
    return;
  }

  // 1. Pro / Trial bypass
  const pro = await isProActive(user_id);

  // 2. If NOT pro → enforce daily cap
  if (!pro) {
    const pass = await allowLookup({ req, userId: user_id });
    if (!pass.allowed) {
      res
        .status(402)
        .json({ error: "Upgrade required", reason: "limit_reached" });
      return;
    }
  }

  // 3. Call model
  try {
    const nutri = await callOpenAI({ food, brand, quantity });
    res.status(200).json(nutri);
    return;
  } catch (e) {
    console.error("[food-lookup] error", e);
    res.status(200).json(fallbackNutrition({ food, brand, quantity }));
    return;
  }
}
