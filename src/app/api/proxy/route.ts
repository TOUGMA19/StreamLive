import { NextRequest, NextResponse } from "next/server";
import { Agent, fetch as undiciFetch, setGlobalDispatcher } from "undici";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  STREAMVAULT — PROXY UNIVERSEL v3.0                                          ║
 * ║  Bypass : CORS · Geo · CloudFront · WAF · Cloudflare · TLS fp · DNS         ║
 * ║           HLS · Hotlink · Rate-limit · Token · IPv6 · HTTP/2 · Cache        ║
 * ║  Fallbacks : 8 profils headers · 6 CORS proxies · Wayback · Google cache    ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

// ─── Dispatcher HTTP tolérant (TLS permissif + pool keep-alive) ──────────────
const tolerantDispatcher = new Agent({
  connect: {
    rejectUnauthorized: false, // Bypass certificats expirés / self-signed IPTV
    ALPNProtocols: ["h2", "http/1.1"],
    // Randomise l'ordre TLS pour éviter le JA3 fingerprinting
    ciphers: [
      "TLS_AES_128_GCM_SHA256",
      "TLS_AES_256_GCM_SHA384",
      "TLS_CHACHA20_POLY1305_SHA256",
      "ECDHE-ECDSA-AES128-GCM-SHA256",
      "ECDHE-RSA-AES128-GCM-SHA256",
      "ECDHE-ECDSA-CHACHA20-POLY1305",
      "ECDHE-RSA-CHACHA20-POLY1305",
      "ECDHE-ECDSA-AES256-GCM-SHA384",
      "ECDHE-RSA-AES256-GCM-SHA384",
    ].sort(() => Math.random() - 0.5).join(":"),
  },
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  pipelining: 1,
  connections: 64,
  headersTimeout: 25_000,
  bodyTimeout: 45_000,
  allowH2: true,
});
setGlobalDispatcher(tolerantDispatcher);

// ─── Cache LRU côté serveur ──────────────────────────────────────────────────
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  constructor(private maxSize: number) {}
  get(key: K): V | undefined {
    const val = this.cache.get(key);
    if (val !== undefined) { this.cache.delete(key); this.cache.set(key, val); }
    return val;
  }
  set(key: K, val: V): void {
    if (this.cache.has(key)) this.cache.delete(key);
    else if (this.cache.size >= this.maxSize) {
      const first = this.cache.keys().next().value as K | undefined;
      if (first !== undefined) this.cache.delete(first);
    }
    this.cache.set(key, val);
  }
}

const segmentCache = new LRUCache<string, Buffer>(300);
const manifestCache = new LRUCache<string, { content: string; timestamp: number }>(80);
const cookieJar = new Map<string, string>();
const blockedDomains = new Map<string, number>(); // domain -> unblock timestamp
const warmupDone = new Set<string>();

// ─── Header pools ────────────────────────────────────────────────────────────
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0",
  "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  "Mozilla/5.0 (SMART-TV; LINUX; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) 94.0.4606.31/7.0 TV Safari/537.36",
  "Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.5359.215 Safari/537.36 WebAppManager",
  "VLC/3.0.20 LibVLC/3.0.20",
  "Lavf/60.16.100",
  "ExoPlayerLib/2.19.1 (Linux;Android 14)",
  "stagefright/1.2 (Linux;Android 14)",
  "IPTVSmartersPro/2.0",
  "TiviMate/4.7.0 (Linux;Android 12)",
  "GStreamer souphttpsrc libsoup/3.4.0",
  "Dalvik/2.1.0 (Linux; U; Android 14; SM-S928B Build/UP1A.231005.007)",
  "Kodi/21.0 (Windows NT 10.0; Win64; x64) App_Bitness/64 Version/21.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edge/131.0.0.0",
  "Mozilla/5.0 (PlayStation; PlayStation 5/2.26) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Safari/605.1.15",
  "AppleTV11,1/17.5.1",
  "Roku4640X/DVP-9.10 (519.10E04111A)",
];

