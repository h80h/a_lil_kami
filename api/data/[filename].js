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
    
    // List all blobs to find the actual URL
    const listResponse = await fetch('https://blob.vercel-storage.com', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!listResponse.ok) {
      throw new Error(`Failed to list blobs: ${listResponse.status}`);
    }
    
    const listData = await listResponse.json();
    
    // Find the blob with matching pathname (just the filename, no path)
    const blob = listData.blobs?.find(b => {
      const blobFilename = b.pathname.split('/').pop(); // Get just filename
      return blobFilename === filename;
    });
    
    if (!blob) {
      return res.status(404).json({ 
        error: 'File not found',
        filename: filename,
        availableFiles: listData.blobs?.map(b => b.pathname) || [],
        message: 'Data has not been extracted yet. Check GitHub Actions or try again in a few minutes.'
      });
    }
    
    // Fetch using the actual public blob URL (no auth needed for public blobs)
    const response = await fetch(blob.url);
    
    if (!response.ok) {
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