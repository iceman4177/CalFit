// src/components/AIFoodLookupBox.jsx
import React, { useState, useMemo } from "react";
import {
  Card, CardContent, CardActions,
  TextField, Button, Typography, Stack, Box
} from "@mui/material";
import UpgradeModal from "./UpgradeModal";
import { useEntitlements } from "../context/EntitlementsContext.jsx";

// ---- stable per-device id ----
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

function getAuthHeaders() {
  try {
    const tok = JSON.parse(localStorage.getItem("supabase.auth.token") || "null");
    const accessToken =
      tok?.currentSession?.access_token || tok?.access_token || tok?.provider_token || "";
    const userId = tok?.user?.id || tok?.currentSession?.user?.id || "";
    const email =
      localStorage.getItem("sc_email") ||
      tok?.user?.email ||
      tok?.currentSession?.user?.email ||
      "";

    const headers = {
      "Content-Type": "application/json",
      "x-client-id": getClientId(),
    };
    if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
    if (userId) headers["x-supabase-user-id"] = userId;
    if (email) headers["x-user-email"] = email;
    return headers;
  } catch {
    return {
      "Content-Type": "application/json",
      "x-client-id": getClientId(),
    };
  }
}

const MAX_FREE_TRIES = 3;
const LOCAL_TRY_KEY = "aiAssist_freeTries";

function readLocalTries() {
  const n = Number(localStorage.getItem(LOCAL_TRY_KEY) || "0");
  return Number.isFinite(n) ? n : 0;
}
function bumpLocalTries() {
  const next = Math.min(readLocalTries() + 1, MAX_FREE_TRIES);
  localStorage.setItem(LOCAL_TRY_KEY, String(next));
  return next;
}

