// api/heartbeat.js
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase using environment variables set in Vercel
const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY 
);

export default async function handler(req, res) {
  // Add CORS headers so your frontend can talk to this API
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Call the database function
    const { data, error } = await supabase.rpc('get_live_user_count');
    
    if (error) {
      console.error("Supabase RPC Error:", error);
      throw error;
    }

    /**
     * CLEANING THE DATA:
     * If the DB returns an object like { count: 2 }, we extract just the number.
     * If it returns a plain number, we use that.
     */
    const finalCount = (data && typeof data === 'object') ? data.count : data;

    // Return a clean, flat JSON object: { "count": X }
    return res.status(200).json({ count: finalCount });

  } catch (err) {
    console.error('Heartbeat API Error:', err.message);
    return res.status(500).json({ 
      error: "Failed to fetch stats", 
      details: err.message 
    });
  }
}