const REGION_IPS: Record<string, string[]> = {
  us: ["104.28.210.170", "172.67.182.45", "34.102.136.180", "52.94.236.248", "54.88.122.200", "3.92.123.45", "8.8.8.8", "1.1.1.1"],
  uk: ["185.93.3.65", "178.62.105.3", "51.140.123.67", "20.68.145.90"],
  de: ["138.201.81.199", "78.46.225.90", "18.185.234.12", "52.29.156.78"],
  fr: ["163.172.30.18", "51.15.242.90", "15.188.123.45", "35.180.45.67"],
  nl: ["178.21.23.150", "89.38.97.11", "51.158.123.45"],
  ca: ["99.79.48.2", "35.182.14.5", "52.60.123.45"],
  es: ["185.199.108.153", "51.255.123.45", "34.90.67.89"],
  it: ["151.101.123.45", "18.102.67.89", "52.48.123.45"],
  tr: ["185.123.45.78", "31.210.123.45"],
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

// Referers utilisés selon la stratégie
const KNOWN_REFERERS = [
  "https://www.google.com/",
  "https://www.youtube.com/",
  "https://www.facebook.com/",
  "https://twitter.com/",
  "https://www.reddit.com/",
  "https://duckduckgo.com/",
  "https://www.bing.com/",
];

// Proxies CORS publics (dernier recours, côté serveur → serveur)
const FALLBACK_PROXIES: Array<(u: string) => string> = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  (u) => `https://thingproxy.freeboard.io/fetch/${u}`,
  (u) => `https://cors.eu.org/${u}`,
  (u) => `https://proxy.cors.sh/${u}`,
];

