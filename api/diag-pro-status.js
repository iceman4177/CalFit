// /api/diag-pro-status.js
export default async function handler(req, res) {
  try {
    const out = {
      has_SUPABASE_URL: !!process.env.SUPABASE_URL,
      has_SERVICE_ROLE: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      node: process.versions?.node,
      envNote: "Vars must be defined for the environment serving slimcal.ai (usually Production).",
    };
    // Optional: attempt a trivial query if both vars exist
    if (out.has_SUPABASE_URL && out.has_SERVICE_ROLE) {
      const { createClient } = await import("@supabase/supabase-js");
      const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { data, error } = await supa.from("app_stripe_customers").select("customer_id").limit(1);
      out.supaOk = !error;
      if (error) out.supaError = error.message;
      if (data) out.sample = data;
    }
    res.status(200).json(out);
  } catch (e) {
    res.status(200).json({ fatal: e?.message || String(e) });
  }
}
