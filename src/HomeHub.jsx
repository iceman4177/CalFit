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

function AppIcon({ icon, label, helper, onClick, grad }) {
  return (
    <Stack spacing={1.05} sx={{ alignItems: "center", width: "100%", maxWidth: 168 }}>
      <ButtonBase
        onClick={onClick}
        sx={{
          width: { xs: 124, sm: 132 },
          height: { xs: 124, sm: 132 },
          borderRadius: 999,
          border: "1px solid rgba(148,163,184,0.18)",
          background: grad || "linear-gradient(180deg, rgba(15,23,42,0.92) 0%, rgba(2,6,23,0.92) 100%)",
          color: "rgba(255,255,255,0.96)",
          boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
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
          transition: "transform 140ms ease, box-shadow 180ms ease",
          "&:before": {
            content: '""',
            position: "absolute",
            inset: -2,
            background: "radial-gradient(600px 220px at 50% 0%, rgba(255,255,255,0.22), rgba(0,0,0,0))",
            opacity: 0.75,
            pointerEvents: "none",
          },
          "&:after": {
            content: '""',
            position: "absolute",
            inset: 0,
            background: "radial-gradient(260px 260px at 50% 35%, rgba(255,255,255,0.10), rgba(0,0,0,0) 60%)",
            pointerEvents: "none",
          },
          "&:hover": { transform: "translateY(-2px)", boxShadow: "0 22px 46px rgba(0,0,0,0.38)" },
          "&:active": { transform: "translateY(0px) scale(0.99)" },
        }}
      >
        <Box sx={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {icon}
        </Box>
        <Typography
          variant="body2"
          sx={{
            position: "relative",
            zIndex: 1,
            fontWeight: 950,
            letterSpacing: 0.25,
            lineHeight: 1.1,
            textShadow: "0 6px 18px rgba(0,0,0,0.45)",
            color: "rgba(255,255,255,0.98)",
          }}
        >
          {label}
        </Typography>
      </ButtonBase>
      <Typography
        variant="caption"
        sx={{
          minHeight: 32,
          px: 0.5,
          textAlign: "center",
          color: "rgba(51,65,85,0.82)",
          fontWeight: 700,
          lineHeight: 1.25,
        }}
      >
        {helper}
      </Typography>
    </Stack>
  );
}

export default function HomeHub() {

  const history = useHistory();
  const { user } = useAuth();
  const profileStatus = useMemo(() => getMinimumProfileStatus(user?.id || null), [user?.id]);

  return (
    <Box
      sx={{
        minHeight: "calc(100vh - 64px)",
        py: { xs: 2.5, sm: 3 },
        background: "radial-gradient(1200px 600px at 50% 0%, rgba(59,130,246,0.10), rgba(255,255,255,0) 55%), radial-gradient(1000px 520px at 50% 60%, rgba(16,185,129,0.08), rgba(255,255,255,0) 60%)",
      }}
    >
      <Container maxWidth="md">
        <Stack spacing={{ xs: 2, sm: 2.6 }} sx={{ alignItems: "center" }}>
          <Stack
            spacing={1.15}
            sx={{
              width: "100%",
              maxWidth: 720,
              textAlign: "center",
              p: { xs: 1.8, sm: 2.5 },
              borderRadius: 4,
              border: "1px solid rgba(148,163,184,0.28)",
              background: "rgba(255,255,255,0.82)",
              boxShadow: "0 18px 42px rgba(0,0,0,0.08)",
            }}
          >
            <Typography
              variant="overline"
              sx={{ fontWeight: 900, letterSpacing: { xs: 0.9, sm: 1.2 }, color: "primary.main", lineHeight: 1, fontSize: { xs: "0.72rem", sm: "0.78rem" } }}
            >
              SlimCal Home
            </Typography>
            <Typography
              variant="h5"
              sx={{ fontWeight: 1000, letterSpacing: { xs: -0.4, sm: -0.8 }, color: "rgba(15,23,42,0.96)", fontSize: { xs: "2rem", sm: undefined }, lineHeight: { xs: 1.05, sm: 1.1 } }}
            >
              Pick your next move
            </Typography>
            <Typography
              variant="subtitle1"
              sx={{ color: "rgba(51,65,85,0.85)", fontWeight: 650, fontSize: { xs: "0.98rem", sm: "1rem" }, maxWidth: { xs: 330, sm: 620 }, mx: "auto" }}
            >
              Log your food and training, check how today is going, then get a clear next step.
            </Typography>
            <Stack
              direction="row"
              sx={{
                flexWrap: { xs: "nowrap", sm: "wrap" },
                gap: { xs: 0.65, sm: 1 },
                pt: 0.35,
                justifyContent: "center",
                alignItems: "center",
                width: "100%",
                overflowX: { xs: "auto", sm: "visible" },
                scrollbarWidth: "none",
                "&::-webkit-scrollbar": { display: "none" },
              }}
            >
              <Chip label="Log" size="small" sx={{ fontWeight: 800, bgcolor: "rgba(59,130,246,0.10)", color: "rgba(30,64,175,1)", height: { xs: 30, sm: 32 }, px: { xs: 0.15, sm: 0.25 }, "& .MuiChip-label": { px: { xs: 1.15, sm: 1.5 }, fontSize: { xs: "0.8rem", sm: "0.8125rem" } } }} />
              <Chip label="Check" size="small" sx={{ fontWeight: 800, bgcolor: "rgba(168,85,247,0.10)", color: "rgba(107,33,168,1)", height: { xs: 30, sm: 32 }, px: { xs: 0.15, sm: 0.25 }, "& .MuiChip-label": { px: { xs: 1.15, sm: 1.5 }, fontSize: { xs: "0.8rem", sm: "0.8125rem" } } }} />
              <Chip label="Plan" size="small" sx={{ fontWeight: 800, bgcolor: "rgba(245,158,11,0.12)", color: "rgba(146,64,14,1)", height: { xs: 30, sm: 32 }, px: { xs: 0.15, sm: 0.25 }, "& .MuiChip-label": { px: { xs: 1.15, sm: 1.5 }, fontSize: { xs: "0.8rem", sm: "0.8125rem" } } }} />
              <Chip label="Scan" size="small" sx={{ fontWeight: 800, bgcolor: "rgba(236,72,153,0.10)", color: "rgba(157,23,77,1)", height: { xs: 30, sm: 32 }, px: { xs: 0.15, sm: 0.25 }, "& .MuiChip-label": { px: { xs: 1.15, sm: 1.5 }, fontSize: { xs: "0.8rem", sm: "0.8125rem" } } }} />
              <Chip label="Coach" size="small" sx={{ fontWeight: 800, bgcolor: "rgba(14,165,233,0.10)", color: "rgba(3,105,161,1)", height: { xs: 30, sm: 32 }, px: { xs: 0.15, sm: 0.25 }, "& .MuiChip-label": { px: { xs: 1.15, sm: 1.5 }, fontSize: { xs: "0.8rem", sm: "0.8125rem" } } }} />
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
                background: "linear-gradient(180deg, rgba(239,246,255,0.96) 0%, rgba(255,255,255,0.95) 100%)",
                boxShadow: "0 10px 30px rgba(59,130,246,0.10)",
              }}
            >
              <Typography sx={{ fontWeight: 1000, color: "rgba(15,23,42,0.96)" }}>
                Personalize SlimCal in under 30 seconds
              </Typography>
              <Typography variant="body2" sx={{ color: "rgba(51,65,85,0.85)", fontWeight: 600 }}>
                Complete your profile to unlock accurate AI calories, Daily Check-In, Today’s Plan, Pose Session, and Coach outputs.
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                <Typography variant="caption" sx={{ fontWeight: 900, color: "primary.main" }}>
                  {profileStatus.completedCount}/{profileStatus.totalCount} core fields complete
                </Typography>
                <ButtonBase
                  onClick={() => history.push('/edit-info')}
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
              gap: { xs: 2, sm: 2.6 },
              justifyItems: "center",
              alignItems: "start",
              pt: { xs: 0.4, sm: 0.8 },
              mx: "auto",
            }}
          >
            <AppIcon
              label="Workout"
              grad="linear-gradient(180deg, rgba(59,130,246,0.95) 0%, rgba(30,64,175,0.98) 100%)"
              icon={<FitnessCenterIcon sx={{ fontSize: 44 }} />}
              helper="Build or log your training session."
              onClick={() => history.push("/workout")}
            />
            <AppIcon
              label="Meals"
              grad="linear-gradient(180deg, rgba(16,185,129,0.92) 0%, rgba(4,120,87,0.98) 100%)"
              icon={<DinnerDiningIcon sx={{ fontSize: 44 }} />}
              helper="Add meals, macros, or get AI ideas."
              onClick={() => history.push("/meals")}
            />

            <AppIcon
              label="Daily Check-In"
              grad="linear-gradient(180deg, rgba(168,85,247,0.92) 0%, rgba(88,28,135,0.98) 100%)"
              icon={<DonutLargeIcon sx={{ fontSize: 44 }} />}
              helper="See how today is tracking so far."
              onClick={() => history.push("/daily-eval")}
            />
            <AppIcon
              label="Today's Plan"
              grad="linear-gradient(180deg, rgba(245,158,11,0.92) 0%, rgba(180,83,9,0.98) 100%)"
              icon={<ChecklistIcon sx={{ fontSize: 44 }} />}
              helper="Know exactly what to knock out next."
              onClick={() => history.push("/daily-checklist")}
            />
            <AppIcon
              label="Pose Session"
              grad="linear-gradient(180deg, rgba(236,72,153,0.92) 0%, rgba(131,24,67,0.98) 100%)"
              icon={<CenterFocusStrongIcon sx={{ fontSize: 44 }} />}
              helper="Run your 3-pose physique scan."
              onClick={() => history.push("/body-scan/session")}
            />
            
            <AppIcon
              label="Coach"
              grad="linear-gradient(180deg, rgba(14,165,233,0.92) 0%, rgba(3,105,161,0.98) 100%)"
              icon={<FactCheckIcon sx={{ fontSize: 44 }} />}
              helper="Get your personalized AI guidance."
              onClick={() => history.push("/verdict")}
            />
          </Box>
        </Stack>
      </Container>
    </Box>
  );
}