// Archive fallback pour playlists uniquement
function archiveFallbacks(u: string): string[] {
  return [
    `https://web.archive.org/web/2024/${u}`,
    `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(u)}`,
  ];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
function getDomain(url: string): string { try { return new URL(url).hostname; } catch { return ""; } }

function pickFromRegion(targetUrl: string): string {
  const lower = targetUrl.toLowerCase();
  for (const [region, ips] of Object.entries(REGION_IPS)) {
    if (lower.includes("." + region + "/") || lower.includes("." + region + ".") || lower.includes("/" + region + "/")) {
      return pick(ips);
    }
  }
  return pick(REGION_IPS.us); // Défaut US (accès le plus large)
}

// Détecte un contenu "challenge Cloudflare / Just a moment / bot check"
function looksBlocked(body: string, contentType: string): boolean {
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return false;
  const s = body.slice(0, 4096).toLowerCase();
  return (
    s.includes("just a moment") ||
    s.includes("checking your browser") ||
    s.includes("cf-browser-verification") ||
    s.includes("attention required") ||
    s.includes("access denied") ||
    s.includes("cloudflare") && s.includes("challenge") ||
    s.includes("bot detection") ||
    s.includes("captcha")
  );
}

// ─── Header Builder ──────────────────────────────────────────────────────────
function buildHeaders(
  targetUrl: string,
  attempt: number,
  isImage: boolean,
  userOverrides: { ua?: string; referer?: string; origin?: string } = {},
): Record<string, string> {
  let origin: string;
  try { origin = new URL(targetUrl).origin; } catch { origin = "https://www.google.com"; }

  const forwardedIp = pickFromRegion(targetUrl);
  const ua = userOverrides.ua || (attempt < USER_AGENTS.length ? USER_AGENTS[attempt] : pick(USER_AGENTS));
  const lang = pick(ACCEPT_LANGUAGES);
  const secUa = pick(SEC_CH_UA);
  const isMobile = /Mobile|Android|iPhone|iPad/.test(ua);
  const isMediaPlayer = /VLC|Lavf|ExoPlayer|stagefright|IPTV|Kodi|TiviMate|GStreamer|AppleTV|Roku/.test(ua);

  const h: Record<string, string> = {
    "User-Agent": ua,
    "Accept": isImage
      ? "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      : isMediaPlayer ? "*/*" : "application/vnd.apple.mpegurl,application/x-mpegURL,video/*,*/*;q=0.8",
    "Accept-Language": lang,
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Connection": "keep-alive",
    "DNT": "1",
    "Sec-GPC": "1",
    "X-Forwarded-For": forwardedIp,
    "X-Real-IP": forwardedIp,
    "CF-Connecting-IP": forwardedIp,
    "True-Client-IP": forwardedIp,
    "Fastly-Client-IP": forwardedIp,
    "X-Forwarded-Proto": "https",
    "X-Forwarded-Host": getDomain(targetUrl),
    "X-Cluster-Client-IP": forwardedIp,
    "X-Originating-IP": forwardedIp,
    "Client-IP": forwardedIp,
    "Via": `1.1 ${forwardedIp}`,
    "Forwarded": `for=${forwardedIp};proto=https;by=${forwardedIp}`,
  };

  // Headers spécifiques aux navigateurs (pas les players)
  if (!isMediaPlayer) {
    h["Upgrade-Insecure-Requests"] = "1";
    h["Sec-Fetch-Dest"] = isImage ? "image" : "empty";
    h["Sec-Fetch-Mode"] = "cors";
    h["Sec-Fetch-Site"] = "cross-site";
    h["Sec-CH-UA"] = secUa;
    h["Sec-CH-UA-Mobile"] = isMobile ? "?1" : "?0";
    h["Sec-CH-UA-Platform"] = ua.includes("Windows") ? `"Windows"` : ua.includes("Macintosh") ? `"macOS"` : ua.includes("iPhone") || ua.includes("iPad") ? `"iOS"` : ua.includes("Android") ? `"Android"` : `"Linux"`;
    h["Sec-CH-UA-Platform-Version"] = `"15.0.0"`;
    h["Sec-CH-UA-Full-Version"] = `"131.0.6778.86"`;
    h["Priority"] = "u=1, i";
  }

  // Cookies stockés
  const domain = getDomain(targetUrl);
  const cookies = cookieJar.get(domain);
  if (cookies) h["Cookie"] = cookies;

  // Stratégies Referer/Origin par tentative
  if (userOverrides.referer) {
    h["Referer"] = userOverrides.referer;
    if (userOverrides.origin) h["Origin"] = userOverrides.origin;
  } else {
    const strategies: Array<() => void> = [
      () => { h["Referer"] = origin + "/"; h["Origin"] = origin; },
      () => { /* Aucun referer — signature player natif */ },
      () => { h["Referer"] = pick(KNOWN_REFERERS); },
      () => { h["Referer"] = targetUrl; h["Origin"] = origin; h["Sec-Fetch-Site"] = "same-origin"; },
      () => { h["Referer"] = origin; h["Origin"] = origin; },
      () => { h["Referer"] = "https://www.google.com/search?q=" + encodeURIComponent(domain); h["Origin"] = "https://www.google.com"; },
      () => { h["Referer"] = pick(KNOWN_REFERERS); h["Origin"] = new URL(h["Referer"]).origin; },
      () => { /* clean */ },
    ];
    strategies[attempt % strategies.length]?.();
  }

  if (attempt >= 4 && !isMediaPlayer) {
    h["X-Requested-With"] = "XMLHttpRequest";
    h["X-Request-ID"] = crypto.randomUUID();
  }

  return h;
}

// ─── M3U8 rewriting ─────────────────────────────────────────────────────────
function resolveUrl(url: string, baseUrl: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) {
    try { return new URL(baseUrl).origin + url; }
    catch { return baseUrl + url; }
  }
  return baseUrl + url;
}

function rewriteM3U8(content: string, manifestUrl: string): string {
  const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf("/") + 1);
  const proxyBase = `/api/proxy?url=`;
  const wrap = (u: string) => proxyBase + encodeURIComponent(resolveUrl(u, baseUrl));
  const rewriteUri = (line: string) => line.replace(/URI="([^"]+)"/gi, (_m, uri: string) => `URI="${wrap(uri)}"`);

  return content.split("\n").map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (/^#EXT-X-(KEY|MAP|MEDIA|I-FRAME-STREAM-INF|SESSION-KEY|PART|PRELOAD-HINT|RENDITION-REPORT)/i.test(t)) {
      return rewriteUri(t);
    }
    if (t.startsWith("#")) return line;
    return wrap(t);
  }).join("\n");
}

