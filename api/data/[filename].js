// api/data/[filename].js
// Vercel API route — proxies kamiBundle.json straight from Cloudflare R2.
// No JSON parsing, no in-memory cache: the raw bytes are streamed to the client.
// Vercel's edge cache (s-maxage) handles repeated requests at the CDN layer.

const ALLOWED_FILES = new Set([
  'kamiBundle.json', // full bundle — the only file the browser now requests
  // Individual section filenames kept here so old/debug URLs get a clear error
  // rather than a generic 400. Remove if you never need them.
  'kamiImage.json',
  'kamiTraits.json',
  'kamiStats.json',
  'kamiRankings.json',
  'kamiMetadata.json',
]);

// Only the bundle is served — individual section requests get a clear message.
const BUNDLE_ONLY_MESSAGE =
  'Individual section files are no longer served separately. ' +
  'Request kamiBundle.json instead.';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { filename } = req.query;

  if (!ALLOWED_FILES.has(filename)) {
    return res.status(400).json({
      error: 'Invalid filename',
      message: 'File not allowed',
      allowedFiles: Array.from(ALLOWED_FILES),
    });
  }

  // Only the bundle is proxied — section filenames are allowed in the set
  // so they return a helpful error rather than the generic 400 above.
  if (filename !== 'kamiBundle.json') {
    return res.status(410).json({
      error: 'Gone',
      message: BUNDLE_ONLY_MESSAGE,
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
    const r2Response = await fetch(`${r2PublicUrl}/kamiBundle.json`);

    if (!r2Response.ok) {
      if (r2Response.status === 404) {
        return res.status(404).json({
          error: 'Bundle not found',
          message: 'kamiBundle.json has not been extracted yet. Check GitHub Actions or try again shortly.',
        });
      }
      throw new Error(`R2 responded with ${r2Response.status} ${r2Response.statusText}`);
    }

    // Let Vercel's CDN cache the response for 5 minutes;
    // serve stale for up to 1 hour while revalidating in the background.
    // No bytes are held in this function's memory between requests.
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    res.setHeader('Content-Type', 'application/json');

    // Stream the raw bytes straight through — never parse the JSON here.
    const body = await r2Response.arrayBuffer();
    res.status(200).send(Buffer.from(body));

  } catch (error) {
    console.error('Error proxying kamiBundle.json:', error.message);
    return res.status(500).json({
      error: 'Failed to fetch bundle',
      message: error.message,
    });
  }
}