// src/PoseSession.jsx
// SIMPLE (v1) Pose Session: no live detection, no overlays, no camera tracking.
// User provides 3 images (Front / Side / Back), we send compressed thumbs to /api/ai/generate (feature: pose_session)
// and then render a shareable result card that can be exported as a PNG.

import React, { useMemo, useState, useCallback } from "react";
import { useHistory } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import IosShareIcon from "@mui/icons-material/IosShare";

import { postAI } from "./lib/ai";
import { shareOrDownloadPng } from "./lib/frameCheckSharePng";
import { buildPoseSimpleSharePng } from "./lib/poseSimpleSharePng";

const POSES = [
  { key: "front", title: "Front", hint: "Stand tall · upper body centered" },
  { key: "side", title: "Side", hint: "Side profile · shoulders + hips in frame" },
  { key: "back", title: "Back", hint: "Turn around · show your back" },
];

function clamp(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

async function makeThumb(dataUrl, maxEdge = 512, quality = 0.72) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const tw = Math.max(1, Math.round(sw * scale));
  const th = Math.max(1, Math.round(sh * scale));
  const c = document.createElement("canvas");
  c.width = tw;
  c.height = th;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, sw, sh, 0, 0, tw, th);
  return c.toDataURL("image/jpeg", quality);
}

function ScorePill({ score10 }) {
  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        px: 2,
        py: 1,
        borderRadius: 999,
        background:
          "linear-gradient(90deg, rgba(0,255,190,0.22), rgba(0,200,255,0.18))",
        border: "1px solid rgba(0,255,190,0.22)",
      }}
    >
      <Typography sx={{ fontWeight: 900, letterSpacing: 0.6 }}>
        AESTHETIC: {score10.toFixed(1)}/10
      </Typography>
    </Box>
  );
}

