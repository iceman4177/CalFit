// src/HomeHub.jsx
import React from "react";
import { useHistory } from "react-router-dom";
import { useEntitlements } from "./context/EntitlementsContext.jsx";
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
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import DonutLargeIcon from "@mui/icons-material/DonutLarge";
import ChecklistIcon from "@mui/icons-material/Checklist";

function AppIcon({ icon, label, onClick, grad, badge }) {
  return (
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
        "&:hover": { transform: "translateY(-2px)" },
        "&:active": { transform: "translateY(0px) scale(0.99)" },
      }}
    >
      {badge ? (
        <Box sx={{ position: "absolute", top: 10, right: 10, zIndex: 2 }}>
          {badge}
        </Box>
      ) : null}
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
  );
}

export default function HomeHub() {
  const ent = useEntitlements();
  const isPro = !!(ent?.isPro || ent?.isProActive);

  const history = useHistory();

  return (
    <Box
      sx={{
        minHeight: "calc(100vh - 64px)",
        py: { xs: 2.5, sm: 3 },
        background: "radial-gradient(1200px 600px at 50% 0%, rgba(59,130,246,0.10), rgba(255,255,255,0) 55%), radial-gradient(1000px 520px at 50% 60%, rgba(16,185,129,0.08), rgba(255,255,255,0) 60%)",
      }}
    >
      <Container maxWidth="sm">
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          <Stack spacing={0.6} sx={{ width: "100%", textAlign: "left", p: 2, borderRadius: 3, border: "1px solid rgba(148,163,184,0.35)", background: "rgba(255,255,255,0.72)", boxShadow: "0 10px 30px rgba(0,0,0,0.10)" }}>
            <Typography
              variant="h5"
              sx={{ fontWeight: 1000, letterSpacing: -0.8, color: "rgba(15,23,42,0.96)" }}
            >
              What are we doing today?
            </Typography>
            <Typography
              variant="subtitle1"
              sx={{ color: "rgba(51,65,85,0.85)", fontWeight: 650 }}
            >
              Tap an icon to log, scan, or get coached.
            </Typography>
          </Stack>

          <Box
            sx={{
              width: "100%",
              display: "grid",
              gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(3, minmax(0, 1fr))" },
              gap: { xs: 2, sm: 2.4 },
              justifyItems: "center",
              pt: 1.2,
            }}
          >
            <AppIcon
              label="Workout"
              grad="linear-gradient(180deg, rgba(59,130,246,0.95) 0%, rgba(30,64,175,0.98) 100%)"
              icon={<FitnessCenterIcon sx={{ fontSize: 44 }} />}
              onClick={() => history.push("/workout")}
            />
            <AppIcon
              label="Meals"
              grad="linear-gradient(180deg, rgba(16,185,129,0.92) 0%, rgba(4,120,87,0.98) 100%)"
              icon={<DinnerDiningIcon sx={{ fontSize: 44 }} />}
              onClick={() => history.push("/meals")}
            />

            <AppIcon
              label="Daily Eval"
              grad="linear-gradient(180deg, rgba(168,85,247,0.92) 0%, rgba(88,28,135,0.98) 100%)"
              icon={<DonutLargeIcon sx={{ fontSize: 44 }} />}
              onClick={() => history.push("/daily-eval")}
            />
            <AppIcon
              label="Checklist"
              grad="linear-gradient(180deg, rgba(245,158,11,0.92) 0%, rgba(180,83,9,0.98) 100%)"
              icon={<ChecklistIcon sx={{ fontSize: 44 }} />}
              onClick={() => history.push("/daily-checklist")}
            />
            <AppIcon
              label="Pose Session"
              grad="linear-gradient(180deg, rgba(236,72,153,0.92) 0%, rgba(131,24,67,0.98) 100%)"
              badge={!isPro ? (
                <Chip
                  size="small"
                  label="PRO"
                  color="default"
                  sx={{ fontWeight: 900, bgcolor: "rgba(0,0,0,0.45)", color: "rgba(255,255,255,0.95)", border: "1px solid rgba(255,255,255,0.25)" }}
                />
              ) : null}
              icon={<CenterFocusStrongIcon sx={{ fontSize: 44 }} />}
              onClick={() => history.push("/body-scan/session")}
            />
            
            <AppIcon
              label="Get Verdict"
              grad="linear-gradient(180deg, rgba(34,197,94,0.92) 0%, rgba(21,128,61,0.98) 100%)"
              icon={<AutoAwesomeIcon sx={{ fontSize: 44 }} />}
              onClick={() => history.push("/get-verdict")}
            />
<AppIcon
              label="Coach"
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
