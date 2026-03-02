// src/lib/frameCheckSharePng.js
// Share helper used by Frame Check + Pose Session.
// Backward compatible with older call shapes:
//
// 1) shareOrDownloadPng(dataUrlString, "file.png")
// 2) shareOrDownloadPng(blob, { filename, title, text })
//
// Uses Web Share API (iOS/Android share sheet) when available, otherwise downloads.

function dataUrlToBlob(dataUrl) {
  const [head, body] = String(dataUrl).split(",");
  const mime = (head.match(/data:([^;]+);base64/i) || [])[1] || "image/png";
  const binStr = atob(body || "");
  const len = binStr.length;
  const arr = new Uint8Array(len);
  for (let i = 0; i < len; i++) arr[i] = binStr.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export async function shareOrDownloadPng(png, arg2) {
  let blob;
  let opts;

  if (typeof png === "string") {
    blob = dataUrlToBlob(png);
    opts = { filename: typeof arg2 === "string" ? arg2 : "slimcalAI.png" };
  } else if (png instanceof Blob) {
    blob = png;
    opts = (arg2 && typeof arg2 === "object") ? arg2 : {};
  } else {
    throw new Error("shareOrDownloadPng expected a dataURL string or a Blob");
  }

  const {
    filename = "slimcalAI.png",
    title = "Slimcal AI",
    text = "#slimcalAI",
  } = opts;

  // Important: iOS/Instagram prefer a real .png filename and image/png mime
  const file = new File([blob], filename, { type: "image/png" });

  const canWebShare = !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));
  if (canWebShare) {
    try {
      // Don't include url when sharing files — some targets reject.
      await navigator.share({ title, text, files: [file] });
      return { ok: true, method: "share" };
    } catch (err) {
      // user canceled or target rejected; fall back to download
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return { ok: true, method: "download" };
  } finally {
    URL.revokeObjectURL(url);
  }
}