export default function PoseSession() {
  const history = useHistory();

  const [fullData, setFullData] = useState({ front: "", side: "", back: "" });
  const [thumbs, setThumbs] = useState({ front: "", side: "", back: "" });
  const [step, setStep] = useState("upload"); // upload | generating | result
  const [error, setError] = useState("");
  const [ai, setAi] = useState(null);

  const ready = useMemo(() => Boolean(thumbs.front && thumbs.side && thumbs.back), [thumbs]);

  const onPick = useCallback(async (poseKey, file) => {
    setError("");
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      const thumb = await makeThumb(dataUrl, 512, 0.72);
      setFullData((p) => ({ ...p, [poseKey]: dataUrl }));
      setThumbs((p) => ({ ...p, [poseKey]: thumb }));
    } catch (e) {
      console.error(e);
      setError("Couldn’t read that image. Try a different photo.");
    }
  }, []);

  const onClear = useCallback((poseKey) => {
    setFullData((p) => ({ ...p, [poseKey]: "" }));
    setThumbs((p) => ({ ...p, [poseKey]: "" }));
  }, []);

  const generate = useCallback(async () => {
    if (!ready) return;
    setStep("generating");
    setError("");
    try {
      const poses = [
        { poseKey: "front_relaxed", title: "Front", imageDataUrl: thumbs.front },
        { poseKey: "side_profile", title: "Side", imageDataUrl: thumbs.side },
        { poseKey: "back_relaxed", title: "Back", imageDataUrl: thumbs.back },
      ];

      const resp = await postAI("pose_session", {
        poses,
        style: "viral_build_arc_v1",
      });

      setAi(resp?.session || null);
      setStep("result");
    } catch (e) {
      console.error(e);
      setError("AI couldn’t generate right now. Try again in a moment.");
      setStep("upload");
    }
  }, [ready, thumbs]);

  const share = useCallback(async () => {
    try {
      const buildArc = clamp(ai?.build_arc ?? 80, 0, 100);
      const score10 = clamp((buildArc / 100) * 10, 0, 10);
      const tier =
        buildArc >= 86 ? "V-TAPER RISING" : buildArc >= 78 ? "ARC BUILDING" : "BASELINE LOCKED";
      const bullets = Array.isArray(ai?.highlights)
        ? ai.highlights.map((s) => String(s)).filter(Boolean).slice(0, 3)
        : ["Solid baseline locked", "Good momentum signal", "Re-scan weekly for progress"];

      const png = await buildPoseSimpleSharePng({
        brand: "Slimcal.ai",
        tier,
        score10,
        bullets,
        poseImages: [fullData.front, fullData.side, fullData.back].filter(Boolean),
      });

      await shareOrDownloadPng(png, "slimcal_build_arc.png");
    } catch (e) {
      console.error(e);
      setError("Couldn’t export the card. Try again.");
    }
  }, [ai, fullData]);

  const resetAll = useCallback(() => {
    setFullData({ front: "", side: "", back: "" });
    setThumbs({ front: "", side: "", back: "" });
    setAi(null);
    setError("");
    setStep("upload");
  }, []);

  const bg =
    "radial-gradient(1200px 600px at 50% 10%, rgba(0,255,190,0.12), rgba(0,0,0,0) 55%), #05070b";

  return (
    <Box sx={{ minHeight: "100vh", background: bg, color: "#E9FFF8", px: { xs: 2, sm: 3 }, py: 3 }}>
      <Box sx={{ maxWidth: 980, mx: "auto" }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => history.push("/evaluate")}
          sx={{ color: "rgba(233,255,248,0.85)", mb: 2 }}
        >
          Back
        </Button>

        <Card
          sx={{
            borderRadius: 6,
            overflow: "hidden",
            background: "rgba(10,14,20,0.88)",
            border: "1px solid rgba(0,255,190,0.16)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          }}
        >
          <CardContent sx={{ p: { xs: 2.5, sm: 4 } }}>
            {step !== "result" ? (
              <>
                <Typography variant="h4" sx={{ fontWeight: 900, letterSpacing: 0.2 }}>
                  AI Physique Tracker
                </Typography>
                <Typography sx={{ opacity: 0.85, mt: 0.5 }}>
                  3 photos · shareable results
                </Typography>

                <Divider sx={{ my: 2.5, borderColor: "rgba(0,255,190,0.16)" }} />

                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  {POSES.map((p) => {
                    const has = Boolean(fullData[p.key]);
                    return (
                      <Card
                        key={p.key}
                        sx={{
                          flex: 1,
                          borderRadius: 5,
                          background: "rgba(0,0,0,0.28)",
                          border: "1px solid rgba(0,255,190,0.14)",
                        }}
                      >
                        <CardContent>
                          <Typography sx={{ fontWeight: 900 }}>{p.title}</Typography>
                          <Typography sx={{ opacity: 0.75, fontSize: 13, mt: 0.5 }}>{p.hint}</Typography>

                          <Box
                            sx={{
                              mt: 1.5,
                              borderRadius: 4,
                              overflow: "hidden",
                              border: "1px solid rgba(0,255,190,0.16)",
                              background: "rgba(0,0,0,0.35)",
                              aspectRatio: "3 / 4",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {has ? (
                              <img
                                src={fullData[p.key]}
                                alt={p.title}
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              />
                            ) : (
                              <Typography sx={{ opacity: 0.55, fontWeight: 700 }}>Add photo</Typography>
                            )}
                          </Box>

                          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                            <Button
                              variant="contained"
                              component="label"
                              fullWidth
                              sx={{
                                borderRadius: 999,
                                fontWeight: 900,
                                textTransform: "none",
                                background:
                                  "linear-gradient(90deg, rgba(0,255,190,0.85), rgba(0,200,255,0.65))",
                                color: "#061015",
                                boxShadow: "0 10px 30px rgba(0,255,190,0.18)",
                              }}
                            >
                              {has ? "Retake" : "Upload"}
                              <input
                                hidden
                                type="file"
                                accept="image/*"
                                capture="environment"
                                onChange={(e) => onPick(p.key, e.target.files?.[0] || null)}
                              />
                            </Button>
                            {has ? (
                              <Button
                                variant="outlined"
                                onClick={() => onClear(p.key)}
                                sx={{
                                  borderRadius: 999,
                                  minWidth: 92,
                                  borderColor: "rgba(233,255,248,0.22)",
                                  color: "rgba(233,255,248,0.88)",
                                  textTransform: "none",
                                  fontWeight: 800,
                                }}
                              >
                                Clear
                              </Button>
                            ) : null}
                          </Stack>
                        </CardContent>
                      </Card>
                    );
                  })}
                </Stack>

                {error ? (
                  <Typography sx={{ mt: 2, color: "rgba(255,150,150,0.95)", fontWeight: 700 }}>{error}</Typography>
                ) : null}

                <Box sx={{ mt: 3, display: "flex", justifyContent: "center" }}>
                  <Button
                    disabled={!ready || step === "generating"}
                    onClick={generate}
                    variant="contained"
                    sx={{
                      px: 5,
                      py: 1.6,
                      borderRadius: 999,
                      fontWeight: 900,
                      textTransform: "none",
                      background: ready
                        ? "linear-gradient(90deg, rgba(0,255,190,0.92), rgba(0,200,255,0.75))"
                        : "rgba(255,255,255,0.10)",
                      color: ready ? "#061015" : "rgba(233,255,248,0.60)",
                      boxShadow: ready ? "0 16px 40px rgba(0,255,190,0.18)" : "none",
                    }}
                  >
                    {step === "generating" ? "Generating…" : "Generate Build Arc Card"}
                  </Button>
                </Box>

                <Typography sx={{ mt: 2, opacity: 0.75, textAlign: "center", fontSize: 13 }}>
                  Private — you control sharing.
                </Typography>
              </>
            ) : (
              <>
                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
                  <Box>
                    <Typography variant="h4" sx={{ fontWeight: 900 }}>
                      Slimcal.ai
                    </Typography>
                    <Typography sx={{ opacity: 0.85 }}>Build Arc</Typography>
                  </Box>
                  <Button
                    onClick={resetAll}
                    variant="outlined"
                    sx={{
                      borderRadius: 999,
                      borderColor: "rgba(233,255,248,0.22)",
                      color: "rgba(233,255,248,0.88)",
                      textTransform: "none",
                      fontWeight: 800,
                    }}
                  >
                    New Scan
                  </Button>
                </Stack>

                <Divider sx={{ my: 2.5, borderColor: "rgba(0,255,190,0.16)" }} />

                <Box sx={{ textAlign: "center" }}>
                  <Typography sx={{ fontWeight: 900, letterSpacing: 1.2, fontSize: 34 }}>
                    {(ai?.build_arc ?? 80) >= 86
                      ? "V-TAPER RISING"
                      : (ai?.build_arc ?? 80) >= 78
                      ? "ARC BUILDING"
                      : "BASELINE LOCKED"}
                  </Typography>
                  <Box sx={{ mt: 1.2 }}>
                    <ScorePill score10={clamp(((ai?.build_arc ?? 80) / 100) * 10, 0, 10)} />
                  </Box>
                </Box>

                <Card
                  sx={{
                    mt: 2.5,
                    borderRadius: 5,
                    background: "rgba(0,0,0,0.28)",
                    border: "1px solid rgba(0,255,190,0.14)",
                  }}
                >
                  <CardContent>
                    <Typography sx={{ fontWeight: 900, letterSpacing: 0.8, mb: 1.2 }}>
                      WHAT’S POPPING
                    </Typography>
                    <Stack spacing={1}>
                      {(Array.isArray(ai?.highlights) ? ai.highlights : [])
                        .slice(0, 3)
                        .map((t, idx) => (
                          <Typography key={idx} sx={{ opacity: 0.92, fontWeight: 750 }}>
                            • {String(t)}
                          </Typography>
                        ))}
                      {!Array.isArray(ai?.highlights) ? (
                        <>
                          <Typography sx={{ opacity: 0.92, fontWeight: 750 }}>• Upper body reading stronger</Typography>
                          <Typography sx={{ opacity: 0.92, fontWeight: 750 }}>• Clean structure — great tracking baseline</Typography>
                          <Typography sx={{ opacity: 0.92, fontWeight: 750 }}>• Momentum signal: keep showing up</Typography>
                        </>
                      ) : null}
                    </Stack>

                    <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
                      {POSES.map((p) => (
                        <Box key={p.key} sx={{ flex: 1 }}>
                          <Box
                            sx={{
                              borderRadius: 4,
                              overflow: "hidden",
                              border: "1px solid rgba(0,255,190,0.16)",
                              background: "rgba(0,0,0,0.35)",
                              aspectRatio: "3 / 4",
                            }}
                          >
                            <img
                              src={fullData[p.key]}
                              alt={p.title}
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                          </Box>
                          <Typography sx={{ mt: 0.7, textAlign: "center", opacity: 0.9, fontWeight: 800 }}>
                            {p.title}
                          </Typography>
                        </Box>
                      ))}
                    </Stack>

                    {error ? (
                      <Typography sx={{ mt: 2, color: "rgba(255,150,150,0.95)", fontWeight: 700 }}>{error}</Typography>
                    ) : null}

                    <Stack direction="row" spacing={1.5} sx={{ mt: 2.5 }}>
                      <Button
                        onClick={share}
                        variant="contained"
                        startIcon={<IosShareIcon />}
                        fullWidth
                        sx={{
                          borderRadius: 999,
                          fontWeight: 900,
                          textTransform: "none",
                          background:
                            "linear-gradient(90deg, rgba(0,255,190,0.92), rgba(0,200,255,0.75))",
                          color: "#061015",
                          boxShadow: "0 16px 40px rgba(0,255,190,0.18)",
                        }}
                      >
                        Share Card
                      </Button>
                      <Button
                        onClick={resetAll}
                        variant="outlined"
                        sx={{
                          borderRadius: 999,
                          minWidth: 140,
                          borderColor: "rgba(233,255,248,0.22)",
                          color: "rgba(233,255,248,0.88)",
                          textTransform: "none",
                          fontWeight: 800,
                        }}
                      >
                        Retake
                      </Button>
                    </Stack>

                    <Typography sx={{ mt: 1.6, opacity: 0.75, textAlign: "center", fontSize: 13 }}>
                      Drop your Build Arc — #SlimcalAI
                    </Typography>
                  </CardContent>

{(ai?.report || ai?.muscleBreakdown) ? (
  <Card
    sx={{
      mt: 2.5,
      borderRadius: 5,
      background: "rgba(0,0,0,0.22)",
      border: "1px solid rgba(0,255,190,0.14)",
    }}
  >
    <CardContent>
      <Typography sx={{ fontWeight: 900, letterSpacing: 0.8, mb: 1.2 }}>
        DETAILED PHYSIQUE BREAKDOWN
      </Typography>

      {ai?.report ? (
        <Stack spacing={1.2} sx={{ mb: 2 }}>
          {String(ai.report)
            .split(/\n\n+/)
            .map((p, idx) => String(p || "").trim())
            .filter(Boolean)
            .slice(0, 30)
            .map((p, idx) => (
              <Typography key={idx} sx={{ opacity: 0.92, lineHeight: 1.6 }}>
                {p}
              </Typography>
            ))}
        </Stack>
      ) : null}

      {ai?.muscleBreakdown && typeof ai.muscleBreakdown === "object" ? (
        <Stack spacing={1.4}>
          {[
            ["delts", "Delts"],
            ["arms", "Arms"],
            ["chest", "Chest"],
            ["lats", "Lats"],
            ["back", "Back"],
            ["core", "Core"],
            ["legs", "Legs"],
            ["calves", "Calves"],
            ["symmetry", "Symmetry"],
          ]
            .map(([k, label]) => ({ k, label, v: ai?.muscleBreakdown?.[k] }))
            .filter((x) => Boolean(String(x.v || "").trim()))
            .map((x) => (
              <Box key={x.k}>
                <Typography sx={{ fontWeight: 900, opacity: 0.95 }}>
                  {x.label}
                </Typography>
                <Typography sx={{ opacity: 0.9, lineHeight: 1.6, mt: 0.4 }}>
                  {String(x.v)}
                </Typography>
              </Box>
            ))}
        </Stack>
      ) : null}

      {(Array.isArray(ai?.bestDeveloped) && ai.bestDeveloped.length) ||
      (Array.isArray(ai?.biggestOpportunity) && ai.biggestOpportunity.length) ? (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mt: 2.5 }}>
          {Array.isArray(ai?.bestDeveloped) && ai.bestDeveloped.length ? (
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 900, mb: 0.8 }}>Best developed</Typography>
              <Stack spacing={0.6}>
                {ai.bestDeveloped.slice(0, 4).map((t, idx) => (
                  <Typography key={idx} sx={{ opacity: 0.92, fontWeight: 750 }}>
                    • {String(t)}
                  </Typography>
                ))}
              </Stack>
            </Box>
          ) : null}

          {Array.isArray(ai?.biggestOpportunity) && ai.biggestOpportunity.length ? (
            <Box sx={{ flex: 1 }}>
              <Typography sx={{ fontWeight: 900, mb: 0.8 }}>Next to level up</Typography>
              <Stack spacing={0.6}>
                {ai.biggestOpportunity.slice(0, 4).map((t, idx) => (
                  <Typography key={idx} sx={{ opacity: 0.92, fontWeight: 750 }}>
                    • {String(t)}
                  </Typography>
                ))}
              </Stack>
            </Box>
          ) : null}
        </Stack>
      ) : null}

      {Array.isArray(ai?.poseNotes) && ai.poseNotes.length ? (
        <Box sx={{ mt: 2.5 }}>
          <Typography sx={{ fontWeight: 900, mb: 0.8 }}>Pose notes</Typography>
          <Stack spacing={0.6}>
            {ai.poseNotes.slice(0, 6).map((t, idx) => (
              <Typography key={idx} sx={{ opacity: 0.9 }}>
                • {String(t)}
              </Typography>
            ))}
          </Stack>
        </Box>
      ) : null}
    </CardContent>
  </Card>
) : null}
                </Card>
              </>
            )}
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
