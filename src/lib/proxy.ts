/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  STREAMVAULT — CLIENT PROXY ULTRA-AVANCÉ                                    ║
 * ║  Bypass CORS, Geo-blocks, WAF, avec fallback multi-niveaux                 ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

// ─── Cache local pour les playlists ────────────────────────────────────────────
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const playlistCache = new Map<string, { content: string; timestamp: number }>();

// ─── Proxy CORS publics avec rotation ─────────────────────────────────────────
const CORS_PROXIES = [
  (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  (u: string) => `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(u)}`,
  (u: string) => `https://cors-anywhere.herokuapp.com/${u}`,
  (u: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}&raw=true`,
];

// ─── User-Agents supplémentaires pour le client ───────────────────────────────
const CLIENT_UAS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Wrap un stream URL via le proxy serveur
 */
export function proxyStreamUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("/api/proxy") || url.startsWith("blob:") || url.startsWith("data:")) return url;
  return `/api/proxy?url=${encodeURIComponent(url)}`;
}

/**
 * Wrap une image via le proxy image
 */
export function proxyImageUrl(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("/") || url.startsWith("blob:") || url.startsWith("data:")) return url;
  return `/api/proxy/image?url=${encodeURIComponent(url)}`;
}

/**
 * Fetch avec retry exponentiel, rotation de headers, et fallback CORS
 */
export async function fetchWithCorsRetry(
  url: string,
  opts?: { retries?: number; timeout?: number; useCache?: boolean }
): Promise<string> {
  const retries = opts?.retries ?? 3;
  const timeout = opts?.timeout ?? 45000;
  const useCache = opts?.useCache ?? true;

  // Vérifier cache
  if (useCache) {
    const cached = playlistCache.get(url);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.content;
    }
  }

  // Tentative 1: Proxy serveur avec retry exponentiel
  for (let i = 0; i < retries; i++) {
    try {
      const proxyRes = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(timeout),
        headers: {
          "X-Client-Version": "2.0",
          "X-Request-ID": crypto.randomUUID(),
        },
      });
      if (proxyRes.ok) {
        const text = await proxyRes.text();
        if (text.length > 0) {
          if (useCache) playlistCache.set(url, { content: text, timestamp: Date.now() });
          return text;
        }
      }
    } catch {
      // Backoff exponentiel avec jitter
      if (i < retries - 1) {
        await sleep(Math.min(Math.pow(2, i) * 500 + Math.random() * 500, 5000));
      }
    }
  }

  // Tentative 2: Direct fetch avec headers alternatifs
  for (const ua of CLIENT_UAS) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: {
          "User-Agent": ua,
          "Accept": "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": new URL(url).origin + "/",
        },
      });
      if (res.ok) {
        const text = await res.text();
        if (text.length > 0) {
          if (useCache) playlistCache.set(url, { content: text, timestamp: Date.now() });
          return text;
        }
      }
    } catch { continue; }
  }

  // Tentative 3: CORS proxies publics
  for (const proxyFn of CORS_PROXIES) {
    try {
      const res = await fetch(proxyFn(url), {
        signal: AbortSignal.timeout(20000),
        headers: { "X-Requested-With": "XMLHttpRequest" },
      });
      if (res.ok) {
        const text = await res.text();
        if (text.length > 0) {
          if (useCache) playlistCache.set(url, { content: text, timestamp: Date.now() });
          return text;
        }
      }
    } catch { continue; }
  }

  throw new Error("Impossible de télécharger. Tous les moyens d'accès ont échoué.");
}

/**
 * Vérifier si un stream est accessible (HEAD request)
 */
export async function checkStreamAvailability(url: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, {
      method: "HEAD",
      signal: AbortSignal.timeout(10000),
    });
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}

/**
 * Précharger un segment HLS en cache
 */
export async function prefetchSegment(url: string): Promise<void> {
  try {
    await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(15000),
      priority: "low",
    });
  } catch { /* ignore */ }
}

/**
 * Détecte les URLs vavoo.to / vavoo.tv à résoudre côté serveur avant lecture.
 */
export function isVavooUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)vavoo\.(to|tv)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Résout un lien vavoo.to en URL de flux HLS finale via /api/vavoo.
 * Renvoie l'URL originale en cas d'échec (le proxy tentera son propre bypass).
 */
export async function resolveVavooUrl(url: string): Promise<string> {
  if (!isVavooUrl(url)) return url;
  try {
    const res = await fetch(`/api/vavoo?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return url;
    const data = await res.json();
    return typeof data?.url === "string" && data.url ? data.url : url;
  } catch {
    return url;
  }
}
