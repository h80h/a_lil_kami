// api/data/[filename].js
// Vercel API route to serve JSON data from Cloudflare R2

export default async function handler(req, res) {
  const { filename } = req.query;
  
  // Only allow these specific files (security)
  const allowedFiles = [
    'kamiImage.json',
    'kamiTraits.json',
    'kamiStats.json',
    'kamiRankings.json',
    'kamiMetadata.json'
  ];
  
  // Check if requested file is allowed
  if (!allowedFiles.includes(filename)) {
    return res.status(400).json({ 
      error: 'Invalid filename',
      message: 'File not allowed',
      allowedFiles: allowedFiles
    });
  }
  
  try {
    // Fetch from Cloudflare R2 public URL
    // You'll get this URL after setting up R2 public access
    const r2PublicUrl = process.env.R2_PUBLIC_URL;
    
    if (!r2PublicUrl) {
      console.error('R2_PUBLIC_URL not set');
      return res.status(500).json({ 
        error: 'Configuration error',
        message: 'R2 public URL not configured'
      });
    }
    
    const fileUrl = `${r2PublicUrl}/${filename}`;
    
    const response = await fetch(fileUrl);
    
    if (!response.ok) {
      if (response.status === 404) {
        return res.status(404).json({ 
          error: 'File not found',
          filename: filename,
          message: 'Data has not been extracted yet. Check GitHub Actions or try again in a few minutes.'
        });
      }
      
      throw new Error(`R2 fetch failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Set cache headers for performance
    // Cache for 5 minutes, but allow stale content for 1 hour while revalidating
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.setHeader('Content-Type', 'application/json');
    
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    // Handle OPTIONS request (for CORS preflight)
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }
    
    return res.status(200).json(data);
    
  } catch (error) {
    console.error(`Error fetching ${filename}:`, error);
    return res.status(500).json({ 
      error: 'Failed to fetch data',
      message: error.message,
      filename: filename
    });
  }
}