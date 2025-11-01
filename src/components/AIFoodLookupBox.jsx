// src/components/AIFoodLookupBox.jsx
import React, { useMemo, useState } from "react";
import {
  Card, CardContent, CardActions,
  TextField, Button, Typography, Stack, Chip, Box
} from "@mui/material";
import UpgradeModal from "./UpgradeModal";

// stable per-device id
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
    // Supabase stores session token in localStorage (v2 uses supabase.auth.getSession(), but we mirror header here)
    const tok = JSON.parse(localStorage.getItem("supabase.auth.token") || "null");
    const access = tok?.currentSession?.access_token || tok?.access_token || null;
    const userId = tok?.user?.id || tok?.currentSession?.user?.id || null;
    const email =
      tok?.user?.email ||
      tok?.currentSession?.user?.email ||
      (localStorage.getItem("sc_email") || null);

    const h = {};
    if (access) h["Authorization"] = `Bearer ${access}`;
    if (userId) h["x-supabase-user-id"] = userId;
    if (email) h["x-user-email"] = email;
    h["x-client-id"] = getClientId();
    return h;
  } catch {
    return { "x-client-id": getClientId() };
  }
}

export default function AIFoodLookupBox({ onAdd }) {
  const [food, setFood] = useState("");
  const [brand, setBrand] = useState("");
  const [quantity, setQuantity] = useState(""); // free text: "150g", "1 cup", "2 pieces"
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const disabled = useMemo(() => !food.trim(), [food]);

  async function handleLookup() {
    if (disabled || loading) return;
    setLoading(true);
    setShowUpgrade(false);
    setResult(null);

    try {
      const resp = await fetch("/api/ai/food-lookup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          // dedicated endpoint — do NOT send to /api/ai/generate
          food,
          brand: brand || null,
          quantity: quantity || null
        }),
      });

      if (resp.status === 402) {
        setShowUpgrade(true);
        setLoading(false);
        return;
      }
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        throw new Error(j?.error || `Lookup failed (${resp.status})`);
      }
      const data = await resp.json();
      setResult(data);
    } catch (e) {
      console.error("[AIFoodLookupBox] lookup failed", e);
      setResult({ title: "Lookup failed", calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
    } finally {
      setLoading(false);
    }
  }

  function handleLog() {
    if (!result || !onAdd) return;
    onAdd({
      title: result.title || food || "Food",
      calories: Number(result.calories || 0),
      protein_g: Number(result.protein_g || 0),
      carbs_g: Number(result.carbs_g || 0),
      fat_g: Number(result.fat_g || 0),
    });
    // keep fields so user can iterate; or clear as preferred
  }

  return (
    <Card variant="outlined" sx={{ borderRadius: 3 }}>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 2 }}>AI Food Lookup</Typography>

        <Stack spacing={2}>
          <TextField
            label="Food"
            placeholder="e.g., Oikos Triple Zero Yogurt"
            value={food}
            onChange={(e) => setFood(e.target.value)}
            fullWidth
          />
          <TextField
            label="Brand (optional)"
            placeholder="e.g., Danone"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            fullWidth
          />
          <TextField
            label="Quantity"
            placeholder="e.g., 150g, 1 cup, 1 container"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            fullWidth
          />

          {result && (
            <Box sx={{
              px: 2, py: 1.5,
              borderRadius: 2,
              bgcolor: "rgba(0,0,0,0.03)"
            }}>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                {result.title || food}
              </Typography>
              <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
                <Chip label={`${Number(result.calories || 0)} kcal`} />
                <Chip label={`${Number(result.protein_g || 0)} g`} icon={<span>🥩</span>} />
                <Chip label={`${Number(result.carbs_g || 0)} g`} icon={<span>🌾</span>} />
                <Chip label={`${Number(result.fat_g || 0)} g`} icon={<span>🥑</span>} />
              </Stack>
            </Box>
          )}
        </Stack>
      </CardContent>

      <CardActions sx={{ px: 2, pb: 2, justifyContent: "space-between" }}>
        <Button
          variant="outlined"
          onClick={handleLookup}
          disabled={disabled || loading}
        >
          {loading ? "Getting..." : "Get Nutrition"}
        </Button>
        <Button
          variant="contained"
          onClick={handleLog}
          disabled={!result}
        >
          Log
        </Button>
      </CardActions>

      <UpgradeModal open={showUpgrade} onClose={() => setShowUpgrade(false)} />
    </Card>
  );
}