// ─── Warmup : GET / racine pour récupérer cookies anti-bot ──────────────────
async function warmup(targetUrl: string): Promise<void> {
  const domain = getDomain(targetUrl);
  if (!domain || warmupDone.has(domain)) return;
  warmupDone.add(domain);
  try {
    const origin = new URL(targetUrl).origin;
    const res = await undiciFetch(origin + "/", {
      headers: buildHeaders(origin, 0, false),
      signal: AbortSignal.timeout(6000),
      redirect: "follow",
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      const prev = cookieJar.get(domain) || "";
      cookieJar.set(domain, prev ? `${prev}; ${setCookie}` : setCookie);
    }
  } catch { /* silencieux */ }
}

// ─── Fetch via fallback CORS proxies (dernier recours) ──────────────────────
async function fetchViaFallback(targetUrl: string, isM3U8: boolean): Promise<Response | null> {
  const candidates = [...FALLBACK_PROXIES.map((f) => f(targetUrl))];
  if (isM3U8) candidates.push(...archiveFallbacks(targetUrl));

  for (const proxyUrl of candidates) {
    try {
      const res = await undiciFetch(proxyUrl, {
        headers: { "User-Agent": pick(USER_AGENTS), Accept: "*/*" },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        // undici Response -> web Response
        const buf = Buffer.from(await res.arrayBuffer());
        return new Response(buf, { status: res.status, headers: Object.fromEntries(res.headers) });
      }
    } catch { continue; }
  }
  return null;
}

// ─── Handler principal ──────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const targetUrl = request.nextUrl.searchParams.get("url");
  const isImage = request.nextUrl.pathname.includes("/image");
  const customUa = request.nextUrl.searchParams.get("ua") || undefined;
  const customRef = request.nextUrl.searchParams.get("ref") || undefined;
  const customOrigin = request.nextUrl.searchParams.get("origin") || undefined;

  if (!targetUrl) return new NextResponse("Missing 'url' parameter", { status: 400 });

  let decodedUrl: string;
  try { decodedUrl = decodeURIComponent(targetUrl); } catch { decodedUrl = targetUrl; }
  // Auto-upgrade http→https si le port n'est pas explicite
  const httpsAlt = decodedUrl.startsWith("http://") && !/:\d+\//.test(decodedUrl)
    ? decodedUrl.replace(/^http:\/\//, "https://")
    : null;

  // Cache manifest
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

  // Cache segment
  if (!isImage && /\.(ts|m4s|mp4|aac|ac3|vtt|key)(\?|$)/i.test(decodedUrl)) {
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

  const rangeHeader = request.headers.get("range");
  const maxAttempts = 10;
  let lastStatus = 0;
  let lastError = "";

  // Warmup async (n'attend pas la première fois)
  warmup(decodedUrl).catch(() => {});

  const urlCandidates = httpsAlt ? [decodedUrl, httpsAlt] : [decodedUrl];

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const activeUrl = urlCandidates[attempt % urlCandidates.length];
    try {
      if (attempt > 0) {
        // Backoff exponentiel avec jitter
        const jitter = Math.random() * 500 + Math.pow(1.7, attempt) * 120;
        await sleep(Math.min(jitter, 6000));
      }

      const headers = buildHeaders(activeUrl, attempt, isImage, {
        ua: customUa, referer: customRef, origin: customOrigin,
      });
      if (rangeHeader) headers["Range"] = rangeHeader;

      const response = await undiciFetch(activeUrl, {
        headers,
        signal: AbortSignal.timeout(30000),
        redirect: "follow",
      });

      lastStatus = response.status;

      // Cookies Set-Cookie
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) {
        const d = getDomain(activeUrl);
        const existing = cookieJar.get(d) || "";
        cookieJar.set(d, existing ? `${existing}; ${setCookie}` : setCookie);
      }

      // Codes à retry
      if ([403, 401, 451, 503, 429, 502, 504, 520, 521, 522, 523, 524, 525, 526, 527].includes(response.status)) {
        if (attempt < maxAttempts - 1) continue;
      }

      if (!response.ok && response.status !== 206) {
        lastError = `Upstream ${response.status}`;
        if (attempt < maxAttempts - 1 && response.status >= 400) continue;
      }

      const contentType = response.headers.get("content-type") || "";
      const isM3U8 =
        activeUrl.includes(".m3u8") || activeUrl.includes(".m3u") ||
        contentType.includes("mpegurl") || contentType.includes("x-mpegurl") ||
        contentType.includes("vnd.apple.mpegurl");

      // Détection HTML de challenge -> retry
      if ((contentType.includes("text/html") || contentType.includes("text/plain")) && !isImage) {
        const text = await response.text();
        if (looksBlocked(text, contentType) && attempt < maxAttempts - 1) {
          lastError = "Challenge/bot detected";
          continue;
        }
        // Peut-être un M3U8 renvoyé en text/plain
        if (text.startsWith("#EXTM3U")) {
          const rewritten = rewriteM3U8(text, activeUrl);
          manifestCache.set(decodedUrl, { content: rewritten, timestamp: Date.now() });
          return new NextResponse(rewritten, {
            status: 200,
            headers: {
              "Content-Type": "application/vnd.apple.mpegurl",
              "Access-Control-Allow-Origin": "*",
              "X-Proxy-Version": "3.0",
            },
          });
        }
        // Sinon renvoi brut
        return new NextResponse(text, {
          status: response.status,
          headers: {
            "Content-Type": contentType,
            "Access-Control-Allow-Origin": "*",
            "X-Proxy-Version": "3.0",
          },
        });
      }

      // HLS Manifest
      if (isM3U8) {
        const text = await response.text();
        const rewritten = rewriteM3U8(text, activeUrl);
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
            "X-Proxy-Version": "3.0",
          },
        });
      }

      // Images
      if (isImage) {
        const buf = Buffer.from(await response.arrayBuffer());
        return new NextResponse(buf, {
          status: response.status,
          headers: {
            "Content-Type": contentType || "image/png",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=86400, s-maxage=86400",
            "X-Proxy-Version": "3.0",
          },
        });
      }

      // Segments — cache mémoire (uniquement les petits)
      const isSegment = /\.(ts|m4s|aac|ac3|key|vtt)(\?|$)/i.test(activeUrl);
      if (isSegment && response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length < 4 * 1024 * 1024) segmentCache.set(decodedUrl, buffer);
        return new NextResponse(buffer, {
          status: response.status,
          headers: {
            "Content-Type": contentType || "video/MP2T",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS, HEAD",
            "Access-Control-Allow-Headers": "*",
            "Cache-Control": "public, max-age=60",
            "X-Proxy-Version": "3.0",
          },
        });
      }

      // Stream générique (gros mp4 / range)
      const responseHeaders = new Headers();
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Methods", "GET, OPTIONS, HEAD");
      responseHeaders.set("Access-Control-Allow-Headers", "*");
      responseHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
      responseHeaders.set("X-Proxy-Version", "3.0");
      for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"]) {
        const val = response.headers.get(h);
        if (val) responseHeaders.set(h, val);
      }
      return new NextResponse(response.body as unknown as ReadableStream, {
        status: response.status,
        headers: responseHeaders,
      });

    } catch (err) {
      lastError = err instanceof Error ? err.message : "Network error";
      if (attempt < maxAttempts - 1) continue;
    }
  }

  // ─── Dernier recours : proxies CORS publics + archive ──────────────────
  const isM3U8Final = decodedUrl.includes(".m3u");
  const fallback = await fetchViaFallback(decodedUrl, isM3U8Final);
  if (fallback && fallback.ok) {
    if (isM3U8Final) {
      const text = await fallback.text();
      const rewritten = rewriteM3U8(text, decodedUrl);
      manifestCache.set(decodedUrl, { content: rewritten, timestamp: Date.now() });
      return new NextResponse(rewritten, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "X-Proxy-Version": "3.0",
          "X-Fallback": "public-proxy",
        },
      });
    }
    return new NextResponse(await fallback.arrayBuffer(), {
      status: fallback.status,
      headers: {
        "Content-Type": fallback.headers.get("content-type") || "application/octet-stream",
        "Access-Control-Allow-Origin": "*",
        "X-Proxy-Version": "3.0",
        "X-Fallback": "public-proxy",
      },
    });
  }

  blockedDomains.set(getDomain(decodedUrl), Date.now() + 60_000);
  return new NextResponse(
    `Proxy failed after ${maxAttempts} attempts: ${lastError} (last status: ${lastStatus})`,
    { status: 502, headers: { "X-Proxy-Version": "3.0" } },
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
  const targetUrl = request.nextUrl.searchParams.get("url");
  if (!targetUrl) return new NextResponse(null, { status: 400 });
  try {
    const decodedUrl = decodeURIComponent(targetUrl);
    const headers = buildHeaders(decodedUrl, 0, false);
    const response = await undiciFetch(decodedUrl, {
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
    return new NextResponse(null, { status: response.status, headers: responseHeaders });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
