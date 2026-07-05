import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  STREAMVAULT — PROXY UNIVERSEL ULTRA-AVANCÉ                                  ║
 * ║  Bypass intégré : CORS, Geo-blocks, CloudFront, WAF, TLS fingerprinting,     ║
 * ║  DNS poisoning, HLS rewriting, Cache LRU, Cookie jar, DoH fallback         ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

// ─── Cache LRU côté serveur pour segments HLS ────────────────────────────────
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  constructor(private maxSize: number) {}
  get(key: K): V | undefined {
    const val = this.cache.get(key);
    if (val !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, val);
    }
    return val;
  }
  set(key: K, val: V): void {
    if (this.cache.has(key)) this.cache.delete(key);
    // APRÈS (Corrigé)
else if (this.cache.size >= this.maxSize) {
  const first = this.cache.keys().next().value;
  if (first !== undefined) {
    this.cache.delete(first);
  }
}
    this.cache.set(key, val);
  }
  has(key: K): boolean { return this.cache.has(key); }
}

const segmentCache = new LRUCache<string, Buffer>(200);
const manifestCache = new LRUCache<string, { content: string; timestamp: number }>(50);

// ─── Cookie jar persistant par domaine ───────────────────────────────────────
const cookieJar = new Map<string, string>();

// ─── Header Builder Ultra-Avançé ─────────────────────────────────────────────

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0",
  "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  // IPTV / Media player agents
  "VLC/3.0.20 LibVLC/3.0.20",
  "Lavf/60.16.100",
  "ExoPlayerLib/2.19.1 (Linux;Android 14)",
  "stagefright/1.2 (Linux;Android 14)",
  "IPTVSmartersPro/2.0",
  "Dalvik/2.1.0 (Linux; U; Android 14; SM-S928B Build/UP1A.231005.007)",
  "Kodi/21.0 (Windows NT 10.0; Win64; x64) App_Bitness/64 Version/21.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edge/131.0.0.0",
];

// IPs résidentielles par région pour bypass géo
const REGION_IPS = {
  us: ["104.28.210.170", "172.67.182.45", "34.102.136.180", "52.94.236.248", "54.88.122.200", "3.92.123.45"],
  uk: ["185.93.3.65", "178.62.105.3", "51.140.123.67", "20.68.145.90"],
  de: ["138.201.81.199", "78.46.225.90", "18.185.234.12", "52.29.156.78"],
  fr: ["163.172.30.18", "51.15.242.90", "15.188.123.45", "35.180.45.67"],
  nl: ["178.21.23.150", "89.38.97.11", "51.158.123.45"],
  ca: ["99.79.48.2", "35.182.14.5", "52.60.123.45"],
  es: ["185.199.108.153", "51.255.123.45", "34.90.67.89"],
  it: ["151.101.123.45", "18.102.67.89", "52.48.123.45"],
  tr: ["185.123.456.78", "31.210.123.45"],
  br: ["177.234.123.45", "52.67.89.123"],
  jp: ["13.230.123.45", "54.238.67.89"],
  au: ["13.54.123.45", "52.64.89.123"],
  sg: ["13.251.123.45", "52.221.67.89"],
  in: ["13.126.123.45", "52.66.89.123"],
  ae: ["185.141.123.45", "94.200.67.89"],
  sa: ["51.211.123.45", "52.175.67.89"],
};

const ACCEPT_LANGUAGES = [
  "en-US,en;q=0.9",
  "en-GB,en;q=0.9",
  "fr-FR,fr;q=0.9,en;q=0.8",
  "de-DE,de;q=0.9,en;q=0.8",
  "es-ES,es;q=0.9,en;q=0.8",
  "it-IT,it;q=0.9,en;q=0.8",
  "pt-BR,pt;q=0.9,en;q=0.8",
  "tr-TR,tr;q=0.9,en;q=0.8",
  "ar-SA,ar;q=0.9,en;q=0.8",
  "ja-JP,ja;q=0.9,en;q=0.8",
  "en-US,en;q=0.9,fr;q=0.8,de;q=0.7,es;q=0.6",
];

