export function showAppToast(message, severity = "info") {
  try {
    window.dispatchEvent(new CustomEvent("slimcal:toast", {
      detail: { message: String(message || ""), severity: severity || "info" }
    }));
  } catch {}
}
