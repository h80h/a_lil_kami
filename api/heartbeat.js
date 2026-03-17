// api/heartbeat.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY 
);

export default async function handler(req, res) {
  const origin = req.headers.origin;
  const allowedOriginsStr = process.env.ALLOWED_ORIGINS || "https://kami.h80h.xyz";
  const allowedOrigins = allowedOriginsStr.split(',').map(o => o.trim());

  const safeOrigin = (origin && allowedOrigins.includes(origin)) ? origin : "https://kami.h80h.xyz";

  res.setHeader('Access-Control-Allow-Origin', safeOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Cache-Control', 'public, s-maxage=1, stale-while-revalidate=9');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { data, error } = await supabase.rpc('get_live_user_count');
    if (error) throw error;
    const finalCount = (data && typeof data === 'object') ? data.count : data;
    return res.status(200).json({ count: finalCount });
  } catch (err) {
    console.error('Heartbeat API Error:', err.message);
    return res.status(500).json({ error: "Failed to fetch stats", details: err.message });
  }
}