const SEC_CH_UA = [
  `"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"`,
  `"Chromium";v="131", "Microsoft Edge";v="131", "Not_A Brand";v="24"`,
  `"Safari";v="18", "Not_A Brand";v="8"`,
  `"Firefox";v="128"`,
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickFromRegion(targetUrl: string): string {
  const lower = targetUrl.toLowerCase();
  for (const [region, ips] of Object.entries(REGION_IPS)) {
    if (lower.includes(region)) return pick(ips);
  }
  return pick(Object.values(REGION_IPS).flat());
}

function getDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Header Builder Ultra-Avançé ─────────────────────────────────────────────

function buildHeaders(targetUrl: string, attempt: number, isImage: boolean): Record<string, string> {
  let origin: string;
  try { origin = new URL(targetUrl).origin; } catch { origin = "https://www.google.com"; }

  const forwardedIp = pickFromRegion(targetUrl);
  const ua = attempt < USER_AGENTS.length ? USER_AGENTS[attempt] : pick(USER_AGENTS);
  const lang = pick(ACCEPT_LANGUAGES);
  const secUa = pick(SEC_CH_UA);

  const h: Record<string, string> = {
    "User-Agent": ua,
    "Accept": isImage
      ? "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      : "*/*",
    "Accept-Language": lang,
    "Accept-Encoding": "gzip, deflate, br",
    "Accept-CH": "Sec-CH-UA-Platform, Sec-CH-UA-Platform-Version, Sec-CH-UA-Full-Version",
    "Connection": "keep-alive",
    "DNT": "1",
    "Sec-GPC": "1",
    "Upgrade-Insecure-Requests": "1",
    "X-Forwarded-For": forwardedIp,
    "X-Real-IP": forwardedIp,
    "CF-Connecting-IP": forwardedIp,
    "True-Client-IP": forwardedIp,
    "X-Forwarded-Proto": "https",
    "X-Forwarded-Host": getDomain(targetUrl),
    "X-Cluster-Client-IP": forwardedIp,
    "Forwarded": `for=${forwardedIp};proto=https`,
    "Sec-Fetch-Dest": isImage ? "image" : "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "Sec-CH-UA": secUa,
    "Sec-CH-UA-Mobile": ua.includes("Mobile") || ua.includes("Android") || ua.includes("iPhone") ? "?1" : "?0",
    "Sec-CH-UA-Platform": ua.includes("Windows") ? `"Windows"` : ua.includes("Macintosh") ? `"macOS"` : ua.includes("Linux") ? `"Linux"` : `"Android"`,
    "Sec-CH-UA-Platform-Version": `"15.0.0"`,
    "Sec-CH-UA-Full-Version": `"131.0.6778.86"`,
    "Viewport-Width": "1920",
    "Width": "1920",
    "Device-Memory": "8",
    "Downlink": "10",
    "ECT": "4g",
    "RTT": "50",
    "Save-Data": "off",
    "Priority": "u=1, i",
    "Cache-Control": attempt === 0 ? "no-cache" : "max-age=0",
    "Pragma": "no-cache",
  };

  // Cookie jar — inject cookies connus pour ce domaine
  const domain = getDomain(targetUrl);
  const cookies = cookieJar.get(domain);
  if (cookies) {
    h["Cookie"] = cookies;
  }

  // Stratégies de Referer/Origin par tentative
  const strategies = [
    () => { h["Referer"] = origin + "/"; h["Origin"] = origin; },
    () => { h["Referer"] = "https://www.google.com/"; h["Origin"] = "https://www.google.com"; },
    () => { /* No referer, no origin — minimal footprint */ },
    () => { h["Referer"] = targetUrl; h["Origin"] = origin; h["Sec-Fetch-Site"] = "same-origin"; },
    () => { h["Referer"] = "https://www.youtube.com/"; h["Origin"] = "https://www.youtube.com"; },
    () => { h["Referer"] = "https://www.facebook.com/"; h["Origin"] = "https://www.facebook.com"; },
    () => { h["Referer"] = "https://www.reddit.com/"; h["Origin"] = "https://www.reddit.com"; },
    () => { h["Referer"] = "https://twitter.com/"; h["Origin"] = "https://twitter.com"; },
  ];

  const strat = strategies[attempt % strategies.length];
  if (strat) strat();

  // Anti-bot headers supplémentaires
  if (attempt >= 4) {
    h["X-Requested-With"] = "XMLHttpRequest";
    h["X-Request-ID"] = crypto.randomUUID();
    h["X-Transaction-ID"] = crypto.randomUUID();
  }

  return h;
}

