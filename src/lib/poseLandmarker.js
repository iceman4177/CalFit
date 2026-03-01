// src/lib/poseLandmarker.js
// Browser-only Pose keypoints (MediaPipe Tasks Vision).
// We intentionally lazy-load to avoid impacting initial bundle.

let _landmarkerPromise = null;
let _landmarkerInstance = null;

async function loadTasksVision() {
  // IMPORTANT:
  // Use CDN import to avoid requiring @mediapipe/tasks-vision to be installed.
  // This prevents Vite/Rollup build failures when the dependency isn't present.
  // Browser-only; do not call during SSR.
  return await import(/* @vite-ignore */ "https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.32");
}

export async function getPoseLandmarker() {
  if (_landmarkerPromise) return _landmarkerPromise;

  _landmarkerPromise = (async () => {
    const { FilesetResolver, PoseLandmarker } = await loadTasksVision();

    // Use hosted wasm + model assets.
    // Model URL pattern is documented across MediaPipe demos and examples.
    const wasm = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm"
    );

    const landmarker = await PoseLandmarker.createFromOptions(wasm, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      },
      runningMode: "VIDEO",
      numPoses: 1,
    });

    _landmarkerInstance = landmarker;
    return landmarker;
  })();

  return _landmarkerPromise;
}


export async function resetPoseLandmarker() {
  // Allow caller to force MediaPipe graph recreation after a WebGL/camera glitch.
  try {
    const inst = await _landmarkerPromise;
    if (inst && typeof inst.close === "function") {
      try { inst.close(); } catch {}
    }
  } catch {}
  _landmarkerPromise = null;
  _landmarkerInstance = null;
}

function v(p) {
  return { x: p.x, y: p.y };
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function angle(a, b, c) {
  // angle ABC in radians
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = Math.sqrt(ab.x * ab.x + ab.y * ab.y) * Math.sqrt(cb.x * cb.x + cb.y * cb.y);
  if (!mag) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot / mag)));
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function scoreRule(ok) {
  return ok ? 1 : 0;
}

export function scorePoseMatch(poseKey, landmarks) {
  // landmarks: array of 33 normalized landmarks (x,y in [0,1])
  // Return { match: 0..1, bbox: {minX,maxX,minY,maxY}, anchors: {...} }
  if (!Array.isArray(landmarks) || landmarks.length < 33) {
    return { match: 0, bbox: null, anchors: null };
  }

  // Key indices per MediaPipe pose: https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
  const L_SHOULDER = 11;
  const R_SHOULDER = 12;
  const L_ELBOW = 13;
  const R_ELBOW = 14;
  const L_WRIST = 15;
  const R_WRIST = 16;
  const L_HIP = 23;
  const R_HIP = 24;

  const ls = v(landmarks[L_SHOULDER]);
  const rs = v(landmarks[R_SHOULDER]);
  const le = v(landmarks[L_ELBOW]);
  const re = v(landmarks[R_ELBOW]);
  const lw = v(landmarks[L_WRIST]);
  const rw = v(landmarks[R_WRIST]);
  const lh = v(landmarks[L_HIP]);
  const rh = v(landmarks[R_HIP]);

  const shoulderWidth = dist(ls, rs) || 0.2;
  const midShoulder = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const midHip = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };

  // bbox
  let minX = 1,
    minY = 1,
    maxX = 0,
    maxY = 0;
  for (const p of landmarks) {
    if (!p) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const bbox = { minX, minY, maxX, maxY };

  // Helper thresholds
  const wristNearHead =
    (dist(lw, midShoulder) < shoulderWidth * 1.35 && lw.y < midShoulder.y + 0.02) &&
    (dist(rw, midShoulder) < shoulderWidth * 1.35 && rw.y < midShoulder.y + 0.02);
  const elbowsHigh = le.y < ls.y + 0.04 && re.y < rs.y + 0.04;
  const elbowsOut =
    Math.abs(le.x - midShoulder.x) > shoulderWidth * 0.55 &&
    Math.abs(re.x - midShoulder.x) > shoulderWidth * 0.55;
  const armsDown = lw.y > midHip.y && rw.y > midHip.y;

  const lElbowAngle = angle(ls, le, lw);
  const rElbowAngle = angle(rs, re, rw);
  const elbowsBent = lElbowAngle > 0.9 && lElbowAngle < 2.5 && rElbowAngle > 0.9 && rElbowAngle < 2.5;

  // Score per pose (simple rules → stable + understandable)
  let s = 0;
  let n = 0;

  if (poseKey === "front_relaxed") {
    // Arms down + wrists below hips + shoulders level
    s += scoreRule(armsDown);
    n++;
    s += scoreRule(Math.abs(ls.y - rs.y) < 0.06);
    n++;
    s += scoreRule(dist(midShoulder, midHip) > 0.18);
    n++;
  } else {
    // Double-bi variants
    s += scoreRule(elbowsHigh);
    n++;
    s += scoreRule(elbowsOut);
    n++;
    s += scoreRule(elbowsBent);
    n++;
    s += scoreRule(wristNearHead);
    n++;
  }

  const match = clamp(n ? s / n : 0, 0, 1);
  return {
    match,
    bbox,
    anchors: {
      midShoulder,
      midHip,
      shoulderWidth,
      ls,
      rs,
    },
  };
}
