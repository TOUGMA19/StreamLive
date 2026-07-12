import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * ╔══════════════════════════════════════════════════════════════════════════════╗
 * ║  VAVOO RESOLVER                                                              ║
 * ║  Prend une URL vavoo.to (watch?live=<id> ou vavoo-iptv/play/<id>) et         ║
 * ║  renvoie l'URL HLS finale (m3u8) prête à être lue.                           ║
 * ║  Flux : ping (auth signature) → mediahubmx-resolve.json → URL finale.        ║
 * ╚══════════════════════════════════════════════════════════════════════════════╝
 */

const API_UA = "okhttp/4.11.0";
const RESOLVE_UA = "MediaHubMX/2";

// Cache in-memory de la signature (~10 min)
let cachedSig: { value: string; expiresAt: number } | null = null;
const SIG_TTL_MS = 10 * 60 * 1000;

// Cache in-memory des résolutions (~2 min : les URLs vavoo tournent souvent)
const resolveCache = new Map<string, { url: string; expiresAt: number }>();
const RESOLVE_TTL_MS = 2 * 60 * 1000;

/** Détecte si une URL est un lien vavoo.to à résoudre */
export function isVavooUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)vavoo\.(to|tv)$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** Normalise vers la forme attendue par mediahubmx-resolve : vavoo-iptv/play/<id> */
function normalizeVavooUrl(url: string): string {
  try {
    const u = new URL(url);
    // watch?live=<id>  → vavoo-iptv/play/<id>
    const liveId = u.searchParams.get("live");
    if (liveId) {
      return `https://vavoo.to/vavoo-iptv/play/${liveId}`;
    }
    // Déjà au bon format
    return url.replace(/^http:\/\//i, "https://");
  } catch {
    return url;
  }
}

async function getAuthSignature(): Promise<string | null> {
  if (cachedSig && cachedSig.expiresAt > Date.now()) return cachedSig.value;

  const uniqueId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const nowMs = Date.now();

  const body = {
    token:
      "ldCvE092e7gER0rVIajfsXIvRhwlrAzP6_1oEJ4q6HH89QHt24v6NNL_jQJO219hiLOXF2hqEfsUuEWitEIGN4EaHHEHb7Cd7gojc5SQYRFzU3XWo_kMeryAUbcwWnQrnf0-",
    reason: "app-blur",
    locale: "de",
    theme: "dark",
    metadata: {
      device: {
        type: "Handset",
        brand: "google",
        model: "Nexus",
        name: "21081111RG",
        uniqueId,
      },
      os: { name: "android", version: "7.1.2", abis: ["arm64-v8a"], host: "android" },
      app: {
        platform: "android",
        version: "1.1.0",
        buildId: "97215000",
        engine: "hbc85",
        signatures: ["6e8a975e3cbf07d5de823a760d4c2547f86c1403105020adee5de67ac510999e"],
        installer: "com.android.vending",
      },
      version: { package: "app.lokke.main", binary: "1.1.0", js: "1.1.0" },
      platform: {
        isAndroid: true,
        isIOS: false,
        isTV: false,
        isWeb: false,
        isMobile: true,
        isWebTV: false,
        isElectron: false,
      },
    },
    appFocusTime: 0,
    playerActive: false,
    playDuration: 0,
    devMode: true,
    hasAddon: true,
    castConnected: false,
    package: "app.lokke.main",
    version: "1.1.0",
    process: "app",
    firstAppStart: nowMs - 86400000,
    lastAppStart: nowMs,
    ipLocation: null,
    adblockEnabled: false,
    proxy: {
      supported: ["ss", "openvpn"],
      engine: "openvpn",
      ssVersion: 1,
      enabled: false,
      autoServer: true,
      id: "fi-hel",
    },
    iap: { supported: true },
  };

  try {
    const res = await fetch("https://www.lokke.app/api/app/ping", {
      method: "POST",
      headers: {
        "user-agent": API_UA,
        "accept": "application/json",
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const sig = json?.addonSig;
    if (typeof sig === "string" && sig.length > 0) {
      cachedSig = { value: sig, expiresAt: Date.now() + SIG_TTL_MS };
      return sig;
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveWithAuth(url: string, signature: string): Promise<string | null> {
  try {
    const res = await fetch("https://vavoo.to/mediahubmx-resolve.json", {
      method: "POST",
      headers: {
        "user-agent": RESOLVE_UA,
        "accept": "application/json",
        "content-type": "application/json; charset=utf-8",
        "mediahubmx-signature": signature,
      },
      body: JSON.stringify({
        language: "de",
        region: "AT",
        url,
        clientVersion: "3.0.2",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    if (Array.isArray(data) && data[0]?.url) return String(data[0].url);
    if (data && typeof data === "object") {
      if (data.url) return String(data.url);
      if (data.data?.url) return String(data.data.url);
    }
    return null;
  } catch {
    return null;
  }
}

export async function resolveVavoo(inputUrl: string): Promise<string | null> {
  const normalized = normalizeVavooUrl(inputUrl);

  const cached = resolveCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  let sig = await getAuthSignature();
  if (!sig) return null;

  let finalUrl = await resolveWithAuth(normalized, sig);

  // Signature peut avoir expiré → une nouvelle tentative
  if (!finalUrl) {
    cachedSig = null;
    sig = await getAuthSignature();
    if (sig) finalUrl = await resolveWithAuth(normalized, sig);
  }

  if (finalUrl) {
    resolveCache.set(normalized, { url: finalUrl, expiresAt: Date.now() + RESOLVE_TTL_MS });
    return finalUrl;
  }
  return null;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "missing ?url parameter" }, { status: 400 });
  }
  if (!isVavooUrl(url)) {
    // Rien à résoudre, on renvoie l'URL telle quelle
    return NextResponse.json({ url, resolved: false });
  }

  const resolved = await resolveVavoo(url);
  if (!resolved) {
    return NextResponse.json(
      { error: "Vavoo resolve failed", url },
      { status: 502 },
    );
  }
  return NextResponse.json(
    { url: resolved, resolved: true, source: url },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