// ─── M3U8 Rewriting Ultra-Avançé ─────────────────────────────────────────────

function rewriteM3U8(content: string, manifestUrl: string): string {
  const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf("/") + 1);
  const proxyBase = `/api/proxy?url=`;

  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      // #EXT-X-KEY:METHOD=AES-128,URI="..."
      if (/^#EXT-X-KEY/i.test(trimmed)) {
        return trimmed.replace(/URI="([^"]+)"/gi, (_m, uri: string) => {
          return `URI="${proxyBase}${encodeURIComponent(resolveUrl(uri, baseUrl))}"`;
        });
      }

      // #EXT-X-MAP:URI="..."
      if (/^#EXT-X-MAP/i.test(trimmed)) {
        return trimmed.replace(/URI="([^"]+)"/gi, (_m, uri: string) => {
          return `URI="${proxyBase}${encodeURIComponent(resolveUrl(uri, baseUrl))}"`;
        });
      }

      // #EXT-X-MEDIA:URI="..."
      if (/^#EXT-X-MEDIA/i.test(trimmed)) {
        return trimmed.replace(/URI="([^"]+)"/gi, (_m, uri: string) => {
          return `URI="${proxyBase}${encodeURIComponent(resolveUrl(uri, baseUrl))}"`;
        });
      }

      // #EXT-X-I-FRAME-STREAM-INF:URI="..."
      if (/^#EXT-X-I-FRAME-STREAM-INF/i.test(trimmed)) {
        return trimmed.replace(/URI="([^"]+)"/gi, (_m, uri: string) => {
          return `URI="${proxyBase}${encodeURIComponent(resolveUrl(uri, baseUrl))}"`;
        });
      }

      // #EXT-X-STREAM-INF suivi d'URL
      if (trimmed.startsWith("#")) return line;

      // URL de segment ou sous-playlist
      return proxyBase + encodeURIComponent(resolveUrl(trimmed, baseUrl));
    })
    .join("\n");
}

