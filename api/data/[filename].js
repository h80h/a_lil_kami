// api/data/[filename].js
// Vercel API route to serve JSON data from Cloudflare R2 bundle

// Map of allowed filenames to their key inside the bundle
const ALLOWED_FILES = {
  'kamiImage.json':    'kamiImage',
  'kamiTraits.json':   'kamiTraits',
  'kamiStats.json':    'kamiStats',
  'kamiRankings.json': 'kamiRankings',
  'kamiMetadata.json': 'kamiMetadata',
};

// In-memory bundle cache to avoid re-fetching the bundle for every request
// The cache is scoped to the serverless function instance lifetime
let bundleCache = null;
let bundleCacheTime = 0;
const BUNDLE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes, matching R2 CacheControl

/**
 * Fetch the full bundle from R2 and cache it in memory
 */
async function getBundle(r2PublicUrl) {
  const now = Date.now();

  if (bundleCache && (now - bundleCacheTime) < BUNDLE_CACHE_TTL_MS) {
    return bundleCache;
  }

  const bundleUrl = `${r2PublicUrl}/kamiBundle.json`;
  const response = await fetch(bundleUrl);

  if (!response.ok) {
    if (response.status === 404) {
      const err = new Error('Bundle not found. Data has not been extracted yet. Check GitHub Actions or try again in a few minutes.');
      err.status = 404;
      throw err;
    }
    const err = new Error(`R2 bundle fetch failed: ${response.status} ${response.statusText}`);
    err.status = 502;
    throw err;
  }

  bundleCache = await response.json();
  bundleCacheTime = now;
  return bundleCache;
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle OPTIONS request (for CORS preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { filename } = req.query;

  // Only allow these specific files (security)
  if (!ALLOWED_FILES.hasOwnProperty(filename)) {
    return res.status(400).json({
      error: 'Invalid filename',
      message: 'File not allowed',
      allowedFiles: Object.keys(ALLOWED_FILES),
    });
  }

  const r2PublicUrl = process.env.R2_PUBLIC_URL;

  if (!r2PublicUrl) {
    console.error('R2_PUBLIC_URL not set');
    return res.status(500).json({
      error: 'Configuration error',
      message: 'R2 public URL not configured',
    });
  }

  try {
    const bundle = await getBundle(r2PublicUrl);

    const bundleKey = ALLOWED_FILES[filename];
    const sectionData = bundle[bundleKey];

    if (sectionData === undefined || sectionData === null) {
      return res.status(404).json({
        error: 'Section not found in bundle',
        filename: filename,
        message: `The bundle exists but does not contain the section "${bundleKey}". Try re-running the extraction.`,
      });
    }

    // Cache for 5 minutes, allow stale for 1 hour while revalidating
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.setHeader('Content-Type', 'application/json');

    return res.status(200).json(sectionData);

  } catch (error) {
    console.error(`Error serving ${filename}:`, error.message);

    const statusCode = error.status || 500;
    return res.status(statusCode).json({
      error: statusCode === 404 ? 'File not found' : 'Failed to fetch data',
      message: error.message,
      filename: filename,
    });
  }
}