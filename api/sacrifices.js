export default async function handler(req, res) {
  const sacrifice_key = process.env.SACRIFICE_KEY; 
  
  if (!sacrifice_key) {
    return res.status(500).json({ error: "API Key missing in Vercel Environment Variables." });
  }

  // --- SECURITY LAYER: REFERER CHECK ---
  const referer = req.headers.referer || "";
  
  // Define allowed origins
  const isLocalhost = referer.includes('localhost') || referer.includes('127.0.0.1');
  const isOfficialSite = referer.includes('kami.h80h.xyz');

  // If the request is NOT from your site or your local machine, block it
  if (!isLocalhost && !isOfficialSite) {
    console.warn(`Blocked unauthorized access attempt from: ${referer}`);
    return res.status(403).json({ error: "Access Denied: Unauthorized Domain." });
  }

  try {
    // Talk to the provider using the hidden key
    const response = await fetch("https://kamistats.com/api/sacrifices", {
      headers: {
        'Authorization': `Bearer ${sacrifice_key}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) throw new Error(`Provider responded with ${response.status}`);

    const data = await response.json();

    // Set CORS to match the specific requester
    res.setHeader('Access-Control-Allow-Origin', isLocalhost ? '*' : 'https://kami.h80h.xyz');
    return res.status(200).json(data);

  } catch (error) {
    console.error('Proxy Error:', error.message);
    return res.status(500).json({ error: "Failed to fetch from provider." });
  }
}