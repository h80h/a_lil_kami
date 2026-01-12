// api/data/[filename].js
// This API route serves JSON data from Vercel Blob Storage to your website

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
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    
    if (!token) {
      console.error('BLOB_READ_WRITE_TOKEN not set');
      return res.status(500).json({ 
        error: 'Configuration error',
        message: 'Storage token not configured'
      });
    }
    
    // Fetch from Vercel Blob Storage
    const blobUrl = `https://blob.vercel-storage.com/${filename}`;
    
    const response = await fetch(blobUrl, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        return res.status(404).json({ 
          error: 'File not found',
          filename: filename,
          message: 'Data has not been extracted yet. Please wait for the first GitHub Actions run or check if the extraction succeeded.'
        });
      }
      
      throw new Error(`Blob fetch failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Set cache headers for performance
    // Cache for 5 minutes (300 seconds), but allow stale content for 1 hour while revalidating
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.setHeader('Content-Type', 'application/json');
    
    // Enable CORS (allows your frontend to access this API)
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