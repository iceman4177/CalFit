export default function handler(req, res) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY;
  res.status(200).json({
    ok: true,
    method: req.method,
    hasUrl: !!url,
    hasServiceRole: !!srk,
  });
}
