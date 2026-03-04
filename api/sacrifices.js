// api/sacrifices.js
export default async function handler(req, res) {
  const sacrifice_key = process.env.SACRIFICE_KEY; 
  if (!sacrifice_key) {
    return res.status(500).json({ error: "API Key missing." });
  }

  const origin = req.headers.origin;
  const allowedOriginsStr = process.env.ALLOWED_ORIGINS || "https://kami.h80h.xyz";
  const allowedOrigins = allowedOriginsStr.split(',').map(o => o.trim());

  const isAllowed = allowedOrigins.includes(origin);

  // Set Dynamic CORS
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://kami.h80h.xyz');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Vary', 'Origin');

  // --- CACHING LAYER ---
  // Cache for 60 seconds on the user's browser, 
  // and 5 minutes on Vercel's Edge network.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Block unauthorized domains (on production only)
  if (!isAllowed && process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: "Access Denied" });
  }

  try {
    const response = await fetch("https://kamistats.com/api/sacrifices", {
      headers: {
        'Authorization': `Bearer ${sacrifice_key}`,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) throw new Error(`Provider responded with ${response.status}`);
    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Proxy Error:', error.message);
    return res.status(500).json({ error: "Failed to fetch from provider." });
  }
}