// src/HomeHub.jsx
import React, { useMemo } from "react";
import { useHistory } from "react-router-dom";
import { useAuth } from "./context/AuthProvider";
import { getMinimumProfileStatus } from "./lib/profileCompletion";
import {
  Box,
  Container,
  Stack,
  Typography,
  ButtonBase,
  Chip,
} from "@mui/material";

import FitnessCenterIcon from "@mui/icons-material/FitnessCenter";
import DinnerDiningIcon from "@mui/icons-material/DinnerDining";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import DonutLargeIcon from "@mui/icons-material/DonutLarge";
import ChecklistIcon from "@mui/icons-material/Checklist";

function AppIcon({ icon, label, desc, onClick, grad }) {
  return (
    <Stack spacing={1.2} sx={{ alignItems: "center", width: "100%", maxWidth: 220 }}>
      <ButtonBase
        onClick={onClick}
        sx={{
          width: { xs: 132, sm: 140 },
          height: { xs: 132, sm: 140 },
          borderRadius: 999,
          border: "1px solid rgba(148,163,184,0.18)",
          background:
            grad ||
            "linear-gradient(180deg, rgba(15,23,42,0.92) 0%, rgba(2,6,23,0.92) 100%)",
          color: "rgba(255,255,255,0.96)",
          boxShadow: "0 18px 40px rgba(0,0,0,0.22)",
          position: "relative",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 0.8,
          px: 1.2,
          py: 1.2,
          textAlign: "center",
          transform: "translateZ(0)",
          "&:before": {
            content: '""',
            position: "absolute",
            inset: -2,
            background:
              "radial-gradient(600px 220px at 50% 0%, rgba(255,255,255,0.22), rgba(0,0,0,0))",
            opacity: 0.75,
            pointerEvents: "none",
          },
          "&:after": {
            content: '""',
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(260px 260px at 50% 35%, rgba(255,255,255,0.10), rgba(0,0,0,0) 60%)",
            pointerEvents: "none",
          },
          "&:hover": { transform: "translateY(-2px)" },
          "&:active": { transform: "translateY(0px) scale(0.99)" },
        }}
      >
        <Box
          sx={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </Box>
        <Typography
          variant="body2"
          sx={{
            position: "relative",
            zIndex: 1,
            fontWeight: 950,
            letterSpacing: 0.15,
            lineHeight: 1.1,
            textShadow: "0 6px 18px rgba(0,0,0,0.45)",
            color: "rgba(255,255,255,0.98)",
            fontSize: { xs: "1rem", sm: "1.1rem" },
          }}
        >
          {label}
        </Typography>
      </ButtonBase>

      <Typography
        variant="body2"
        sx={{
          width: "100%",
          maxWidth: { xs: 170, sm: 190 },
          textAlign: "center",
          color: "rgba(51,65,85,0.86)",
          fontWeight: 700,
          lineHeight: 1.2,
          fontSize: { xs: "0.95rem", sm: "1rem" },
          minHeight: { xs: 44, sm: 48 },
        }}
      >
        {desc}
      </Typography>
    </Stack>
  );
}

const heroChips = [
  { label: "Log", bg: "rgba(59,130,246,0.10)", color: "#2563eb" },
  { label: "Check", bg: "rgba(168,85,247,0.10)", color: "#7e22ce" },
  { label: "Plan", bg: "rgba(245,158,11,0.12)", color: "#b45309" },
  { label: "Scan", bg: "rgba(236,72,153,0.10)", color: "#be185d" },
  { label: "Coach", bg: "rgba(14,165,233,0.10)", color: "#0369a1" },
];

export default function HomeHub() {
  const history = useHistory();
  const { user } = useAuth();
  const profileStatus = useMemo(
    () => getMinimumProfileStatus(user?.id || null),
    [user?.id]
  );

  return (
    <Box
      sx={{
        minHeight: "calc(100vh - 64px)",
        py: { xs: 2.5, sm: 3 },
        background:
          "radial-gradient(1200px 600px at 50% 0%, rgba(59,130,246,0.10), rgba(255,255,255,0) 55%), radial-gradient(1000px 520px at 50% 60%, rgba(16,185,129,0.08), rgba(255,255,255,0) 60%)",
      }}
    >
      <Container maxWidth="md">
        <Stack spacing={{ xs: 2, sm: 2.6 }} sx={{ alignItems: "center" }}>
          <Stack
            spacing={1}
            sx={{
              width: "100%",
              maxWidth: 760,
              alignItems: "center",
              textAlign: "center",
              p: { xs: 2.25, sm: 2.8 },
              borderRadius: { xs: 5, sm: 6 },
              border: "1px solid rgba(148,163,184,0.22)",
              background: "rgba(255,255,255,0.80)",
              boxShadow: "0 18px 42px rgba(0,0,0,0.08)",
            }}
          >
            <Typography
              sx={{
                fontWeight: 1000,
                letterSpacing: 2.2,
                color: "#2563eb",
                fontSize: { xs: "0.95rem", sm: "1rem" },
              }}
            >
              SLIMCAL HOME
            </Typography>
            <Typography
              variant="h4"
              sx={{
                fontWeight: 1000,
                letterSpacing: -1.1,
                color: "rgba(15,23,42,0.98)",
                fontSize: { xs: "2rem", sm: "2.35rem" },
                lineHeight: 1.05,
              }}
            >
              Pick your next move
            </Typography>
            <Typography
              sx={{
                color: "rgba(51,65,85,0.82)",
                fontWeight: 700,
                lineHeight: 1.45,
                fontSize: { xs: "1rem", sm: "1.2rem" },
                maxWidth: 640,
              }}
            >
              Log your food and training, check how today is going, then get a clear next step.
            </Typography>

            <Stack
              direction="row"
              spacing={{ xs: 0.8, sm: 1 }}
              sx={{
                justifyContent: "center",
                alignItems: "center",
                flexWrap: "wrap",
                rowGap: 0.8,
                pt: 0.4,
              }}
            >
              {heroChips.map((chip) => (
                <Chip
                  key={chip.label}
                  label={chip.label}
                  sx={{
                    bgcolor: chip.bg,
                    color: chip.color,
                    fontWeight: 900,
                    borderRadius: 999,
                    fontSize: { xs: "0.9rem", sm: "0.95rem" },
                    height: { xs: 40, sm: 38 },
                    px: { xs: 0.35, sm: 0.2 },
                  }}
                />
              ))}
            </Stack>
          </Stack>

          {user && !profileStatus.isComplete && (
            <Stack
              spacing={1.1}
              sx={{
                width: "100%",
                p: 2,
                borderRadius: 3,
                border: "1px solid rgba(59,130,246,0.22)",
                background:
                  "linear-gradient(180deg, rgba(239,246,255,0.96) 0%, rgba(255,255,255,0.95) 100%)",
                boxShadow: "0 10px 30px rgba(59,130,246,0.10)",
              }}
            >
              <Typography sx={{ fontWeight: 1000, color: "rgba(15,23,42,0.96)" }}>
                Personalize SlimCal in under 30 seconds
              </Typography>
              <Typography
                variant="body2"
                sx={{ color: "rgba(51,65,85,0.85)", fontWeight: 600 }}
              >
                Complete your profile to unlock accurate AI calories, Daily Check-In, Today’s Plan, Pose Session, and Coach outputs.
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Typography variant="caption" sx={{ fontWeight: 900, color: "primary.main" }}>
                  {profileStatus.completedCount}/{profileStatus.totalCount} core fields complete
                </Typography>
                <ButtonBase
                  onClick={() => history.push("/edit-info")}
                  sx={{
                    px: 1.5,
                    py: 0.75,
                    borderRadius: 999,
                    bgcolor: "primary.main",
                    color: "white",
                    fontWeight: 900,
                  }}
                >
                  Complete Profile
                </ButtonBase>
              </Stack>
            </Stack>
          )}

          <Box
            sx={{
              width: "100%",
              maxWidth: 760,
              display: "grid",
              gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(3, minmax(0, 1fr))" },
              gap: { xs: 2.3, sm: 2.8 },
              justifyItems: "center",
              alignItems: "start",
              pt: { xs: 0.4, sm: 0.8 },
              mx: "auto",
            }}
          >
            <AppIcon
              label="Workout"
              desc="Build or log a workout."
              grad="linear-gradient(180deg, rgba(59,130,246,0.95) 0%, rgba(30,64,175,0.98) 100%)"
              icon={<FitnessCenterIcon sx={{ fontSize: 44 }} />}
              onClick={() => history.push("/workout")}
            />
            <AppIcon
              label="Meals"
              desc="Log meals and track macros."
              grad="linear-gradient(180deg, rgba(16,185,129,0.92) 0%, rgba(4,120,87,0.98) 100%)"
              icon={<DinnerDiningIcon sx={{ fontSize: 44 }} />}
              onClick={() => history.push("/meals")}
            />
            <AppIcon
              label="Daily Check-In"
              desc="See how today is tracking."
              grad="linear-gradient(180deg, rgba(168,85,247,0.92) 0%, rgba(88,28,135,0.98) 100%)"
              icon={<DonutLargeIcon sx={{ fontSize: 44 }} />}
              onClick={() => history.push("/daily-eval")}
            />
            <AppIcon
              label="Today's Plan"
              desc="Know what to do next."
              grad="linear-gradient(180deg, rgba(245,158,11,0.92) 0%, rgba(180,83,9,0.98) 100%)"
              icon={<ChecklistIcon sx={{ fontSize: 44 }} />}
              onClick={() => history.push("/daily-checklist")}
            />
            <AppIcon
              label="Pose Session"
              desc="Run your 3-pose scan."
              grad="linear-gradient(180deg, rgba(236,72,153,0.92) 0%, rgba(131,24,67,0.98) 100%)"
              icon={<CenterFocusStrongIcon sx={{ fontSize: 44 }} />}
              onClick={() => history.push("/body-scan/session")}
            />
            <AppIcon
              label="Coach"
              desc="Get your clearest next step."
              grad="linear-gradient(180deg, rgba(14,165,233,0.92) 0%, rgba(3,105,161,0.98) 100%)"
              icon={<FactCheckIcon sx={{ fontSize: 44 }} />}
              onClick={() => history.push("/verdict")}
            />
          </Box>
        </Stack>
      </Container>
    </Box>
  );
}
