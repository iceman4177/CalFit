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
import { canUseDailyFeature, registerDailyFeatureUse } from "./FeatureUseBadge.jsx";

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
      const fileName = `slimcal-frame-check-${toISODateLocal()}.png`;
      const s = display?.scores || ctx?.frameScores || {};
      const tier = String(s?.tier || "On Deck");

      const canvas = document.createElement("canvas");
      const W = 1080;
      const H = 1920;
      canvas.width = W;
      canvas.height = H;
      const g = canvas.getContext("2d");

      // Background
      const bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#0b1220");
      bg.addColorStop(1, "#05070b");
      g.fillStyle = bg;
      g.fillRect(0, 0, W, H);

      // Accent glow
      const glow = g.createRadialGradient(W * 0.22, H * 0.18, 10, W * 0.22, H * 0.18, 900);
      glow.addColorStop(0, "rgba(56,189,248,0.22)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);

      // Helpers
      const pad = 72;
      const maxW = W - pad * 2;

      const drawWrapped = (text, x, y, maxWidth, lineHeight, font, color, maxLines = 999) => {
        g.font = font;
        g.fillStyle = color;
        const words = String(text || "").split(/\s+/);
        let line = "";
        let lines = 0;

        for (let i = 0; i < words.length; i++) {
          const test = line ? `${line} ${words[i]}` : words[i];
          const w = g.measureText(test).width;
          if (w > maxWidth && line) {
            g.fillText(line, x, y);
            y += lineHeight;
            lines += 1;
            line = words[i];
            if (lines >= maxLines - 1) break;
          } else {
            line = test;
          }
        }
        if (line && lines < maxLines) {
          g.fillText(line, x, y);
          y += lineHeight;
          lines += 1;
        }
        return { y, lines };
      };

      const roundRect = (x, y, w, h, r) => {
        const rr = Math.min(r, w / 2, h / 2);
        g.beginPath();
        g.moveTo(x + rr, y);
        g.arcTo(x + w, y, x + w, y + h, rr);
        g.arcTo(x + w, y + h, x, y + h, rr);
        g.arcTo(x, y + h, x, y, rr);
        g.arcTo(x, y, x + w, y, rr);
        g.closePath();
      };

      // Header
      g.font = "700 56px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      g.fillStyle = "rgba(255,255,255,0.92)";
      g.fillText("FRAME CHECK", pad, 160);

      g.font = "500 30px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      g.fillStyle = "rgba(255,255,255,0.65)";
      g.fillText("powered by SlimCal", pad, 205);

      // Score row
      const overall = Math.round(Number(s?.overall || 0));
      const aesthetic = Math.round(Number(s?.aesthetic || 0));
      const discipline = Math.round(Number(s?.discipline || 0));

      const chipY = 260;
      const chipH = 86;
      const chipGap = 22;

      const drawChip = (x, label, value, accent) => {
        roundRect(x, chipY, (maxW - chipGap * 2) / 3, chipH, 24);
        g.fillStyle = "rgba(255,255,255,0.06)";
        g.fill();
        g.strokeStyle = "rgba(255,255,255,0.10)";
        g.lineWidth = 2;
        g.stroke();

        g.font = "600 22px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial";
        g.fillStyle = "rgba(255,255,255,0.70)";
        g.fillText(label, x + 22, chipY + 34);

        g.font = `800 40px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial`;
        g.fillStyle = accent;
        g.fillText(String(value), x + 22, chipY + 72);
      };

      const chipW = (maxW - chipGap * 2) / 3;
      drawChip(pad, "Overall", overall, "rgba(56,189,248,0.95)");
      drawChip(pad + chipW + chipGap, "Aesthetic", aesthetic, "rgba(167,139,250,0.95)");
      drawChip(pad + (chipW + chipGap) * 2, "Discipline", discipline, "rgba(34,197,94,0.95)");

      // Tier badge
      const badgeY = 380;
      const badgeW = 420;
      roundRect(pad, badgeY, badgeW, 72, 999);
      g.fillStyle = "rgba(56,189,248,0.10)";
      g.fill();
      g.strokeStyle = "rgba(56,189,248,0.28)";
      g.stroke();

      g.font = "700 28px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      g.fillStyle = "rgba(255,255,255,0.88)";
      g.fillText(tier.toUpperCase(), pad + 26, badgeY + 48);

      // Strength / weak spot
      const strength = String(s?.strength || display?.scores?.strength || "Upper body density");
      const weakness = String(s?.weakness || display?.scores?.weakness || "Rear delts");

      g.font = "600 30px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      g.fillStyle = "rgba(255,255,255,0.88)";
      g.fillText("Top strength", pad, 520);
      drawWrapped(strength, pad, 570, maxW, 40, "500 36px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial", "rgba(255,255,255,0.92)", 2);

      g.font = "600 30px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      g.fillStyle = "rgba(255,255,255,0.88)";
      g.fillText("Weak spot", pad, 675);
      drawWrapped(weakness, pad, 725, maxW, 40, "500 36px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial", "rgba(255,255,255,0.92)", 2);

      // 90-day projection
      const proj = String(display?.projection_90d || "").trim();
      const projText = proj || "Stay consistent for 90 days and your score trend becomes obvious — leaner waist, sharper lines, stronger chest/shoulders. Keep protein high and training honest.";
      g.font = "700 34px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      g.fillStyle = "rgba(255,255,255,0.90)";
      g.fillText("90-day projection", pad, 860);
      drawWrapped(projText, pad, 915, maxW, 44, "500 32px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial", "rgba(255,255,255,0.78)", 6);

      // Footer
      g.font = "500 24px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      g.fillStyle = "rgba(255,255,255,0.55)";
      g.fillText("Share this. Challenge a friend. Build your arc.", pad, H - 140);

      g.font = "700 26px Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial";
      g.fillStyle = "rgba(56,189,248,0.85)";
      g.fillText("slimcal.ai", pad, H - 96);

      const dataUrl = canvas.toDataURL("image/png");
      const file = await dataUrlToFile(dataUrl, fileName);

      if (navigator?.canShare && navigator.canShare({ files: [file] }) && navigator?.share) {
        await navigator.share({
          files: [file],
          title: "SlimCal Frame Check",
          text: "My Frame Check (powered by SlimCal)",
        });
        toast?.("Shared.", "success");
        return;
      }

      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast?.("PNG downloaded.", "success");
    } catch (e) {
      toast?.("Share export failed.", "warning");
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
