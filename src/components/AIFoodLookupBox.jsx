// src/components/AIFoodLookupBox.jsx
import React, { useState, useMemo } from "react";
import {
  Card, CardContent, CardActions,
  TextField, Button, Typography, Stack, Box
} from "@mui/material";
import UpgradeModal from "./UpgradeModal";

// ---- client id (stable per device) ----
function getClientId() {
  try {
    let cid = localStorage.getItem("clientId");
    if (!cid) {
      cid = (crypto?.randomUUID?.() || String(Date.now())).slice(0, 36);
      localStorage.setItem("clientId", cid);
    }
    return cid;
  } catch {
    return "anon";
  }
}

// ---- supabase auth helpers (non-throwing) ----
function getSupabaseSession() {
  try {
    const tok = JSON.parse(localStorage.getItem("supabase.auth.token") || "null");
    // v2 session shape
    const access_token = tok?.currentSession?.access_token || tok?.access_token || null;
    const user = tok?.currentSession?.user || tok?.user || null;
    return { access_token, user };
  } catch {
    return { access_token: null, user: null };
  }
}

export default function AIFoodLookupBox({ onAdd }) {
  const [food, setFood] = useState("");
  const [brand, setBrand] = useState("");
  const [qty, setQty] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showUpgrade, setShowUpgrade] = useState(false);

  const clientId = useMemo(() => getClientId(), []);
  const { access_token, user } = useMemo(() => getSupabaseSession(), []);
  const email = useMemo(() => (user?.email || localStorage.getItem("sc_email") || "").toLowerCase(), [user]);

  function sanitizeQty(s) {
    // strip stray backticks and weird whitespace
    return String(s || "").replace(/[`]+/g, "").trim();
  }

  async function getNutrition() {
    setBusy(true);
    setErr("");
    try {
      // Build a single-meal “suggestion” request. We bias the model to echo back a single item’s macros.
      const payload = {
        feature: "meal",          // normalizeFeature will accept this
        count: 1,
        email,
        constraints: {
          training_intent: "general"
        },
        // nudge the model by embedding our food text into "diet"/goal strings
        // but the server only cares about constraints + count; model prompt handles content.
        diet_preference: "omnivore",
        // extra hint details to increase correctness
        note: `Estimate macros for a single food: ${brand ? brand + " " : ""}${food}${qty ? `, quantity: ${sanitizeQty(qty)}` : ""}`,
      };

      const headers = {
        "Content-Type": "application/json",
        "x-client-id": clientId,
        "x-user-email": email || "",
      };
      if (user?.id) headers["x-supabase-user-id"] = user.id;
      if (access_token) headers["Authorization"] = `Bearer ${access_token}`;

      const resp = await fetch("/api/ai/generate", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (resp.status === 402) {
        // free-pass limit reached → prompt upgrade
        setShowUpgrade(true);
        setBusy(false);
        return;
      }

      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        throw new Error(txt || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const first = Array.isArray(data?.suggestions) ? data.suggestions[0] : null;

      if (!first) {
        throw new Error("No suggestions returned.");
      }

      // Normalize fields we care about
      const item = {
        title: first.title || (brand ? `${brand} ${food}` : food) || "Food item",
        calories: Number(first.calories ?? first.kcal ?? first.energy_kcal ?? 0),
        protein_g: Number(first.protein_g ?? 0),
        carbs_g: Number(first.carbs_g ?? 0),
        fat_g: Number(first.fat_g ?? 0),
        qty: sanitizeQty(qty) || "1 serving",
      };

      // Guard against NaN → 0
      item.calories = Number.isFinite(item.calories) ? item.calories : 0;
      item.protein_g = Number.isFinite(item.protein_g) ? item.protein_g : 0;
      item.carbs_g = Number.isFinite(item.carbs_g) ? item.carbs_g : 0;
      item.fat_g = Number.isFinite(item.fat_g) ? item.fat_g : 0;

      setResult(item);
    } catch (e) {
      console.error("[AIFoodLookupBox] lookup failed", e);
      setErr("Sorry—couldn’t fetch nutrition. Try tweaking the name/quantity.");
    } finally {
      setBusy(false);
    }
  }

  function handleLog() {
    if (!result) return;
    const entry = {
      title: result.title,
      calories: Math.max(0, Number(result.calories || 0)),
      protein_g: Math.max(0, Number(result.protein_g || 0)),
      carbs_g: Math.max(0, Number(result.carbs_g || 0)),
      fat_g: Math.max(0, Number(result.fat_g || 0)),
      quantity: result.qty || "1 serving",
      source: "ai_lookup",
      ts: Date.now(),
    };
    onAdd?.(entry);
    // keep the preview visible but you could clear it here if preferred
  }

  return (
    <>
      <Card className="rounded-2xl shadow-md">
        <CardContent>
          <Typography variant="h6" sx={{ mb: 1 }}>AI Food Lookup</Typography>
          <Stack spacing={1.5}>
            <TextField
              label="Food"
              placeholder="e.g., Oikos Triple Zero yogurt"
              value={food}
              onChange={(e) => setFood(e.target.value)}
              fullWidth
            />
            <TextField
              label="Brand (optional)"
              placeholder="e.g., Danone / Costco / Kirkland"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              fullWidth
            />
            <TextField
              label="Quantity"
              placeholder='e.g., "1 cup", "170 g", "1 stick", "2 pieces"'
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              fullWidth
            />

            {result && (
              <Box sx={{ p: 1.5, border: "1px solid #eee", borderRadius: 2 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  {result.title} — {result.qty}
                </Typography>
                <Stack direction="row" spacing={2}>
                  <Typography variant="body2">🔥 {result.calories} kcal</Typography>
                  <Typography variant="body2">🥩 {result.protein_g} g</Typography>
                  <Typography variant="body2">🌾 {result.carbs_g} g</Typography>
                  <Typography variant="body2">🥑 {result.fat_g} g</Typography>
                </Stack>
              </Box>
            )}

            {!!err && (
              <Typography variant="body2" color="error">{err}</Typography>
            )}
          </Stack>
        </CardContent>
        <CardActions sx={{ justifyContent: "space-between", px: 2, pb: 2 }}>
          <Button onClick={getNutrition} disabled={busy} variant="outlined">
            {busy ? "Working…" : "Get Nutrition"}
          </Button>
          <Button onClick={handleLog} disabled={!result} variant="contained">
            Log
          </Button>
        </CardActions>
      </Card>

      <UpgradeModal open={showUpgrade} onClose={() => setShowUpgrade(false)} />
    </>
  );
}
