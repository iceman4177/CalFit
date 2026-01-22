// src/DailyEvaluationHome.jsx
import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Stack,
  Chip,
  Divider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tooltip,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import UpgradeModal from "./components/UpgradeModal";
import FeatureUseBadge, {
  canUseDailyFeature,
  registerDailyFeatureUse,
  getDailyRemaining,
  getFreeDailyLimit,
} from "./components/FeatureUseBadge.jsx";
import { useEntitlements } from "./context/EntitlementsContext.jsx";
import { supabase } from "./lib/supabaseClient";

/* -------------------------------------------------------
  Daily Evaluation Home (Acquisition)
  - Horizontal swipeable cards
  - “Verdict → Stakes → Diagnosis → Locked Insight → Science → Sources”
  - Keeps your existing retention Coach (DailyRecapCoach) separate
-------------------------------------------------------- */

function todayUS() {
  try {
    return new Date().toLocaleDateString("en-US");
  } catch {
    return "";
  }
}

function safeJsonParse(v, fallback) {
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

function getDayMealsRecord(mealHistory, dayStr) {
  if (!Array.isArray(mealHistory)) return null;
  return mealHistory.find((d) => d?.date === dayStr) || null;
}

function sumWorkoutsCalories(workoutHistory, dayStr) {
  if (!Array.isArray(workoutHistory)) return 0;
  return workoutHistory
    .filter((w) => w?.date === dayStr)
    .reduce((s, w) => s + (Number(w?.totalCalories) || 0), 0);
}

function sumMealsCalories(dayRec) {
  const meals = dayRec?.meals;
  if (!Array.isArray(meals)) return 0;
  return meals.reduce((s, m) => s + (Number(m?.calories) || 0), 0);
}

function sumMealsMacros(dayRec) {
  const meals = dayRec?.meals;
  if (!Array.isArray(meals)) return { protein: 0, carbs: 0, fat: 0 };
  return meals.reduce(
    (acc, m) => {
      const macros = m?.macros || {};
      acc.protein += Number(macros?.protein || 0);
      acc.carbs += Number(macros?.carbs || 0);
      acc.fat += Number(macros?.fat || 0);
      return acc;
    },
    { protein: 0, carbs: 0, fat: 0 }
  );
}

function classify(value, { goodMin, borderlineMin } = {}) {
  // returns: on_track | borderline | off
  if (value == null || Number.isNaN(Number(value))) return "off";
  const n = Number(value);
  if (typeof goodMin === "number" && n >= goodMin) return "on_track";
  if (typeof borderlineMin === "number" && n >= borderlineMin) return "borderline";
  return "off";
}

function labelForClass(c) {
  if (c === "on_track") return "on track";
  if (c === "borderline") return "borderline";
  return "off";
}

function chipColorForClass(c) {
  if (c === "on_track") return "success";
  if (c === "borderline") return "warning";
  return "default";
}

function verdictFromSignals({ hasLogs, netKcal, proteinTimingClass, recoveryClass, trainingClass }) {
  // “Calm + confident + slightly uncomfortable”
  if (!hasLogs) {
    return {
      headline: "No signal yet —\nso today can’t be evaluated.",
      sub: "Log a meal and a workout to generate a real daily verdict.",
      severity: "off",
    };
  }

  // Simple rule set (v1). We can upgrade later without changing UI structure.
  const weakLinks = [];
  if (proteinTimingClass !== "on_track") weakLinks.push("protein timing");
  if (recoveryClass !== "on_track") weakLinks.push("recovery");
  if (trainingClass !== "on_track") weakLinks.push("training");

  const netAbs = Math.abs(Number(netKcal) || 0);

  // If net calories are wildly off, make it the limiter
  if (netAbs >= 700) {
    return {
      headline: "Effort was high —\nbut the outcome was limited.",
      sub: "One pattern created a bigger swing than most people realize.",
      severity: "borderline",
    };
  }

  if (weakLinks.length === 0) {
    return {
      headline: "You did most things right today.",
      sub: "But one detail still determines whether this compounds.",
      severity: "on_track",
    };
  }

  if (weakLinks.length === 1) {
    return {
      headline: "Today was productive —\nbut not optimal.",
      sub: `One detail limited today’s impact: ${weakLinks[0]}.`,
      severity: "borderline",
    };
  }

  return {
    headline: "You did the work —\nbut the pattern wasn’t tight.",
    sub: `Multiple signals were borderline: ${weakLinks.join(", ")}.`,
    severity: "borderline",
  };
}

function pickPrimaryLimiter({ proteinTimingClass, recoveryClass, trainingClass, netKcal }) {
  // Choose the single most “sale-worthy” limiter to lock behind insight.
  // Priority: protein timing (most relatable) → recovery → training → net calories swing
  if (proteinTimingClass !== "on_track") return "protein_timing";
  if (recoveryClass !== "on_track") return "recovery";
  if (trainingClass !== "on_track") return "training";
  const netAbs = Math.abs(Number(netKcal) || 0);
  if (netAbs >= 500) return "energy_balance";
  return "execution";
}

function scienceBlurbFor(limiterKey) {
  // Keep it “research shows… evidence suggests…” with no jargon.
  switch (limiterKey) {
    case "protein_timing":
      return {
        title: "Why timing matters",
        body: [
          "Research suggests that distributing protein across the day supports muscle protein synthesis and recovery.",
          "Eating protein closer to training can improve repair signals and reduce next-day soreness for many lifters.",
          "When intake is delayed, the same total protein can be less effective for recovery and performance.",
        ],
        sources: [
          "Journal of the International Society of Sports Nutrition",
          "American College of Sports Medicine (position stands)",
        ],
      };
    case "recovery":
      return {
        title: "Why recovery drives results",
        body: [
          "Evidence suggests training adaptations depend on recovery quality — not just effort.",
          "Short sleep and low recovery can reduce performance, increase hunger, and worsen consistency.",
          "Small recovery improvements often outperform adding more volume.",
        ],
        sources: ["American College of Sports Medicine", "Sleep & performance research summaries"],
      };
    case "training":
      return {
        title: "Why training quality matters",
        body: [
          "Progress depends on progressive overload, sufficient stimulus, and repeatable execution.",
          "Evidence suggests higher-quality sets (close to failure with control) can outperform extra junk volume.",
          "Consistency beats intensity spikes.",
        ],
        sources: ["Strength & conditioning research summaries", "ACSM training guidance"],
      };
    case "energy_balance":
      return {
        title: "Why energy balance matters",
        body: [
          "Evidence suggests large calorie swings can slow composition changes — even with consistent training.",
          "Staying within a tighter range makes outcomes more predictable and easier to adjust.",
          "Small daily errors compound quietly over weeks.",
        ],
        sources: ["Sports nutrition research summaries", "ACSM nutrition guidance"],
      };
    default:
      return {
        title: "Why one detail matters",
        body: [
          "Evidence suggests outcomes depend on the few behaviors you repeat most often.",
          "When the pattern is tight, results become predictable.",
          "When it’s loose, progress feels random — even with effort.",
        ],
        sources: ["Sports nutrition & training consensus statements"],
      };
  }
}

export default function DailyEvaluationHome() {
  const { isProActive } = useEntitlements();
  const [authUser, setAuthUser] = useState(null);

  // Server truth is already normalized elsewhere; here we only need:
  // - isProActive for gating
  // - local daily free uses badge + consumption for “unlock”
  const pro = !!isProActive || localStorage.getItem("isPro") === "true";

  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // unlock state (free: can unlock limited times/day; pro: always unlocked)
  const [unlocked, setUnlocked] = useState(false);

  // Keep auth user (only for display / future personalization)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (mounted) setAuthUser(data?.user ?? null);
      } catch {
        if (mounted) setAuthUser(null);
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setAuthUser(session?.user ?? null);
    });
    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  // Read local logs (v1) — no backend dependency required
  const analysis = useMemo(() => {
    const dayStr = todayUS();
    const workoutHistory = safeJsonParse(localStorage.getItem("workoutHistory"), []);
    const mealHistory = safeJsonParse(localStorage.getItem("mealHistory"), []);

    const dayMealsRec = getDayMealsRecord(mealHistory, dayStr);

    const burned = sumWorkoutsCalories(workoutHistory, dayStr);
    const consumed = sumMealsCalories(dayMealsRec);
    const macros = sumMealsMacros(dayMealsRec);

    const netKcal = (Number(consumed) || 0) - (Number(burned) || 0);
    const hasLogs =
      (Number(consumed) || 0) > 0 || (Number(burned) || 0) > 0 || (dayMealsRec?.meals?.length || 0) > 0;

    // Light heuristics for “diagnosis” labels (v1)
    // We can wire in your real goals later.
    const trainingClass = classify(burned, { goodMin: 120, borderlineMin: 40 }); // “did something”
    const proteinClass = classify(macros.protein, { goodMin: 120, borderlineMin: 80 }); // rough default
    // Protein timing (v1 guess): if user logged any meal after workout? We don’t have timestamps consistently,
    // so we model “timing” as “protein present” for now and upgrade later.
    const proteinTimingClass = proteinClass === "on_track" ? "on_track" : proteinClass;
    // Recovery (v1): use sleepHours if present in local userData
    const userData = safeJsonParse(localStorage.getItem("userData"), {});
    const sleepHours = Number(userData?.sleepHours || userData?.sleep || 0);
    const recoveryClass = classify(sleepHours, { goodMin: 7, borderlineMin: 6 });

    return {
      dayStr,
      burned,
      consumed,
      netKcal,
      macros,
      sleepHours: sleepHours || null,
      hasLogs,
      classes: {
        trainingClass,
        proteinClass,
        proteinTimingClass,
        recoveryClass,
      },
    };
  }, []);

  const limiterKey = useMemo(() => {
    return pickPrimaryLimiter({
      proteinTimingClass: analysis.classes.proteinTimingClass,
      recoveryClass: analysis.classes.recoveryClass,
      trainingClass: analysis.classes.trainingClass,
      netKcal: analysis.netKcal,
    });
  }, [analysis]);

  const verdict = useMemo(() => {
    return verdictFromSignals({
      hasLogs: analysis.hasLogs,
      netKcal: analysis.netKcal,
      proteinTimingClass: analysis.classes.proteinTimingClass,
      recoveryClass: analysis.classes.recoveryClass,
      trainingClass: analysis.classes.trainingClass,
    });
  }, [analysis]);

  const science = useMemo(() => scienceBlurbFor(limiterKey), [limiterKey]);

  // If pro, always unlocked
  useEffect(() => {
    if (pro) setUnlocked(true);
  }, [pro]);

  const openUpgrade = () => {
    try {
      // If you have server-truth trial eligibility driving this elsewhere,
      // the Header sets slimcal:upgradeMode. Here we default to upgrade.
      if (!localStorage.getItem("slimcal:upgradeMode")) {
        localStorage.setItem("slimcal:upgradeMode", "upgrade");
      }
    } catch {}
    setUpgradeOpen(true);
  };

  const handleUnlock = () => {
    if (pro) {
      setUnlocked(true);
      return;
    }
    // Use daily_recap quota for “locked insight unlock” (keeps your existing per-feature psychology)
    const featureKey = "daily_recap";

    if (canUseDailyFeature(featureKey)) {
      registerDailyFeatureUse(featureKey);
      setUnlocked(true);
      return;
    }

    openUpgrade();
  };

  const diagnosisRows = useMemo(() => {
    const rows = [
      {
        label: "Calories",
        value:
          analysis.hasLogs
            ? Math.abs(Number(analysis.netKcal) || 0) <= 350
              ? "on track"
              : Math.abs(Number(analysis.netKcal) || 0) <= 650
                ? "borderline"
                : "off"
            : "off",
      },
      { label: "Training", value: labelForClass(analysis.classes.trainingClass) },
      { label: "Protein", value: labelForClass(analysis.classes.proteinClass) },
      { label: "Recovery", value: labelForClass(analysis.classes.recoveryClass) },
    ];
    return rows;
  }, [analysis]);

  const containerSx = {
    display: "flex",
    gap: 2,
    overflowX: "auto",
    pb: 1,
    scrollSnapType: "x mandatory",
    WebkitOverflowScrolling: "touch",
    "&::-webkit-scrollbar": { height: 8 },
    "&::-webkit-scrollbar-thumb": { borderRadius: 999, background: "rgba(0,0,0,0.15)" },
  };

  const cardSx = {
    flex: "0 0 auto",
    width: { xs: "86vw", sm: 420 },
    maxWidth: 460,
    scrollSnapAlign: "start",
    borderRadius: 4,
  };

  const titleSx = { fontWeight: 900, letterSpacing: -0.2 };

  const statusChip = (cls) => (
    <Chip
      size="small"
      label={labelForClass(cls)}
      color={chipColorForClass(cls)}
      variant={cls === "off" ? "outlined" : "filled"}
      sx={{ fontWeight: 800, textTransform: "lowercase" }}
    />
  );

  const remaining = getDailyRemaining("daily_recap");
  const limit = getFreeDailyLimit("daily_recap");

  return (
    <>
      {/* Acquisition UI: Sliding Cards */}
      <Box sx={{ mb: 2, textAlign: "center" }}>
        <Typography variant="h5" sx={{ fontWeight: 900 }}>
          Daily Evaluation
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Calm verdict. Clear stakes. One locked insight.
        </Typography>

        {/* Light personalization */}
        {authUser?.email && (
          <Typography variant="caption" color="text.secondary">
            Evaluating for {authUser.email}
          </Typography>
        )}
      </Box>

      {/* Swipe Cards */}
      <Box sx={containerSx}>
        {/* CARD 1: VERDICT */}
        <Card sx={cardSx} elevation={2}>
          <CardContent sx={{ p: 3 }}>
            <Stack spacing={2}>
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>
                Verdict
              </Typography>

              <Typography
                variant="h4"
                sx={{ ...titleSx, whiteSpace: "pre-line", lineHeight: 1.05 }}
              >
                {verdict.headline}
              </Typography>

              <Typography color="text.secondary">
                {verdict.sub}
              </Typography>

              <Box>
                <Chip
                  size="small"
                  label={
                    verdict.severity === "on_track"
                      ? "evaluated"
                      : verdict.severity === "borderline"
                        ? "needs adjustment"
                        : "insufficient data"
                  }
                  color={verdict.severity === "on_track" ? "success" : verdict.severity === "borderline" ? "warning" : "default"}
                  variant={verdict.severity === "off" ? "outlined" : "filled"}
                  sx={{ fontWeight: 800 }}
                />
              </Box>
            </Stack>
          </CardContent>
        </Card>

        {/* CARD 2: STAKES */}
        <Card sx={cardSx} elevation={2}>
          <CardContent sx={{ p: 3 }}>
            <Stack spacing={2}>
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>
                Stakes
              </Typography>

              <Typography variant="h5" sx={titleSx}>
                Why this matters
              </Typography>

              <Typography>
                Repeating today’s pattern can slow results — even with consistent effort.
              </Typography>

              <Typography variant="body2" color="text.secondary">
                Based on your meals, training, goals, and recovery.
              </Typography>

              <Divider />

              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                <Chip size="small" label={`Consumed: ${Math.round(analysis.consumed)} kcal`} variant="outlined" />
                <Chip size="small" label={`Burned: ${Math.round(analysis.burned)} kcal`} variant="outlined" />
                <Chip
                  size="small"
                  label={`Net: ${Math.round(analysis.netKcal)} kcal`}
                  color={Math.abs(analysis.netKcal) <= 350 ? "success" : Math.abs(analysis.netKcal) <= 650 ? "warning" : "default"}
                  variant={Math.abs(analysis.netKcal) <= 650 ? "filled" : "outlined"}
                  sx={{ fontWeight: 800 }}
                />
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        {/* CARD 3: DIAGNOSIS */}
        <Card sx={cardSx} elevation={2}>
          <CardContent sx={{ p: 3 }}>
            <Stack spacing={2}>
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>
                Diagnosis
              </Typography>

              <Typography variant="h5" sx={titleSx}>
                What I’m seeing
              </Typography>

              <Stack spacing={1}>
                {diagnosisRows.map((r) => (
                  <Stack
                    key={r.label}
                    direction="row"
                    alignItems="center"
                    justifyContent="space-between"
                    sx={{ py: 0.5 }}
                  >
                    <Typography sx={{ fontWeight: 800 }}>{r.label}</Typography>
                    <Chip size="small" label={r.value} sx={{ fontWeight: 900, textTransform: "lowercase" }} />
                  </Stack>
                ))}
              </Stack>

              <Divider />

              <Typography variant="body2" color="text.secondary">
                This is v1 evaluation logic. Next we’ll map this tightly to your goal type + targets.
              </Typography>
            </Stack>
          </CardContent>
        </Card>

        {/* CARD 4: LOCKED INSIGHT */}
        <Card sx={cardSx} elevation={3}>
          <CardContent sx={{ p: 3 }}>
            <Stack spacing={2}>
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>
                Coach Insight
              </Typography>

              <Typography variant="h5" sx={titleSx}>
                One adjustment today would change tomorrow’s outcome.
              </Typography>

              {/* Badge: show PRO ∞ or free remaining */}
              <Box>
                <FeatureUseBadge
                  featureKey="daily_recap"
                  isPro={pro}
                  sx={{ mr: 1 }}
                  labelPrefix="Unlock"
                />
                {!pro && (
                  <Typography variant="caption" color="text.secondary">
                    {remaining}/{limit} free unlocks left today
                  </Typography>
                )}
              </Box>

              {!unlocked ? (
                <>
                  <Typography color="text.secondary">
                    This is specific to you — but withheld until you unlock it.
                  </Typography>
                  <Button
                    variant="contained"
                    onClick={handleUnlock}
                    sx={{ fontWeight: 900, borderRadius: 3 }}
                  >
                    Unlock explanation
                  </Button>
                  {!pro && remaining <= 0 && (
                    <Typography variant="caption" color="text.secondary">
                      You used today’s free unlocks. Upgrade for unlimited insights.
                    </Typography>
                  )}
                </>
              ) : (
                <>
                  <Typography sx={{ fontWeight: 900 }}>
                    The limiter today was:{" "}
                    <span style={{ fontWeight: 900 }}>
                      {limiterKey === "protein_timing"
                        ? "protein timing"
                        : limiterKey === "recovery"
                          ? "recovery"
                          : limiterKey === "training"
                            ? "training quality"
                            : limiterKey === "energy_balance"
                              ? "energy balance"
                              : "execution consistency"}
                    </span>
                    .
                  </Typography>
                  <Typography color="text.secondary">
                    Next step: we’ll generate a personalized correction (copy + action) — and keep the verdict format.
                  </Typography>

                  {!pro && (
                    <Button
                      variant="outlined"
                      onClick={openUpgrade}
                      sx={{ fontWeight: 900, borderRadius: 3 }}
                    >
                      Upgrade for unlimited
                    </Button>
                  )}
                </>
              )}
            </Stack>
          </CardContent>
        </Card>

        {/* CARD 5: SCIENCE / EVIDENCE */}
        <Card sx={cardSx} elevation={2}>
          <CardContent sx={{ p: 3 }}>
            <Stack spacing={2}>
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>
                Evidence
              </Typography>

              <Typography variant="h5" sx={titleSx}>
                {science.title}
              </Typography>

              {!unlocked && !pro ? (
                <>
                  <Typography color="text.secondary">
                    Unlock the insight to see the evidence behind your verdict.
                  </Typography>
                  <Button
                    variant="contained"
                    onClick={handleUnlock}
                    sx={{ fontWeight: 900, borderRadius: 3 }}
                  >
                    Unlock evidence
                  </Button>
                </>
              ) : (
                <>
                  {science.body.map((p, idx) => (
                    <Typography key={idx}>{p}</Typography>
                  ))}

                  <Divider />

                  <Typography variant="body2" color="text.secondary">
                    Authority matters. We’ll keep this readable — no jargon, no clutter.
                  </Typography>
                </>
              )}
            </Stack>
          </CardContent>
        </Card>

        {/* CARD 6: SOURCES (collapsed) */}
        <Card sx={cardSx} elevation={2}>
          <CardContent sx={{ p: 3 }}>
            <Stack spacing={2}>
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>
                Sources
              </Typography>

              {!unlocked && !pro ? (
                <Typography color="text.secondary">
                  Sources appear after unlock to keep the home screen clean.
                </Typography>
              ) : (
                <Accordion defaultExpanded={false} elevation={0} sx={{ borderRadius: 2, border: "1px solid rgba(0,0,0,0.08)" }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography sx={{ fontWeight: 900 }}>Based on research from</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={1}>
                      {science.sources.map((s, idx) => (
                        <Typography key={idx}>• {s}</Typography>
                      ))}
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              )}

              <Divider />

              <Typography variant="body2" color="text.secondary">
                Next: we’ll swap these placeholders for your actual citation mapping and “source chips”.
              </Typography>
            </Stack>
          </CardContent>
        </Card>

        {/* OPTIONAL CARD: Suggested focus */}
        <Card sx={cardSx} elevation={2}>
          <CardContent sx={{ p: 3 }}>
            <Stack spacing={2}>
              <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 800 }}>
                Suggested focus
              </Typography>

              <Typography variant="h5" sx={titleSx}>
                Keep it simple tomorrow
              </Typography>

              <Typography>
                Pay attention to{" "}
                <strong>
                  {limiterKey === "protein_timing"
                    ? "protein timing"
                    : limiterKey === "recovery"
                      ? "sleep & recovery"
                      : limiterKey === "training"
                        ? "training quality"
                        : limiterKey === "energy_balance"
                          ? "energy balance"
                          : "execution consistency"}
                </strong>
                .
              </Typography>

              <Typography variant="body2" color="text.secondary">
                No quests here. No gamification. Just the lever that moves the outcome.
              </Typography>

              {!pro && (
                <Tooltip title="Unlimited insights + personalized corrections">
                  <Button
                    variant="outlined"
                    onClick={openUpgrade}
                    sx={{ fontWeight: 900, borderRadius: 3 }}
                  >
                    Upgrade to unlock certainty
                  </Button>
                </Tooltip>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Box>

      {/* Upgrade modal */}
      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        // Title/description are computed inside modal based on slimcal:upgradeMode,
        // but you can override here if you want.
      />
    </>
  );
}
