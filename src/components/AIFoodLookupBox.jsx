// src/components/AIFoodLookupBox.jsx
import React, { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardActions,
  TextField,
  Button,
  Typography,
  Stack,
  Chip,
  Box
} from "@mui/material";
import UpgradeModal from "./UpgradeModal";

// stable per-device id (same idea as workout/meal generators)
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

function getUserId() {
  try {
    const tok = JSON.parse(localStorage.getItem("supabase.auth.token") || "null");
    return tok?.user?.id || null;
  } catch {
    return null;
  }
}

/**
 * Props:
 * - onAddFood({ name, calories, protein_g, carbs_g, fat_g })
 * - canUseLookup(): bool            // parent says if user can run lookup right now (credits / entitlement)
 * - registerLookupUse(): void       // parent burns one free credit after a successful lookup if needed
 * - onHitPaywall(): void            // parent opens Upgrade modal
 *
 * All 3 gating props are optional so the component won't explode if you render it without them.
 */
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

  // local-only modal as a fallback in case parent didn't pass onHitPaywall
  const [showUpgradeLocal, setShowUpgradeLocal] = useState(false);

  const userId = useMemo(() => getUserId(), []);

  async function handleLookup() {
    // 1. local gate FIRST (cheap)
    if (typeof canUseLookup === "function" && !canUseLookup()) {
      if (typeof onHitPaywall === "function") {
        onHitPaywall();
      } else {
        setShowUpgradeLocal(true);
      }
      return;
    }

    setLoading(true);
    setError("");
    setResData(null);

    try {
      const resp = await fetch("/api/ai/food-lookup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": getClientId() // lets backend count anonymous tries
        },
        body: JSON.stringify({
          user_id: userId,
          food: food.trim(),
          brand: brand.trim(),
          quantity: quantity.trim()
        })
      });

      // 402 means backend says "upgrade"
      if (resp.status === 402) {
        setLoading(false);
        if (typeof onHitPaywall === "function") {
          onHitPaywall();
        } else {
          setShowUpgradeLocal(true);
        }
        return;
      }

      const text = await resp.text();
      if (!resp.ok) {
        throw new Error(text || `HTTP ${resp.status}`);
      }

      const json = text ? JSON.parse(text) : null;
      if (!json || json.calories == null || json.name == null) {
        throw new Error("No nutrition returned");
      }

      // burn a credit now that we got a valid lookup
      if (typeof registerLookupUse === "function") {
        registerLookupUse();
      }

      setResData(json);
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
      name: resData.brand
        ? `${resData.name} — ${resData.brand}`
        : resData.name,
      calories: Math.max(0, Number(resData.calories) || 0),
      protein_g: Number(resData.protein_g) || 0,
      carbs_g: Number(resData.carbs_g) || 0,
      fat_g: Number(resData.fat_g) || 0
    };

    if (typeof onAddFood === "function") {
      onAddFood(payload);
    }

    // reset UI
    setResData(null);
    setFood("");
    setBrand("");
    setQuantity("");
  }

  const disabled =
    !food.trim() || !quantity.trim() || loading;

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          AI Food Lookup
          <Chip size="small" color="primary" label="PRO" />
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
                {resData.brand
                  ? `${resData.name} — ${resData.brand}`
                  : resData.name}
              </Typography>

              <Typography variant="body2" color="text.secondary">
                {resData.quantity_input} •{" "}
                {resData.serving?.amount} {resData.serving?.unit}
                {resData.serving?.grams
                  ? ` (${resData.serving.grams} g)`
                  : ""}
              </Typography>

              <Stack
                direction="row"
                spacing={2}
                sx={{ mt: 0.75, flexWrap: "wrap" }}
              >
                <Typography>
                  🔥 {Math.round(resData.calories)} kcal
                </Typography>
                <Typography>
                  🥩 {Math.round(resData.protein_g)} g
                </Typography>
                <Typography>
                  🌾 {Math.round(resData.carbs_g)} g
                </Typography>
                <Typography>
                  🥑 {Math.round(resData.fat_g)} g
                </Typography>
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
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block" }}
                >
                  {resData.notes}
                </Typography>
              )}
            </Box>
          )}
        </Stack>
      </CardContent>

      <CardActions sx={{ justifyContent: "space-between" }}>
        <Button
          variant="outlined"
          onClick={handleLookup}
          disabled={disabled}
        >
          {loading ? "Looking up..." : "Get Nutrition"}
        </Button>
        <Button
          variant="contained"
          onClick={handleLog}
          disabled={!resData}
        >
          Log
        </Button>
      </CardActions>

      {/* Fallback upgrade modal
         If parent provided onHitPaywall, that shows its own UpgradeModal.
         This local one is just in case parent didn't. */}
      <UpgradeModal
        open={showUpgradeLocal}
        onClose={() => setShowUpgradeLocal(false)}
        title="Upgrade to Slimcal Pro"
        description="AI Food Lookup lets you log calories/macros instantly. Upgrade for unlimited lookups."
      />
    </Card>
  );
}
