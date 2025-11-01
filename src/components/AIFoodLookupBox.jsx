// src/components/AIFoodLookupBox.jsx
import React, { useState, useMemo } from "react";
import {
  Card, CardContent, CardActions,
  TextField, Button, Typography, Stack, Box
} from "@mui/material";
import UpgradeModal from "./UpgradeModal";
import { useEntitlements } from "../context/EntitlementsContext.jsx";
import { supabase } from "../lib/supabaseClient"; // ✅ add this

function getClientId() {
  try {
    let cid = localStorage.getItem("clientId");
    if (!cid) {
      cid = (crypto?.randomUUID?.() || String(Date.now())).slice(0, 36);
      localStorage.setItem("clientId", cid);
    }
    return cid;
  } catch { return "anon"; }
}

// robust: try Supabase SDK first; then common localStorage fallbacks
async function getAuthContext() {
  try {
    const { data } = await supabase.auth.getSession();
    const session = data?.session || null;
    const user = session?.user || null;
    const accessToken = session?.access_token || null;

    // fallback: try common sb-* key (v2) if SDK isn’t populated yet
    let uid = user?.id || null;
    let email = user?.email || null;
    if (!uid || !accessToken) {
      const lsKey = Object.keys(localStorage).find((k) =>
        /^sb-.*-auth-token$/.test(k)
      );
      if (lsKey) {
        const parsed = JSON.parse(localStorage.getItem(lsKey) || "null");
        const ses = parsed?.currentSession || parsed?.session || null;
        uid = uid || ses?.user?.id || null;
        email = email || ses?.user?.email || null;
      }
    }
    return { uid, email, accessToken };
  } catch {
    return { uid: null, email: null, accessToken: null };
  }
}

export default function AIFoodLookupBox({
  onAddFood,
  canUseLookup,
  registerLookupUse,
  onHitPaywall
}) {
  const [food, setFood] = useState("");
  const [brand, setBrand] = useState("");
  const [quantity, setQuantity] = useState("");
  const [loading, setLoading] = useState(false);
  const [resData, setResData] = useState(null);
  const [error, setError] = useState("");
  const [showUpgrade, setShowUpgrade] = useState(false);

  const { isProActive, status } = useEntitlements();
  const proOrTrial = !!(isProActive || ["active", "trialing", "past_due"].includes(String(status).toLowerCase()));

  async function handleLookup() {
    // Local pre-gate for free users only
    if (!proOrTrial && typeof canUseLookup === "function" && !canUseLookup()) {
      onHitPaywall?.();
      setShowUpgrade(true);
      return;
    }

    setLoading(true);
    setError("");
    setResData(null);

    try {
      const { uid, email, accessToken } = await getAuthContext();

      const headers = {
        "Content-Type": "application/json",
        "X-Client-Id": getClientId(),
      };
      if (uid) headers["X-Supabase-User-Id"] = uid;
      if (email) headers["X-User-Email"] = email;
      if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

      const resp = await fetch("/api/ai/food-lookup", {
        method: "POST",
        headers,
        body: JSON.stringify({
          user_id: uid || null,
          email: email || null,
          food: food.trim(),
          brand: brand.trim(),
          quantity: quantity.trim()
        })
      });

      if (resp.status === 402) {
        onHitPaywall?.();
        setShowUpgrade(true);
        setLoading(false);
        return;
      }

      const text = await resp.text();
      if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);
      const json = text ? JSON.parse(text) : null;
      if (!json || typeof json.calories === "undefined") throw new Error("No nutrition returned");

      // Map to UI shape (already provided by API, but normalize just in case)
      setResData({
        name: json.name || food.trim(),
        brand: json.brand || brand.trim() || null,
        quantity_input: json.quantity_input || quantity.trim() || null,
        serving: json.serving || null,
        calories: Number(json.calories) || 0,
        protein_g: Number(json.protein_g) || 0,
        carbs_g: Number(json.carbs_g) || 0,
        fat_g: Number(json.fat_g) || 0,
        confidence: typeof json.confidence === "number" ? json.confidence : undefined,
        notes: json.notes || undefined,
      });

      // Burn a credit for free users only
      if (!proOrTrial) registerLookupUse?.();
    } catch (e) {
      console.error("[AIFoodLookupBox] lookup failed", e);
      setError("Couldn’t fetch nutrition. Please refine and try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleLog() {
    if (!resData) return;
    const payload = {
      name: resData.brand ? `${resData.name} — ${resData.brand}` : resData.name,
      calories: Math.max(0, Number(resData.calories) || 0),
      protein_g: Number(resData.protein_g) || 0,
      carbs_g: Number(resData.carbs_g) || 0,
      fat_g: Number(resData.fat_g) || 0
    };
    onAddFood?.(payload);
    setResData(null);
    setFood(""); setBrand(""); setQuantity("");
  }

  const disabled = !food.trim() || !quantity.trim() || loading;

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom sx={{ fontWeight: 800 }}>
          AI Food Lookup
        </Typography>
        <Stack spacing={1.25}>
          <TextField label="Food" placeholder="e.g., Greek yogurt 0% plain" value={food} onChange={(e)=>setFood(e.target.value)} fullWidth />
          <TextField label="Brand (optional)" placeholder="e.g., Fage Total" value={brand} onChange={(e)=>setBrand(e.target.value)} fullWidth />
          <TextField label="Quantity" placeholder="e.g., 170 g, 1 cup, 6 oz cooked" value={quantity} onChange={(e)=>setQuantity(e.target.value)} fullWidth />
          {error && <Typography color="error" variant="body2">{error}</Typography>}
          {resData && (
            <Box sx={{ p:1.25, border:"1px solid rgba(2,6,23,0.08)", borderRadius:1 }}>
              <Typography variant="subtitle2">
                {resData.brand ? `${resData.name} — ${resData.brand}` : resData.name}
              </Typography>
              {resData.quantity_input && (
                <Typography variant="body2" color="text.secondary">
                  {resData.quantity_input}{resData?.serving?.amount ? ` • ${resData.serving.amount} ${resData.serving.unit}${resData.serving.grams ? ` (${resData.serving.grams} g)` : ""}` : ""}
                </Typography>
              )}
              <Stack direction="row" spacing={2} sx={{ mt: 0.75, flexWrap: "wrap" }}>
                <Typography>🔥 {Math.round(resData.calories)} kcal</Typography>
                <Typography>🥩 {Math.round(resData.protein_g)} g</Typography>
                <Typography>🌾 {Math.round(resData.carbs_g)} g</Typography>
                <Typography>🥑 {Math.round(resData.fat_g)} g</Typography>
              </Stack>
            </Box>
          )}
        </Stack>
      </CardContent>
      <CardActions sx={{ justifyContent: "space-between" }}>
        <Button variant="outlined" onClick={handleLookup} disabled={disabled}>
          {loading ? "Looking up..." : "Get Nutrition"}
        </Button>
        <Button variant="contained" onClick={handleLog} disabled={!resData}>Log</Button>
      </CardActions>
      <UpgradeModal
        open={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        title="Upgrade to Slimcal Pro"
        description="AI Food Lookup uses advanced nutrition reasoning. Upgrade for unlimited lookups."
      />
    </Card>
  );
}
