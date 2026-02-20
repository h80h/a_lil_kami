export default async function handler(req, res) {
  // This works on Vercel AND locally (if using 'vercel dev')
  const sacrifice_key = process.env.SACRIFICE_KEY; 
  
  if (!sacrifice_key) {
    return res.status(500).json({ 
        error: "API Key missing. Add SACRIFICE_KEY to Vercel Dashboard or .env file." 
    });
  }

  try {
    const response = await fetch("https://kamistats.com/api/sacrifices", {
      headers: {
        'Authorization': `Bearer ${sacrifice_key}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: "Proxy fetch failed" });
  }
}