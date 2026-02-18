// src/BodyScanBeta.jsx
import React, { useMemo, useRef, useState } from "react";
import { useHistory } from "react-router-dom";
import {
  Box,
  Button,
  Chip,
  Stack,
  Typography,
  Checkbox,
  FormControlLabel,
} from "@mui/material";
import IosShareIcon from "@mui/icons-material/IosShare";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";

function StepDots({ step }) {
  return (
    <Stack direction="row" spacing={0.8} justifyContent="center" sx={{ mt: 1.2 }}>
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          sx={{
            width: i === step ? 18 : 8,
            height: 8,
            borderRadius: 999,
            transition: "all 160ms ease",
            bgcolor: i === step ? "rgba(34,197,94,0.95)" : "rgba(148,163,184,0.35)",
          }}
        />
      ))}
    </Stack>
  );
}

function GlassPanel({ children, sx }) {
  return (
    <Box
      sx={{
        borderRadius: 3,
        border: "1px solid rgba(148,163,184,0.18)",
        background:
          "linear-gradient(180deg, rgba(15,23,42,0.82) 0%, rgba(2,6,23,0.82) 100%)",
        boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
        p: 2,
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

export default function BodyScanBeta() {
  const history = useHistory();
  const fileRef = useRef(null);

  const [step, setStep] = useState(0);
  const [photoFile, setPhotoFile] = useState(null);
  const [consent, setConsent] = useState(false);

  const previewUrl = useMemo(() => {
    if (!photoFile) return null;
    try {
      return URL.createObjectURL(photoFile);
    } catch {
      return null;
    }
  }, [photoFile]);

  const openPicker = () => {
    if (fileRef.current) fileRef.current.click();
  };

  const onPickFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhotoFile(f);
  };

  const mockResults = useMemo(() => {
    // Placeholder values (we’ll wire AI next). Keep tone neutral/positive.
    return {
      bodyFatPct: 18.7,
      leanMassLbs: 156,
      bmi: 23,
      buildArcScore: 81,
      percentile: 19,
      strengthTag: "Consistency",
      horizon: "90-Day upgrade horizon",
      levers: ["Add ~25g protein today", "Strength train 2–3×/week"],
    };
  }, []);

  const shareBuildArc = async () => {
    const text = `BUILD ARC — ${mockResults.buildArcScore}/100 (Top ${mockResults.percentile}%)\nStrength: ${mockResults.strengthTag}\n${mockResults.horizon}\n— SlimCal.ai`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Build Arc", text });
      } else {
        await navigator.clipboard.writeText(text);
        alert("Copied your Build Arc summary to clipboard ✅");
      }
    } catch (e) {
      console.error("[BodyScan] share failed", e);
    }
  };

  return (
    <Box
      sx={{
        minHeight: "calc(100vh - 112px)",
        pb: 2,
        px: { xs: 2, sm: 3 },
        pt: 2,
        background:
          "radial-gradient(1000px 500px at 50% -10%, rgba(34,197,94,0.22), transparent 55%), linear-gradient(180deg, rgba(2,6,23,1) 0%, rgba(0,0,0,1) 100%)",
      }}
    >
      <Stack spacing={1.2} sx={{ maxWidth: 520, mx: "auto" }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography sx={{ fontWeight: 950, fontSize: 22, color: "rgba(255,255,255,0.92)" }}>
              Body Scan
            </Typography>
            <Chip
              label="Beta"
              size="small"
              sx={{
                fontWeight: 950,
                borderRadius: 999,
                bgcolor: "rgba(34,197,94,0.14)",
                color: "rgba(187,247,208,0.92)",
                border: "1px solid rgba(34,197,94,0.28)",
              }}
            />
          </Stack>

          <Button
            onClick={() => history.push("/")}
            size="small"
            startIcon={<ArrowBackIcon />}
            sx={{ color: "rgba(255,255,255,0.72)" }}
          >
            Back
          </Button>
        </Stack>

        {step === 0 && (
          <GlassPanel>
            <Typography sx={{ color: "rgba(255,255,255,0.78)", mb: 1 }}>
              See where you stand and unlock the fastest upgrade levers.
            </Typography>

            <Box
              onClick={openPicker}
              role="button"
              sx={{
                borderRadius: 3,
                border: "1px dashed rgba(148,163,184,0.35)",
                background: "rgba(2,6,23,0.45)",
                p: 2,
                textAlign: "center",
                cursor: "pointer",
              }}
            >
              <Typography sx={{ fontWeight: 900, mb: 0.6 }}>Upload photo</Typography>

              <Box
                sx={{
                  borderRadius: 2.5,
                  overflow: "hidden",
                  border: "1px solid rgba(148,163,184,0.18)",
                  width: "100%",
                  aspectRatio: "9 / 12",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(0,0,0,0.35)",
                }}
              >
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="preview"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.62)" }}>
                    Tap to choose a full‑body photo
                  </Typography>
                )}
              </Box>

              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={onPickFile}
              />
            </Box>

            <FormControlLabel
              sx={{ mt: 1 }}
              control={
                <Checkbox
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  sx={{
                    color: "rgba(148,163,184,0.7)",
                    "&.Mui-checked": { color: "rgba(59,130,246,0.95)" },
                  }}
                />
              }
              label={
                <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.68)" }}>
                  Understood — SlimCal doesn’t share, only scans.
                </Typography>
              }
            />

            <Button
              fullWidth
              variant="contained"
              disabled={!photoFile || !consent}
              onClick={() => setStep(1)}
              sx={{
                mt: 1,
                borderRadius: 999,
                fontWeight: 950,
                py: 1.15,
                background: "linear-gradient(180deg, rgba(59,130,246,1) 0%, rgba(37,99,235,1) 100%)",
              }}
            >
              Continue
            </Button>

            <StepDots step={0} />
          </GlassPanel>
        )}

        {step === 1 && (
          <GlassPanel>
            <Typography sx={{ fontWeight: 950, fontSize: 20, mb: 0.4 }}>
              Move back, align body outline
            </Typography>
            <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.7)", mb: 1 }}>
              Plus sign should sit at your navel for a clean baseline.
            </Typography>

            <Box
              sx={{
                position: "relative",
                borderRadius: 3,
                overflow: "hidden",
                border: "1px solid rgba(148,163,184,0.18)",
                background: "rgba(0,0,0,0.35)",
                width: "100%",
                aspectRatio: "9 / 12",
              }}
            >
              {previewUrl && (
                <img
                  src={previewUrl}
                  alt="align"
                  style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.92 }}
                />
              )}

              {/* Outline frame */}
              <Box
                sx={{
                  position: "absolute",
                  inset: 14,
                  borderRadius: 3,
                  border: "1px solid rgba(34,197,94,0.25)",
                  boxShadow: "0 0 0 1px rgba(34,197,94,0.08) inset",
                }}
              />

              {/* Crosshair */}
              <Box
                sx={{
                  position: "absolute",
                  left: "50%",
                  top: "52%",
                  transform: "translate(-50%, -50%)",
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  background: "rgba(34,197,94,0.9)",
                  boxShadow: "0 0 18px rgba(34,197,94,0.55)",
                }}
              />
              <Box
                sx={{
                  position: "absolute",
                  left: "50%",
                  top: "52%",
                  transform: "translate(-50%, -50%)",
                  width: 160,
                  height: 1,
                  bgcolor: "rgba(34,197,94,0.25)",
                }}
              />
              <Box
                sx={{
                  position: "absolute",
                  left: "50%",
                  top: "52%",
                  transform: "translate(-50%, -50%)",
                  width: 1,
                  height: 160,
                  bgcolor: "rgba(34,197,94,0.25)",
                }}
              />
            </Box>

            <Stack spacing={0.6} sx={{ mt: 1.2 }}>
              {mockResults.levers.map((t) => (
                <Stack key={t} direction="row" spacing={1} alignItems="center">
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      bgcolor: "rgba(34,197,94,0.9)",
                      boxShadow: "0 0 10px rgba(34,197,94,0.35)",
                    }}
                  />
                  <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.78)" }}>
                    {t}
                  </Typography>
                </Stack>
              ))}
            </Stack>

            <Stack direction="row" spacing={1} sx={{ mt: 1.3 }}>
              <Button
                variant="outlined"
                fullWidth
                onClick={() => setStep(0)}
                sx={{
                  borderRadius: 999,
                  fontWeight: 900,
                  color: "rgba(255,255,255,0.82)",
                  borderColor: "rgba(148,163,184,0.28)",
                }}
              >
                Back
              </Button>
              <Button
                variant="contained"
                fullWidth
                onClick={() => setStep(2)}
                sx={{
                  borderRadius: 999,
                  fontWeight: 950,
                  background:
                    "linear-gradient(180deg, rgba(34,197,94,1) 0%, rgba(22,163,74,1) 100%)",
                }}
              >
                Scan My Body
              </Button>
            </Stack>

            <StepDots step={1} />
          </GlassPanel>
        )}

        {step === 2 && (
          <GlassPanel>
            <Typography sx={{ fontWeight: 950, letterSpacing: 0.6, color: "rgba(187,247,208,0.9)" }}>
              SCAN RESULTS
            </Typography>
            <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.72)", mb: 1 }}>
              Here are your physique signals (baseline estimate):
            </Typography>

            <Box
              sx={{
                borderRadius: 3,
                border: "1px solid rgba(148,163,184,0.18)",
                overflow: "hidden",
                background:
                  "radial-gradient(420px 240px at 50% 20%, rgba(34,197,94,0.20), transparent 60%), rgba(0,0,0,0.32)",
                aspectRatio: "16 / 9",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                mb: 1.2,
              }}
            >
              <Typography sx={{ color: "rgba(255,255,255,0.55)" }}>
                (Neon body render placeholder)
              </Typography>
            </Box>

            <Stack direction="row" spacing={1} sx={{ mb: 1.2 }}>
              <GlassPanel sx={{ flex: 1, p: 1.3 }}>
                <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.62)" }}>
                  Body Fat
                </Typography>
                <Typography sx={{ fontWeight: 950, fontSize: 20, color: "rgba(187,247,208,0.92)" }}>
                  {mockResults.bodyFatPct}%
                </Typography>
              </GlassPanel>
              <GlassPanel sx={{ flex: 1, p: 1.3 }}>
                <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.62)" }}>
                  Lean Mass
                </Typography>
                <Typography sx={{ fontWeight: 950, fontSize: 20, color: "rgba(187,247,208,0.92)" }}>
                  {mockResults.leanMassLbs} lbs
                </Typography>
              </GlassPanel>
              <GlassPanel sx={{ flex: 1, p: 1.3 }}>
                <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.62)" }}>
                  BMI
                </Typography>
                <Typography sx={{ fontWeight: 950, fontSize: 20, color: "rgba(147,197,253,0.92)" }}>
                  {mockResults.bmi}
                </Typography>
              </GlassPanel>
            </Stack>

            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.62)" }}>
              Upgrade levers
            </Typography>
            <Stack spacing={0.6} sx={{ mt: 0.6, mb: 1 }}>
              {mockResults.levers.map((t) => (
                <Stack key={t} direction="row" spacing={1} alignItems="center">
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      bgcolor: "rgba(34,197,94,0.9)",
                      boxShadow: "0 0 10px rgba(34,197,94,0.35)",
                    }}
                  />
                  <Typography variant="body2" sx={{ color: "rgba(255,255,255,0.78)" }}>
                    {t}
                  </Typography>
                </Stack>
              ))}
            </Stack>

            <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.62)" }}>
              Scan confidence:
              <span style={{ color: "rgba(187,247,208,0.9)", fontWeight: 900 }}> solid baseline</span>
              <span style={{ color: "rgba(255,255,255,0.62)" }}> — re-scan in similar lighting for clean tracking.</span>
            </Typography>

            {/* Build Arc share card */}
            <Box
              sx={{
                mt: 1.3,
                borderRadius: 4,
                border: "1px solid rgba(148,163,184,0.18)",
                background:
                  "radial-gradient(500px 240px at 50% 20%, rgba(59,130,246,0.18), transparent 60%), rgba(2,6,23,0.65)",
                p: 2,
                position: "relative",
                overflow: "hidden",
              }}
            >
              <Typography sx={{ fontWeight: 950, color: "rgba(187,247,208,0.9)", letterSpacing: 1 }}>
                BUILD ARC
              </Typography>

              <Typography sx={{ fontSize: 34, fontWeight: 950, mt: 0.2, color: "rgba(255,255,255,0.92)" }}>
                {mockResults.buildArcScore}/100
              </Typography>
              <Typography sx={{ fontWeight: 900, color: "rgba(255,255,255,0.78)" }}>
                Top {mockResults.percentile}%
              </Typography>

              <Typography variant="body2" sx={{ mt: 0.8, color: "rgba(255,255,255,0.78)" }}>
                Strength: <span style={{ fontWeight: 950 }}>{mockResults.strengthTag}</span>
              </Typography>
              <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.62)" }}>
                {mockResults.horizon}
              </Typography>

              <Button
                onClick={shareBuildArc}
                startIcon={<IosShareIcon />}
                fullWidth
                variant="contained"
                sx={{
                  mt: 1.2,
                  borderRadius: 999,
                  fontWeight: 950,
                  py: 1.1,
                  background:
                    "linear-gradient(180deg, rgba(59,130,246,1) 0%, rgba(37,99,235,1) 100%)",
                }}
              >
                Share
              </Button>

              <Typography variant="caption" sx={{ display: "block", mt: 1, textAlign: "center", color: "rgba(255,255,255,0.55)" }}>
                FRAME CHECK • SlimCal.ai
              </Typography>
            </Box>

            <Stack direction="row" spacing={1} sx={{ mt: 1.3 }}>
              <Button
                variant="outlined"
                fullWidth
                onClick={() => setStep(1)}
                sx={{
                  borderRadius: 999,
                  fontWeight: 900,
                  color: "rgba(255,255,255,0.82)",
                  borderColor: "rgba(148,163,184,0.28)",
                }}
              >
                Back
              </Button>
              <Button
                variant="contained"
                fullWidth
                onClick={() => history.push("/")}
                sx={{
                  borderRadius: 999,
                  fontWeight: 950,
                  background: "linear-gradient(180deg, rgba(34,197,94,1) 0%, rgba(22,163,74,1) 100%)",
                }}
              >
                Done
              </Button>
            </Stack>

            <StepDots step={2} />
          </GlassPanel>
        )}
      </Stack>
    </Box>
  );
}
