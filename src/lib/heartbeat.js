// /src/lib/heartbeat.js
export async function sendHeartbeat({ id, email, provider, display_name, last_client }) {
  try {
    const res = await fetch("/api/users/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, email, provider, display_name, last_client }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