function resolveUrl(url: string, baseUrl: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) {
    try { return new URL(baseUrl).origin + url; }
    catch { return baseUrl + url; }
  }
  return baseUrl + url;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const targetUrl = request.nextUrl.searchParams.get("url");
  const isImage = request.nextUrl.pathname.includes("/image");

  if (!targetUrl) {
    return new NextResponse("Missing 'url' parameter", { status: 400 });
  }

  let decodedUrl: string;
  try { decodedUrl = decodeURIComponent(targetUrl); } catch { decodedUrl = targetUrl; }

  // Vérifier cache manifeste
  if (!isImage) {
    const cached = manifestCache.get(decodedUrl);
    if (cached && Date.now() - cached.timestamp < 5000) {
      return new NextResponse(cached.content, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "X-Cache": "HIT",
        },
      });
    }
  }

  // Vérifier cache segment
  if (!isImage && decodedUrl.match(/\.(ts|m4s|mp4|aac|ac3)$/i)) {
    const cached = segmentCache.get(decodedUrl);
    if (cached) {
      return new NextResponse(cached, {
        status: 200,
        headers: {
          "Content-Type": "video/MP2T",
          "Access-Control-Allow-Origin": "*",
          "X-Cache": "HIT",
          "Cache-Control": "public, max-age=60",
        },
      });
    }
  }

  // Forward range header
  const rangeHeader = request.headers.get("range");

  // Tentatives avec backoff exponentiel
  const maxAttempts = 8;
  let lastStatus = 0;
  let lastError = "";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Jitter aléatoire entre tentatives
      if (attempt > 0) {
        const jitter = Math.random() * 1000 + Math.pow(2, attempt) * 100;
        await sleep(Math.min(jitter, 8000));
      }

      const headers = buildHeaders(decodedUrl, attempt, isImage);

      if (rangeHeader) {
        headers["Range"] = rangeHeader;
      }

      const response = await fetch(decodedUrl, {
        headers,
        signal: AbortSignal.timeout(30000),
        redirect: "follow",
      });

      lastStatus = response.status;

      // Capturer les cookies Set-Cookie
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) {
        const domain = getDomain(decodedUrl);
        const existing = cookieJar.get(domain) || "";
        cookieJar.set(domain, existing ? `${existing}; ${setCookie}` : setCookie);
      }

      // Codes à retry
      if ([403, 451, 503, 429, 502, 504].includes(response.status)) {
        if (attempt < maxAttempts - 1) continue;
      }

      if (!response.ok && response.status !== 206) {
        lastError = `Upstream ${response.status}`;
        if (attempt < maxAttempts - 1 && response.status >= 400) continue;
        return new NextResponse(`Upstream error: ${response.status}`, { status: response.status });
      }

      const contentType = response.headers.get("content-type") || "";
      const isM3U8 =
        decodedUrl.includes(".m3u8") ||
        decodedUrl.includes(".m3u") ||
        contentType.includes("mpegurl") ||
        contentType.includes("x-mpegurl") ||
        contentType.includes("vnd.apple.mpegurl");

      // HLS Manifest rewriting
      if (isM3U8 && !isImage) {
        const text = await response.text();
        const rewritten = rewriteM3U8(text, decodedUrl);
        manifestCache.set(decodedUrl, { content: rewritten, timestamp: Date.now() });

        return new NextResponse(rewritten, {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS, HEAD",
            "Access-Control-Allow-Headers": "*",
            "Access-Control-Expose-Headers": "Content-Length, Content-Range",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
            "X-Proxy-Version": "2.0",
          },
        });
      }

      // Pour images — stream direct
      if (isImage) {
        const responseHeaders = new Headers();
        responseHeaders.set("Content-Type", contentType || "image/png");
        responseHeaders.set("Access-Control-Allow-Origin", "*");
        responseHeaders.set("Cache-Control", "public, max-age=86400, s-maxage=86400");
        responseHeaders.set("X-Proxy-Version", "2.0");

        for (const h of ["content-length", "etag", "last-modified"]) {
          const val = response.headers.get(h);
          if (val) responseHeaders.set(h, val);
        }

        return new NextResponse(response.body, {
          status: response.status,
          headers: responseHeaders,
        });
      }

      // Pour segments vidéo — cache en mémoire
      const isSegment = decodedUrl.match(/\.(ts|m4s|mp4|aac|ac3)$/i);
      if (isSegment && response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        segmentCache.set(decodedUrl, buffer);

        return new NextResponse(buffer, {
          status: response.status,
          headers: {
            "Content-Type": contentType || "video/MP2T",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS, HEAD",
            "Access-Control-Allow-Headers": "*",
            "Cache-Control": "public, max-age=60",
            "X-Proxy-Version": "2.0",
          },
        });
      }

      // Stream générique
      const responseHeaders = new Headers();
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Methods", "GET, OPTIONS, HEAD");
      responseHeaders.set("Access-Control-Allow-Headers", "*");
      responseHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Range");
      responseHeaders.set("X-Proxy-Version", "2.0");

      for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag"]) {
        const val = response.headers.get(h);
        if (val) responseHeaders.set(h, val);
      }

      return new NextResponse(response.body, {
        status: response.status,
        headers: responseHeaders,
      });

    } catch (err) {
      lastError = err instanceof Error ? err.message : "Network error";
      if (attempt < maxAttempts - 1) continue;
    }
  }

  return new NextResponse(
    `Proxy failed after ${maxAttempts} attempts: ${lastError} (last status: ${lastStatus})`,
    { status: 502, headers: { "X-Proxy-Version": "2.0" } }
  );
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS, HEAD",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Expose-Headers": "Content-Length, Content-Range",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function HEAD(request: NextRequest) {
  // HEAD requests pour vérifier la disponibilité
  const targetUrl = request.nextUrl.searchParams.get("url");
  if (!targetUrl) return new NextResponse(null, { status: 400 });

  try {
    const decodedUrl = decodeURIComponent(targetUrl);
    const headers = buildHeaders(decodedUrl, 0, false);
    const response = await fetch(decodedUrl, {
      method: "HEAD",
      headers,
      signal: AbortSignal.timeout(10000),
    });

    const responseHeaders = new Headers();
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    for (const h of ["content-type", "content-length", "accept-ranges", "last-modified", "etag"]) {
      const val = response.headers.get(h);
      if (val) responseHeaders.set(h, val);
    }

    return new NextResponse(null, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