export default function AIFoodLookupBox({
  onAddFood,
  canUseLookup,        // optional external counter
  registerLookupUse,   // optional external burner
  onHitPaywall         // optional hook to open Upgrade elsewhere
}) {
  const [food, setFood] = useState("");
  const [brand, setBrand] = useState("");
  const [quantity, setQuantity] = useState("");
  const [loading, setLoading] = useState(false);
  const [resData, setResData] = useState(null);
  const [error, setError] = useState("");
  const [showUpgrade, setShowUpgrade] = useState(false);

  const { isProActive, status, isEntitled } = useEntitlements();
  const proOrTrial =
    isEntitled || !!(isProActive || ["active", "trialing", "past_due"].includes(String(status).toLowerCase()));

  const freeTryAvailable = () => {
    if (proOrTrial) return true;
    if (typeof canUseLookup === "function") return canUseLookup();
    return readLocalTries() < MAX_FREE_TRIES;
  };

  const burnFreeTry = () => {
    if (proOrTrial) return;
    if (typeof registerLookupUse === "function") {
      registerLookupUse();
    } else {
      bumpLocalTries();
    }
  };

  async function handleLookup() {
    // local gate before hitting server (skip for Pro/Trial)
    if (!proOrTrial && !freeTryAvailable()) {
      onHitPaywall?.();
      setShowUpgrade(true);
      return;
    }

    setLoading(true);
    setError("");
    setResData(null);

    try {
      // ⬇️ use the unified AI gateway with entitlement bypass
      const resp = await fetch("/api/ai/generate", {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({
          feature: "assist",
          type: "lookup",
          mode: "food",
          prompt: JSON.stringify({ food: food.trim(), brand: brand.trim(), quantity: quantity.trim() }),
        }),
      });

      if (resp.status === 402) {
        // Only prompt if NOT entitled. If entitled, surface soft warning.
        if (!proOrTrial) {
          onHitPaywall?.();
          setShowUpgrade(true);
        } else {
          setError("You’re entitled to unlimited lookups, but the server returned a 402. Try again.");
        }
        setLoading(false);
        return;
      }

      const text = await resp.text();
      if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);

      const data = text ? JSON.parse(text) : null;
      const item = Array.isArray(data?.suggestions) ? data.suggestions[0] : data?.result || null;
      if (!item || (item.calories == null && !item.nutrition)) {
        throw new Error("No nutrition returned");
      }

      const normalized = item.nutrition
        ? {
            name: item.title || item.name || "Food",
            brand: item.brand || brand.trim() || "",
            quantity_input: quantity.trim(),
            serving: item.nutrition.serving || { amount: 1, unit: "serving" },
            calories: Number(item.nutrition.calories) || 0,
            protein_g: Number(item.nutrition.protein_g) || 0,
            carbs_g: Number(item.nutrition.carbs_g) || 0,
            fat_g: Number(item.nutrition.fat_g) || 0,
            confidence: item.confidence ?? null,
            notes: item.notes || "",
          }
        : {
            name: item.name || "Food",
            brand: item.brand || brand.trim() || "",
            quantity_input: quantity.trim(),
            serving: item.serving || { amount: 1, unit: "serving" },
            calories: Number(item.calories) || 0,
            protein_g: Number(item.protein_g) || 0,
            carbs_g: Number(item.carbs_g) || 0,
            fat_g: Number(item.fat_g) || 0,
            confidence: item.confidence ?? null,
            notes: item.notes || "",
          };

      setResData(normalized);

      if (!proOrTrial) burnFreeTry();
    } catch (e) {
      console.error("[AIFoodLookupBox] lookup failed", e);
      setError("Couldn’t fetch nutrition. Please refine the input and try again.");
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
    setFood("");
    setBrand("");
    setQuantity("");
  }

  const disabled = !food.trim() || !quantity.trim() || loading;

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom sx={{ fontWeight: 800 }}>
          AI Food Lookup
        </Typography>

        <Stack spacing={1.25}>
          <TextField
            label="Food"
            placeholder="e.g., Greek yogurt 0% plain"
            value={food}
            onChange={(e) => setFood(e.target.value)}
            fullWidth
          />
          <TextField
            label="Brand (optional)"
            placeholder="e.g., Fage Total"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            fullWidth
          />
          <TextField
            label="Quantity"
            placeholder="e.g., 170 g, 1 cup, 6 oz cooked, 1 stick"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            fullWidth
          />

          {error && (
            <Typography color="error" variant="body2">
              {error}
            </Typography>
          )}

          {resData && (
            <Box
              sx={{
                p: 1.25,
                border: "1px solid rgba(2,6,23,0.08)",
                borderRadius: 1
              }}
            >
              <Typography variant="subtitle2">
                {resData.brand ? `${resData.name} — ${resData.brand}` : resData.name}
              </Typography>

              <Typography variant="body2" color="text.secondary">
                {resData.quantity_input} • {resData.serving?.amount} {resData.serving?.unit}
                {resData.serving?.grams ? ` (${resData.serving.grams} g)` : ""}
              </Typography>

              <Stack direction="row" spacing={2} sx={{ mt: 0.75, flexWrap: "wrap" }}>
                <Typography>🔥 {Math.round(resData.calories)} kcal</Typography>
                <Typography>🥩 {Math.round(resData.protein_g)} g</Typography>
                <Typography>🌾 {Math.round(resData.carbs_g)} g</Typography>
                <Typography>🥑 {Math.round(resData.fat_g)} g</Typography>
              </Stack>

              {typeof resData.confidence === "number" && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ mt: 0.5, display: "block" }}
                >
                  Confidence: {(resData.confidence * 100).toFixed(0)}%
                </Typography>
              )}

              {resData.notes && (
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  {resData.notes}
                </Typography>
              )}
            </Box>
          )}
        </Stack>
      </CardContent>

      <CardActions sx={{ justifyContent: "space-between" }}>
        <Button variant="outlined" onClick={handleLookup} disabled={disabled}>
          {loading ? "Looking up..." : "Get Nutrition"}
        </Button>

        <Button variant="contained" onClick={handleLog} disabled={!resData}>
          Log
        </Button>
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
