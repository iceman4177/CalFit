// src/components/FrameCheckModal.jsx
import React, { useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import IosShareIcon from "@mui/icons-material/IosShare";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

import { buildFrameCheckPrompt, buildLocalFrameReport, computeFrameCheckScores } from "../lib/frameCheck.js";
import { buildFrameCheckSharePng, shareOrDownloadPng } from "../lib/frameCheckSharePng.js";
import { canUseDailyFeature, registerDailyFeatureUse } from "./FeatureUseBadge.jsx";

function buildShareCaption(scores) {
  const s = scores || {};
  const tier = s.tier || "BUILD ARC";
  const overall = typeof s.overall === "number" ? s.overall : "";
  const strength = s.strength ? `Strength: ${s.strength}.` : "";
  const lever = s.weakness ? `Fix next: ${s.weakness}.` : "";
  const proj = typeof s.projected90 === "number" ? `90d → ${s.projected90}/100.` : "";
  return `FRAME CHECK — ${tier} (${overall}/100)\n${strength} ${lever} ${proj}\nslimcal.ai`;
}

function toISODateLocal() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().slice(0, 10);
}

async function dataUrlToFile(dataUrl, filename) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], filename, { type: blob.type || "image/png" });
}

export default function FrameCheckModal({
  open,
  onClose,
  entitlements,
  bundle,
  checklistSummary,
  toast,
}) {
  const shareRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");

  const ctx = useMemo(() => {
    const scores = computeFrameCheckScores({
      ...bundle,
      checklist: checklistSummary,
    });
    return {
      ...bundle,
      checklist: checklistSummary,
      frameScores: scores,
    };
  }, [bundle, checklistSummary]);

  const scoreChipColor = useMemo(() => {
    const n = Number(ctx?.frameScores?.overall || 0);
    if (n >= 88) return "success";
    if (n >= 74) return "primary";
    if (n >= 58) return "warning";
    return "error";
  }, [ctx]);

  const localFallback = useMemo(() => buildLocalFrameReport(ctx), [ctx]);

  const handleRun = async () => {
    setError("");

    const isPro = !!entitlements?.isPro;
    if (!isPro && !canUseDailyFeature("frame_check")) {
      toast?.("Free limit reached (Frame Check: 1/day). Upgrade for more.", "warning");
      return;
    }

    setLoading(true);
    try {
      const prompt = buildFrameCheckPrompt(ctx);

      const r = await fetch("/api/ai/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": localStorage.getItem("slimcal_client_id") || "",
        },
        body: JSON.stringify({
          feature: "frame_check",
          prompt,
        }),
      });

      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(json?.error || "Failed to generate Frame Check");
      }

      const text = json?.text || json?.result || json?.message || "";
      let parsed = null;
      try {
        parsed = typeof text === "string" ? JSON.parse(text) : text;
      } catch {
        // If the model returned non-JSON, keep it as plain text
        parsed = { headline: "Frame Check", summary: String(text || "").slice(0, 2000), breakdown: [], next_moves: [], share_card: String(text || "").slice(0, 600), projection_90d: "" };
      }

      if (!isPro) registerDailyFeatureUse("frame_check");
      setReport(parsed);
      toast?.("Frame Check ready — screenshot or share it.", "success");
    } catch (e) {
      const msg = e?.message || "Frame Check failed";
      setError(msg);
      setReport(null);
      toast?.("Frame Check fallback loaded.", "info");
    } finally {
      setLoading(false);
    }
  };

  const display = report || localFallback;

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      toast?.("Copied.", "success");
    } catch {
      toast?.("Copy failed.", "warning");
    }
  };

  const handleSharePng = async () => {
    try {
      const s = ctx?.frameScores || computeFrameCheckScores({ ...bundle, checklist: checklistSummary });
      const blob = await buildFrameCheckSharePng(s, { pixelRatio: 2 });

      const fileName = `slimcal-frame-check-${toISODateLocal()}.png`;
      const caption = buildShareCaption(s);

      await shareOrDownloadPng(blob, fileName, caption);
      toast?.("Share card ready.", "success");
    } catch (e) {
      console.error(e);
      toast?.("Share failed. Try again.", "warning");
    }
  };
  return (
    <Dialog open={open} onClose={onClose} fullScreen>
      <Box
        sx={{
          minHeight: "100dvh",
          background: "radial-gradient(1200px 600px at 20% 10%, rgba(56,189,248,0.16), rgba(0,0,0,0)), linear-gradient(180deg, #0b1220, #05070b)",
          color: "white",
        }}
      >
        {/* Header */}
        <Box
          sx={{
            position: "sticky",
            top: 0,
            zIndex: 10,
            px: 2,
            py: 1.5,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid rgba(148,163,184,0.14)",
            backdropFilter: "blur(10px)",
            backgroundColor: "rgba(5,7,11,0.6)",
          }}
        >
          <Stack spacing={0.2}>
            <Typography sx={{ fontWeight: 950, letterSpacing: 0.4 }}>Frame Check</Typography>
            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.72)" }}>
              Daily scan — discipline × physique signals
            </Typography>
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center">
            <Chip
              label={`${ctx?.frameScores?.overall ?? 0}/100`}
              color={scoreChipColor}
              sx={{ fontWeight: 950, borderRadius: 999 }}
            />
            <IconButton onClick={onClose} sx={{ color: "rgba(255,255,255,0.9)" }}>
              <CloseIcon />
            </IconButton>
          </Stack>
        </Box>

        <Box sx={{ px: 2, py: 2 }}>
          {/* Top action row */}
          <Stack spacing={1.1}>
            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
              <Chip
                label={ctx?.frameScores?.tier || "BUILD MODE"}
                sx={{ fontWeight: 950, borderRadius: 999, color: "white", border: "1px solid rgba(148,163,184,0.22)" }}
                variant="outlined"
              />
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => copyText(display?.share_card || localFallback?.share_card)}
                  startIcon={<ContentCopyIcon />}
                  sx={{ borderRadius: 999, fontWeight: 850, borderColor: "rgba(148,163,184,0.35)", color: "rgba(255,255,255,0.88)" }}
                >
                  Copy
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleSharePng}
                  startIcon={<IosShareIcon />}
                  sx={{ borderRadius: 999, fontWeight: 950 }}
                >
                  Share PNG
                </Button>
              </Stack>
            </Stack>

            <Button
              variant="contained"
              onClick={handleRun}
              disabled={loading}
              sx={{ borderRadius: 999, fontWeight: 950, py: 1.1 }}
            >
              {loading ? "Running scan…" : "Run Frame Check"}
            </Button>

            {!!error && (
              <Typography variant="body2" sx={{ color: "rgba(248,113,113,0.95)" }}>
                {error}
              </Typography>
            )}
          </Stack>

          {/* Share card (PNG capture target) */}
          <Box
            ref={shareRef}
            sx={{
              mt: 2,
              borderRadius: 4,
              border: "1px solid rgba(148,163,184,0.18)",
              background: "linear-gradient(180deg, rgba(2,6,23,0.92), rgba(15,23,42,0.75))",
              boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
              p: 2,
            }}
          >
            <Stack spacing={1}>
              <Typography sx={{ fontWeight: 950, letterSpacing: 1.2, opacity: 0.95 }}>FRAME CHECK</Typography>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Chip label={`${ctx?.frameScores?.tier || "BUILD MODE"}`} sx={{ fontWeight: 950, borderRadius: 999 }} />
                <Chip label={`${ctx?.frameScores?.overall ?? 0}/100`} color={scoreChipColor} sx={{ fontWeight: 950, borderRadius: 999 }} />
                <Chip label={`90d ~ ${ctx?.frameScores?.projected90 ?? 0}/100`} sx={{ borderRadius: 999, color: "rgba(255,255,255,0.85)" }} variant="outlined" />
              </Stack>

              <Stack direction="row" spacing={2} sx={{ mt: 0.5 }}>
                <Stack spacing={0.2}>
                  <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.65)" }}>Strength</Typography>
                  <Typography sx={{ fontWeight: 900 }}>{ctx?.frameScores?.strength || "Consistency"}</Typography>
                </Stack>
                <Stack spacing={0.2}>
                  <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.65)" }}>Weak Spot</Typography>
                  <Typography sx={{ fontWeight: 900 }}>{ctx?.frameScores?.weakness || "Logging"}</Typography>
                </Stack>
              </Stack>

              <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.62)", mt: 0.5 }}>
                powered by SlimCal • screenshot-ready
              </Typography>
            </Stack>
          </Box>

          {/* Full report (scrollable) */}
          <Box
            sx={{
              mt: 2,
              borderRadius: 4,
              border: "1px solid rgba(148,163,184,0.14)",
              background: "rgba(2,6,23,0.55)",
              p: 2,
              maxHeight: "calc(100dvh - 430px)",
              overflowY: "auto",
            }}
          >
            <Stack spacing={1.2}>
              <Typography sx={{ fontWeight: 950, fontSize: 18 }}>
                {display?.headline || localFallback?.headline}
              </Typography>

              <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.78)", whiteSpace: "pre-wrap" }}>
                {display?.summary || localFallback?.summary}
              </Typography>

              {Array.isArray(display?.breakdown) && display.breakdown.length > 0 && (
                <Stack spacing={0.6}>
                  <Typography sx={{ fontWeight: 900, opacity: 0.95 }}>Breakdown</Typography>
                  {display.breakdown.slice(0, 10).map((b, i) => (
                    <Typography key={i} variant="body2" sx={{ color: "rgba(255,255,255,0.78)" }}>
                      • {String(b)}
                    </Typography>
                  ))}
                </Stack>
              )}

              {Array.isArray(display?.next_moves) && display.next_moves.length > 0 && (
                <Stack spacing={0.6}>
                  <Typography sx={{ fontWeight: 900, opacity: 0.95 }}>Next moves</Typography>
                  {display.next_moves.slice(0, 10).map((b, i) => (
                    <Typography key={i} variant="body2" sx={{ color: "rgba(255,255,255,0.82)" }}>
                      {i + 1}. {String(b)}
                    </Typography>
                  ))}
                </Stack>
              )}

              {!!display?.projection_90d && (
                <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.78)" }}>
                  {String(display.projection_90d)}
                </Typography>
              )}
            </Stack>
          </Box>
        </Box>
      </Box>
    </Dialog>
  );
}
