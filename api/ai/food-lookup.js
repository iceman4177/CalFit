// api/ai/food-lookup.js
//
// Pro-only endpoint: users submit { food, brand, quantity } and receive
// { name, brand, quantity_input, serving, calories, protein_g, carbs_g, fat_g, confidence, notes }.
//
// Examples:
// { "user_id":"<uuid>", "food":"Greek yogurt 0% plain", "brand":"Fage Total", "quantity":"170 g" }
// { "user_id":"<uuid>", "food":"Pepper Jack cheese stick", "brand":"Sargento", "quantity":"1 stick" }
// { "user_id":"<uuid>", "food":"Chicken breast", "brand":"Kroger", "quantity":"6 oz cooked" }

import { supabaseAdmin } from "../_lib/supabaseAdmin.js";
import OpenAI from "openai";

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export const config = { api: { bodyParser: false } };
export const maxDuration = 10;

// ------------ utils ------------
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

function safeNum(n, def = 0) {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? v : def;
}

function calcCaloriesFromMacros({ calories, protein_g, carbs_g, fat_g }) {
  const cal = safeNum(calories, -1);
  if (cal >= 0) return Math.round(cal);
  const p = safeNum(protein_g);
  const c = safeNum(carbs_g);
  const f = safeNum(fat_g);
  const est = p * 4 + c * 4 + f * 9;
  return Math.round(est);
}

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

// ------------ handler ------------
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!openai) {
    res.status(500).json({ error: "OpenAI not configured" });
    return;
  }

  const body = await readJson(req);
  const user_id = body?.user_id || null;

  // Pro gating
  const isPro = await isProActive(user_id);
  if (!isPro) {
    res.status(402).json({ error: "Upgrade required", reason: "pro_only" });
    return;
  }

  // inputs
  const food = String(body?.food || "").trim();
  const brand = String(body?.brand || "").trim();
  const quantity = String(body?.quantity || "").trim(); // e.g., "1 cup", "170 g", "6 oz cooked"

  if (!food || !quantity) {
    res.status(400).json({ error: "Missing required fields: food and quantity" });
    return;
  }

  // Build prompt for structured JSON
  const sys = `You are a meticulous nutrition analyst. Output ONLY valid JSON for a single food entry:
{
  "name": "string",               // common food name
  "brand": "string|null",
  "quantity_input": "string",     // the user's quantity string, echoed back
  "serving": { "amount": number, "unit": "g|ml|oz|cup|tbsp|tsp|stick|slice|piece", "grams": number|null },
  "calories": number,             // total for the quantity, not per 100g
  "protein_g": number,
  "carbs_g": number,
  "fat_g": number,
  "confidence": number,           // 0.0-1.0 confidence in estimate
  "notes": "string|null"
}
Rules:
- Respect brand and preparation details if provided.
- Normalize the serving to a clear unit and include grams when possible.
- All macro numbers are totals for the quantity input (not per 100g).
- If label nutrition varies by brand, use typical brand-labeled values when brand is known; otherwise use authoritative averages (USDA style).
- If any macro is unknown, estimate reasonably and be transparent in "notes".
- Do not include markdown or prose outside JSON.`;

  const usr = `Food: ${food}
Brand: ${brand || "(unspecified)"}
Quantity: ${quantity}
Context: User is logging intake; provide totals for the specified quantity.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr }
      ]
    });

    const txt = completion?.choices?.[0]?.message?.content || "";
    let parsed = null;
    try { parsed = JSON.parse(txt); } catch {}

    if (!parsed || typeof parsed !== "object") {
      res.status(500).json({ error: "Model returned invalid JSON" });
      return;
    }

    // Normalize + sanity checks
    const out = {
      name: String(parsed.name || food),
      brand: brand || parsed.brand || null,
      quantity_input: quantity,
      serving: {
        amount: safeNum(parsed?.serving?.amount, 1),
        unit: String(parsed?.serving?.unit || "g"),
        grams: parsed?.serving?.grams != null ? safeNum(parsed.serving.grams, null) : null
      },
      protein_g: safeNum(parsed.protein_g),
      carbs_g: safeNum(parsed.carbs_g),
      fat_g: safeNum(parsed.fat_g),
      calories: calcCaloriesFromMacros({
        calories: parsed.calories,
        protein_g: parsed.protein_g,
        carbs_g: parsed.carbs_g,
        fat_g: parsed.fat_g
      }),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.6)),
      notes: parsed.notes ? String(parsed.notes) : null
    };

    res.status(200).json(out);
  } catch (e) {
    console.error("[ai/food-lookup] error", e);
    res.status(500).json({ error: "Lookup failed" });
  }
}
