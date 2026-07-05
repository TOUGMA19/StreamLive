import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Universal bypass proxy — defeats CORS, geo-blocks, CDN restrictions.
 * 
 * Strategies:
 * - Rotate User-Agents to look like different browsers/platforms
 * - Spoof X-Forwarded-For with US/EU IPs to bypass geo-restrictions
 * - Set appropriate Referer/Origin to bypass hotlink protection
 * - Accept-Language headers matching target region
 * - Follow redirects transparently
 * - Rewrite HLS manifests so all sub-requests also go through proxy
 * - Retry with different header profiles on 403/451
 */

// ─── Header Profiles ───────────────────────────────────────────

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  // IPTV / media player style agents
  "VLC/3.0.20 LibVLC/3.0.20",
  "Lavf/60.16.100",
  "ExoPlayerLib/2.19.1",
  "stagefright/1.2 (Linux;Android 14)",
  "IPTVSmartersProV2",
  "Dalvik/2.1.0 (Linux; U; Android 14; SM-S928B Build/UP1A.231005.007)",
];

// Fake IPs from various regions to bypass geo-restrictions
const FORWARDED_IPS = [
  // US
  "104.28.210.170", "172.67.182.45", "34.102.136.180", "52.94.236.248",
  // UK
  "185.93.3.65", "178.62.105.3",
  // Germany
  "138.201.81.199", "78.46.225.90",
  // France
  "163.172.30.18", "51.15.242.90",
  // Netherlands
  "178.21.23.150", "89.38.97.11",
  // Canada
  "99.79.48.2", "35.182.14.5",
];

const ACCEPT_LANGUAGES = [
  "en-US,en;q=0.9",
  "en-GB,en;q=0.9",
  "fr-FR,fr;q=0.9,en;q=0.8",
  "de-DE,de;q=0.9,en;q=0.8",
  "en-US,en;q=0.9,fr;q=0.8,de;q=0.7",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildHeaders(targetUrl: string, attempt: number): Record<string, string> {
  let origin: string;
  try { origin = new URL(targetUrl).origin; } catch { origin = "https://www.google.com"; }

  const h: Record<string, string> = {
    "User-Agent": attempt < 5 ? pick(USER_AGENTS) : USER_AGENTS[attempt % USER_AGENTS.length],
    "Accept": "*/*",
    "Accept-Language": pick(ACCEPT_LANGUAGES),
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "X-Forwarded-For": pick(FORWARDED_IPS),
    "X-Real-IP": pick(FORWARDED_IPS),
    "CF-Connecting-IP": pick(FORWARDED_IPS),
    "True-Client-IP": pick(FORWARDED_IPS),
    "X-Forwarded-Proto": "https",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "Sec-CH-UA": '"Chromium";v="131", "Google Chrome";v="131", "Not_A Brand";v="24"',
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform": '"Windows"',
  };

  // Vary referer/origin strategy by attempt
  if (attempt === 0) {
    // Same-origin referer
    h["Referer"] = origin + "/";
    h["Origin"] = origin;
  } else if (attempt === 1) {
    // Google as referer
    h["Referer"] = "https://www.google.com/";
    h["Origin"] = "https://www.google.com";
  } else if (attempt === 2) {
    // No referer, no origin
    // leave them out
  } else {
    // Use the target URL as referer
    h["Referer"] = targetUrl;
    h["Origin"] = origin;
  }

  return h;
}

// ─── Main Handler ───────────────────────────────────────────

export async function GET(request: NextRequest) {
  const targetUrl = request.nextUrl.searchParams.get("url");
  if (!targetUrl) {
    return NextResponse.json({ error: "Missing 'url' parameter" }, { status: 400 });
  }

  let decodedUrl: string;
  try { decodedUrl = decodeURIComponent(targetUrl); } catch { decodedUrl = targetUrl; }

  // Forward range header from client
  const rangeHeader = request.headers.get("range");

  // Try up to 4 attempts with different header profiles
  const maxAttempts = 4;
  let lastStatus = 0;
  let lastError = "";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const headers = buildHeaders(decodedUrl, attempt);

      if (rangeHeader) {
        headers["Range"] = rangeHeader;
      }

      const response = await fetch(decodedUrl, {
        headers,
        signal: AbortSignal.timeout(30000),
        redirect: "follow",
      });

      lastStatus = response.status;

      // On 403/451/503 — try next profile
      if (response.status === 403 || response.status === 451 || response.status === 503) {
        if (attempt < maxAttempts - 1) continue;
        // Last attempt failed too — return as-is
      }

      if (!response.ok && response.status !== 206) {
        lastError = `Upstream ${response.status}`;
        if (attempt < maxAttempts - 1 && response.status >= 400) continue;
        return new NextResponse(`Upstream error: ${response.status}`, { status: response.status });
      }

      // Detect content type
      const contentType = response.headers.get("content-type") || "";
      const isM3U8 =
        decodedUrl.includes(".m3u8") ||
        contentType.includes("mpegurl") ||
        contentType.includes("x-mpegurl") ||
        contentType.includes("vnd.apple.mpegurl");

      // For HLS manifests → rewrite internal URLs
      if (isM3U8) {
        const text = await response.text();
        const rewritten = rewriteM3U8(text, decodedUrl);

        return new NextResponse(rewritten, {
          status: 200,
          headers: {
            "Content-Type": "application/vnd.apple.mpegurl",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Cache-Control": "no-cache, no-store",
          },
        });
      }

      // For everything else → stream through
      const responseHeaders = new Headers();
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      responseHeaders.set("Access-Control-Allow-Headers", "*");

      for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control"]) {
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

  return new NextResponse(`Proxy failed after ${maxAttempts} attempts: ${lastError} (last status: ${lastStatus})`, { status: 502 });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}

// ─── M3U8 Rewriting ─────────────────────────────────────────

function rewriteM3U8(content: string, manifestUrl: string): string {
  const baseUrl = manifestUrl.substring(0, manifestUrl.lastIndexOf("/") + 1);

  return content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      // Rewrite URI="..." in tags
      if (/^#EXT-X-(KEY|MAP|MEDIA|I-FRAME-STREAM-INF)/i.test(trimmed)) {
        return trimmed.replace(/URI="([^"]+)"/gi, (_m, uri: string) => {
          return `URI="${proxyUrl(resolveUrl(uri, baseUrl))}"`;
        });
      }

      // Skip other tags
      if (trimmed.startsWith("#")) return line;

      // URL line → proxy it
      return proxyUrl(resolveUrl(trimmed, baseUrl));
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

function proxyUrl(url: string): string {
  return `/api/proxy?url=${encodeURIComponent(url)}`;
}
