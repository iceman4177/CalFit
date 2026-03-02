// src/HomeHub.jsx
import React from "react";
import { useHistory } from "react-router-dom";
import {
  Box,
  Container,
  Stack,
  Typography,
  ButtonBase,
} from "@mui/material";

import FitnessCenterIcon from "@mui/icons-material/FitnessCenter";
import DinnerDiningIcon from "@mui/icons-material/DinnerDining";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import FactCheckIcon from "@mui/icons-material/FactCheck";

function AppIcon({ icon, label, onClick }) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        width: 112,
        height: 112,
        borderRadius: 4,
        border: "1px solid rgba(148,163,184,0.18)",
        background:
          "linear-gradient(180deg, rgba(15,23,42,0.92) 0%, rgba(2,6,23,0.92) 100%)",
        color: "rgba(255,255,255,0.92)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
        display: "flex",
        flexDirection: "column",
        gap: 1,
        px: 1.25,
        py: 1.25,
        textAlign: "center",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
        {icon}
      </Box>
      <Typography
        variant="body2"
        sx={{ fontWeight: 850, letterSpacing: 0.2, lineHeight: 1.1 }}
      >
        {label}
      </Typography>
    </ButtonBase>
  );
}

export default function HomeHub() {
  const history = useHistory();

  return (
    <Box
      sx={{
        minHeight: "calc(100vh - 64px)",
        py: 2,
      }}
    >
      <Container maxWidth="sm">
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          <Stack spacing={0.5} sx={{ width: "100%", textAlign: "left" }}>
            <Typography
              variant="h5"
              sx={{ fontWeight: 1000, letterSpacing: -0.6, color: "rgba(255,255,255,0.95)" }}
            >
              What are we doing today?
            </Typography>
            <Typography
              variant="body2"
              sx={{ color: "rgba(255,255,255,0.72)" }}
            >
              Tap an icon to log, scan, or get your Daily Verdict.
            </Typography>
          </Stack>

          <Box
            sx={{
              width: "100%",
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 2,
              justifyItems: "center",
              pt: 1,
            }}
          >
            <AppIcon
              label="Workout"
              icon={<FitnessCenterIcon sx={{ fontSize: 44 }} />}
              onClick={() => history.push("/workout")}
            />
            <AppIcon
              label="Meals"
              icon={<DinnerDiningIcon sx={{ fontSize: 44 }} />}
              onClick={() => history.push("/meals")}
            />
            <AppIcon
              label="Scan"
              icon={<CenterFocusStrongIcon sx={{ fontSize: 44 }} />}
              onClick={() => history.push("/body-scan")}
            />
            <AppIcon
              label="Daily Verdict"
              icon={<FactCheckIcon sx={{ fontSize: 44 }} />}
              onClick={() => history.push("/verdict")}
            />
          </Box>
        </Stack>
      </Container>
    </Box>
  );
}
