/**
 * Proxy routing — all external content goes through our server-side proxy
 * to bypass CORS, geo-blocks, CloudFront restrictions, CDN blocks, etc.
 * 
 * The server proxy spoofs headers, IPs, and User-Agents to appear as
 * a regular browser from an allowed region.
 */

/**
 * Wrap a stream URL through the proxy.
 * For HLS, the proxy also rewrites the M3U8 manifest so all segments
 * and sub-playlists go through the proxy too.
 */
export function proxyStreamUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("/api/proxy") || url.startsWith("blob:") || url.startsWith("data:")) return url;
  return `/api/proxy?url=${encodeURIComponent(url)}`;
}

/**
 * Wrap an image URL through the image proxy (with caching).
 */
export function proxyImageUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("/") || url.startsWith("blob:") || url.startsWith("data:")) return url;
  return `/api/proxy/image?url=${encodeURIComponent(url)}`;
}

/**
 * Fetch text content (M3U playlists, Xtream APIs) through the proxy.
 * Goes through the server proxy which handles geo-bypass headers.
 * Falls back to public CORS proxies if our server proxy fails.
 */
export async function fetchWithCorsRetry(url: string): Promise<string> {
  // Try through our own server proxy first (best geo-bypass)
  try {
    const proxyRes = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(45000),
    });
    if (proxyRes.ok) {
      const text = await proxyRes.text();
      if (text.length > 0) return text;
    }
  } catch {
    // Fall through to alternatives
  }

  // Try direct fetch (might work for non-blocked URLs)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (res.ok) return await res.text();
  } catch {
    // Fall through
  }

  // Try public CORS proxies as last resort
  const CORS_PROXIES = [
    (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  ];

  for (const proxyFn of CORS_PROXIES) {
    try {
      const res = await fetch(proxyFn(url), { signal: AbortSignal.timeout(20000) });
      if (res.ok) {
        const text = await res.text();
        if (text.length > 0) return text;
      }
    } catch { continue; }
  }

  throw new Error("Impossible de télécharger. Tous les moyens d'accès ont échoué.");
}
